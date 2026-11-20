import * as vscode from 'vscode';
import * as http from 'http';
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AmbiguousTargetError, DatabaseToolsService, MAX_ROWS_LIMIT, TargetPicker } from './databaseToolsService';
import { DatabaseTarget, describeTarget, isReadOnlySql, targetKey } from './sqlAgentCore';

export const MCP_SERVER_NAME = 'mssql-manager';
export const MCP_DEFAULT_PORT = 47815;
const MCP_TOKEN_SECRET_KEY = 'mssqlManager.mcp.token';
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export const MCP_SERVER_INSTRUCTIONS = [
    'Tools for Microsoft SQL Server databases connected in the MS SQL Manager VS Code extension.',
    'Before writing or running any SQL, call get_schema for the target database and use only objects it returns — never guess table or column names.',
    'get_schema also returns database-specific instructions written by the user; always follow them.',
    'If several databases are connected and the user did not say which one to use, call list_databases and ask the user; then pass connectionId and database explicitly.',
    'Reuse the same connectionId and database in follow-up calls.'
].join('\n');

/** Asks the human to confirm a data-modifying statement when the MCP client can't. */
export type WriteConfirmationFallback = (sql: string, target: DatabaseTarget) => Promise<boolean>;

export const vscodeWriteConfirmation: WriteConfirmationFallback = async (sql, target) => {
    const choice = await vscode.window.showWarningMessage(
        `An MCP client wants to run a data-modifying statement on ${describeTarget(target)}.`,
        { modal: true, detail: sql.length > 2000 ? `${sql.slice(0, 2000)}…` : sql },
        'Execute'
    );
    return choice === 'Execute';
};

const targetShape = {
    connectionId: z.string().optional().describe('Connection id (or connection name) from list_databases. Omit to infer.'),
    database: z.string().optional().describe('Database name. Omit to infer from the connection or previous calls.')
};

const toolError = (message: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text: message }] });
const toolText = (text: string): CallToolResult => ({ content: [{ type: 'text', text }] });

/**
 * Build an MCP server exposing the database tools. Target ambiguity is resolved with
 * MCP elicitation when the client supports it; otherwise the agent gets the list of
 * candidates and is told to ask the user.
 */
