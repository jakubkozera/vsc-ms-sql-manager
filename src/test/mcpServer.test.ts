import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { SqlMcpHttpServer, createSqlMcpServer, isAuthorizedRequest } from '../ai/mcpServer';
import { DatabaseToolsService } from '../ai/databaseToolsService';
import { FakeConnection, createServiceFixture } from './helpers/databaseToolsFixtures';

type ToolResult = { isError?: boolean; content: { type: string; text?: string }[] };
const textOf = (result: unknown) => (result as ToolResult).content.map(c => c.text ?? '').join('');

async function connectClient(
    service: DatabaseToolsService,
    options: { elicit?: (params: any) => ElicitResult; confirmFallback?: sinon.SinonStub } = {}
) {
    const server = createSqlMcpServer(service, '1.0.0-test', options.confirmFallback ?? sinon.stub().resolves(false));
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: options.elicit ? { elicitation: {} } : {} });
    if (options.elicit) {
        const elicit = options.elicit;
        client.setRequestHandler(ElicitRequestSchema, async request => elicit(request.params));
    }
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { client, server };
}

const twoDatabases: FakeConnection[] = [
    { id: 'srv', name: 'Local', server: 'localhost', connectionType: 'server', databases: ['master', 'Sales', 'Hr'] }
];

