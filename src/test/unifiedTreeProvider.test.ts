import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { UnifiedTreeProvider, ServerGroupNode, ServerConnectionNode, ConnectionNode, DatabaseNode, SchemaItemNode } from '../unifiedTreeProvider';
import { ConnectionProvider, ServerGroup, ConnectionConfig } from '../connectionProvider';

suite('UnifiedTreeProvider Test Suite', () => {
    let unifiedTreeProvider: UnifiedTreeProvider;
    let connectionProvider: ConnectionProvider;
    let outputChannel: vscode.OutputChannel;
    let sandbox: sinon.SinonSandbox;
    let mockTreeDataChangedEmitter: vscode.EventEmitter<any>;
    let mockFileDecorationsChangedEmitter: vscode.EventEmitter<any>;

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

        // Mock connection provider
        connectionProvider = {
            getServerGroups: sandbox.stub().returns([]),
            getSavedConnectionsList: sandbox.stub().resolves([]),
            isConnectionActive: sandbox.stub().returns(false),
            isConnectionPending: sandbox.stub().returns(false),
            isConnectionFailed: sandbox.stub().returns(false),
            hasDatabaseFilter: sandbox.stub().returns(false),
            getDatabaseFilter: sandbox.stub().returns(undefined),
            hasTableFilter: sandbox.stub().returns(false),
            getTableFilter: sandbox.stub().returns(undefined),
            getConnection: sandbox.stub().returns(null),
            createDbPool: sandbox.stub().resolves(null),
            connectToSavedById: sandbox.stub().resolves()
        } as any;

        // Create mock event emitters
        mockTreeDataChangedEmitter = new vscode.EventEmitter<any>();
        mockFileDecorationsChangedEmitter = new vscode.EventEmitter<any>();

        unifiedTreeProvider = new UnifiedTreeProvider(connectionProvider, outputChannel);
        
        // Replace the private event emitters with our mocks for testing
        (unifiedTreeProvider as any)._onDidChangeTreeData = mockTreeDataChangedEmitter;
        (unifiedTreeProvider as any)._onDidChangeFileDecorations = mockFileDecorationsChangedEmitter;
    });

    teardown(() => {
        sandbox.restore();
        mockTreeDataChangedEmitter.dispose();
        mockFileDecorationsChangedEmitter.dispose();
    });

    suite('Constructor and Initialization', () => {
        test('should initialize with connection provider and output channel', () => {
            assert.ok(unifiedTreeProvider);
            assert.strictEqual((unifiedTreeProvider as any).connectionProvider, connectionProvider);
            assert.strictEqual((unifiedTreeProvider as any).outputChannel, outputChannel);
        });

        test('should have drag and drop mime types', () => {
            assert.deepStrictEqual(unifiedTreeProvider.dropMimeTypes, ['application/vnd.code.tree.mssqlmanagerexplorer']);
            assert.deepStrictEqual(unifiedTreeProvider.dragMimeTypes, ['application/vnd.code.tree.mssqlmanagerexplorer']);
        });
    });

    suite('Tree Data Provider Methods', () => {
        test('should refresh tree data', () => {
            const fireStub = sandbox.stub(mockTreeDataChangedEmitter, 'fire');
            const fireDecorationsStub = sandbox.stub(mockFileDecorationsChangedEmitter, 'fire');
            
            unifiedTreeProvider.refresh();
            
            assert.strictEqual(fireStub.calledOnce, true);
            assert.strictEqual(fireDecorationsStub.calledOnce, true);
        });

        test('should refresh specific node', () => {
            const fireStub = sandbox.stub(mockTreeDataChangedEmitter, 'fire');
            const testNode = new ServerGroupNode({ id: 'test', name: 'Test Group' }, 0, connectionProvider);
            
            unifiedTreeProvider.refreshNode(testNode);
            
            assert.strictEqual(fireStub.calledOnce, true);
            assert.strictEqual(fireStub.calledWith(testNode), true);
        });
    });

    suite('Root Level Children - Empty State', () => {
        test('should return empty array when no server groups or connections', async () => {
            (connectionProvider.getServerGroups as sinon.SinonStub).returns([]);
            (connectionProvider.getSavedConnectionsList as sinon.SinonStub).resolves([]);

            const children = await unifiedTreeProvider.getChildren();
            
            assert.deepStrictEqual(children, []);
        });
    });

    suite('Server Groups Management', () => {
        test('should return server group nodes for existing groups', async () => {
            const testGroups: ServerGroup[] = [
                { id: 'group1', name: 'Group 1' },
                { id: 'group2', name: 'Group 2' }
            ];
            const testConnections: ConnectionConfig[] = [
                { id: 'conn1', name: 'Connection 1', server: 'srv1', database: 'db1', authType: 'sql', connectionType: 'database', serverGroupId: 'group1' }
            ];

            (connectionProvider.getServerGroups as sinon.SinonStub).returns(testGroups);
            (connectionProvider.getSavedConnectionsList as sinon.SinonStub).resolves(testConnections);

            const children = await unifiedTreeProvider.getChildren();

            assert.strictEqual(children.length, 2); // 2 groups
            assert.ok(children[0] instanceof ServerGroupNode);
            assert.ok(children[1] instanceof ServerGroupNode);
            assert.strictEqual(children[0].label, 'Group 1');
            assert.strictEqual(children[1].label, 'Group 2');
        });

        test('should include ungrouped connections at root level', async () => {
            const testGroups: ServerGroup[] = [
                { id: 'group1', name: 'Group 1' }
            ];
            const testConnections: ConnectionConfig[] = [
                { id: 'conn1', name: 'Connection 1', server: 'srv1', database: 'db1', authType: 'sql', connectionType: 'database', serverGroupId: 'group1' },
                { id: 'conn2', name: 'Ungrouped Connection', server: 'srv2', database: 'db2', authType: 'windows', connectionType: 'server' } // No serverGroupId
            ];

            (connectionProvider.getServerGroups as sinon.SinonStub).returns(testGroups);
            (connectionProvider.getSavedConnectionsList as sinon.SinonStub).resolves(testConnections);
            (connectionProvider.isConnectionActive as sinon.SinonStub).returns(false);
            (connectionProvider.isConnectionPending as sinon.SinonStub).returns(false);
            (connectionProvider.isConnectionFailed as sinon.SinonStub).returns(false);
            (connectionProvider.hasDatabaseFilter as sinon.SinonStub).returns(false);

            const children = await unifiedTreeProvider.getChildren();

            assert.strictEqual(children.length, 2); // 1 group + 1 ungrouped connection
            assert.ok(children[0] instanceof ServerGroupNode);
            assert.ok(children[1] instanceof ServerConnectionNode); // Ungrouped server connection
            assert.strictEqual(children[1].label, 'Ungrouped Connection');
        });
    });

    suite('Connection Types Handling', () => {
        test('should create ServerConnectionNode for server type connections', async () => {
            const testConnections: ConnectionConfig[] = [
                { id: 'srv1', name: 'Server Connection', server: 'localhost', database: '', authType: 'windows', connectionType: 'server' }
            ];

            (connectionProvider.getServerGroups as sinon.SinonStub).returns([]);
            (connectionProvider.getSavedConnectionsList as sinon.SinonStub).resolves(testConnections);
            (connectionProvider.isConnectionActive as sinon.SinonStub).returns(false);
            (connectionProvider.isConnectionPending as sinon.SinonStub).returns(false);
            (connectionProvider.isConnectionFailed as sinon.SinonStub).returns(false);
            (connectionProvider.hasDatabaseFilter as sinon.SinonStub).returns(false);

            const children = await unifiedTreeProvider.getChildren();

            assert.strictEqual(children.length, 1);
            assert.ok(children[0] instanceof ServerConnectionNode);
            assert.strictEqual(children[0].label, 'Server Connection');
        });

        test('should create ConnectionNode for database type connections', async () => {
            const testConnections: ConnectionConfig[] = [
                { id: 'db1', name: 'Database Connection', server: 'localhost', database: 'testdb', authType: 'sql', connectionType: 'database' }
            ];

            (connectionProvider.getServerGroups as sinon.SinonStub).returns([]);
            (connectionProvider.getSavedConnectionsList as sinon.SinonStub).resolves(testConnections);
            (connectionProvider.isConnectionActive as sinon.SinonStub).returns(false);
            (connectionProvider.isConnectionPending as sinon.SinonStub).returns(false);
            (connectionProvider.isConnectionFailed as sinon.SinonStub).returns(false);

            const children = await unifiedTreeProvider.getChildren();

            assert.strictEqual(children.length, 1);
            assert.ok(children[0] instanceof ConnectionNode);
            assert.strictEqual(children[0].label, 'Database Connection');
        });
    });

    suite('Server Group Children', () => {
        test('should return connections for specific server group', async () => {
            const testGroup = { id: 'group1', name: 'Test Group' };
            const testConnections: ConnectionConfig[] = [
                { id: 'conn1', name: 'Group Connection 1', server: 'srv1', database: 'db1', authType: 'sql', connectionType: 'database', serverGroupId: 'group1' },
                { id: 'conn2', name: 'Group Connection 2', server: 'srv2', database: 'db2', authType: 'windows', connectionType: 'server', serverGroupId: 'group1' },
                { id: 'conn3', name: 'Other Group Connection', server: 'srv3', database: 'db3', authType: 'sql', connectionType: 'database', serverGroupId: 'group2' }
            ];

            (connectionProvider.getSavedConnectionsList as sinon.SinonStub).resolves(testConnections);
            (connectionProvider.isConnectionActive as sinon.SinonStub).returns(false);
            (connectionProvider.isConnectionPending as sinon.SinonStub).returns(false);
            (connectionProvider.isConnectionFailed as sinon.SinonStub).returns(false);
            (connectionProvider.hasDatabaseFilter as sinon.SinonStub).returns(false);

            const serverGroupNode = new ServerGroupNode(testGroup, 2, connectionProvider);
            const children = await unifiedTreeProvider.getChildren(serverGroupNode);

            assert.strictEqual(children.length, 2); // Only connections from group1
            assert.strictEqual(children[0].label, 'Group Connection 1');
            assert.strictEqual(children[1].label, 'Group Connection 2');
        });
    });

    suite('Tree Item Properties', () => {
        test('should return correct tree item for ServerGroupNode', () => {
            const testGroup = { id: 'group1', name: 'Test Group' };
            const serverGroupNode = new ServerGroupNode(testGroup, 3, connectionProvider);
            
            const treeItem = unifiedTreeProvider.getTreeItem(serverGroupNode);
            
            assert.strictEqual(treeItem.label, 'Test Group');
            assert.strictEqual(treeItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
            assert.ok(treeItem.iconPath);
        });

        test('should return correct tree item for ConnectionNode', () => {
            const connectionNode = new ConnectionNode(
                'Test Connection',
                'localhost',
                'testdb',
                'conn1',
                'sql',
                false, // isActive = false
                false  // isPending = false
            );
            
            const treeItem = unifiedTreeProvider.getTreeItem(connectionNode);
            
            assert.strictEqual(treeItem.label, 'Test Connection');
            // ConnectionNode is Collapsed when not active
            assert.strictEqual(treeItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        });

        test('should return correct tree item for ServerConnectionNode', () => {
            const serverConnectionNode = new ServerConnectionNode(
                'Server Connection',
                'localhost',
                'srv1',
                'windows',
                false,
                false,
                false
            );
            
            const treeItem = unifiedTreeProvider.getTreeItem(serverConnectionNode);
            
            assert.strictEqual(treeItem.label, 'Server Connection');
            assert.strictEqual(treeItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        });
    });

    suite('Connection State Indicators', () => {
        test('should show pending state for connections', async () => {
            const testConnections: ConnectionConfig[] = [
                { id: 'pending1', name: 'Pending Connection', server: 'srv1', database: 'db1', authType: 'sql', connectionType: 'database' }
            ];

            (connectionProvider.getServerGroups as sinon.SinonStub).returns([]);
            (connectionProvider.getSavedConnectionsList as sinon.SinonStub).resolves(testConnections);
            (connectionProvider.isConnectionActive as sinon.SinonStub).returns(false);
            (connectionProvider.isConnectionPending as sinon.SinonStub).withArgs('pending1').returns(true);
            (connectionProvider.isConnectionFailed as sinon.SinonStub).returns(false);

            const children = await unifiedTreeProvider.getChildren();

            assert.strictEqual(children.length, 1);
            assert.ok(children[0] instanceof ConnectionNode);
            assert.strictEqual((children[0] as ConnectionNode).isPending, true);
        });

        test('should show active state for connections', async () => {
            const testConnections: ConnectionConfig[] = [
                { id: 'active1', name: 'Active Connection', server: 'srv1', database: 'db1', authType: 'sql', connectionType: 'database' }
            ];

            (connectionProvider.getServerGroups as sinon.SinonStub).returns([]);
            (connectionProvider.getSavedConnectionsList as sinon.SinonStub).resolves(testConnections);
            (connectionProvider.isConnectionActive as sinon.SinonStub).withArgs('active1').returns(true);
            (connectionProvider.isConnectionPending as sinon.SinonStub).returns(false);
            (connectionProvider.isConnectionFailed as sinon.SinonStub).returns(false);

            const children = await unifiedTreeProvider.getChildren();

            assert.strictEqual(children.length, 1);
            assert.ok(children[0] instanceof ConnectionNode);
            assert.strictEqual((children[0] as ConnectionNode).isActive, true);
        });
    });

    suite('Database Filter Indicators', () => {
        test('should indicate when database filter is applied', async () => {
            const testConnections: ConnectionConfig[] = [
                { id: 'filtered1', name: 'Filtered Server', server: 'srv1', database: '', authType: 'windows', connectionType: 'server' }
            ];

            (connectionProvider.getServerGroups as sinon.SinonStub).returns([]);
            (connectionProvider.getSavedConnectionsList as sinon.SinonStub).resolves(testConnections);
            (connectionProvider.isConnectionActive as sinon.SinonStub).returns(false);
            (connectionProvider.isConnectionPending as sinon.SinonStub).returns(false);
            (connectionProvider.isConnectionFailed as sinon.SinonStub).returns(false);
            (connectionProvider.hasDatabaseFilter as sinon.SinonStub).withArgs('filtered1').returns(true);

            const children = await unifiedTreeProvider.getChildren();

            assert.strictEqual(children.length, 1);
            assert.ok(children[0] instanceof ServerConnectionNode);
            assert.strictEqual((children[0] as ServerConnectionNode).hasFilter, true);
        });
    });

    suite('Error Handling', () => {
        test('should handle errors in getChildren gracefully', async () => {
            (connectionProvider.getServerGroups as sinon.SinonStub).throws(new Error('Test error'));

            const children = await unifiedTreeProvider.getChildren();

            assert.deepStrictEqual(children, []);
            
            // Verify error was logged
            const appendLineCalls = (outputChannel.appendLine as sinon.SinonStub).getCalls();
            const errorLogs = appendLineCalls.filter(call => 
                call.args[0].includes('[UnifiedTreeProvider] Error loading root nodes')
            );
            assert.strictEqual(errorLogs.length, 1);
        });

        test('should handle connection provider failures', async () => {
            (connectionProvider.getSavedConnectionsList as sinon.SinonStub).rejects(new Error('Connection failed'));
            (connectionProvider.getServerGroups as sinon.SinonStub).returns([]);

            const children = await unifiedTreeProvider.getChildren();

            assert.deepStrictEqual(children, []);
        });
    });

    suite('Parent Navigation', () => {
        test('should return undefined parent for root nodes', async () => {
            const serverGroupNode = new ServerGroupNode({ id: 'group1', name: 'Test Group' }, 0, connectionProvider);
            
            const parent = await unifiedTreeProvider.getParent(serverGroupNode);
            
            assert.strictEqual(parent, undefined);
        });
    });

    suite('File Decorations', () => {
        test('should provide file decoration for URI', () => {
            const testUri = vscode.Uri.file('/test/path');
            
            const decoration = unifiedTreeProvider.provideFileDecoration(testUri);
            
            // Should handle decoration request gracefully
            // Implementation might return undefined for non-relevant URIs
            assert.ok(decoration === undefined || decoration instanceof Object);
        });
    });

    suite('Drag and Drop', () => {
        test('should handle drag operation', async () => {
            const sourceNode = new ConnectionNode('Test', 'srv', 'db', 'id', 'sql', false, false);
            const dataTransfer = new vscode.DataTransfer();
            const token = new vscode.CancellationTokenSource().token;
            
            // Should not throw error
            await assert.doesNotReject(async () => {
                await unifiedTreeProvider.handleDrag([sourceNode], dataTransfer, token);
            });
        });

        test('should handle drop operation', async () => {
            const targetNode = new ServerGroupNode({ id: 'group1', name: 'Target Group' }, 0, connectionProvider);
            const dataTransfer = new vscode.DataTransfer();
            const token = new vscode.CancellationTokenSource().token;
            
            // Should not throw error
            await assert.doesNotReject(async () => {
                await unifiedTreeProvider.handleDrop(targetNode, dataTransfer, token);
            });
        });
    });

    suite('Auto-Connect Behavior', () => {
        test('should trigger auto-connect for inactive server connections', async () => {
            const serverConnection = new ServerConnectionNode(
                'Server Connection',
                'localhost',
                'srv1',
                'windows',
                false, // not active
                false, // not pending
                false
            );

            (connectionProvider.connectToSavedById as sinon.SinonStub).resolves();

            const children = await unifiedTreeProvider.getChildren(serverConnection);

            // Should attempt to connect
            assert.strictEqual((connectionProvider.connectToSavedById as sinon.SinonStub).called, true);
            
            // Should return empty array immediately
            assert.deepStrictEqual(children, []);
        });
    });
});