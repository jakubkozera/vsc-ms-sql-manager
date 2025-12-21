import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { SchemaCache, SchemaObjectType } from '../utils/schemaCache';
import * as fs from 'fs/promises';
import * as path from 'path';

suite('SchemaCache Tests', () => {
    let schemaCache: SchemaCache;
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockPool: any;
    let mockConnection: any;
    let cachePath: string;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock extension context
        cachePath = path.join(__dirname, '../../test-cache');
        mockContext = {
            globalStorageUri: vscode.Uri.file(cachePath),
            subscriptions: [],
            workspaceState: {} as any,
            globalState: {} as any,
            extensionUri: vscode.Uri.file(__dirname),
            extensionPath: '',
            asAbsolutePath: (relativePath: string) => relativePath,
            storageUri: undefined,
            storagePath: undefined,
            logUri: vscode.Uri.file(__dirname),
            logPath: '',
            extensionMode: vscode.ExtensionMode.Test,
            extension: {} as any,
            environmentVariableCollection: {} as any,
            secrets: {} as any,
            languageModelAccessInformation: {} as any
        } as unknown as vscode.ExtensionContext;

        // Mock connection info
        mockConnection = {
            id: 'test-conn-1',
            name: 'Test Connection',
            server: 'localhost',
            database: 'TestDB'
        };

        // Mock database pool with query responses
        mockPool = {
            request: sandbox.stub().returns({
                query: sandbox.stub(),
                input: function() { return this; }
            })
        };

        // Initialize schema cache
        schemaCache = SchemaCache.getInstance(mockContext);
    });

    teardown(async () => {
        sandbox.restore();
        schemaCache.clearAll();
        
        // Clean up test cache directory
        try {
            await fs.rm(cachePath, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    suite('Database Hash Computation', () => {
        test('should compute database hash correctly', async () => {
            const mockRequest = mockPool.request();
            
            // Mock hash queries
            mockRequest.query.onCall(0).resolves({
                recordset: [{ objectsChecksum: 12345 }]
            });
            mockRequest.query.onCall(1).resolves({
                recordset: [{ maxModifyDate: new Date('2025-01-01') }]
            });
            mockRequest.query.onCall(2).resolves({
                recordset: [{ tables: 5, views: 3, procedures: 10, functions: 2 }]
            });

            const schema = await schemaCache.getSchema(mockConnection, mockPool);
            
            assert.strictEqual(schema.hash.objectsChecksum, 12345);
            assert.strictEqual(schema.hash.objectCounts.tables, 5);
            assert.strictEqual(schema.hash.objectCounts.views, 3);
            assert.strictEqual(schema.hash.objectCounts.procedures, 10);
            assert.strictEqual(schema.hash.objectCounts.functions, 2);
        });

        test('should detect schema changes via hash mismatch', async () => {
            const mockRequest = mockPool.request();
            
            // First call - original hash
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 12345 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date('2025-01-01') }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 5, views: 3, procedures: 10, functions: 2 }] });
            
            // Mock tables, columns, views, procedures, functions, indexes, constraints, triggers queries
            for (let i = 0; i < 8; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }

            await schemaCache.getSchema(mockConnection, mockPool);
            const callCount = mockRequest.query.callCount;

            // Second call - different hash (should trigger refresh)
            mockRequest.query.resetHistory();
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 67890 }] }); // Changed!
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date('2025-01-02') }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 6, views: 3, procedures: 10, functions: 2 }] });
            
            for (let i = 0; i < 8; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }

            await schemaCache.getSchema(mockConnection, mockPool);
            
            // Should have queried again due to hash mismatch
            assert.ok(mockRequest.query.callCount > 3, 'Schema should be refreshed on hash mismatch');
        });
    });

    suite('Table Caching', () => {
        test('should fetch and cache tables', async () => {
            const mockRequest = mockPool.request();
            
            // Mock hash queries
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 12345 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 2, views: 0, procedures: 0, functions: 0 }] });
            
            // Mock tables query
            mockRequest.query.onCall(3).resolves({
                recordset: [
                    { schema: 'dbo', name: 'Users', owner: 'dbo', rowCount: 100, sizeMB: 5.2, lastModified: new Date() },
                    { schema: 'dbo', name: 'Orders', owner: 'dbo', rowCount: 500, sizeMB: 12.5, lastModified: new Date() }
                ]
            });
            
            // Mock other queries (columns, views, etc.)
            for (let i = 0; i < 7; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }

            const tables = await schemaCache.getTables(mockConnection, mockPool);
            
            assert.strictEqual(tables.length, 2);
            assert.strictEqual(tables[0].name, 'Users');
            assert.strictEqual(tables[0].schema, 'dbo');
            assert.strictEqual(tables[0].rowCount, 100);
            assert.strictEqual(tables[1].name, 'Orders');
        });

        test('should fetch table columns', async () => {
            const mockRequest = mockPool.request();
            
            // Mock hash queries
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 12345 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 1, views: 0, procedures: 0, functions: 0 }] });
            
            // Mock tables query
            mockRequest.query.onCall(3).resolves({
                recordset: [{ schema: 'dbo', name: 'Users', owner: 'dbo', rowCount: 100, sizeMB: 5.2, lastModified: new Date() }]
            });
            
            // Mock columns query
            mockRequest.query.onCall(4).resolves({
                recordset: [
                    { tableSchema: 'dbo', tableName: 'Users', columnName: 'Id', dataType: 'int', 
                      isNullable: 'NO', position: 1, isPrimaryKey: 1, isIdentity: 1 },
                    { tableSchema: 'dbo', tableName: 'Users', columnName: 'Name', dataType: 'nvarchar', 
                      isNullable: 'NO', maxLength: 100, position: 2, isPrimaryKey: 0, isIdentity: 0 },
                    { tableSchema: 'dbo', tableName: 'Users', columnName: 'Email', dataType: 'nvarchar', 
                      isNullable: 'YES', maxLength: 255, position: 3, isPrimaryKey: 0, isIdentity: 0 }
                ]
            });
            
            // Mock other queries
            for (let i = 0; i < 6; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }

            const columns = await schemaCache.getTableColumns(mockConnection, mockPool, 'dbo', 'Users');
            
            assert.strictEqual(columns.length, 3);
            assert.strictEqual(columns[0].columnName, 'Id');
            assert.strictEqual(columns[0].dataType, 'int');
            assert.strictEqual(columns[0].isPrimaryKey, true);
            assert.strictEqual(columns[0].isIdentity, true);
            assert.strictEqual(columns[1].columnName, 'Name');
            assert.strictEqual(columns[1].isNullable, false);
            assert.strictEqual(columns[2].columnName, 'Email');
            assert.strictEqual(columns[2].isNullable, true);
        });

        test('should cache table data in memory', async () => {
            const mockRequest = mockPool.request();
            
            // Setup mocks
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 12345 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 1, views: 0, procedures: 0, functions: 0 }] });
            mockRequest.query.onCall(3).resolves({
                recordset: [{ schema: 'dbo', name: 'Users', owner: 'dbo', rowCount: 100, sizeMB: 5.2, lastModified: new Date() }]
            });
            
            for (let i = 0; i < 7; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }

            // First call
            await schemaCache.getTables(mockConnection, mockPool);
            const firstCallCount = mockRequest.query.callCount;

            // Second call - should use cache
            await schemaCache.getTables(mockConnection, mockPool);
            const secondCallCount = mockRequest.query.callCount;

            // Should not query again (same call count)
            assert.strictEqual(firstCallCount, secondCallCount, 'Should use cached data on second call');
        });
    });

    suite('Views, Procedures, and Functions', () => {
        test('should fetch and cache views', async () => {
            const mockRequest = mockPool.request();
            
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 12345 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 0, views: 2, procedures: 0, functions: 0 }] });
            mockRequest.query.onCall(3).resolves({ recordset: [] }); // tables
            mockRequest.query.onCall(4).resolves({ recordset: [] }); // columns
            mockRequest.query.onCall(5).resolves({
                recordset: [
                    { schema: 'dbo', name: 'UserView', lastModified: new Date() },
                    { schema: 'dbo', name: 'OrderView', lastModified: new Date() }
                ]
            });
            
            for (let i = 0; i < 5; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }

            const views = await schemaCache.getViews(mockConnection, mockPool);
            
            assert.strictEqual(views.length, 2);
            assert.strictEqual(views[0].name, 'UserView');
            assert.strictEqual(views[1].name, 'OrderView');
        });

        test('should fetch and cache stored procedures', async () => {
            const mockRequest = mockPool.request();
            
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 12345 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 0, views: 0, procedures: 2, functions: 0 }] });
            
            for (let i = 0; i < 3; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }
            
            mockRequest.query.onCall(6).resolves({
                recordset: [
                    { schema: 'dbo', name: 'GetUsers', lastModified: new Date() },
                    { schema: 'dbo', name: 'InsertOrder', lastModified: new Date() }
                ]
            });
            
            for (let i = 0; i < 4; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }

            const procedures = await schemaCache.getProcedures(mockConnection, mockPool);
            
            assert.strictEqual(procedures.length, 2);
            assert.strictEqual(procedures[0].name, 'GetUsers');
            assert.strictEqual(procedures[1].name, 'InsertOrder');
        });

        test('should fetch and cache functions', async () => {
            const mockRequest = mockPool.request();
            
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 12345 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 0, views: 0, procedures: 0, functions: 2 }] });
            
            for (let i = 0; i < 4; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }
            
            mockRequest.query.onCall(7).resolves({
                recordset: [
                    { schema: 'dbo', name: 'CalculateTotal', functionType: 'SCALAR_FUNCTION', lastModified: new Date() },
                    { schema: 'dbo', name: 'GetOrderItems', functionType: 'TABLE_FUNCTION', lastModified: new Date() }
                ]
            });
            
            for (let i = 0; i < 3; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }

            const functions = await schemaCache.getFunctions(mockConnection, mockPool);
            
            assert.strictEqual(functions.length, 2);
            assert.strictEqual(functions[0].name, 'CalculateTotal');
            assert.strictEqual(functions[0].functionType, 'SCALAR_FUNCTION');
            assert.strictEqual(functions[1].name, 'GetOrderItems');
        });
    });

    suite('Indexes and Constraints', () => {
        test('should fetch table indexes', async () => {
            const mockRequest = mockPool.request();
            
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 12345 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 1, views: 0, procedures: 0, functions: 0 }] });
            mockRequest.query.onCall(3).resolves({
                recordset: [{ schema: 'dbo', name: 'Users', owner: 'dbo', rowCount: 100, sizeMB: 5.2, lastModified: new Date() }]
            });
            mockRequest.query.onCall(4).resolves({ recordset: [] }); // columns
            mockRequest.query.onCall(5).resolves({ recordset: [] }); // views
            mockRequest.query.onCall(6).resolves({ recordset: [] }); // procedures
            mockRequest.query.onCall(7).resolves({ recordset: [] }); // functions
            mockRequest.query.onCall(8).resolves({
                recordset: [
                    { tableSchema: 'dbo', tableName: 'Users', indexName: 'PK_Users', indexType: 'CLUSTERED', 
                      isUnique: true, isPrimaryKey: true, columnName: 'Id', key_ordinal: 1 },
                    { tableSchema: 'dbo', tableName: 'Users', indexName: 'IX_Users_Email', indexType: 'NONCLUSTERED', 
                      isUnique: true, isPrimaryKey: false, columnName: 'Email', key_ordinal: 1 }
                ]
            });
            
            for (let i = 0; i < 2; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }

            const indexes = await schemaCache.getTableIndexes(mockConnection, mockPool, 'dbo', 'Users');
            
            assert.strictEqual(indexes.length, 2);
            assert.strictEqual(indexes[0].indexName, 'PK_Users');
            assert.strictEqual(indexes[0].isPrimaryKey, true);
            assert.strictEqual(indexes[1].indexName, 'IX_Users_Email');
            assert.strictEqual(indexes[1].isUnique, true);
        });

        test('should fetch table constraints', async () => {
            const mockRequest = mockPool.request();
            
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 12345 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 1, views: 0, procedures: 0, functions: 0 }] });
            mockRequest.query.onCall(3).resolves({
                recordset: [{ schema: 'dbo', name: 'Orders', owner: 'dbo', rowCount: 100, sizeMB: 5.2, lastModified: new Date() }]
            });
            
            for (let i = 0; i < 5; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }
            
            mockRequest.query.onCall(9).resolves({
                recordset: [
                    { tableSchema: 'dbo', tableName: 'Orders', constraintName: 'PK_Orders', 
                      constraintType: 'PRIMARY KEY', columnName: 'Id' },
                    { tableSchema: 'dbo', tableName: 'Orders', constraintName: 'FK_Orders_Users', 
                      constraintType: 'FOREIGN KEY', columnName: 'UserId', 
                      referencedTableSchema: 'dbo', referencedTableName: 'Users', referencedColumnName: 'Id' },
                    { tableSchema: 'dbo', tableName: 'Orders', constraintName: 'CHK_Orders_Total', 
                      constraintType: 'CHECK', checkClause: 'Total > 0' }
                ]
            });
            
            mockRequest.query.resolves({ recordset: [] });

            const constraints = await schemaCache.getTableConstraints(mockConnection, mockPool, 'dbo', 'Orders');
            
            assert.strictEqual(constraints.length, 3);
            assert.strictEqual(constraints[0].constraintName, 'PK_Orders');
            assert.strictEqual(constraints[0].constraintType, 'PRIMARY KEY');
            assert.strictEqual(constraints[1].constraintName, 'FK_Orders_Users');
            assert.strictEqual(constraints[1].referencedTableName, 'Users');
            assert.strictEqual(constraints[2].constraintName, 'CHK_Orders_Total');
            assert.strictEqual(constraints[2].checkClause, 'Total > 0');
        });
    });

    suite('Object Invalidation', () => {
        test('should invalidate and refresh specific table', async () => {
            const mockRequest = mockPool.request();
            
            // Initial schema load
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 12345 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 1, views: 0, procedures: 0, functions: 0 }] });
            mockRequest.query.onCall(3).resolves({
                recordset: [{ schema: 'dbo', name: 'Users', owner: 'dbo', rowCount: 100, sizeMB: 5.2, lastModified: new Date() }]
            });
            
            for (let i = 0; i < 7; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }

            await schemaCache.getSchema(mockConnection, mockPool);
            const initialCallCount = mockRequest.query.callCount;

            // Invalidate table
            mockRequest.query.resetHistory();
            
            // Mock refresh queries for specific table
            mockRequest.query.onCall(0).resolves({
                recordset: [{ schema: 'dbo', name: 'Users', owner: 'dbo', rowCount: 150, sizeMB: 6.0, lastModified: new Date() }]
            });
            mockRequest.query.onCall(1).resolves({ recordset: [] }); // columns
            mockRequest.query.onCall(2).resolves({ recordset: [] }); // indexes
            mockRequest.query.onCall(3).resolves({ recordset: [] }); // constraints
            mockRequest.query.onCall(4).resolves({ recordset: [{ objectsChecksum: 12345 }] }); // hash
            mockRequest.query.onCall(5).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(6).resolves({ recordset: [{ tables: 1, views: 0, procedures: 0, functions: 0 }] });

            await schemaCache.invalidateObject(mockConnection, mockPool, SchemaObjectType.Table, 'dbo', 'Users');

            // Should have made refresh queries
            assert.ok(mockRequest.query.callCount > 0, 'Should refresh table data after invalidation');
        });

        test('should refresh entire schema on refreshAll', async () => {
            const mockRequest = mockPool.request();
            
            // Initial load
            for (let i = 0; i < 11; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 12345 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 0, views: 0, procedures: 0, functions: 0 }] });

            await schemaCache.getSchema(mockConnection, mockPool);
            
            mockRequest.query.resetHistory();
            
            // Refresh all
            for (let i = 0; i < 11; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 67890 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 5, views: 3, procedures: 10, functions: 2 }] });

            await schemaCache.refreshAll(mockConnection, mockPool);

            // Should fetch complete schema
            assert.ok(mockRequest.query.callCount >= 11, 'Should fetch all schema components');
        });
    });

    suite('Cache Persistence', () => {
        test('should clear all caches', async () => {
            const mockRequest = mockPool.request();
            
            // Load schema
            for (let i = 0; i < 11; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 12345 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 0, views: 0, procedures: 0, functions: 0 }] });

            await schemaCache.getSchema(mockConnection, mockPool);
            
            // Clear cache
            schemaCache.clearAll();
            
            mockRequest.query.resetHistory();
            
            // Next call should fetch again
            for (let i = 0; i < 11; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 12345 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 0, views: 0, procedures: 0, functions: 0 }] });

            await schemaCache.getSchema(mockConnection, mockPool);
            
            assert.ok(mockRequest.query.callCount >= 11, 'Should refetch schema after clear');
        });

        test('should clear cache for specific connection', async () => {
            const mockRequest = mockPool.request();
            
            for (let i = 0; i < 11; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 12345 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 0, views: 0, procedures: 0, functions: 0 }] });

            await schemaCache.getSchema(mockConnection, mockPool);
            
            schemaCache.clear(mockConnection);
            
            mockRequest.query.resetHistory();
            
            for (let i = 0; i < 11; i++) {
                mockRequest.query.resolves({ recordset: [] });
            }
            mockRequest.query.onCall(0).resolves({ recordset: [{ objectsChecksum: 12345 }] });
            mockRequest.query.onCall(1).resolves({ recordset: [{ maxModifyDate: new Date() }] });
            mockRequest.query.onCall(2).resolves({ recordset: [{ tables: 0, views: 0, procedures: 0, functions: 0 }] });

            await schemaCache.getSchema(mockConnection, mockPool);
            
            assert.ok(mockRequest.query.callCount >= 11, 'Should refetch after connection-specific clear');
        });
    });
});