export function createSqlMcpServer(
    service: DatabaseToolsService,
    version: string,
    confirmWriteFallback: WriteConfirmationFallback = vscodeWriteConfirmation
): McpServer {
    const mcp = new McpServer({ name: MCP_SERVER_NAME, version }, { instructions: MCP_SERVER_INSTRUCTIONS });

    const supportsElicitation = () => !!mcp.server.getClientCapabilities()?.elicitation;

    const createPicker = (requestId: string | number): TargetPicker | undefined => {
        if (!supportsElicitation()) {
            return undefined;
        }
        return {
            async pickTarget(candidates) {
                const result = await mcp.server.elicitInput({
                    message: 'Multiple SQL Server databases are connected in MS SQL Manager. Which one should be used?',
                    requestedSchema: {
                        type: 'object',
                        properties: {
                            target: {
                                type: 'string',
                                title: 'Database',
                                enum: candidates.map(targetKey),
                                enumNames: candidates.map(describeTarget)
                            }
                        },
                        required: ['target']
                    }
                }, { relatedRequestId: requestId });
                if (result.action !== 'accept') {
                    return undefined;
                }
                return candidates.find(c => targetKey(c) === result.content?.target);
            }
        };
    };

    const confirmWrite = async (sql: string, target: DatabaseTarget, requestId: string | number): Promise<boolean> => {
        if (!supportsElicitation()) {
            return confirmWriteFallback(sql, target);
        }
        const result = await mcp.server.elicitInput({
            message: `Execute this data-modifying statement on ${describeTarget(target)}?\n\n${sql}`,
            requestedSchema: {
                type: 'object',
                properties: {
                    confirm: { type: 'boolean', title: 'Execute the statement', default: false }
                },
                required: ['confirm']
            }
        }, { relatedRequestId: requestId });
        return result.action === 'accept' && result.content?.confirm === true;
    };

    const run = async (action: () => Promise<string>): Promise<CallToolResult> => {
        try {
            return toolText(await action());
        } catch (error) {
            if (error instanceof AmbiguousTargetError) {
                return toolError(error.message);
            }
            return toolError(error instanceof Error ? error.message : String(error));
        }
    };

    mcp.registerTool('list_databases', {
        title: 'List connected databases',
        description: 'List the SQL Server connections and databases currently connected in MS SQL Manager, including their connectionId values. Use it when the target database is unclear.',
        annotations: { readOnlyHint: true, openWorldHint: false }
    }, async () => run(async () => service.describeTargets(await service.listTargets())));

    mcp.registerTool('get_schema', {
        title: 'Get database schema and instructions',
        description: 'Return the schema of a SQL Server database (tables with columns, keys and indexes, views, procedures, functions), the server version and the user\'s database-specific instructions. ALWAYS call this before writing SQL so that only existing objects are used.',
        inputSchema: {
            ...targetShape,
            objects: z.array(z.string()).optional().describe('Optional list of object names (e.g. "dbo.Orders", "Customer*") to limit the output. Use it for large databases.')
        },
        annotations: { readOnlyHint: true, openWorldHint: false }
    }, async (args, extra) => run(async () => {
        const target = await service.resolveTarget(args, createPicker(extra.requestId));
        return service.getSchemaContext(target, args.objects);
    }));

    mcp.registerTool('run_query', {
        title: 'Run T-SQL query',
        description: 'Execute T-SQL against a SQL Server database and return the result sets as JSON. Call get_schema first. Data-modifying statements require confirmation by the user.',
        inputSchema: {
            ...targetShape,
            sql: z.string().describe('The T-SQL to execute.'),
            maxRows: z.number().int().min(1).max(MAX_ROWS_LIMIT).optional().describe('Maximum rows returned per result set (default 100).')
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
    }, async (args, extra) => run(async () => {
        const target = await service.resolveTarget(args, createPicker(extra.requestId));
        if (!isReadOnlySql(args.sql) && !(await confirmWrite(args.sql, target, extra.requestId))) {
            throw new Error('The user declined to execute this data-modifying statement. Do not retry it without asking the user.');
        }
        return service.runQuery(target, args.sql, args.maxRows);
    }));

    return mcp;
}

export function isAuthorizedRequest(authorization: string | undefined, token: string): boolean {
    if (!authorization || !token) {
        return false;
    }
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        return false;
    }
    const provided = Buffer.from(match[1].trim());
    const expected = Buffer.from(token);
    return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('Request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined);
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

function sendJsonError(res: http.ServerResponse, status: number, message: string): void {
    if (res.headersSent) {
        return;
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

/**
 * Local Streamable HTTP MCP server (127.0.0.1 only, bearer-token protected) hosted in the
 * extension host so any MCP client can reuse the connections opened in MS SQL Manager.
 */
export class SqlMcpHttpServer implements vscode.Disposable {
    private httpServer: http.Server | undefined;
    private port: number | undefined;
    private token = '';
    private readonly sessions = new Map<string, StreamableHTTPServerTransport>();

    constructor(
        private readonly secrets: vscode.SecretStorage,
        private readonly service: DatabaseToolsService,
        private readonly outputChannel: vscode.OutputChannel,
        private readonly version: string,
        private readonly confirmWriteFallback: WriteConfirmationFallback = vscodeWriteConfirmation
    ) {}

    get isRunning(): boolean {
        return !!this.httpServer;
    }

    get url(): string | undefined {
        return this.port ? `http://127.0.0.1:${this.port}/mcp` : undefined;
    }

    async getToken(): Promise<string> {
        if (!this.token) {
            let token = await this.secrets.get(MCP_TOKEN_SECRET_KEY);
            if (!token) {
                token = randomBytes(32).toString('hex');
                await this.secrets.store(MCP_TOKEN_SECRET_KEY, token);
            }
            this.token = token;
        }
        return this.token;
    }

    async start(port: number): Promise<void> {
        if (this.httpServer) {
            return;
        }
        await this.getToken();

        const server = http.createServer((req, res) => {
            this.handle(req, res).catch(error => {
                this.outputChannel.appendLine(`[MCP] Request failed: ${error}`);
                sendJsonError(res, 500, 'Internal server error');
            });
        });

        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, '127.0.0.1', () => {
                server.off('error', reject);
                resolve();
            });
        });

        this.httpServer = server;
        const address = server.address();
        this.port = typeof address === 'object' && address ? address.port : port;
        this.outputChannel.appendLine(`[MCP] Server listening on ${this.url}`);
    }

    async stop(): Promise<void> {
        for (const transport of this.sessions.values()) {
            await transport.close().catch(() => undefined);
        }
        this.sessions.clear();
        const server = this.httpServer;
        this.httpServer = undefined;
        this.port = undefined;
        if (server) {
            server.closeAllConnections?.();
            await new Promise<void>(resolve => server.close(() => resolve()));
            this.outputChannel.appendLine('[MCP] Server stopped');
        }
    }

    dispose(): void {
        void this.stop();
    }

    /** Configuration snippet for MCP clients (`mcpServers` format). */
    async getClientConfig(): Promise<string> {
        if (!this.url) {
            throw new Error('The MCP server is not running.');
        }
        return JSON.stringify({
            mcpServers: {
                [MCP_SERVER_NAME]: {
                    type: 'http',
                    url: this.url,
                    headers: { Authorization: `Bearer ${await this.getToken()}` }
                }
            }
        }, null, 2);
    }

    private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const path = (req.url ?? '/').split('?')[0];
        if (path !== '/mcp') {
            sendJsonError(res, 404, 'Not found');
            return;
        }
        if (!isAuthorizedRequest(req.headers.authorization, this.token)) {
            res.setHeader('WWW-Authenticate', 'Bearer');
            sendJsonError(res, 401, 'Unauthorized');
            return;
        }

        const sessionHeader = req.headers['mcp-session-id'];
        const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
        const body = req.method === 'POST' ? await readJsonBody(req) : undefined;

        let transport = sessionId ? this.sessions.get(sessionId) : undefined;
        if (!transport) {
            if (sessionId) {
                sendJsonError(res, 404, 'Session not found');
                return;
            }
            if (req.method !== 'POST' || !isInitializeRequest(body)) {
                sendJsonError(res, 400, 'Bad Request: no valid session ID provided');
                return;
            }
            transport = this.createSessionTransport();
            await createSqlMcpServer(this.service, this.version, this.confirmWriteFallback).connect(transport);
        }

        await transport.handleRequest(req, res, body);
    }

    private createSessionTransport(): StreamableHTTPServerTransport {
        const port = this.port;
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableDnsRebindingProtection: true,
            allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
            onsessioninitialized: id => {
                this.sessions.set(id, transport);
            },
            onsessionclosed: id => {
                this.sessions.delete(id);
            }
        });
        transport.onclose = () => {
            if (transport.sessionId) {
                this.sessions.delete(transport.sessionId);
            }
        };
        return transport;
    }
}
