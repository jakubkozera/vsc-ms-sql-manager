import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { QueryExecutor, QueryResult } from '../queryExecutor';
import { ConnectionProvider } from '../connectionProvider';
import { QueryHistoryManager } from '../queryHistory';

// Basic functionality tests
suite('QueryExecutor Basic Tests', () => {
    let queryExecutor: QueryExecutor;
    let connectionProvider: ConnectionProvider;
    let outputChannel: vscode.OutputChannel;
    let historyManager: QueryHistoryManager;
    let sandbox: sinon.SinonSandbox;
    let mockConnection: any;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock output channel
        outputChannel = {
            appendLine: sandbox.stub(),
            show: sandbox.stub(),
            hide: sandbox.stub(),
            clear: sandbox.stub(),
            dispose: sandbox.stub(),
            name: 'test-channel'
        } as any;

        // Mock connection object
        mockConnection = {
            request: sandbox.stub().returns({
                query: sandbox.stub().resolves({
                    recordset: [
                        { id: 1, name: 'Test Row 1' },
                        { id: 2, name: 'Test Row 2' }
                    ],
                    recordsets: [[
                        { id: 1, name: 'Test Row 1' },
                        { id: 2, name: 'Test Row 2' }
                    ]],
                    rowsAffected: [2]
                }),
                cancel: sandbox.stub()
            })
        };

        // Mock connection provider
        connectionProvider = {
            getConnection: sandbox.stub().returns(mockConnection),
            getActiveConnectionInfo: sandbox.stub().returns({
                id: 'test-conn-123',
                name: 'Test Connection',
                server: 'localhost',
                database: 'TestDB'
            })
        } as any;

        // Mock history manager
        historyManager = {
            addEntry: sandbox.stub()
        } as any;

        queryExecutor = new QueryExecutor(connectionProvider, outputChannel, historyManager);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should initialize QueryExecutor', () => {
        assert.ok(queryExecutor);
        assert.strictEqual((queryExecutor as any).connectionProvider, connectionProvider);
        assert.strictEqual((queryExecutor as any).outputChannel, outputChannel);
        assert.strictEqual((queryExecutor as any).historyManager, historyManager);
    });

    test('should execute a simple query', async () => {
        const queryText = 'SELECT * FROM Users';
        
        const result = await queryExecutor.executeQuery(queryText);
        
        assert.ok(result);
        assert.ok(result.recordsets);
        assert.strictEqual(result.recordsets.length, 1);
        assert.strictEqual(result.recordsets[0].length, 2);
        assert.strictEqual(result.recordsets[0][0].id, 1);
        assert.strictEqual(result.query, queryText);
        assert.ok(typeof result.executionTime === 'number');
        assert.ok(Array.isArray(result.rowsAffected));
    });

    test('should handle query execution error', async () => {
        mockConnection.request().query.rejects(new Error('Test error'));
        
        try {
            await queryExecutor.executeQuery('INVALID SQL');
            assert.fail('Expected error was not thrown');
        } catch (error: any) {
            assert.ok(error);
            assert.ok(error.message.includes('Test error'));
        }
    });

    test('should handle no connection available', async () => {
        (connectionProvider.getConnection as sinon.SinonStub).returns(null);
        
        try {
            await queryExecutor.executeQuery('SELECT 1');
            assert.fail('Expected error was not thrown');
        } catch (error: any) {
            assert.ok(error);
            assert.ok(error.message.includes('No active database connection'));
        }
    });

    test('should use custom connection pool when provided', async () => {
        const mockPool = {
            request: sandbox.stub().returns(mockConnection.request()),
            connect: sandbox.stub().resolves(),
            close: sandbox.stub().resolves(),
            connected: true
        };
        
        await queryExecutor.executeQuery('SELECT 1', mockPool);
        
        assert.strictEqual(mockPool.request.calledOnce, true);
    });

    test('should add query to history when available', async () => {
        await queryExecutor.executeQuery('SELECT * FROM Users');
        
        assert.strictEqual((historyManager.addEntry as sinon.SinonStub).calledOnce, true);
    });

    test('should initialize without history manager', () => {
        const executorWithoutHistory = new QueryExecutor(connectionProvider, outputChannel);
        
        assert.ok(executorWithoutHistory);
        assert.strictEqual((executorWithoutHistory as any).historyManager, undefined);
    });

    test('should cancel running query', () => {
        queryExecutor.cancelCurrentQuery();
        // Should not throw error even when no query is running
        assert.ok(true);
    });
});