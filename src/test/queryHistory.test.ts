import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { QueryHistoryManager, QueryHistoryEntry } from '../queryHistory';

suite('QueryHistoryManager Test Suite', () => {
    let queryHistoryManager: QueryHistoryManager;
    let mockContext: vscode.ExtensionContext;
    let sandbox: sinon.SinonSandbox;
    let mockGlobalState: any;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock global state storage
        mockGlobalState = {
            get: sandbox.stub().returns([]),
            update: sandbox.stub().resolves()
        };

        // Mock extension context
        mockContext = {
            globalState: mockGlobalState,
            subscriptions: [],
            workspaceState: {} as any,
            extensionUri: vscode.Uri.file('/test'),
            extensionPath: '/test',
            storagePath: '/test/storage',
            globalStoragePath: '/test/global',
            logPath: '/test/logs',
            storageUri: vscode.Uri.file('/test/storage'),
            globalStorageUri: vscode.Uri.file('/test/global'),
            logUri: vscode.Uri.file('/test/logs'),
            extensionMode: vscode.ExtensionMode.Test,
            secrets: {} as any,
            extension: {} as any,
            languageModelAccessInformation: {} as any,
            asAbsolutePath: (relativePath: string) => `/test/${relativePath}`,
            environmentVariableCollection: {} as any
        };

        queryHistoryManager = new QueryHistoryManager(mockContext);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Initialization', () => {
        test('should initialize with empty history', () => {
            assert.ok(queryHistoryManager);
            const history = queryHistoryManager.getHistory();
            assert.strictEqual(history.length, 0);
        });

        test('should load existing history from storage', () => {
            const existingHistory: QueryHistoryEntry[] = [
                {
                    id: '123',
                    query: 'SELECT * FROM Users',
                    connectionId: 'conn1',
                    connectionName: 'Test Connection',
                    database: 'TestDB',
                    server: 'localhost',
                    resultSetCount: 1,
                    rowCounts: [5],
                    executedAt: new Date()
                }
            ];
            
            mockGlobalState.get.returns(existingHistory);
            
            const newManager = new QueryHistoryManager(mockContext);
            const history = newManager.getHistory();
            
            assert.strictEqual(history.length, 1);
            assert.strictEqual(history[0].query, 'SELECT * FROM Users');
        });
    });

    suite('Adding Entries', () => {
        test('should add new query entry', () => {
            const entryData = {
                query: 'SELECT COUNT(*) FROM Products',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1]
            };

            queryHistoryManager.addEntry(entryData);
            
            const history = queryHistoryManager.getHistory();
            assert.strictEqual(history.length, 1);
            assert.strictEqual(history[0].query, entryData.query);
            assert.strictEqual(history[0].connectionId, entryData.connectionId);
            assert.ok(history[0].id);
            assert.ok(history[0].executedAt instanceof Date);
        });

        test('should add entry at beginning (most recent first)', () => {
            queryHistoryManager.addEntry({
                query: 'SELECT 1',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1]
            });

            queryHistoryManager.addEntry({
                query: 'SELECT 2',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1]
            });

            const history = queryHistoryManager.getHistory();
            assert.strictEqual(history.length, 2);
            assert.strictEqual(history[0].query, 'SELECT 2'); // Most recent first
            assert.strictEqual(history[1].query, 'SELECT 1');
        });

        test('should preserve pinned status when provided', () => {
            queryHistoryManager.addEntry({
                query: 'SELECT * FROM Users',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [5],
                pinned: true
            });

            const history = queryHistoryManager.getHistory();
            assert.strictEqual(history[0].pinned, true);
        });

        test('should handle multiple recordsets', () => {
            queryHistoryManager.addEntry({
                query: 'SELECT * FROM Users; SELECT * FROM Orders;',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 2,
                rowCounts: [5, 10]
            });

            const history = queryHistoryManager.getHistory();
            assert.strictEqual(history[0].resultSetCount, 2);
            assert.deepStrictEqual(history[0].rowCounts, [5, 10]);
        });
    });

    suite('History Management', () => {
        test('should limit history size to maximum', () => {
            // Add more entries than the maximum (100)
            for (let i = 0; i < 105; i++) {
                queryHistoryManager.addEntry({
                    query: `SELECT ${i}`,
                    connectionId: 'conn1',
                    connectionName: 'Test Connection',
                    database: 'TestDB',
                    server: 'localhost',
                    resultSetCount: 1,
                    rowCounts: [1]
                });
            }

            const history = queryHistoryManager.getHistory();
            assert.strictEqual(history.length, 100);
            assert.strictEqual(history[0].query, 'SELECT 104'); // Most recent
        });

        test('should save to storage when adding entries', () => {
            queryHistoryManager.addEntry({
                query: 'SELECT NOW()',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1]
            });

            assert.strictEqual(mockGlobalState.update.calledOnce, true);
            const updateCall = mockGlobalState.update.getCall(0);
            assert.strictEqual(updateCall.args[0], 'mssqlManager.queryHistory');
            assert.ok(Array.isArray(updateCall.args[1]));
        });
    });

    suite('Entry Retrieval', () => {
        test('should return empty array initially', () => {
            const history = queryHistoryManager.getHistory();
            assert.ok(Array.isArray(history));
            assert.strictEqual(history.length, 0);
        });

        test('should return copy of history to prevent external modification', () => {
            queryHistoryManager.addEntry({
                query: 'SELECT 1',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1]
            });

            const history1 = queryHistoryManager.getHistory();
            const history2 = queryHistoryManager.getHistory();
            
            // Should be different arrays (copies)
            assert.notStrictEqual(history1, history2);
            assert.deepStrictEqual(history1, history2);
        });
    });

    suite('Entry Filtering', () => {
        setup(() => {
            // Add test entries
            queryHistoryManager.addEntry({
                query: 'SELECT * FROM Users',
                connectionId: 'conn1',
                connectionName: 'Connection 1',
                database: 'DB1',
                server: 'server1',
                resultSetCount: 1,
                rowCounts: [5]
            });

            queryHistoryManager.addEntry({
                query: 'SELECT * FROM Orders',
                connectionId: 'conn2',
                connectionName: 'Connection 2',
                database: 'DB2',
                server: 'server2',
                resultSetCount: 1,
                rowCounts: [3]
            });
        });

        test('should be able to retrieve all entries', () => {
            const history = queryHistoryManager.getHistory();
            
            assert.strictEqual(history.length, 2);
            assert.strictEqual(history[0].query, 'SELECT * FROM Orders'); // Most recent first
            assert.strictEqual(history[1].query, 'SELECT * FROM Users');
        });

        test('should filter entries manually by connection ID', () => {
            const allHistory = queryHistoryManager.getHistory();
            const filtered = allHistory.filter(entry => entry.connectionId === 'conn1');
            
            assert.strictEqual(filtered.length, 1);
            assert.strictEqual(filtered[0].connectionId, 'conn1');
            assert.strictEqual(filtered[0].query, 'SELECT * FROM Users');
        });
    });

    suite('Entry Management', () => {
        test('should find entry by ID', () => {
            queryHistoryManager.addEntry({
                query: 'SELECT 1',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1]
            });

            const history = queryHistoryManager.getHistory();
            const entryId = history[0].id;
            
            const foundEntry = queryHistoryManager.getEntry(entryId);
            assert.ok(foundEntry);
            assert.strictEqual(foundEntry.id, entryId);
            assert.strictEqual(foundEntry.query, 'SELECT 1');
        });

        test('should return undefined for non-existent ID', () => {
            const foundEntry = queryHistoryManager.getEntry('non-existent');
            assert.strictEqual(foundEntry, undefined);
        });

        test('should update entry title successfully', () => {
            queryHistoryManager.addEntry({
                query: 'SELECT 1',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1]
            });

            const history = queryHistoryManager.getHistory();
            const entryId = history[0].id;
            
            queryHistoryManager.renameEntry(entryId, 'My Custom Query');

            const updatedEntry = queryHistoryManager.getEntry(entryId);
            assert.strictEqual(updatedEntry?.title, 'My Custom Query');
        });

        test('should update entry pinned status successfully', () => {
            queryHistoryManager.addEntry({
                query: 'SELECT 1',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1]
            });

            const history = queryHistoryManager.getHistory();
            const entryId = history[0].id;
            
            queryHistoryManager.setPinned(entryId, true);

            const updatedEntry = queryHistoryManager.getEntry(entryId);
            assert.strictEqual(updatedEntry?.pinned, true);
        });



        test('should remove entry successfully', () => {
            queryHistoryManager.addEntry({
                query: 'SELECT 1',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1]
            });

            const history = queryHistoryManager.getHistory();
            const entryId = history[0].id;
            
            queryHistoryManager.deleteEntry(entryId);
            
            const newHistory = queryHistoryManager.getHistory();
            assert.strictEqual(newHistory.length, 0);
        });

        test('should handle removing non-existent entry', () => {
            // Should not throw error
            assert.doesNotThrow(() => {
                queryHistoryManager.deleteEntry('non-existent');
            });
        });
    });

    suite('Event Handling', () => {
        test('should fire change event when adding entry', (done) => {
            let eventFired = false;
            
            queryHistoryManager.onDidChangeHistory(() => {
                eventFired = true;
                assert.strictEqual(eventFired, true);
                done();
            });

            queryHistoryManager.addEntry({
                query: 'SELECT 1',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1]
            });
        });

        test('should fire change event when updating entry', (done) => {
            queryHistoryManager.addEntry({
                query: 'SELECT 1',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1]
            });

            const history = queryHistoryManager.getHistory();
            const entryId = history[0].id;

            queryHistoryManager.onDidChangeHistory(() => {
                done();
            });

            queryHistoryManager.renameEntry(entryId, 'Updated');
        });

        test('should fire change event when removing entry', (done) => {
            queryHistoryManager.addEntry({
                query: 'SELECT 1',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1]
            });

            const history = queryHistoryManager.getHistory();
            const entryId = history[0].id;

            queryHistoryManager.onDidChangeHistory(() => {
                done();
            });

            queryHistoryManager.deleteEntry(entryId);
        });
    });

    suite('Clear History', () => {
        test('should clear all non-pinned history', () => {
            // Add some entries
            queryHistoryManager.addEntry({
                query: 'SELECT 1',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1]
            });

            queryHistoryManager.addEntry({
                query: 'SELECT 2',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1]
            });

            // Clear history
            queryHistoryManager.clearHistory();
            
            const history = queryHistoryManager.getHistory();
            assert.strictEqual(history.length, 0);
        });

        test('should preserve pinned entries when clearing', () => {
            // Add a regular entry
            queryHistoryManager.addEntry({
                query: 'SELECT 1',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1]
            });

            // Add a pinned entry
            queryHistoryManager.addEntry({
                query: 'SELECT 2',
                connectionId: 'conn1',
                connectionName: 'Test Connection',
                database: 'TestDB',
                server: 'localhost',
                resultSetCount: 1,
                rowCounts: [1],
                pinned: true
            });

            // Clear history
            queryHistoryManager.clearHistory();
            
            const history = queryHistoryManager.getHistory();
            assert.strictEqual(history.length, 1);
            assert.strictEqual(history[0].query, 'SELECT 2');
            assert.strictEqual(history[0].pinned, true);
        });

        test('should save cleared state to storage', () => {
            queryHistoryManager.clearHistory();
            
            assert.strictEqual(mockGlobalState.update.calledOnce, true);
            const updateCall = mockGlobalState.update.getCall(0);
            assert.strictEqual(updateCall.args[0], 'mssqlManager.queryHistory');
            assert.deepStrictEqual(updateCall.args[1], []);
        });
    });
});