suite('MCP server', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('exposes the database tools and usage instructions', async () => {
        const { service } = createServiceFixture(sandbox, twoDatabases);
        const { client } = await connectClient(service);

        const tools = await client.listTools();
        assert.deepStrictEqual(tools.tools.map(t => t.name).sort(), ['get_schema', 'list_databases', 'run_query']);
        assert.ok(client.getInstructions()?.includes('call get_schema'));
        const runQuery = tools.tools.find(t => t.name === 'run_query')!;
        assert.strictEqual(runQuery.annotations?.destructiveHint, true);
        await client.close();
    });

    test('list_databases returns connection ids and databases', async () => {
        const { service } = createServiceFixture(sandbox, twoDatabases);
        const { client } = await connectClient(service);
        const text = textOf(await client.callTool({ name: 'list_databases', arguments: {} }));
        assert.ok(text.includes('connectionId="srv", database="Sales"'));
        await client.close();
    });

    test('get_schema without elicitation support asks the agent to clarify the database', async () => {
        const { service } = createServiceFixture(sandbox, twoDatabases);
        const { client } = await connectClient(service);

        const result = await client.callTool({ name: 'get_schema', arguments: {} }) as ToolResult;

        assert.strictEqual(result.isError, true);
        assert.ok(textOf(result).includes('Ask the user which one to use'));
        assert.ok(textOf(result).includes('database="Hr"'));
        await client.close();
    });

    test('get_schema elicits the database from the user when the client supports it', async () => {
        const { service } = createServiceFixture(sandbox, twoDatabases);
        let elicitedOptions: string[] = [];
        const { client } = await connectClient(service, {
            elicit: params => {
                elicitedOptions = params.requestedSchema.properties.target.enum;
                return { action: 'accept', content: { target: 'srv::Hr' } };
            }
        });

        const result = await client.callTool({ name: 'get_schema', arguments: {} }) as ToolResult;

        assert.deepStrictEqual(elicitedOptions, ['srv::Sales', 'srv::Hr']);
        assert.ok(!result.isError);
        assert.ok(textOf(result).includes('database="Hr"'));
        assert.ok(textOf(result).includes('CREATE TABLE [dbo].[Orders]'));
        await client.close();
    });

    test('declined elicitation is reported as a cancellation', async () => {
        const { service } = createServiceFixture(sandbox, twoDatabases);
        const { client } = await connectClient(service, { elicit: () => ({ action: 'decline' }) });
        const result = await client.callTool({ name: 'get_schema', arguments: {} }) as ToolResult;
        assert.strictEqual(result.isError, true);
        assert.ok(textOf(result).includes('cancelled the database selection'));
        await client.close();
    });

    test('run_query executes read-only SQL without confirmation', async () => {
        const fixture = createServiceFixture(sandbox, twoDatabases);
        const confirmFallback = sandbox.stub().resolves(false);
        const { client } = await connectClient(fixture.service, { confirmFallback });

        const result = await client.callTool({ name: 'run_query', arguments: { sql: 'SELECT Id FROM dbo.Customers', database: 'Sales' } }) as ToolResult;

        assert.ok(!result.isError, textOf(result));
        assert.ok(textOf(result).includes('"Name": "Alice"'));
        sinon.assert.notCalled(confirmFallback);
        await client.close();
    });

    test('run_query asks for confirmation through elicitation before modifying data', async () => {
        const fixture = createServiceFixture(sandbox, twoDatabases);
        const { client } = await connectClient(fixture.service, { elicit: () => ({ action: 'accept', content: { confirm: false } }) });

        const result = await client.callTool({ name: 'run_query', arguments: { sql: 'DELETE FROM dbo.Orders', database: 'Sales' } }) as ToolResult;

        assert.strictEqual(result.isError, true);
        assert.ok(textOf(result).includes('declined'));
        sinon.assert.neverCalledWith(fixture.dbPool.query, 'DELETE FROM dbo.Orders');

        const { client: approvingClient } = await connectClient(fixture.service, { elicit: () => ({ action: 'accept', content: { confirm: true } }) });
        const approved = await approvingClient.callTool({ name: 'run_query', arguments: { sql: 'DELETE FROM dbo.Orders', database: 'Sales' } }) as ToolResult;
        assert.ok(!approved.isError, textOf(approved));
        sinon.assert.calledWith(fixture.dbPool.query, 'DELETE FROM dbo.Orders');
        await client.close();
        await approvingClient.close();
    });

    test('run_query falls back to VS Code confirmation when the client cannot elicit', async () => {
        const fixture = createServiceFixture(sandbox, twoDatabases);
        const confirmFallback = sandbox.stub().resolves(true);
        const { client } = await connectClient(fixture.service, { confirmFallback });

        const result = await client.callTool({ name: 'run_query', arguments: { sql: 'UPDATE dbo.Orders SET Id = 1 WHERE Id = 2', database: 'Sales' } }) as ToolResult;

        assert.ok(!result.isError, textOf(result));
        sinon.assert.calledOnce(confirmFallback);
        await client.close();
    });

    test('isAuthorizedRequest validates bearer tokens', () => {
        assert.strictEqual(isAuthorizedRequest('Bearer abc', 'abc'), true);
        assert.strictEqual(isAuthorizedRequest('bearer abc', 'abc'), true);
        assert.strictEqual(isAuthorizedRequest('Bearer abd', 'abc'), false);
        assert.strictEqual(isAuthorizedRequest('Bearer abcd', 'abc'), false);
        assert.strictEqual(isAuthorizedRequest('Basic abc', 'abc'), false);
        assert.strictEqual(isAuthorizedRequest(undefined, 'abc'), false);
        assert.strictEqual(isAuthorizedRequest('Bearer ', ''), false);
    });

    suite('HTTP transport', () => {
        let httpServer: SqlMcpHttpServer;
        let storedSecrets: Map<string, string>;

        setup(async () => {
            storedSecrets = new Map();
            const secrets = {
                get: async (key: string) => storedSecrets.get(key),
                store: async (key: string, value: string) => { storedSecrets.set(key, value); },
                delete: async (key: string) => { storedSecrets.delete(key); },
                onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
            } as unknown as vscode.SecretStorage;
            const { service } = createServiceFixture(sandbox, twoDatabases);
            httpServer = new SqlMcpHttpServer(secrets, service, { appendLine: () => undefined } as unknown as vscode.OutputChannel, '1.0.0-test');
            await httpServer.start(0);
        });

        teardown(async () => {
            await httpServer.stop();
        });

        test('listens on 127.0.0.1 and persists a generated token', async () => {
            assert.ok(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(httpServer.url!));
            const token = await httpServer.getToken();
            assert.strictEqual(token.length, 64);
            assert.strictEqual(storedSecrets.get('mssqlManager.mcp.token'), token);
            const config = JSON.parse(await httpServer.getClientConfig());
            assert.strictEqual(config.mcpServers['mssql-manager'].url, httpServer.url);
            assert.strictEqual(config.mcpServers['mssql-manager'].headers.Authorization, `Bearer ${token}`);
        });

        test('rejects requests without a valid token', async () => {
            const response = await fetch(httpServer.url!, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
            });
            assert.strictEqual(response.status, 401);

            const wrong = await fetch(httpServer.url!, {
                method: 'POST',
                headers: { Authorization: 'Bearer wrong', 'Content-Type': 'application/json' },
                body: '{}'
            });
            assert.strictEqual(wrong.status, 401);
        });

        test('rejects non-initialize requests without a session', async () => {
            const response = await fetch(httpServer.url!, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${await httpServer.getToken()}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream'
                },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
            });
            assert.strictEqual(response.status, 400);
        });

        test('serves MCP clients authenticated with the token', async () => {
            const client = new Client({ name: 'http-client', version: '1.0.0' });
            const transport = new StreamableHTTPClientTransport(new URL(httpServer.url!), {
                requestInit: { headers: { Authorization: `Bearer ${await httpServer.getToken()}` } }
            });
            await client.connect(transport);

            const tools = await client.listTools();
            assert.ok(tools.tools.some(t => t.name === 'get_schema'));
            const text = textOf(await client.callTool({ name: 'get_schema', arguments: { database: 'Sales' } }));
            assert.ok(text.includes('database="Sales"'));

            await client.close();
        });
    });
});
