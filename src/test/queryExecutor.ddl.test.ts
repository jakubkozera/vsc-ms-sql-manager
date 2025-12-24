import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { QueryExecutor } from '../queryExecutor';
import { ConnectionProvider } from '../connectionProvider';
import { QueryHistoryManager } from '../queryHistory';
import { SchemaCache, SchemaObjectType } from '../utils/schemaCache';

suite('QueryExecutor DDL Detection Tests', () => {
    let queryExecutor: QueryExecutor;
    let connectionProvider: ConnectionProvider;
    let outputChannel: vscode.OutputChannel;
    let historyManager: QueryHistoryManager;
    let schemaCache: SchemaCache;
    let sandbox: sinon.SinonSandbox;
    let mockConnection: any;
    let mockContext: vscode.ExtensionContext;
    let invalidateObjectStub: sinon.SinonStub;

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
                    recordset: [],
                    recordsets: [[]],
                    rowsAffected: [1]
                }),
                cancel: sandbox.stub(),
                setArrayRowMode: sandbox.stub()
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
            }),
            getConnectionConfig: sandbox.stub().returns({
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

        // Mock context
        mockContext = {
            globalStorageUri: vscode.Uri.file('/test/path'),
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

        // Mock SchemaCache - create instance and stub
        schemaCache = SchemaCache.getInstance(mockContext);
        invalidateObjectStub = sandbox.stub(schemaCache, 'invalidateObject').resolves();

        // Create query executor with context
        queryExecutor = new QueryExecutor(connectionProvider, outputChannel, historyManager, mockContext);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('CREATE TABLE Detection', () => {
        test('should detect CREATE TABLE and invalidate cache', async () => {
            const query = 'CREATE TABLE dbo.Users (Id INT PRIMARY KEY, Name NVARCHAR(100))';
            
            await queryExecutor.executeQuery(query);

            assert.ok(invalidateObjectStub.called, 'Should call invalidateObject');
            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Table,
                    'dbo',
                    'Users'
                ),
                'Should invalidate Users table in dbo schema'
            );
        });

        test('should detect CREATE TABLE with brackets', async () => {
            const query = 'CREATE TABLE [dbo].[Orders] ([OrderId] INT, [Total] DECIMAL(10,2))';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Table,
                    'dbo',
                    'Orders'
                ),
                'Should handle bracketed names'
            );
        });

        test('should detect CREATE TABLE without schema (defaults to dbo)', async () => {
            const query = 'CREATE TABLE Products (ProductId INT, ProductName NVARCHAR(200))';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Table,
                    'dbo',
                    'Products'
                ),
                'Should default to dbo schema'
            );
        });
    });

    suite('ALTER TABLE Detection', () => {
        test('should detect ALTER TABLE', async () => {
            const query = 'ALTER TABLE dbo.Users ADD Email NVARCHAR(255)';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Table,
                    'dbo',
                    'Users'
                )
            );
        });

        test('should detect ALTER TABLE with multiple statements', async () => {
            const query = `
                ALTER TABLE dbo.Orders ADD CustomerEmail NVARCHAR(255);
                ALTER TABLE dbo.Products DROP COLUMN OldField;
            `;
            
            await queryExecutor.executeQuery(query);

            assert.strictEqual(invalidateObjectStub.callCount, 2, 'Should detect both ALTER statements');
        });
    });

    suite('DROP TABLE Detection', () => {
        test('should detect DROP TABLE', async () => {
            const query = 'DROP TABLE dbo.OldTable';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Table,
                    'dbo',
                    'OldTable'
                )
            );
        });

        test('should detect DROP TABLE IF EXISTS', async () => {
            const query = 'DROP TABLE IF EXISTS dbo.TempTable';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Table,
                    'dbo',
                    'TempTable'
                )
            );
        });
    });

    suite('VIEW Detection', () => {
        test('should detect CREATE VIEW', async () => {
            const query = 'CREATE VIEW dbo.UserView AS SELECT * FROM Users';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.View,
                    'dbo',
                    'UserView'
                )
            );
        });

        test('should detect ALTER VIEW', async () => {
            const query = 'ALTER VIEW dbo.OrderView AS SELECT OrderId, Total FROM Orders WHERE Total > 100';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.View,
                    'dbo',
                    'OrderView'
                )
            );
        });

        test('should detect DROP VIEW', async () => {
            const query = 'DROP VIEW dbo.OldView';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.View,
                    'dbo',
                    'OldView'
                )
            );
        });
    });

    suite('STORED PROCEDURE Detection', () => {
        test('should detect CREATE PROCEDURE', async () => {
            const query = 'CREATE PROCEDURE dbo.GetUsers AS SELECT * FROM Users';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Procedure,
                    'dbo',
                    'GetUsers'
                )
            );
        });

        test('should detect CREATE PROC (short form)', async () => {
            const query = 'CREATE PROC dbo.InsertOrder @UserId INT, @Total DECIMAL AS INSERT INTO Orders VALUES (@UserId, @Total)';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Procedure,
                    'dbo',
                    'InsertOrder'
                )
            );
        });

        test('should detect ALTER PROCEDURE', async () => {
            const query = 'ALTER PROCEDURE dbo.UpdateUser @UserId INT AS UPDATE Users SET LastModified = GETDATE() WHERE Id = @UserId';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Procedure,
                    'dbo',
                    'UpdateUser'
                )
            );
        });

        test('should detect DROP PROCEDURE', async () => {
            const query = 'DROP PROCEDURE dbo.OldProcedure';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Procedure,
                    'dbo',
                    'OldProcedure'
                )
            );
        });
    });

    suite('FUNCTION Detection', () => {
        test('should detect CREATE FUNCTION', async () => {
            const query = 'CREATE FUNCTION dbo.CalculateTotal(@OrderId INT) RETURNS DECIMAL(10,2) AS BEGIN RETURN (SELECT Total FROM Orders WHERE Id = @OrderId) END';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Function,
                    'dbo',
                    'CalculateTotal'
                )
            );
        });

        test('should detect ALTER FUNCTION', async () => {
            const query = 'ALTER FUNCTION dbo.GetUserCount() RETURNS INT AS BEGIN RETURN (SELECT COUNT(*) FROM Users) END';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Function,
                    'dbo',
                    'GetUserCount'
                )
            );
        });

        test('should detect DROP FUNCTION', async () => {
            const query = 'DROP FUNCTION dbo.OldFunction';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Function,
                    'dbo',
                    'OldFunction'
                )
            );
        });
    });

    suite('TRIGGER Detection', () => {
        test('should detect CREATE TRIGGER', async () => {
            const query = 'CREATE TRIGGER dbo.trg_Users_Update ON dbo.Users AFTER UPDATE AS UPDATE Users SET LastModified = GETDATE()';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Trigger,
                    'dbo',
                    'trg_Users_Update'
                )
            );
        });

        test('should detect ALTER TRIGGER', async () => {
            const query = 'ALTER TRIGGER dbo.trg_Orders_Insert ON dbo.Orders AFTER INSERT AS INSERT INTO OrderLog SELECT * FROM inserted';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Trigger,
                    'dbo',
                    'trg_Orders_Insert'
                )
            );
        });

        test('should detect DROP TRIGGER', async () => {
            const query = 'DROP TRIGGER dbo.OldTrigger';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Trigger,
                    'dbo',
                    'OldTrigger'
                )
            );
        });
    });

    suite('INDEX Detection', () => {
        test('should detect CREATE INDEX', async () => {
            const query = 'CREATE INDEX IX_Users_Email ON dbo.Users(Email)';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Index,
                    'dbo',
                    'Users'
                ),
                'Should invalidate the table, not the index itself'
            );
        });

        test('should detect CREATE UNIQUE INDEX', async () => {
            const query = 'CREATE UNIQUE INDEX IX_Products_Code ON dbo.Products(ProductCode)';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Index,
                    'dbo',
                    'Products'
                )
            );
        });

        test('should detect CREATE CLUSTERED INDEX', async () => {
            const query = 'CREATE CLUSTERED INDEX IX_Orders_Date ON dbo.Orders(OrderDate)';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Index,
                    'dbo',
                    'Orders'
                )
            );
        });

        test('should detect DROP INDEX', async () => {
            const query = 'DROP INDEX IX_Users_Email ON dbo.Users';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Index,
                    'dbo',
                    'Users'
                )
            );
        });
    });

    suite('Complex Scenarios', () => {
        test('should detect multiple DDL statements in one query', async () => {
            const query = `
                CREATE TABLE dbo.NewTable (Id INT);
                CREATE VIEW dbo.NewView AS SELECT * FROM NewTable;
                CREATE PROCEDURE dbo.NewProc AS SELECT * FROM NewView;
            `;
            
            await queryExecutor.executeQuery(query);

            assert.strictEqual(invalidateObjectStub.callCount, 3, 'Should detect all three DDL statements');
            assert.ok(invalidateObjectStub.calledWith(sinon.match.any, sinon.match.any, SchemaObjectType.Table, 'dbo', 'NewTable'));
            assert.ok(invalidateObjectStub.calledWith(sinon.match.any, sinon.match.any, SchemaObjectType.View, 'dbo', 'NewView'));
            assert.ok(invalidateObjectStub.calledWith(sinon.match.any, sinon.match.any, SchemaObjectType.Procedure, 'dbo', 'NewProc'));
        });

        test('should ignore DDL in comments', async () => {
            const query = `
                -- CREATE TABLE dbo.CommentedTable (Id INT);
                /* CREATE VIEW dbo.BlockCommentView AS SELECT 1 */
                SELECT * FROM Users;
            `;
            
            await queryExecutor.executeQuery(query);

            assert.strictEqual(invalidateObjectStub.callCount, 0, 'Should not detect DDL in comments');
        });

        test('should handle case insensitivity', async () => {
            const query = 'create table dbo.LowercaseTable (id int)';
            
            await queryExecutor.executeQuery(query);

            assert.ok(
                invalidateObjectStub.calledWith(
                    sinon.match.any,
                    sinon.match.any,
                    SchemaObjectType.Table,
                    'dbo',
                    'LowercaseTable'
                )
            );
        });

        test('should not invalidate on SELECT queries', async () => {
            const query = 'SELECT * FROM dbo.Users';
            
            await queryExecutor.executeQuery(query);

            assert.strictEqual(invalidateObjectStub.callCount, 0, 'Should not invalidate on SELECT');
        });

        test('should not invalidate on INSERT/UPDATE/DELETE', async () => {
            const query = `
                INSERT INTO dbo.Users VALUES (1, 'John');
                UPDATE dbo.Orders SET Total = 100 WHERE Id = 1;
                DELETE FROM dbo.Products WHERE Id = 5;
            `;
            
            await queryExecutor.executeQuery(query);

            assert.strictEqual(invalidateObjectStub.callCount, 0, 'Should not invalidate on DML statements');
        });

        test('should handle GO batch separators', async () => {
            const query = `
                CREATE TABLE dbo.Table1 (Id INT)
                GO
                CREATE TABLE dbo.Table2 (Id INT)
                GO
            `;
            
            await queryExecutor.executeQuery(query);

            // Both tables should be detected across GO statements
            assert.ok(invalidateObjectStub.callCount >= 2, 'Should detect DDL across GO batches');
        });
    });

    suite('Error Handling', () => {
        test('should not fail query execution if cache invalidation fails', async () => {
            invalidateObjectStub.rejects(new Error('Cache error'));
            
            const query = 'CREATE TABLE dbo.TestTable (Id INT)';
            
            // Should not throw error
            await queryExecutor.executeQuery(query);

            assert.ok(true, 'Query execution should continue despite cache error');
        });

        test('should handle malformed DDL gracefully', async () => {
            const query = 'CREATE TABLE dbo. (Id INT)'; // Missing table name
            
            // Should not throw error
            await queryExecutor.executeQuery(query);

            // Might not invalidate anything, but shouldn't crash
            assert.ok(true, 'Should handle malformed DDL without crashing');
        });
    });
});
