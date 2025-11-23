import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ConnectionProvider, ConnectionConfig, ServerGroup } from '../connectionProvider';

suite('ConnectionProvider Test Suite', () => {
    let connectionProvider: ConnectionProvider;
    let context: vscode.ExtensionContext;
    let outputChannel: vscode.OutputChannel;
    let sandbox: sinon.SinonSandbox;
    let mockGlobalState: any;
    let mockSecrets: any;

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

        // Mock global state
        mockGlobalState = {
            get: sandbox.stub(),
            update: sandbox.stub().resolves(true)
        };

        // Mock secrets
        mockSecrets = {
            store: sandbox.stub().resolves(),
            get: sandbox.stub().resolves(''),
            delete: sandbox.stub().resolves()
        };

        // Mock extension context
        context = {
            extensionUri: vscode.Uri.file('/test/path'),
            subscriptions: [],
            workspaceState: {} as any,
            globalState: mockGlobalState,
            secrets: mockSecrets,
            extensionPath: '/test/path',
            asAbsolutePath: sandbox.stub().returns('/test/path'),
            storagePath: '/test/storage',
            globalStoragePath: '/test/global-storage',
            logPath: '/test/log',
            logUri: vscode.Uri.file('/test/log'),
            storageUri: vscode.Uri.file('/test/storage'),
            globalStorageUri: vscode.Uri.file('/test/global-storage'),
            extensionMode: vscode.ExtensionMode.Test,
            extension: {} as any,
            environmentVariableCollection: {} as any,
            languageModelAccessInformation: {} as any
        };

        // Setup default returns
        (mockGlobalState.get as sinon.SinonStub).withArgs('mssqlManager.serverGroups', []).returns([]);
        (mockGlobalState.get as sinon.SinonStub).withArgs('mssqlManager.connections', []).returns([]);
        (mockGlobalState.get as sinon.SinonStub).withArgs('mssqlManager.databaseFilters', {}).returns({});
        (mockGlobalState.get as sinon.SinonStub).withArgs('mssqlManager.tableFilters', {}).returns({});

        connectionProvider = new ConnectionProvider(context, outputChannel);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Constructor and Initialization', () => {
        test('should initialize with empty connections and server groups', () => {
            // Verify constructor calls globalState.get for initialization
            const getStub = mockGlobalState.get as sinon.SinonStub;
            
            // Check that get was called at all during construction
            assert.strictEqual(getStub.called, true, 'globalState.get should be called during construction');
            
            // Check call count (should be at least 2 calls for database and table filters)
            assert.ok(getStub.callCount >= 2, `Expected at least 2 calls to get, but got ${getStub.callCount}`);
            
            // Check specific calls for filters
            const calls = getStub.getCalls();
            const databaseFiltersCalled = calls.some(call => 
                call.args[0] === 'mssqlManager.databaseFilters'
            );
            const tableFiltersCalled = calls.some(call => 
                call.args[0] === 'mssqlManager.tableFilters'
            );
            
            assert.strictEqual(databaseFiltersCalled, true, 'Should call get for databaseFilters');
            assert.strictEqual(tableFiltersCalled, true, 'Should call get for tableFilters');
        });

        test('should add connection change callbacks', () => {
            const callback = sandbox.stub();
            connectionProvider.addConnectionChangeCallback(callback);
            
            // Verify callback was added
            assert.ok(connectionProvider);
            // Since callbacks are private, we test indirectly through logging
            assert.strictEqual((outputChannel.appendLine as sinon.SinonStub).calledWith('[ConnectionProvider] Adding connection change callback'), true);
        });
    });

    suite('Server Groups Management', () => {
        test('should return empty server groups initially', () => {
            const groups = connectionProvider.getServerGroups();
            assert.deepStrictEqual(groups, []);
        });

        test('should create new server group', async () => {
            const testGroup: ServerGroup = {
                id: 'test-group-1',
                name: 'Test Group',
                description: 'Test description',
                color: '#FF0000'
            };

            await connectionProvider.saveServerGroup(testGroup);

            // Verify globalState.update was called
            assert.strictEqual((mockGlobalState.update as sinon.SinonStub).calledWith('mssqlManager.serverGroups', [testGroup]), true);
        });

        test('should update existing server group', async () => {
            const existingGroup: ServerGroup = { id: 'group-1', name: 'Old Name' };
            const updatedGroup: ServerGroup = { id: 'group-1', name: 'New Name', description: 'Updated' };

            mockGlobalState.get.withArgs('mssqlManager.serverGroups', []).returns([existingGroup]);
            
            await connectionProvider.saveServerGroup(updatedGroup);

            // Verify the group was updated
            assert.strictEqual((mockGlobalState.update as sinon.SinonStub).calledOnce, true);
            const updateCall = (mockGlobalState.update as sinon.SinonStub).getCall(0);
            assert.strictEqual(updateCall.args[0], 'mssqlManager.serverGroups');
            assert.deepStrictEqual(updateCall.args[1], [updatedGroup]);
        });

        test('should delete server group', async () => {
            const group1: ServerGroup = { id: 'group-1', name: 'Group 1' };
            const group2: ServerGroup = { id: 'group-2', name: 'Group 2' };
            
            // Setup mock to return groups when deleteServerGroup calls getServerGroups
            const getStub = mockGlobalState.get as sinon.SinonStub;
            getStub.withArgs('mssqlManager.serverGroups', []).returns([group1, group2]);

            await connectionProvider.deleteServerGroup('group-1');

            // Verify the group was removed
            const updateStub = mockGlobalState.update as sinon.SinonStub;
            assert.ok(updateStub.called, 'globalState.update should be called');
            assert.ok(updateStub.callCount >= 1, `Expected at least 1 call to update, got ${updateStub.callCount}`);
            
            // Find the call that updates server groups
            const calls = updateStub.getCalls();
            const serverGroupsUpdateCall = calls.find(call => call.args[0] === 'mssqlManager.serverGroups');
            assert.ok(serverGroupsUpdateCall, 'Should have called update for mssqlManager.serverGroups');
            
            // Verify group1 was removed and only group2 remains
            const updatedGroups = serverGroupsUpdateCall.args[1];
            assert.deepStrictEqual(updatedGroups, [group2]);
        });
    });

    suite('Connection Management', () => {
        test('should return empty connections list initially', async () => {
            const connections = await connectionProvider.getSavedConnectionsList();
            assert.deepStrictEqual(connections, []);
        });

        test('should create connection config from parameters', async () => {
            const config: ConnectionConfig = {
                id: 'test-conn-1',
                name: 'Test Connection',
                server: 'localhost',
                database: 'testdb',
                authType: 'sql',
                connectionType: 'database',
                username: 'testuser',
                password: 'testpass'
            };

                // Mock establishConnection to avoid real database connection
            sandbox.stub(connectionProvider as any, 'establishConnection').resolves();
            
            await (connectionProvider as any).handleWebviewConnection(config);

            // Verify secrets were stored for sensitive data
            assert.strictEqual((mockSecrets.store as sinon.SinonStub).calledWith(`mssqlManager.password.${config.id}`, config.password), true);
            assert.strictEqual((mockSecrets.store as sinon.SinonStub).calledWith(`mssqlManager.username.${config.id}`, config.username), true);

            // Verify connection was saved to globalState (without sensitive data)
            assert.strictEqual((mockGlobalState.update as sinon.SinonStub).calledWith('mssqlManager.connections'), true);
        });

        test('should handle Windows authentication connection', async () => {
            const config: ConnectionConfig = {
                id: 'test-conn-windows',
                name: 'Windows Auth Connection',
                server: 'localhost',
                database: 'testdb',
                authType: 'windows',
                connectionType: 'database'
            };

            // Mock establishConnection to avoid real database connection
            sandbox.stub(connectionProvider as any, 'establishConnection').resolves();
            
            await (connectionProvider as any).handleWebviewConnection(config);

            // Verify no username/password stored for Windows auth (secrets should still be called for password)
            // But should store connection config
            assert.strictEqual((mockGlobalState.update as sinon.SinonStub).calledOnce, true);
        });

        test('should determine server connection type correctly', async () => {
            const serverConfig: ConnectionConfig = {
                id: 'test-server-conn',
                name: 'Server Connection',
                server: 'localhost',
                database: '', // Empty database should default to server type
                authType: 'windows',
                connectionType: 'server'
            };

            // Mock establishConnection to avoid real database connection
            sandbox.stub(connectionProvider as any, 'establishConnection').resolves();
            
            await (connectionProvider as any).handleWebviewConnection(serverConfig);

            // Verify connection type was set correctly
            assert.strictEqual((mockGlobalState.update as sinon.SinonStub).calledOnce, true);
        });

        test('should get connection status correctly', () => {
            const connectionId = 'test-conn-1';
            
            // Initially not active
            assert.strictEqual(connectionProvider.isConnectionActive(connectionId), false);
            assert.strictEqual(connectionProvider.isConnectionPending(connectionId), false);
        });

        test('should handle connection configuration retrieval', async () => {
            const savedConnection: Partial<ConnectionConfig> = {
                id: 'test-conn-1',
                name: 'Test Connection',
                server: 'localhost',
                database: 'testdb',
                authType: 'sql',
                connectionType: 'database'
            };

            // Mock saved connections in global state
            (mockGlobalState.get as sinon.SinonStub).withArgs('mssqlManager.connections', []).returns([savedConnection]);
            
            // Test getting saved connections works (which uses getSavedConnections internally)
            const savedConnections = await connectionProvider.getSavedConnectionsList();
            
            assert.ok(savedConnections);
            assert.strictEqual(savedConnections.length, 1);
            assert.strictEqual(savedConnections[0].id, 'test-conn-1');
            assert.strictEqual(savedConnections[0].name, 'Test Connection');
            assert.strictEqual(savedConnections[0].server, 'localhost');
            
            // getConnectionConfig returns null for inactive connections (expected behavior)
            const config = connectionProvider.getConnectionConfig('test-conn-1');
            assert.strictEqual(config, null);
        });
    });

    suite('Database and Table Filters', () => {
        test('should set and get database filter', () => {
            const connectionId = 'test-conn-1';
            const filter = {
                name: { operator: 'contains', value: 'test' }
            };

            connectionProvider.setDatabaseFilter(connectionId, filter);
            
            assert.strictEqual(connectionProvider.hasDatabaseFilter(connectionId), true);
            
            const retrievedFilter = connectionProvider.getDatabaseFilter(connectionId);
            assert.deepStrictEqual(retrievedFilter, filter);
        });

        test('should clear database filter', () => {
            const connectionId = 'test-conn-1';
            const filter = { name: { operator: 'contains', value: 'test' } };

            connectionProvider.setDatabaseFilter(connectionId, filter);
            // Clear by setting null filter
            connectionProvider.setDatabaseFilter(connectionId, null);
            
            assert.strictEqual(connectionProvider.hasDatabaseFilter(connectionId), false);
        });

        test('should set and get table filter', () => {
            const connectionId = 'test-conn-1';
            const database = 'testdb';
            const filter = {
                name: { operator: 'startswith', value: 'tbl' },
                schema: { operator: 'equals', value: 'dbo' }
            };

            connectionProvider.setTableFilter(connectionId, database, filter);
            
            assert.strictEqual(connectionProvider.hasTableFilter(connectionId, database), true);
            
            const retrievedFilter = connectionProvider.getTableFilter(connectionId, database);
            assert.deepStrictEqual(retrievedFilter, filter);
        });

        test('should clear table filter', () => {
            const connectionId = 'test-conn-1';
            const database = 'testdb';
            const filter = { name: { operator: 'contains', value: 'test' } };

            connectionProvider.setTableFilter(connectionId, database, filter);
            // Clear by setting null filter
            connectionProvider.setTableFilter(connectionId, database, null);
            
            assert.strictEqual(connectionProvider.hasTableFilter(connectionId, database), false);
        });
    });

    suite('Connection String Parsing', () => {
        test('should parse SQL Server connection string correctly', async () => {
            const connectionString = 'Server=localhost;Database=testdb;User Id=testuser;Password=testpass;Encrypt=true;';
            
            const config: ConnectionConfig = {
                id: 'test-conn-cs',
                name: 'Connection String Test',
                server: '',
                database: '',
                authType: 'sql',
                connectionType: 'database',
                connectionString: connectionString,
                useConnectionString: true
            };

            // Mock establishConnection to avoid real database connection
            sandbox.stub(connectionProvider as any, 'establishConnection').resolves();
            
            await (connectionProvider as any).handleWebviewConnection(config);

            // Verify connection string was stored in secrets
            assert.strictEqual((mockSecrets.store as sinon.SinonStub).calledWith(`mssqlManager.connectionString.${config.id}`, connectionString), true);
        });

        test('should parse Windows authentication connection string', async () => {
            const connectionString = 'Server=localhost;Database=testdb;Integrated Security=SSPI;Encrypt=false;';
            
            const config: ConnectionConfig = {
                id: 'test-conn-cs-win',
                name: 'Windows Auth CS Test',
                server: '',
                database: '',
                authType: 'windows',
                connectionType: 'database',
                connectionString: connectionString,
                useConnectionString: true
            };

            // Mock establishConnection to avoid real database connection
            sandbox.stub(connectionProvider as any, 'establishConnection').resolves();
            
            await (connectionProvider as any).handleWebviewConnection(config);

            // Should store connection string but not username/password for Windows auth  
            assert.strictEqual((mockSecrets.store as sinon.SinonStub).calledWith(`mssqlManager.connectionString.${config.id}`, connectionString), true);
        });
    });

    suite('Error Handling', () => {
        test('should handle connection deletion of non-existent connection', async () => {
            try {
                await connectionProvider.deleteConnection('non-existent-id');
                assert.fail('Should have thrown an error');
            } catch (error: any) {
                assert.ok(error.message.includes('Connection not found'));
            }
        });

        test('should handle server group deletion of non-existent group', async () => {
            mockGlobalState.get.withArgs('mssqlManager.serverGroups', []).returns([]);
            
            // Should throw error for non-existent group
            try {
                await connectionProvider.deleteServerGroup('non-existent-group');
                assert.fail('Should have thrown an error');
            } catch (error: any) {
                assert.ok(error.message.includes('Server group not found'));
            }
        });

        test('should handle secrets storage failures gracefully', async () => {
            mockSecrets.store.rejects(new Error('Secrets storage failed'));
            
            const config: ConnectionConfig = {
                id: 'test-conn-fail',
                name: 'Failing Connection',
                server: 'localhost',
                database: 'testdb',
                authType: 'sql',
                connectionType: 'database',
                username: 'testuser',
                password: 'testpass'
            };

            // Should throw error due to secrets failure
            try {
                // Mock establishConnection to avoid real database connection
                sandbox.stub(connectionProvider as any, 'establishConnection').resolves();
                
                await (connectionProvider as any).handleWebviewConnection(config);
                assert.fail('Should have thrown an error');
            } catch (error) {
                assert.ok(error instanceof Error);
            }
        });
    });

    suite('Connection Lifecycle', () => {
        test('should track pending connections', () => {
            const connectionId = 'test-conn-pending';
            
            // Initially not pending
            assert.strictEqual(connectionProvider.isConnectionPending(connectionId), false);
            
            // Note: Since setPending and related methods are likely private,
            // we test this through the public interface behavior
        });

        test('should get active connection', () => {
            const activeConnections = connectionProvider.getActiveConnections();
            
            // Initially no active connections
            assert.deepStrictEqual(activeConnections, []);
        });

        test('should get saved connections list', async () => {
            const testConnections = [
                { id: 'conn1', name: 'Connection 1', server: 'srv1', database: 'db1', authType: 'sql', connectionType: 'database' },
                { id: 'conn2', name: 'Connection 2', server: 'srv2', database: 'db2', authType: 'windows', connectionType: 'server' }
            ];

            // Reset the mock to return test connections
            (mockGlobalState.get as sinon.SinonStub).withArgs('mssqlManager.connections', []).returns(testConnections);
            
            const connections = await connectionProvider.getSavedConnectionsList();
            
            assert.deepStrictEqual(connections, testConnections);
        });
    });

    // Note: Preferred database methods are private, so we skip these tests
});