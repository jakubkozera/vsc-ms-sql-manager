import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { DatabaseToolsService } from '../../ai/databaseToolsService';

export const SAMPLE_SCHEMA = [
    '-- Database Schema for: Sales',
    '-- Connection: conn-server',
    '-- Last Updated: 2026-01-01T00:00:00.000Z',
    '',
    '-- TABLES (2)',
    'CREATE TABLE [dbo].[Customers] (',
    '    [Id] INT NOT NULL,',
    '    [Name] NVARCHAR(100) NOT NULL,',
    '    CONSTRAINT [PK_Customers] PRIMARY KEY ([Id])',
    '); -- Rows: 10',
    '',
    'CREATE TABLE [dbo].[Orders] (',
    '    [Id] INT NOT NULL,',
    '    [CustomerId] INT NOT NULL,',
    '    CONSTRAINT [PK_Orders] PRIMARY KEY ([Id])',
    ');',
    '',
    '-- VIEWS (1)',
    'CREATE VIEW [report].[OrderTotals] AS SELECT',
    '    -- Column information not available',
    '    *',
    'FROM [YourTable]; -- View definition not available',
    '',
    '-- STORED PROCEDURES (2)',
    '-- EXEC [dbo].[GetCustomer]',
    '-- EXEC [dbo].[DeleteOrder]',
    '',
    '-- FUNCTIONS (1)',
    '-- SELECT [dbo].[fnTotal]()',
    ''
].join('\n');

export interface FakeConnection {
    id: string;
    name: string;
    server: string;
    connectionType: 'server' | 'database';
    database?: string;
    databases?: string[];
}

export function createFakePool(sandbox: sinon.SinonSandbox, databases: string[] = []) {
    const query = sandbox.stub().callsFake(async (sql: string) => {
        if (sql.includes('FROM sys.databases WHERE state = 0')) {
            return { recordset: databases.map(name => ({ name })) };
        }
        if (sql.includes("SERVERPROPERTY('ProductVersion')")) {
            return { recordset: [{ version: '16.0.1000.6', edition: 'Developer Edition', compatibilityLevel: 160 }] };
        }
        return { recordsets: [[{ Id: 1, Name: 'Alice' }]], recordset: [{ Id: 1, Name: 'Alice' }], rowsAffected: [1] };
    });
    return { pool: { request: () => ({ query }), connected: true }, query };
}

export function createServiceFixture(sandbox: sinon.SinonSandbox, connections: FakeConnection[]) {
    const pools = new Map<string, ReturnType<typeof createFakePool>>();
    for (const c of connections) {
        pools.set(c.id, createFakePool(sandbox, c.databases ?? []));
    }
    const dbPool = createFakePool(sandbox);

    const connectionProvider = {
        getAllActiveConnections: sandbox.stub().callsFake(() => connections.map(c => ({
            id: c.id,
            config: { id: c.id, name: c.name, server: c.server, connectionType: c.connectionType, database: c.database ?? '' },
            connection: pools.get(c.id)!.pool
        }))),
        getConnection: sandbox.stub().callsFake((id: string) => pools.get(id)?.pool ?? null),
        getConnectionConfig: sandbox.stub().callsFake((id: string) => {
            const c = connections.find(x => x.id === id);
            return c ? { id: c.id, name: c.name, server: c.server, connectionType: c.connectionType, database: c.database ?? '' } : null;
        }),
        ensureConnectionAndGetDbPool: sandbox.stub().resolves(dbPool.pool)
    };

    const schemaContextBuilder = { buildSchemaContext: sandbox.stub().resolves(SAMPLE_SCHEMA) };
    const instructionsManager = { loadInstructions: sandbox.stub().resolves(null as string | null) };
    const outputChannel = { appendLine: sandbox.stub() } as unknown as vscode.OutputChannel;
    let editorHint: { connectionId: string; database?: string } | undefined;

    const service = new DatabaseToolsService(
        connectionProvider as any,
        schemaContextBuilder as any,
        instructionsManager as any,
        outputChannel,
        () => editorHint
    );

    return {
        service,
        connectionProvider,
        schemaContextBuilder,
        instructionsManager,
        pools,
        dbPool,
        setEditorHint: (hint: typeof editorHint) => { editorHint = hint; }
    };
}
