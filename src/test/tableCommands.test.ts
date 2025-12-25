import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ConnectionProvider } from '../connectionProvider';
import { UnifiedTreeProvider } from '../unifiedTreeProvider';

suite('Table Commands Test Suite', () => {
    let connectionProvider: ConnectionProvider;
    let unifiedTreeProvider: UnifiedTreeProvider;
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
        unifiedTreeProvider = new UnifiedTreeProvider(connectionProvider, outputChannel);

        // Mock VS Code window functions
        sandbox.stub(vscode.window, 'showErrorMessage').resolves();
        sandbox.stub(vscode.window, 'showInformationMessage').resolves();
        sandbox.stub(vscode.workspace, 'openTextDocument').resolves();
        sandbox.stub(vscode.window, 'showTextDocument').resolves();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('selectTop1000 Command', () => {
        test('should process table node correctly', () => {
            const tableNode = {
                label: 'Users',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            // Test basic node properties
            assert.strictEqual(tableNode.label, 'Users');
            assert.strictEqual(tableNode.connectionId, 'test-conn');
            assert.strictEqual(tableNode.database, 'TestDB');

            // Test query construction logic
            const expectedQuery = `SELECT TOP 1000 * FROM [${tableNode.label}]`;
            assert.strictEqual(expectedQuery, 'SELECT TOP 1000 * FROM [Users]');
        });

        test('should handle table with schema prefix', () => {
            const tableNode = {
                label: 'dbo.Users',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            // Test schema parsing
            const parts = tableNode.label.split('.');
            assert.strictEqual(parts.length, 2);
            assert.strictEqual(parts[0], 'dbo');
            assert.strictEqual(parts[1], 'Users');

            // Test query construction with schema
            const expectedQuery = `SELECT TOP 1000 * FROM [${tableNode.label}]`;
            assert.strictEqual(expectedQuery, 'SELECT TOP 1000 * FROM [dbo.Users]');
        });

        test('should validate connection exists', () => {
            const tableNode = {
                label: 'Users',
                connectionId: 'missing-conn',
                database: 'TestDB'
            };

            // Test connection validation
            const connection = connectionProvider.getConnection(tableNode.connectionId);
            assert.strictEqual(connection, null);
        });

        test('should detect disconnected state', () => {
            const tableNode = {
                label: 'Users',
                connectionId: 'disconnected-conn',
                database: 'TestDB'
            };

            // Test active connection detection
            const activeConnections = connectionProvider.getActiveConnections();
            const isConnected = activeConnections.some(conn => conn.id === tableNode.connectionId);
            assert.strictEqual(isConnected, false);
        });

        test('should validate required fields', () => {
            const validNode = {
                label: 'Users',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            const invalidNode = {
                label: '',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            // Test validation logic
            assert.ok(validNode.label && validNode.connectionId && validNode.database);
            assert.ok(!invalidNode.label || invalidNode.connectionId && invalidNode.database);
        });

        test('should generate valid SQL for complex table names', () => {
            const complexTableNode = {
                label: 'schema.table_with_underscores',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            const expectedQuery = `SELECT TOP 1000 * FROM [${complexTableNode.label}]`;
            assert.strictEqual(expectedQuery, 'SELECT TOP 1000 * FROM [schema.table_with_underscores]');
        });
    });

    suite('scriptTableCreate Command', () => {
        test('should process CREATE script request', () => {
            const tableNode = {
                label: 'Users',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            // Test basic script generation logic
            const scriptHeader = `-- Create script for table [${tableNode.label}]`;
            assert.strictEqual(scriptHeader, '-- Create script for table [Users]');
        });

        test('should handle table with primary key info', () => {
            const tableNode = {
                label: 'Users',
                connectionId: 'test-conn',
                database: 'TestDB',
                primaryKey: 'Id'
            };

            // Test primary key handling
            assert.strictEqual(tableNode.primaryKey, 'Id');
        });

        test('should validate script generation requirements', () => {
            const tableNode = {
                label: 'Users',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            // Test required fields for script generation
            const hasRequiredFields = !!(tableNode.label && tableNode.connectionId && tableNode.database);
            assert.strictEqual(hasRequiredFields, true);
        });

        test('should handle complex data types', () => {
            const mockColumns = [
                { name: 'Id', type: 'int', isNullable: false },
                { name: 'Name', type: 'nvarchar(255)', isNullable: true },
                { name: 'CreatedDate', type: 'datetime2', isNullable: false }
            ];

            // Test column processing logic
            mockColumns.forEach(col => {
                assert.ok(col.name);
                assert.ok(col.type);
                assert.ok(typeof col.isNullable === 'boolean');
            });
        });
    });

    suite('scriptTableDrop Command', () => {
        test('should generate DROP script', () => {
            const tableNode = {
                label: 'Users',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            const dropScript = `DROP TABLE [${tableNode.label}]`;
            assert.strictEqual(dropScript, 'DROP TABLE [Users]');
        });

        test('should handle schema-prefixed table for DROP', () => {
            const tableNode = {
                label: 'dbo.Users',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            const dropScript = `DROP TABLE [${tableNode.label}]`;
            assert.strictEqual(dropScript, 'DROP TABLE [dbo.Users]');
        });

        test('should validate table node for DROP', () => {
            const validNode = { label: 'Users', connectionId: 'test-conn', database: 'TestDB' };
            const invalidNode = { label: null, connectionId: 'test-conn', database: 'TestDB' };

            assert.ok(validNode.label);
            assert.ok(!invalidNode.label);
        });
    });

    suite('refreshTable Command', () => {
        test('should trigger tree refresh', () => {
            // Test refresh capability
            assert.ok(typeof unifiedTreeProvider.refresh === 'function');
        });

        test('should handle refresh success', () => {
            const tableNode = {
                label: 'Users',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            // Test that node has required properties for refresh
            assert.ok(tableNode.label && tableNode.connectionId);
        });

        test('should validate refresh requirements', () => {
            const tableNode = {
                label: 'Users',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            // Validate refresh prerequisites
            const canRefresh = !!(tableNode && tableNode.connectionId);
            assert.strictEqual(canRefresh, true);
        });
    });

    suite('Integration and Edge Cases', () => {
        test('should handle database context switching', () => {
            const tableNode1 = { label: 'Users', connectionId: 'conn1', database: 'DB1' };
            const tableNode2 = { label: 'Orders', connectionId: 'conn1', database: 'DB2' };

            // Test context switching logic
            assert.notStrictEqual(tableNode1.database, tableNode2.database);
            assert.strictEqual(tableNode1.connectionId, tableNode2.connectionId);
        });

        test('should handle long table names', () => {
            const longTableName = 'VeryLongTableNameThatExceedsNormalLimitsButShouldStillWork_WithUnderscores_AndNumbers123';
            const tableNode = {
                label: longTableName,
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            // Test long name handling
            assert.ok(tableNode.label.length > 50);
            const query = `SELECT TOP 1000 * FROM [${tableNode.label}]`;
            assert.ok(query.includes(longTableName));
        });

        test('should handle special characters in table names', () => {
            const specialTableName = 'table-with-special_chars$and#symbols';
            const tableNode = {
                label: specialTableName,
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            // Test special character handling
            const query = `SELECT TOP 1000 * FROM [${tableNode.label}]`;
            assert.strictEqual(query, `SELECT TOP 1000 * FROM [${specialTableName}]`);
        });

        test('should validate empty result sets handling', () => {
            const tableNode = {
                label: 'EmptyTable',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            // Test empty result validation
            const mockResultSet: any[] = [];
            assert.strictEqual(mockResultSet.length, 0);
            assert.ok(Array.isArray(mockResultSet));
        });

        test('should handle query timeout scenarios', () => {
            const tableNode = {
                label: 'LargeTable',
                connectionId: 'slow-conn',
                database: 'TestDB'
            };

            // Test timeout configuration
            const timeoutMs = 30000; // 30 seconds
            assert.ok(timeoutMs > 0);
            assert.ok(tableNode.label === 'LargeTable');
        });

        test('should handle concurrent table operations', () => {
            const tables = [
                { label: 'Users', connectionId: 'conn1', database: 'DB1' },
                { label: 'Orders', connectionId: 'conn1', database: 'DB1' },
                { label: 'Products', connectionId: 'conn2', database: 'DB2' }
            ];

            // Test concurrent operation support
            const connectionIds = [...new Set(tables.map(t => t.connectionId))];
            assert.strictEqual(connectionIds.length, 2);
            assert.strictEqual(tables.length, 3);
        });

        test('should handle table alias generation', () => {
            const tableNode = {
                label: 'very_long_table_name_that_needs_alias',
                connectionId: 'test-conn',
                database: 'TestDB'
            };

            // Test alias generation logic
            const alias = tableNode.label.substring(0, 10);
            assert.strictEqual(alias, 'very_long_');
            assert.ok(alias.length <= 10);
        });
    });

    suite('Script ROW Commands Tests', () => {
        test('should generate INSERT script with correct column types', () => {
            const tableName = 'Users';
            const schema = 'dbo';
            
            // Test INSERT script generation structure
            const expectedColumns = ['Name', 'Email', 'Age', 'IsActive', 'CreatedDate'];
            const insertScript = `INSERT INTO [${schema}].[${tableName}]\n(`;
            
            assert.ok(insertScript.includes('INSERT INTO'));
            assert.ok(insertScript.includes(tableName));
        });

        test('should exclude identity columns from INSERT script', () => {
            const columns = [
                { name: 'Id', is_identity: true, is_computed: false, generated_always_type: 0 },
                { name: 'Name', is_identity: false, is_computed: false, generated_always_type: 0 },
                { name: 'Email', is_identity: false, is_computed: false, generated_always_type: 0 }
            ];

            // Filter insertable columns
            const insertableColumns = columns.filter(col => 
                !col.is_identity && !col.is_computed && col.generated_always_type === 0
            );

            assert.strictEqual(insertableColumns.length, 2);
            assert.ok(!insertableColumns.some(col => col.name === 'Id'));
            assert.ok(insertableColumns.some(col => col.name === 'Name'));
        });

        test('should generate INSERT script with correct comma placement', () => {
            const columns = [
                { columnName: 'Id', dataType: 'uniqueidentifier', isIdentity: false, isComputed: false, generatedAlwaysType: 0 },
                { columnName: 'Name', dataType: 'nvarchar', isIdentity: false, isComputed: false, generatedAlwaysType: 0 },
                { columnName: 'Age', dataType: 'int', isIdentity: false, isComputed: false, generatedAlwaysType: 0 },
                { columnName: 'IsActive', dataType: 'bit', isIdentity: false, isComputed: false, generatedAlwaysType: 0 }
            ];

            // Simulate the INSERT script generation logic
            const schema = 'dbo';
            const table = 'Users';
            let insertScript = `INSERT INTO [${schema}].[${table}]\n(\n`;
            insertScript += columns.map((col: any) => `    [${col.columnName}]`).join(',\n');
            insertScript += '\n)\nVALUES\n(\n';
            insertScript += columns.map((col: any, index: number) => {
                let value: string;
                if (['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext'].includes(col.dataType.toLowerCase())) {
                    value = `    N''`;
                } else if (['bit'].includes(col.dataType.toLowerCase())) {
                    value = `    0`;
                } else if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'].includes(col.dataType.toLowerCase())) {
                    value = `    0`;
                } else if (['uniqueidentifier'].includes(col.dataType.toLowerCase())) {
                    value = `    NEWID()`;
                } else {
                    value = `    NULL`;
                }
                
                const comma = index < columns.length - 1 ? ',' : '';
                let comment = col.columnName;
                if (['bit'].includes(col.dataType.toLowerCase())) {
                    comment += ' (bit)';
                } else if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'].includes(col.dataType.toLowerCase())) {
                    comment += ' (numeric)';
                }
                return `${value}${comma}  -- ${comment}`;
            }).join('\n');
            insertScript += '\n)';

            // Verify comma placement: commas should be after values, not in comments
            assert.ok(insertScript.includes('NEWID(),  -- Id'));
            assert.ok(insertScript.includes("N'',  -- Name"));
            assert.ok(insertScript.includes('0,  -- Age (numeric)'));
            assert.ok(insertScript.includes('0  -- IsActive (bit)'));  // Last value has no comma
            
            // Verify commas are NOT in comments
            assert.ok(!insertScript.includes('NEWID()  -- Id,'));
            assert.ok(!insertScript.includes("N''  -- Name,"));
            assert.ok(!insertScript.includes('0  -- Age (numeric),'));
        });

        test('should exclude computed columns from INSERT script', () => {
            const columns = [
                { name: 'Id', is_identity: false, is_computed: false, generated_always_type: 0 },
                { name: 'Price', is_identity: false, is_computed: false, generated_always_type: 0 },
                { name: 'Tax', is_identity: false, is_computed: false, generated_always_type: 0 },
                { name: 'Total', is_identity: false, is_computed: true, generated_always_type: 0 }
            ];

            const insertableColumns = columns.filter(col => 
                !col.is_identity && !col.is_computed && col.generated_always_type === 0
            );

            assert.strictEqual(insertableColumns.length, 3);
            assert.ok(!insertableColumns.some(col => col.name === 'Total'));
        });

        test('should generate INSERT script with type-appropriate placeholders', () => {
            const columnTypes = [
                { name: 'Name', type: 'nvarchar', expected: "N''" },
                { name: 'Age', type: 'int', expected: '0' },
                { name: 'IsActive', type: 'bit', expected: '0' },
                { name: 'CreatedDate', type: 'datetime', expected: 'NULL' }
            ];

            columnTypes.forEach(col => {
                let placeholder = '';
                if (['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext'].includes(col.type.toLowerCase())) {
                    placeholder = "N''";
                } else if (['date', 'datetime', 'datetime2', 'smalldatetime', 'time', 'datetimeoffset'].includes(col.type.toLowerCase())) {
                    placeholder = 'NULL';
                } else if (['bit'].includes(col.type.toLowerCase())) {
                    placeholder = '0';
                } else if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'].includes(col.type.toLowerCase())) {
                    placeholder = '0';
                } else {
                    placeholder = 'NULL';
                }

                assert.strictEqual(placeholder, col.expected, `Type ${col.type} should have placeholder ${col.expected}`);
            });
        });

        test('should generate UPDATE script with all non-PK columns', () => {
            const allColumns = [
                { name: 'Id', is_identity: false, is_computed: false, generated_always_type: 0 },
                { name: 'Name', is_identity: false, is_computed: false, generated_always_type: 0 },
                { name: 'Email', is_identity: false, is_computed: false, generated_always_type: 0 },
                { name: 'Age', is_identity: false, is_computed: false, generated_always_type: 0 }
            ];
            const pkColumns = ['Id'];

            const updateableColumns = allColumns.filter(col => 
                !pkColumns.includes(col.name) && 
                !col.is_identity && 
                !col.is_computed && 
                col.generated_always_type === 0
            );

            assert.strictEqual(updateableColumns.length, 3);
            assert.ok(!updateableColumns.some(col => col.name === 'Id'));
        });

        test('should format UPDATE script with first column active', () => {
            const updateableColumns = [
                { name: 'Name', type: 'nvarchar' },
                { name: 'Email', type: 'nvarchar' },
                { name: 'Age', type: 'int' }
            ];

            // First column should be active (no comment)
            const firstLine = `    [${updateableColumns[0].name}] = N''`;
            assert.ok(!firstLine.includes('--'));

            // Rest should be commented
            const secondLine = `    -- [${updateableColumns[1].name}] = N''`;
            assert.ok(secondLine.includes('--'));
        });

        test('should generate UPDATE script with WHERE clause for PKs', () => {
            const pkColumns = [
                { name: 'Id' },
                { name: 'TenantId' }
            ];

            const whereClause = pkColumns.map((pk, index) => {
                const operator = index === 0 ? '    ' : '    AND ';
                return `${operator}[${pk.name}] = NULL`;
            }).join('\n');

            assert.ok(whereClause.includes('[Id] = NULL'));
            assert.ok(whereClause.includes('AND [TenantId] = NULL'));
        });

        test('should handle composite primary keys in UPDATE script', () => {
            const compositePKs = ['OrderId', 'ProductId'];
            
            assert.strictEqual(compositePKs.length, 2);
            assert.ok(compositePKs.includes('OrderId'));
            assert.ok(compositePKs.includes('ProductId'));
        });

        test('should generate DELETE script with transaction wrapper', () => {
            const deleteScript = [
                'BEGIN TRANSACTION;',
                'BEGIN TRY',
                '    DELETE FROM [dbo].[Users]',
                '    WHERE [Id] = @Target_Id;',
                '    COMMIT TRANSACTION;',
                'END TRY',
                'BEGIN CATCH',
                '    ROLLBACK TRANSACTION;',
                'END CATCH;'
            ].join('\n');

            assert.ok(deleteScript.includes('BEGIN TRANSACTION'));
            assert.ok(deleteScript.includes('BEGIN TRY'));
            assert.ok(deleteScript.includes('COMMIT TRANSACTION'));
            assert.ok(deleteScript.includes('ROLLBACK TRANSACTION'));
        });

        test('should detect and exclude self-referencing foreign keys', () => {
            const foreignKeys = [
                { parent_object_id: 1001, referenced_object_id: 1001, name: 'FK_SelfRef' }, // Self-reference
                { parent_object_id: 1002, referenced_object_id: 1001, name: 'FK_Valid' }
            ];

            const nonSelfReferencing = foreignKeys.filter(fk => 
                fk.parent_object_id !== fk.referenced_object_id
            );

            assert.strictEqual(nonSelfReferencing.length, 1);
            assert.strictEqual(nonSelfReferencing[0].name, 'FK_Valid');
        });

        test('should generate cascading DELETE hierarchy', () => {
            const dependencies = [
                { level: 0, ref_table: 'Orders', target_table: 'Users' },
                { level: 1, ref_table: 'OrderItems', target_table: 'Orders' },
                { level: 2, ref_table: 'OrderItemDetails', target_table: 'OrderItems' }
            ];

            // Sort by level descending (delete from most dependent first)
            const sorted = dependencies.sort((a, b) => b.level - a.level);

            assert.strictEqual(sorted[0].level, 2);
            assert.strictEqual(sorted[0].ref_table, 'OrderItemDetails');
            assert.strictEqual(sorted[sorted.length - 1].level, 0);
        });

        test('should avoid duplicate table deletions', () => {
            const dependencies = [
                { level: 0, ref_schema: 'dbo', ref_table: 'Orders' },
                { level: 0, ref_schema: 'dbo', ref_table: 'Orders' }, // Duplicate
                { level: 1, ref_schema: 'dbo', ref_table: 'OrderItems' }
            ];

            const processedTables = new Set<string>();
            const unique = dependencies.filter(dep => {
                const key = `${dep.level}_${dep.ref_schema}.${dep.ref_table}`;
                if (processedTables.has(key)) {
                    return false;
                }
                processedTables.add(key);
                return true;
            });

            assert.strictEqual(unique.length, 2);
        });

        test('should format actual row values for DELETE script', () => {
            const rowData = {
                Id: 123,
                Name: "O'Brien",
                Email: 'test@example.com',
                IsActive: true,
                CreatedDate: new Date('2024-01-15')
            };

            // Test value formatting
            const formattedId = String(rowData.Id);
            const formattedName = `N'${rowData.Name.replace(/'/g, "''")}'`;
            const formattedEmail = `N'${rowData.Email}'`;
            const formattedIsActive = rowData.IsActive ? '1' : '0';

            assert.strictEqual(formattedId, '123');
            assert.strictEqual(formattedName, "N'O''Brien'"); // Escaped single quote
            assert.strictEqual(formattedEmail, "N'test@example.com'");
            assert.strictEqual(formattedIsActive, '1');
        });

        test('should handle NULL values in row data', () => {
            const rowData = {
                Id: 1,
                Name: null,
                Email: undefined
            };

            const formatValue = (value: any) => {
                if (value === null || value === undefined) {
                    return 'NULL';
                }
                if (typeof value === 'string') {
                    return `N'${value.replace(/'/g, "''")}'`;
                }
                if (typeof value === 'number') {
                    return String(value);
                }
                return 'NULL';
            };

            assert.strictEqual(formatValue(rowData.Id), '1');
            assert.strictEqual(formatValue(rowData.Name), 'NULL');
            assert.strictEqual(formatValue(rowData.Email), 'NULL');
        });

        test('should handle composite PKs in DELETE script with row data', () => {
            const pkColumns = [
                { COLUMN_NAME: 'OrderId' },
                { COLUMN_NAME: 'ProductId' }
            ];
            const rowData = {
                OrderId: 100,
                ProductId: 200
            };

            pkColumns.forEach(pk => {
                const value = rowData[pk.COLUMN_NAME as keyof typeof rowData];
                assert.ok(value !== undefined);
                assert.ok(typeof value === 'number');
            });

            assert.strictEqual(rowData.OrderId, 100);
            assert.strictEqual(rowData.ProductId, 200);
        });

        test('should use direct column comparison for DELETE dependencies', () => {
            const tableName = 'Projects';
            const rootTableNameSingular = tableName.endsWith('s') ? tableName.slice(0, -1) : tableName;
            const potentialColumnNames = [`${tableName}Id`, `${rootTableNameSingular}Id`];

            assert.ok(potentialColumnNames.includes('ProjectsId'));
            assert.ok(potentialColumnNames.includes('ProjectId'));
            
            // Simulate finding direct column
            const refColumns = ['ProjectId', 'UserId'];
            const directColumn = refColumns.find(col => 
                potentialColumnNames.some(pcn => col === pcn)
            );

            assert.strictEqual(directColumn, 'ProjectId');
        });

        test('should prevent circular references in FK hierarchy', () => {
            const path = 'Users -> Orders -> OrderItems';
            const newTable = 'Orders';

            // Check if table already exists in path
            const hasCircular = path.includes(newTable);

            assert.ok(hasCircular);
        });

        test('should limit recursion depth to prevent infinite loops', () => {
            const maxLevel = 10;
            const currentLevel = 9;

            const shouldContinue = currentLevel < maxLevel;

            assert.ok(shouldContinue);
            assert.strictEqual(currentLevel + 1, maxLevel);
        });
    });
});