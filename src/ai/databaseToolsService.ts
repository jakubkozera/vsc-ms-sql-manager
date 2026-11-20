import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { SchemaContextBuilder } from '../schemaContextBuilder';
import { DatabaseInstructionsManager } from '../databaseInstructions';
import {
    DatabaseTarget,
    SQL_AGENT_GUIDELINES,
    SYSTEM_DATABASES,
    TargetHint,
    TargetRequest,
    describeTarget,
    filterSchemaText,
    formatQueryResult,
    formatTargetLine,
    limitSchemaText,
    selectTarget
} from './sqlAgentCore';

/** Interactive way of asking the user which database to use (QuickPick, MCP elicitation, ...). */
export interface TargetPicker {
    pickTarget(candidates: DatabaseTarget[]): Promise<DatabaseTarget | undefined>;
}

export class AmbiguousTargetError extends Error {
    constructor(public readonly candidates: DatabaseTarget[]) {
        super(
            'Multiple databases are available and the target could not be inferred. ' +
            'Ask the user which one to use, then call the tool again with both "connectionId" and "database".\n' +
            'Available targets:\n' +
            candidates.map(c => `- ${formatTargetLine(c)}`).join('\n')
        );
        this.name = 'AmbiguousTargetError';
    }
}

export class TargetSelectionCancelledError extends Error {
    constructor() {
        super('The user cancelled the database selection. Ask the user which database should be used before trying again.');
        this.name = 'TargetSelectionCancelledError';
    }
}

const PREFERRED_TARGET_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_MAX_ROWS = 100;
export const MAX_ROWS_LIMIT = 1000;

/**
 * Shared backend for the Copilot language model tools and the MCP server:
 * resolves which connection/database to use, provides schema + database instructions
 * (so agents don't hallucinate object names) and executes queries.
 */
export class DatabaseToolsService {
    private preferredTarget: { hint: TargetHint; at: number } | undefined;

    constructor(
        private readonly connectionProvider: ConnectionProvider,
        private readonly schemaContextBuilder: SchemaContextBuilder,
        private readonly instructionsManager: DatabaseInstructionsManager,
        private readonly outputChannel: vscode.OutputChannel,
        private readonly getEditorHint: () => TargetHint | undefined = () => undefined
    ) {}

    /** Remember the database the user is working with, used to break ties when a tool call doesn't specify one. */
    setPreferredTarget(hint: TargetHint): void {
        this.preferredTarget = { hint, at: Date.now() };
    }

    getPreferredTarget(): TargetHint | undefined {
        if (!this.preferredTarget || Date.now() - this.preferredTarget.at > PREFERRED_TARGET_TTL_MS) {
            return undefined;
        }
        return this.preferredTarget.hint;
    }

    /** All databases reachable through active connections. */
    async listTargets(): Promise<DatabaseTarget[]> {
        const targets: DatabaseTarget[] = [];

        for (const { id, config, connection } of this.connectionProvider.getAllActiveConnections()) {
            const base = {
                connectionId: id,
                connectionName: config.name || config.server,
                server: config.server
            };

            if (config.connectionType === 'server') {
                try {
                    const result = await connection.request().query(
                        'SELECT name FROM sys.databases WHERE state = 0 AND HAS_DBACCESS(name) = 1 ORDER BY name'
                    );
                    for (const row of (result.recordset ?? []) as { name: string }[]) {
                        targets.push({
                            ...base,
                            connectionType: 'server',
                            database: row.name,
                            isSystemDatabase: SYSTEM_DATABASES.has(row.name.toLowerCase())
                        });
                    }
                } catch (error) {
                    this.outputChannel.appendLine(`[DatabaseTools] Failed to list databases for ${id}: ${error}`);
                }
            } else {
                const database = config.database || 'master';
                targets.push({
                    ...base,
                    connectionType: 'database',
                    database,
                    isSystemDatabase: SYSTEM_DATABASES.has(database.toLowerCase())
                });
            }
        }

        return targets;
    }

    /**
     * Resolve the target database. Without a picker, ambiguity raises {@link AmbiguousTargetError}
     * so the calling agent can ask the user in the conversation.
     */
    async resolveTarget(request: TargetRequest, picker?: TargetPicker): Promise<DatabaseTarget> {
        const all = await this.listTargets();
        const selection = selectTarget(all, request, [this.getPreferredTarget(), this.getEditorHint()]);

        let target: DatabaseTarget;
        if (selection.kind === 'none') {
            throw new Error(selection.message);
        } else if (selection.kind === 'resolved') {
            target = selection.target;
        } else {
            if (!picker) {
                throw new AmbiguousTargetError(selection.candidates);
            }
            const picked = await picker.pickTarget(selection.candidates);
            if (!picked) {
                throw new TargetSelectionCancelledError();
            }
            target = picked;
        }

        this.setPreferredTarget({ connectionId: target.connectionId, database: target.database });
        return target;
    }

