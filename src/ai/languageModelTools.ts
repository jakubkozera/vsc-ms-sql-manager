import * as vscode from 'vscode';
import { DatabaseToolsService, TargetPicker } from './databaseToolsService';
import { DatabaseTarget, describeTarget, isReadOnlySql } from './sqlAgentCore';

/** Names must match `contributes.languageModelTools` in package.json. */
export const LM_TOOL_NAMES = {
    listDatabases: 'mssql_list_databases',
    getSchema: 'mssql_get_schema',
    runQuery: 'mssql_run_query',
    openQuery: 'mssql_open_query'
} as const;

interface TargetInput {
    connectionId?: string;
    database?: string;
}

export interface GetSchemaInput extends TargetInput {
    objects?: string[];
}

export interface RunQueryInput extends TargetInput {
    sql: string;
    maxRows?: number;
}

export interface OpenQueryInput extends TargetInput {
    sql: string;
    execute?: boolean;
}

/** Asks the user in VS Code which database to use when it can't be inferred. */
export const quickPickTargetPicker: TargetPicker = {
    async pickTarget(candidates: DatabaseTarget[]): Promise<DatabaseTarget | undefined> {
        const picked = await vscode.window.showQuickPick(
            candidates.map(target => ({
                label: target.database,
                description: `${target.connectionName} (${target.server})`,
                detail: target.connectionType === 'server' ? 'Server connection' : 'Database connection',
                target
            })),
            {
                title: 'MS SQL Manager: Which database should Copilot use?',
                placeHolder: 'Multiple databases are available — select the one for this request',
                ignoreFocusOut: true,
                matchOnDescription: true
            }
        );
        return picked?.target;
    }
};

const textResult = (text: string) => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);

const targetSuffix = (input: TargetInput): string => {
    if (input.database && input.connectionId) {
        return ` on ${input.database} (${input.connectionId})`;
    }
    if (input.database) {
        return ` on ${input.database}`;
    }
    return '';
};

export class ListDatabasesTool implements vscode.LanguageModelTool<Record<string, never>> {
    constructor(private readonly service: DatabaseToolsService) {}

    async invoke(): Promise<vscode.LanguageModelToolResult> {
        const targets = await this.service.listTargets();
        return textResult(this.service.describeTargets(targets));
    }

    prepareInvocation(): vscode.PreparedToolInvocation {
        return { invocationMessage: 'Listing SQL Server databases' };
    }
}

export class GetSchemaTool implements vscode.LanguageModelTool<GetSchemaInput> {
    constructor(private readonly service: DatabaseToolsService, private readonly picker: TargetPicker = quickPickTargetPicker) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<GetSchemaInput>): Promise<vscode.LanguageModelToolResult> {
        const target = await this.service.resolveTarget(options.input, this.picker);
        return textResult(await this.service.getSchemaContext(target, options.input.objects));
    }

    prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<GetSchemaInput>): vscode.PreparedToolInvocation {
        const objects = options.input.objects?.length ? ` (${options.input.objects.join(', ')})` : '';
        return { invocationMessage: `Reading database schema${objects}${targetSuffix(options.input)}` };
    }
}

export class RunQueryTool implements vscode.LanguageModelTool<RunQueryInput> {
    constructor(private readonly service: DatabaseToolsService, private readonly picker: TargetPicker = quickPickTargetPicker) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<RunQueryInput>): Promise<vscode.LanguageModelToolResult> {
        const target = await this.service.resolveTarget(options.input, this.picker);
        return textResult(await this.service.runQuery(target, options.input.sql, options.input.maxRows));
    }

    prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<RunQueryInput>): vscode.PreparedToolInvocation {
        const readOnly = isReadOnlySql(options.input.sql ?? '');
        const where = targetSuffix(options.input);
        const message = new vscode.MarkdownString();
        if (!readOnly) {
            message.appendMarkdown('**This statement may modify data or schema.**\n\n');
        }
        message.appendCodeblock(options.input.sql ?? '', 'sql');
        return {
            invocationMessage: `Running SQL query${where}`,
            confirmationMessages: {
                title: readOnly ? `Run SQL query${where}?` : `Run data-modifying SQL${where}?`,
                message
            }
        };
    }
}

export class OpenQueryTool implements vscode.LanguageModelTool<OpenQueryInput> {
    constructor(private readonly service: DatabaseToolsService, private readonly picker: TargetPicker = quickPickTargetPicker) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<OpenQueryInput>): Promise<vscode.LanguageModelToolResult> {
        const target = await this.service.resolveTarget(options.input, this.picker);
        await vscode.commands.executeCommand(
            'mssqlManager.newQuery',
            { connectionId: target.connectionId, database: target.database, name: target.connectionName },
            options.input.sql,
            options.input.execute === true
        );
        return textResult(`Opened the query in a new MS SQL Manager editor for ${describeTarget(target)}${options.input.execute ? ' and started executing it' : ''}.`);
    }

    prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<OpenQueryInput>): vscode.PreparedToolInvocation {
        const where = targetSuffix(options.input);
        if (!options.input.execute) {
            return { invocationMessage: `Opening query in SQL editor${where}` };
        }
        const message = new vscode.MarkdownString();
        message.appendCodeblock(options.input.sql ?? '', 'sql');
        return {
            invocationMessage: `Opening and executing query in SQL editor${where}`,
            confirmationMessages: { title: `Open and execute this query${where}?`, message }
        };
    }
}

export function registerLanguageModelTools(context: vscode.ExtensionContext, service: DatabaseToolsService): void {
    context.subscriptions.push(
        vscode.lm.registerTool(LM_TOOL_NAMES.listDatabases, new ListDatabasesTool(service)),
        vscode.lm.registerTool(LM_TOOL_NAMES.getSchema, new GetSchemaTool(service)),
        vscode.lm.registerTool(LM_TOOL_NAMES.runQuery, new RunQueryTool(service)),
        vscode.lm.registerTool(LM_TOOL_NAMES.openQuery, new OpenQueryTool(service))
    );
}
