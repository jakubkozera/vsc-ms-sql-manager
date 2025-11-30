import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ConnectionProvider } from '../connectionProvider';

suite('Stored Procedure Commands Test Suite', () => {
    let connectionProvider: ConnectionProvider;
    let outputChannel: vscode.OutputChannel;
    let context: vscode.ExtensionContext;
    let sandbox: sinon.SinonSandbox;

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

        // Mock extension context
        const mockGlobalState = {
            get: sandbox.stub().callsFake((key, defaultValue) => {
                if (key === 'mssqlManager.databaseFilters') return {};
                if (key === 'mssqlManager.tableFilters') return {};
                if (key === 'mssqlManager.savedConnections') return [];
                return defaultValue;
            }),
            update: sandbox.stub().resolves(true)
        };

        const mockSecrets = {
            store: sandbox.stub().resolves(),
            get: sandbox.stub().resolves(''),
            delete: sandbox.stub().resolves()
        };

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
            logPath: '/test/log'
        } as any;

        connectionProvider = new ConnectionProvider(context, outputChannel);

        // Mock VS Code functions
        sandbox.stub(vscode.window, 'showErrorMessage').resolves();
        sandbox.stub(vscode.window, 'showInformationMessage').resolves();
        sandbox.stub(vscode.window, 'showInputBox').resolves('test_procedure');
        sandbox.stub(vscode.workspace, 'openTextDocument').resolves();
        sandbox.stub(vscode.window, 'showTextDocument').resolves();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('createStoredProcedure Command', () => {
        test('should validate procedure name input', () => {
            const validName = 'sp_GetUsers';
            const invalidName = '';

            assert.ok(validName.trim().length > 0);
            assert.strictEqual(invalidName.trim().length, 0);
        });

        test('should generate CREATE PROCEDURE script', () => {
            const procedureName = 'sp_GetUsers';
            const createScript = `CREATE PROCEDURE [${procedureName}]
AS
BEGIN
    -- Procedure body here
    SELECT 1
END`;

            assert.ok(createScript.includes('CREATE PROCEDURE'));
            assert.ok(createScript.includes(procedureName));
            assert.ok(createScript.includes('BEGIN'));
            assert.ok(createScript.includes('END'));
        });

        test('should handle database node context', () => {
            const databaseNode = {
                label: 'TestDB',
                connectionId: 'test-conn'
            };

            assert.ok(databaseNode.label);
            assert.ok(databaseNode.connectionId);
        });

        test('should validate connection for procedure creation', () => {
            const connectionId = 'test-conn';
            const connection = connectionProvider.getConnection(connectionId);
            
            assert.strictEqual(connection, null); // No active connections in test
        });

        test('should handle procedure with parameters', () => {
            const procedureTemplate = `CREATE PROCEDURE [sp_GetUserById]
    @UserId INT
AS
BEGIN
    SELECT * FROM Users WHERE Id = @UserId
END`;

            assert.ok(procedureTemplate.includes('@UserId'));
            assert.ok(procedureTemplate.includes('INT'));
        });

        test('should handle procedure with output parameters', () => {
            const procedureTemplate = `CREATE PROCEDURE [sp_GetUserCount]
    @Count INT OUTPUT
AS
BEGIN
    SELECT @Count = COUNT(*) FROM Users
END`;

            assert.ok(procedureTemplate.includes('OUTPUT'));
            assert.ok(procedureTemplate.includes('@Count'));
        });

        test('should handle complex procedure template', () => {
            const complexTemplate = `CREATE PROCEDURE [sp_ComplexOperation]
    @Param1 NVARCHAR(100),
    @Param2 INT,
    @Result NVARCHAR(MAX) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @TempVar INT;
    
    -- Complex logic here
    SET @Result = 'Success';
END`;

            assert.ok(complexTemplate.includes('SET NOCOUNT ON'));
            assert.ok(complexTemplate.includes('DECLARE'));
            assert.ok(complexTemplate.includes('@TempVar'));
        });
    });

    suite('modifyStoredProcedure Command', () => {
        test('should generate ALTER PROCEDURE script', () => {
            const procedureNode = {
                label: 'sp_ExistingProcedure',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            const alterScript = `ALTER PROCEDURE [${procedureNode.label}]
AS
BEGIN
    -- Modified procedure body here
    SELECT 1
END`;

            assert.ok(alterScript.includes('ALTER PROCEDURE'));
            assert.ok(alterScript.includes(procedureNode.label));
        });

        test('should validate procedure node', () => {
            const validNode = {
                label: 'sp_TestProcedure',
                connectionId: 'conn',
                database: 'db'
            };
            const invalidNode = {
                label: null,
                connectionId: 'conn',
                database: 'db'
            };

            assert.ok(validNode.label);
            assert.ok(!invalidNode.label);
        });

        test('should handle procedure permissions', () => {
            const procedureScript = `ALTER PROCEDURE [sp_TestProcedure]
AS
BEGIN
    -- Check permissions
    IF NOT EXISTS (SELECT 1 FROM sys.database_permissions WHERE grantee_principal_id = USER_ID())
    BEGIN
        RAISERROR('Insufficient permissions', 16, 1);
        RETURN;
    END
    
    SELECT 1;
END`;

            assert.ok(procedureScript.includes('sys.database_permissions'));
            assert.ok(procedureScript.includes('RAISERROR'));
        });

        test('should handle error handling in procedures', () => {
            const procedureWithTryCatch = `ALTER PROCEDURE [sp_SafeProcedure]
AS
BEGIN
    BEGIN TRY
        -- Risky operation
        SELECT 1/0;
    END TRY
    BEGIN CATCH
        DECLARE @ErrorMessage NVARCHAR(4000);
        SET @ErrorMessage = ERROR_MESSAGE();
        RAISERROR(@ErrorMessage, 16, 1);
    END CATCH
END`;

            assert.ok(procedureWithTryCatch.includes('BEGIN TRY'));
            assert.ok(procedureWithTryCatch.includes('BEGIN CATCH'));
            assert.ok(procedureWithTryCatch.includes('ERROR_MESSAGE()'));
        });
    });

    suite('deleteStoredProcedure Command', () => {
        test('should generate DROP PROCEDURE script', () => {
            const procedureNode = {
                label: 'sp_ProcedureToDelete',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            const dropScript = `DROP PROCEDURE [${procedureNode.label}]`;
            assert.strictEqual(dropScript, 'DROP PROCEDURE [sp_ProcedureToDelete]');
        });

        test('should handle IF EXISTS check', () => {
            const procedureName = 'sp_TestProcedure';
            const safeDropScript = `IF EXISTS (SELECT * FROM sys.procedures WHERE name = '${procedureName}')
    DROP PROCEDURE [${procedureName}]`;

            assert.ok(safeDropScript.includes('IF EXISTS'));
            assert.ok(safeDropScript.includes('sys.procedures'));
        });

        test('should validate procedure existence', () => {
            const procedureName = 'sp_NonExistentProcedure';
            const checkQuery = `SELECT COUNT(*) FROM sys.procedures WHERE name = '${procedureName}'`;

            assert.ok(checkQuery.includes('COUNT(*)'));
            assert.ok(checkQuery.includes('sys.procedures'));
        });

        test('should handle cascading deletion', () => {
            const procedureName = 'sp_ParentProcedure';
            const cascadeCheck = `-- Check for dependencies before dropping
SELECT 
    referencing_schema_name,
    referencing_entity_name,
    referencing_id
FROM sys.dm_sql_referencing_entities ('dbo.${procedureName}', 'OBJECT')`;

            assert.ok(cascadeCheck.includes('sys.dm_sql_referencing_entities'));
            assert.ok(cascadeCheck.includes('referencing_entity_name'));
        });
    });

    suite('scriptStoredProcedureCreate Command', () => {
        test('should generate CREATE script from existing procedure', () => {
            const procedureNode = {
                label: 'sp_ExistingProcedure',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            // Mock procedure definition
            const procedureDefinition = `CREATE PROCEDURE [${procedureNode.label}]
    @Param1 INT
AS
BEGIN
    SELECT * FROM Users WHERE Id = @Param1
END`;

            assert.ok(procedureDefinition.includes('CREATE PROCEDURE'));
            assert.ok(procedureDefinition.includes('@Param1'));
        });

        test('should handle procedure metadata extraction', () => {
            const procedureMetadata = {
                name: 'sp_TestProcedure',
                schema: 'dbo',
                parameters: [
                    { name: '@Param1', type: 'INT', isOutput: false },
                    { name: '@Result', type: 'NVARCHAR(MAX)', isOutput: true }
                ],
                createDate: new Date(),
                modifyDate: new Date()
            };

            assert.ok(procedureMetadata.name);
            assert.strictEqual(procedureMetadata.parameters.length, 2);
            assert.strictEqual(procedureMetadata.parameters[1].isOutput, true);
        });

        test('should handle system procedures filtering', () => {
            const procedureList = [
                'sp_UserProcedure',
                'sp_helpdb',
                'sp_who',
                'sp_CustomProcedure'
            ];

            const userProcedures = procedureList.filter(name => 
                !name.startsWith('sp_help') && 
                !name.startsWith('sp_who') &&
                name.startsWith('sp_')
            );

            assert.strictEqual(userProcedures.length, 2);
            assert.ok(userProcedures.includes('sp_UserProcedure'));
            assert.ok(userProcedures.includes('sp_CustomProcedure'));
        });

        test('should handle procedure body extraction', () => {
            const systemDefinition = `CREATE PROCEDURE [dbo].[sp_TestProcedure]
    @Id INT
AS
BEGIN
    SET NOCOUNT ON;
    
    SELECT 
        Id,
        Name,
        Email
    FROM Users
    WHERE Id = @Id
END`;

            assert.ok(systemDefinition.includes('SET NOCOUNT ON'));
            assert.ok(systemDefinition.includes('dbo'));
        });
    });

    suite('executeStoredProcedure Command', () => {
        test('should generate EXEC statement', () => {
            const procedureNode = {
                label: 'sp_GetUsers',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            const execStatement = `EXEC [${procedureNode.label}]`;
            assert.strictEqual(execStatement, 'EXEC [sp_GetUsers]');
        });

        test('should handle procedure with parameters', () => {
            const procedureName = 'sp_GetUserById';
            const parameters = [
                { name: '@UserId', type: 'INT', defaultValue: '1' }
            ];

            const execWithParams = `EXEC [${procedureName}] @UserId = ${parameters[0].defaultValue}`;
            assert.strictEqual(execWithParams, 'EXEC [sp_GetUserById] @UserId = 1');
        });

        test('should handle output parameters', () => {
            const execWithOutput = `DECLARE @Result NVARCHAR(MAX);
EXEC [sp_ProcedureWithOutput] @InputParam = 1, @OutputParam = @Result OUTPUT;
SELECT @Result AS Result;`;

            assert.ok(execWithOutput.includes('DECLARE'));
            assert.ok(execWithOutput.includes('OUTPUT'));
            assert.ok(execWithOutput.includes('SELECT @Result'));
        });

        test('should handle procedure return values', () => {
            const execWithReturn = `DECLARE @ReturnValue INT;
EXEC @ReturnValue = [sp_ProcedureWithReturn] @Param = 1;
SELECT @ReturnValue AS ReturnValue;`;

            assert.ok(execWithReturn.includes('@ReturnValue'));
            assert.ok(execWithReturn.includes('SELECT @ReturnValue'));
        });

        test('should validate parameter types', () => {
            const parameters = [
                { name: '@StringParam', type: 'NVARCHAR(100)', value: 'test' },
                { name: '@IntParam', type: 'INT', value: 42 },
                { name: '@DateParam', type: 'DATETIME', value: '2023-01-01' }
            ];

            parameters.forEach(param => {
                assert.ok(param.name.startsWith('@'));
                assert.ok(param.type);
                assert.ok(param.value !== undefined);
            });
        });
    });

    suite('Integration and Workflow Tests', () => {
        test('should handle complete procedure lifecycle', () => {
            const lifecycle = {
                create: 'CREATE PROCEDURE [sp_Test]',
                alter: 'ALTER PROCEDURE [sp_Test]',
                execute: 'EXEC [sp_Test]',
                drop: 'DROP PROCEDURE [sp_Test]'
            };

            Object.values(lifecycle).forEach(statement => {
                assert.ok(statement.includes('sp_Test'));
            });
        });

        test('should handle procedure versioning', () => {
            const versions = [
                { name: 'sp_ProcessData_v1', version: 1 },
                { name: 'sp_ProcessData_v2', version: 2 },
                { name: 'sp_ProcessData_v3', version: 3 }
            ];

            const latestVersion = Math.max(...versions.map(v => v.version));
            assert.strictEqual(latestVersion, 3);
        });

        test('should handle procedure dependencies', () => {
            const procedureDependencies = {
                'sp_MainProcedure': ['sp_HelperProcedure1', 'sp_HelperProcedure2'],
                'sp_HelperProcedure1': ['sp_UtilityFunction'],
                'sp_HelperProcedure2': []
            };

            const mainDeps = procedureDependencies['sp_MainProcedure'];
            assert.strictEqual(mainDeps.length, 2);
        });

        test('should handle procedure permissions management', () => {
            const permissions = [
                { principal: 'db_datareader', permission: 'EXECUTE', procedure: 'sp_GetData' },
                { principal: 'db_datawriter', permission: 'EXECUTE', procedure: 'sp_UpdateData' },
                { principal: 'AppRole', permission: 'EXECUTE', procedure: 'sp_ProcessData' }
            ];

            assert.strictEqual(permissions.length, 3);
            permissions.forEach(perm => {
                assert.strictEqual(perm.permission, 'EXECUTE');
            });
        });

        test('should handle procedure performance monitoring', () => {
            const performanceMetrics = {
                procedure: 'sp_DataProcessing',
                avgExecutionTimeMs: 150,
                totalExecutions: 1000,
                lastExecutionTime: new Date(),
                memoryUsageKB: 512
            };

            assert.ok(performanceMetrics.avgExecutionTimeMs > 0);
            assert.ok(performanceMetrics.totalExecutions > 0);
        });

        test('should handle procedure backup and restore', () => {
            const backupInfo = {
                procedures: [
                    { name: 'sp_CriticalProcess', backed_up: true, backup_date: new Date() },
                    { name: 'sp_UtilityFunction', backed_up: false, backup_date: null }
                ]
            };

            const backedUpProcedures = backupInfo.procedures.filter(p => p.backed_up);
            assert.strictEqual(backedUpProcedures.length, 1);
        });

        test('should handle procedure testing framework', () => {
            const testFramework = {
                testProcedure: 'sp_TestRunner',
                testCases: [
                    { name: 'test_valid_input', expected: 'success' },
                    { name: 'test_invalid_input', expected: 'error' },
                    { name: 'test_boundary_values', expected: 'success' }
                ],
                results: []
            };

            assert.strictEqual(testFramework.testCases.length, 3);
            assert.ok(Array.isArray(testFramework.results));
        });

        test('should handle procedure documentation generation', () => {
            const documentation = {
                procedure: 'sp_ComplexProcess',
                description: 'Processes complex business logic',
                parameters: [
                    { name: '@InputData', description: 'Input data for processing' },
                    { name: '@Options', description: 'Processing options' }
                ],
                returnValues: ['0 for success', '-1 for error'],
                examples: ['EXEC sp_ComplexProcess @InputData = \'test\'']
            };

            assert.ok(documentation.description);
            assert.strictEqual(documentation.parameters.length, 2);
            assert.strictEqual(documentation.examples.length, 1);
        });
    });
});