    describeTargets(targets: DatabaseTarget[]): string {
        if (targets.length === 0) {
            return 'There are no active SQL Server connections in MS SQL Manager. Ask the user to connect first.';
        }
        const preferred = this.getPreferredTarget() ?? this.getEditorHint();
        const lines = targets.map(t => {
            const isCurrent = preferred && preferred.connectionId === t.connectionId &&
                (!preferred.database || preferred.database.toLowerCase() === t.database.toLowerCase());
            return `- ${formatTargetLine(t)}${t.isSystemDatabase ? ' [system]' : ''}${isCurrent ? ' [current]' : ''}`;
        });
        return `Active databases (${targets.length}):\n${lines.join('\n')}\n\nPass "connectionId" and "database" to the other tools to choose a target explicitly.`;
    }

    /** Schema (CREATE statements) + linked database instructions + server version for the target. */
    async getSchemaContext(target: DatabaseTarget, objects?: string[]): Promise<string> {
        const schemaText = await this.schemaContextBuilder.buildSchemaContext(target.connectionId, target.database);
        const schemaBody = objects && objects.length > 0
            ? filterSchemaText(schemaText, objects)
            : limitSchemaText(schemaText);

        const instructions = await this.loadInstructions(target);
        const serverInfo = await this.getServerInfo(target);

        const parts = [
            `Target: ${formatTargetLine(target)}`,
            serverInfo ? `Server: ${serverInfo}` : '',
            instructions
                ? `## Database-specific instructions (must be followed)\n${instructions}`
                : '',
            `## Schema\n\`\`\`sql\n${schemaBody}\n\`\`\``,
            SQL_AGENT_GUIDELINES
        ];
        return parts.filter(Boolean).join('\n\n');
    }

    async runQuery(target: DatabaseTarget, sql: string, maxRows: number = DEFAULT_MAX_ROWS): Promise<string> {
        if (!sql || !sql.trim()) {
            throw new Error('The "sql" parameter is empty. Provide the T-SQL to execute.');
        }
        const rowLimit = Math.min(Math.max(1, Math.floor(maxRows || DEFAULT_MAX_ROWS)), MAX_ROWS_LIMIT);
        const pool = await this.getPool(target);

        const started = Date.now();
        const result = await pool.request().query(sql);
        const elapsed = Date.now() - started;

        this.outputChannel.appendLine(`[DatabaseTools] Executed query on ${describeTarget(target)} in ${elapsed}ms`);
        return `Target: ${formatTargetLine(target)}\n${formatQueryResult(result, elapsed, rowLimit)}`;
    }

    private async getPool(target: DatabaseTarget) {
        if (target.connectionType === 'server') {
            return this.connectionProvider.ensureConnectionAndGetDbPool(target.connectionId, target.database);
        }
        const pool = this.connectionProvider.getConnection(target.connectionId);
        if (!pool) {
            throw new Error(`Connection "${target.connectionName}" is no longer active. Ask the user to reconnect in MS SQL Manager.`);
        }
        return pool;
    }

    private async loadInstructions(target: DatabaseTarget): Promise<string | null> {
        try {
            const database = target.connectionType === 'server' ? target.database : undefined;
            return await this.instructionsManager.loadInstructions(target.connectionId, database);
        } catch (error) {
            this.outputChannel.appendLine(`[DatabaseTools] Failed to load database instructions: ${error}`);
            return null;
        }
    }

    private async getServerInfo(target: DatabaseTarget): Promise<string | undefined> {
        try {
            const pool = await this.getPool(target);
            const result = await pool.request().query(
                "SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(128)) AS version, " +
                "CAST(SERVERPROPERTY('Edition') AS NVARCHAR(128)) AS edition, " +
                'compatibility_level AS compatibilityLevel FROM sys.databases WHERE name = DB_NAME()'
            );
            const row = result.recordset?.[0] as { version?: string; edition?: string; compatibilityLevel?: number } | undefined;
            if (!row) {
                return undefined;
            }
            return `SQL Server ${row.version} (${row.edition}), database compatibility level ${row.compatibilityLevel}`;
        } catch (error) {
            this.outputChannel.appendLine(`[DatabaseTools] Failed to read server info: ${error}`);
            return undefined;
        }
    }
}
