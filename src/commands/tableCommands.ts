import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { UnifiedTreeProvider } from '../unifiedTreeProvider';
import { openSqlInCustomEditor } from '../utils/sqlDocumentHelper';
import { SchemaCache } from '../utils/schemaCache';

export function registerTableCommands(
    context: vscode.ExtensionContext,
    connectionProvider: ConnectionProvider,
    unifiedTreeProvider: UnifiedTreeProvider,
    outputChannel: vscode.OutputChannel
): vscode.Disposable[] {
    const schemaCache = SchemaCache.getInstance(context);
    
    const selectTop1000Command = vscode.commands.registerCommand('mssqlManager.selectTop1000', async (tableNode?: any) => {
        try {
            if (!tableNode || !tableNode.connectionId || !tableNode.label) {
                vscode.window.showErrorMessage('Invalid table item');
                return;
            }

            const connection = connectionProvider.getConnection(tableNode.connectionId);
            if (!connection) {
                vscode.window.showErrorMessage('No active connection found. Please connect to the database first.');
                return;
            }

            if (!connection.connected) {
                vscode.window.showErrorMessage('Connection is not active. Please connect to the database first.');
                return;
            }

            const tableName = tableNode.label as string;
            const [schema, table] = tableName.includes('.') ? tableName.split('.') : ['dbo', tableName];
            
            // Generate table alias (first 2-3 letters of table name, lowercase)
            const tableAlias = table.length <= 3 ? table.toLowerCase() : table.substring(0, 2).toLowerCase();
            
            // Get table columns to build explicit SELECT query
            let query: string;
            let queryConnection = connection;
            
            // If we have a database context and this is a server connection, create a database-specific pool
            if (tableNode.database && tableNode.connectionId) {
                try {
                    queryConnection = await connectionProvider.createDbPool(tableNode.connectionId, tableNode.database);
                    outputChannel.appendLine(`[TableCommands] Using database-specific pool for ${tableNode.database}`);
                } catch (error) {
                    outputChannel.appendLine(`[TableCommands] Failed to create DB pool, using base connection: ${error}`);
                    queryConnection = connection;
                }
            }
            
            try {
                // Use schema cache to get columns
                const connectionConfig = connectionProvider.getConnectionConfig(tableNode.connectionId);
                const connectionInfo = {
                    server: connectionConfig?.server || '',
                    database: tableNode.database || connectionConfig?.database || ''
                };
                
                const columns = await schemaCache.getTableColumns(connectionInfo, queryConnection, schema, table);
                
                if (columns && columns.length > 0) {
                    const columnList = columns.map((col: any) => `[${col.columnName}]`).join(',\n      ');
                    query = `SELECT TOP (1000) ${columnList}\n  FROM [${schema}].[${table}] [${tableAlias}]`;
                } else {
                    // Fallback to * if we can't get columns
                    query = `SELECT TOP (1000) *\n  FROM [${schema}].[${table}] [${tableAlias}]`;
                }
            } catch (error) {
                // Fallback to * if column query fails
                outputChannel.appendLine(`Failed to get columns for ${tableName}, using *: ${error}`);
                query = `SELECT TOP (1000) *\n  FROM [${schema}].[${table}] [${tableAlias}]`;
            }
            
            // Set the preferred database context and open in SQL editor with auto-execute
            if (tableNode.database) {
                connectionProvider.setNextEditorPreferredDatabase(tableNode.connectionId, tableNode.database);
            }
            
            // Use newQuery command with autoExecute to run the query immediately
            await vscode.commands.executeCommand('mssqlManager.newQuery', tableNode, query, true);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to generate SELECT query: ${errorMessage}`);
            outputChannel.appendLine(`Select Top 1000 failed: ${errorMessage}`);
        }
    });

    const scriptTableCreateCommand = vscode.commands.registerCommand('mssqlManager.scriptTableCreate', async (tableNode?: any) => {
        try {
            if (!tableNode || !tableNode.connectionId || !tableNode.label) {
                vscode.window.showErrorMessage('Invalid table item');
                return;
            }

            const tableName = tableNode.label as string;
            const connection = connectionProvider.getConnection(tableNode.connectionId);
            let queryConnection = connection;
            
            if (!connection) {
                vscode.window.showErrorMessage('No active connection found');
                return;
            }

            // If we have a database context and this is a server connection, create a database-specific pool
            if (tableNode.database && tableNode.connectionId) {
                try {
                    queryConnection = await connectionProvider.createDbPool(tableNode.connectionId, tableNode.database);
                    outputChannel.appendLine(`[TableCommands] Using database-specific pool for ${tableNode.database}`);
                } catch (error) {
                    outputChannel.appendLine(`[TableCommands] Failed to create DB pool, using base connection: ${error}`);
                    queryConnection = connection;
                }
            }

            const [schema, table] = tableName.includes('.') ? tableName.split('.') : ['dbo', tableName];

            let createScript = 'SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\n';

            const columnsQuery = `
                SELECT 
                    c.name AS COLUMN_NAME,
                    t.name AS DATA_TYPE,
                    c.max_length,
                    c.precision,
                    c.scale,
                    c.is_nullable,
                    c.default_object_id,
                    dc.name AS default_constraint_name,
                    dc.definition AS default_definition,
                    c.is_identity,
                    c.generated_always_type,
                    c.generated_always_type_desc,
                    c.is_hidden
                FROM sys.columns c
                INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
                LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
                WHERE c.object_id = OBJECT_ID('[${schema}].[${table}]')
                ORDER BY c.column_id;
            `;

            if (!queryConnection) {
                throw new Error('No connection available for scripting table');
            }
            const colResult = await queryConnection.request().query(columnsQuery);
            
            const fileGroupQuery = `
                SELECT 
                    'PRIMARY' AS data_space,
                    CASE 
                        WHEN EXISTS(SELECT 1 FROM sys.columns c WHERE c.object_id = OBJECT_ID('[${schema}].[${table}]') AND c.max_length = -1)
                        THEN 'PRIMARY'
                        ELSE NULL
                    END AS lob_data_space
            `;
            const fgResult = await queryConnection.request().query(fileGroupQuery);
            const dataSpace = fgResult.recordset[0]?.data_space || 'PRIMARY';
            const lobDataSpace = fgResult.recordset[0]?.lob_data_space;

            const temporalQuery = `
                SELECT 
                    t.temporal_type,
                    t.temporal_type_desc,
                    OBJECT_SCHEMA_NAME(t.history_table_id) AS history_schema,
                    OBJECT_NAME(t.history_table_id) AS history_table,
                    c1.name AS period_start_column,
                    c2.name AS period_end_column
                FROM sys.tables t
                LEFT JOIN sys.periods p ON t.object_id = p.object_id
                LEFT JOIN sys.columns c1 ON p.object_id = c1.object_id AND p.start_column_id = c1.column_id
                LEFT JOIN sys.columns c2 ON p.object_id = c2.object_id AND p.end_column_id = c2.column_id
                WHERE t.object_id = OBJECT_ID('[${schema}].[${table}]');
            `;
            const temporalResult = await queryConnection.request().query(temporalQuery);
            const temporalInfo = temporalResult.recordset[0];
            const isTemporalTable = temporalInfo?.temporal_type === 2;

            createScript += `CREATE TABLE [${schema}].[${table}](\n`;
            
            const columnDefs = colResult.recordset.map((col: any) => {
                let dataType = col.DATA_TYPE.toLowerCase();
                
                if (['varchar', 'char', 'nvarchar', 'nchar', 'binary', 'varbinary'].includes(dataType)) {
                    if (col.max_length === -1) {
                        dataType = `[${dataType}](max)`;
                    } else {
                        const length = ['nvarchar', 'nchar'].includes(dataType) ? col.max_length / 2 : col.max_length;
                        dataType = `[${dataType}](${length})`;
                    }
                } else if (['decimal', 'numeric'].includes(dataType)) {
                    dataType = `[${dataType}](${col.precision},${col.scale})`;
                } else if (['time', 'datetime2', 'datetimeoffset'].includes(dataType)) {
                    dataType = `[${dataType}](${col.scale})`;
                } else {
                    dataType = `[${dataType}]`;
                }
                
                let colDef = `\t[${col.COLUMN_NAME}] ${dataType}`;
                
                if (col.generated_always_type === 1) {
                    colDef += ' GENERATED ALWAYS AS ROW START';
                } else if (col.generated_always_type === 2) {
                    colDef += ' GENERATED ALWAYS AS ROW END';
                }
                
                if (col.is_hidden) {
                    colDef += ' HIDDEN';
                }
                
                const nullable = col.is_nullable ? 'NULL' : 'NOT NULL';
                colDef += ' ' + nullable;
                
                return colDef;
            });
            
            createScript += columnDefs.join(',\n');
            
            if (isTemporalTable && temporalInfo.period_start_column && temporalInfo.period_end_column) {
                createScript += `,\n\tPERIOD FOR SYSTEM_TIME ([${temporalInfo.period_start_column}], [${temporalInfo.period_end_column}])`;
            }
            
            createScript += `\n) ON [${dataSpace}]`;
            if (lobDataSpace) {
                createScript += ` TEXTIMAGE_ON [${lobDataSpace}]`;
            }
            
            if (isTemporalTable && temporalInfo.history_table) {
                createScript += `\nWITH\n(\nSYSTEM_VERSIONING = ON (HISTORY_TABLE = [${temporalInfo.history_schema}].[${temporalInfo.history_table}])\n)`;
            }
            
            createScript += '\nGO\n';

            const pkQuery = `
                SELECT 
                    kc.name AS constraint_name,
                    i.type_desc,
                    STRING_AGG(CAST(c.name AS NVARCHAR(MAX)) + ' ' + CASE WHEN ic.is_descending_key = 1 THEN 'DESC' ELSE 'ASC' END, ',\n\t') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns,
                    ISNULL(ds.name, 'PRIMARY') AS data_space
                FROM sys.key_constraints kc
                INNER JOIN sys.indexes i ON kc.parent_object_id = i.object_id AND kc.unique_index_id = i.index_id
                INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                LEFT JOIN sys.data_spaces ds ON i.data_space_id = ds.data_space_id
                WHERE kc.parent_object_id = OBJECT_ID('[${schema}].[${table}]') AND kc.type = 'PK'
                GROUP BY kc.name, i.type_desc, ds.name;
            `;
            const pkResult = await queryConnection.request().query(pkQuery);
            
            if (pkResult.recordset.length > 0) {
                const pk = pkResult.recordset[0];
                const clustered = pk.type_desc === 'CLUSTERED' ? 'CLUSTERED' : 'NONCLUSTERED';
                createScript += `ALTER TABLE [${schema}].[${table}] ADD  CONSTRAINT [${pk.constraint_name}] PRIMARY KEY ${clustered} \n(\n\t${pk.columns}\n)`;
                createScript += `WITH (STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ONLINE = OFF, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [${pk.data_space}]\nGO\n`;
            }

            const indexQuery = `
                SELECT 
                    i.name AS index_name,
                    i.type_desc,
                    i.is_unique,
                    STRING_AGG(CAST(c.name AS NVARCHAR(MAX)) + ' ' + CASE WHEN ic.is_descending_key = 1 THEN 'DESC' ELSE 'ASC' END, ',\n\t') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns,
                    ISNULL(ds.name, 'PRIMARY') AS data_space
                FROM sys.indexes i
                INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                LEFT JOIN sys.data_spaces ds ON i.data_space_id = ds.data_space_id
                WHERE i.object_id = OBJECT_ID('[${schema}].[${table}]') 
                    AND i.is_primary_key = 0 
                    AND i.type > 0
                GROUP BY i.name, i.type_desc, i.is_unique, ds.name;
            `;
            const indexResult = await queryConnection.request().query(indexQuery);
            
            for (const idx of indexResult.recordset) {
                const unique = idx.is_unique ? 'UNIQUE ' : '';
                const clustered = idx.type_desc === 'CLUSTERED' ? 'CLUSTERED' : 'NONCLUSTERED';
                createScript += `CREATE ${unique}${clustered} INDEX [${idx.index_name}] ON [${schema}].[${table}]\n(\n\t${idx.columns}\n)`;
                createScript += `WITH (STATISTICS_NORECOMPUTE = OFF, DROP_EXISTING = OFF, ONLINE = OFF, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [${idx.data_space}]\nGO\n`;
            }

            for (const col of colResult.recordset) {
                if (col.default_constraint_name && col.default_definition) {
                    createScript += `ALTER TABLE [${schema}].[${table}] ADD  DEFAULT ${col.default_definition} FOR [${col.COLUMN_NAME}]\nGO\n`;
                }
            }

            const fkQuery = `
                SELECT 
                    fk.name AS constraint_name,
                    OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS ref_schema,
                    OBJECT_NAME(fk.referenced_object_id) AS ref_table,
                    STRING_AGG(CAST(c.name AS NVARCHAR(MAX)), ', ') AS columns,
                    STRING_AGG(CAST(rc.name AS NVARCHAR(MAX)), ', ') AS ref_columns,
                    fk.delete_referential_action_desc,
                    fk.update_referential_action_desc
                FROM sys.foreign_keys fk
                INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
                INNER JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
                INNER JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
                WHERE fk.parent_object_id = OBJECT_ID('[${schema}].[${table}]')
                GROUP BY fk.name, fk.referenced_object_id, fk.delete_referential_action_desc, fk.update_referential_action_desc;
            `;
            const fkResult = await queryConnection.request().query(fkQuery);
            
            for (const fk of fkResult.recordset) {
                createScript += `ALTER TABLE [${schema}].[${table}]  WITH CHECK ADD  CONSTRAINT [${fk.constraint_name}] FOREIGN KEY([${fk.columns}])\n`;
                createScript += `REFERENCES [${fk.ref_schema}].[${fk.ref_table}] ([${fk.ref_columns}])\n`;
                if (fk.delete_referential_action_desc !== 'NO_ACTION') {
                    createScript += `ON DELETE ${fk.delete_referential_action_desc.replace('_', ' ')}\n`;
                }
                if (fk.update_referential_action_desc !== 'NO_ACTION') {
                    createScript += `ON UPDATE ${fk.update_referential_action_desc.replace('_', ' ')}\n`;
                }
                createScript += 'GO\n';
                createScript += `ALTER TABLE [${schema}].[${table}] CHECK CONSTRAINT [${fk.constraint_name}]\nGO\n`;
            }

            await openSqlInCustomEditor(createScript, `create_${table}.sql`, context);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to generate CREATE script: ${errorMessage}`);
            outputChannel.appendLine(`Script as Create failed: ${errorMessage}`);
        }
    });

    const scriptTableDropCommand = vscode.commands.registerCommand('mssqlManager.scriptTableDrop', async (tableNode?: any) => {
        try {
            if (!tableNode || !tableNode.label) {
                vscode.window.showErrorMessage('Invalid table item');
                return;
            }

            const tableName = tableNode.label as string;
            const [schema, table] = tableName.includes('.') ? tableName.split('.') : ['dbo', tableName];
            
            const dropScript = `IF  EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[${schema}].[${table}]') AND type in (N'U'))
DROP TABLE [${schema}].[${table}]
GO`;

            await openSqlInCustomEditor(dropScript, `drop_${table}.sql`, context);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to generate DROP script: ${errorMessage}`);
            outputChannel.appendLine(`Script as Drop failed: ${errorMessage}`);
        }
    });

    const refreshTableCommand = vscode.commands.registerCommand('mssqlManager.refreshTable', async (tableNode?: any) => {
        try {
            if (!tableNode) {
                vscode.window.showErrorMessage('Invalid table item');
                return;
            }

            unifiedTreeProvider.refresh();
            vscode.window.showInformationMessage('Table refreshed');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to refresh table: ${errorMessage}`);
            outputChannel.appendLine(`Refresh table failed: ${errorMessage}`);
        }
    });

    const scriptRowInsertCommand = vscode.commands.registerCommand('mssqlManager.scriptRowInsert', async (tableNode?: any) => {
        try {
            if (!tableNode || !tableNode.connectionId || !tableNode.label) {
                vscode.window.showErrorMessage('Invalid table item');
                return;
            }

            const tableName = tableNode.label as string;
            const connection = connectionProvider.getConnection(tableNode.connectionId);
            let queryConnection = connection;
            
            if (!connection) {
                vscode.window.showErrorMessage('No active connection found');
                return;
            }

            // If we have a database context and this is a server connection, create a database-specific pool
            if (tableNode.database && tableNode.connectionId) {
                try {
                    queryConnection = await connectionProvider.createDbPool(tableNode.connectionId, tableNode.database);
                    outputChannel.appendLine(`[TableCommands] Using database-specific pool for ${tableNode.database}`);
                } catch (error) {
                    outputChannel.appendLine(`[TableCommands] Failed to create DB pool, using base connection: ${error}`);
                    queryConnection = connection;
                }
            }

            const [schema, table] = tableName.includes('.') ? tableName.split('.') : ['dbo', tableName];

            // Get all columns from cache
            const connectionConfig = connectionProvider.getConnectionConfig(tableNode.connectionId);
            const connectionInfo = {
                server: connectionConfig?.server || '',
                database: tableNode.database || connectionConfig?.database || ''
            };
            
            if (!queryConnection) {
                throw new Error('No connection available for scripting row');
            }
            
            const allColumns = await schemaCache.getTableColumns(connectionInfo, queryConnection, schema, table);

            // Filter out identity, computed, and generated columns
            const insertableColumns = allColumns.filter((col: any) => 
                !col.isIdentity && !col.isComputed && (col.generatedAlwaysType === 0 || col.generatedAlwaysType === null || col.generatedAlwaysType === undefined)
            );

            if (insertableColumns.length === 0) {
                vscode.window.showWarningMessage('Table has no insertable columns');
                return;
            }

            // Generate INSERT script
            let insertScript = `INSERT INTO [${schema}].[${table}]\n(\n`;
            insertScript += insertableColumns.map((col: any) => `    [${col.columnName}]`).join(',\n');
            insertScript += '\n)\nVALUES\n(\n';
            insertScript += insertableColumns.map((col: any) => {
                // Add appropriate placeholder based on data type
                if (['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext'].includes(col.dataType.toLowerCase())) {
                    return `    N''  -- ${col.columnName}`;
                } else if (['date', 'datetime', 'datetime2', 'smalldatetime', 'time', 'datetimeoffset'].includes(col.dataType.toLowerCase())) {
                    return `    NULL  -- ${col.columnName} (datetime)`;
                } else if (['bit'].includes(col.dataType.toLowerCase())) {
                    return `    0  -- ${col.columnName} (bit)`;
                } else if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'].includes(col.dataType.toLowerCase())) {
                    return `    0  -- ${col.columnName} (numeric)`;
                } else if (['uniqueidentifier'].includes(col.dataType.toLowerCase())) {
                    return `    NEWID()  -- ${col.columnName}`;
                } else {
                    return `    NULL  -- ${col.columnName}`;
                }
            }).join(',\n');
            insertScript += '\n)';

            await openSqlInCustomEditor(insertScript, `insert_${table}.sql`, context);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to generate INSERT script: ${errorMessage}`);
            outputChannel.appendLine(`Script Row INSERT failed: ${errorMessage}`);
        }
    });

    const scriptRowUpdateCommand = vscode.commands.registerCommand('mssqlManager.scriptRowUpdate', async (tableNode?: any) => {
        try {
            if (!tableNode || !tableNode.connectionId || !tableNode.label) {
                vscode.window.showErrorMessage('Invalid table item');
                return;
            }

            const tableName = tableNode.label as string;
            const connection = connectionProvider.getConnection(tableNode.connectionId);
            let queryConnection = connection;
            
            if (!connection) {
                vscode.window.showErrorMessage('No active connection found');
                return;
            }

            // If we have a database context and this is a server connection, create a database-specific pool
            if (tableNode.database && tableNode.connectionId) {
                try {
                    queryConnection = await connectionProvider.createDbPool(tableNode.connectionId, tableNode.database);
                    outputChannel.appendLine(`[TableCommands] Using database-specific pool for ${tableNode.database}`);
                } catch (error) {
                    outputChannel.appendLine(`[TableCommands] Failed to create DB pool, using base connection: ${error}`);
                    queryConnection = connection;
                }
            }

            const [schema, table] = tableName.includes('.') ? tableName.split('.') : ['dbo', tableName];

            // Get connection info for cache
            const connectionConfig = connectionProvider.getConnectionConfig(tableNode.connectionId);
            const connectionInfo = {
                server: connectionConfig?.server || '',
                database: tableNode.database || connectionConfig?.database || ''
            };

            if (!queryConnection) {
                throw new Error('No connection available for scripting row');
            }
            
            // Get columns and constraints from cache
            const allColumns = await schemaCache.getTableColumns(connectionInfo, queryConnection, schema, table);
            const constraints = await schemaCache.getTableConstraints(connectionInfo, queryConnection, schema, table);

            // Get primary key columns from constraints
            const pkConstraint = constraints.find(c => c.constraintType === 'PRIMARY KEY');
            const pkColumns = pkConstraint?.columns || [];
            
            // Filter columns: exclude PKs, identity, computed, and generated columns
            const updateableColumns = allColumns.filter((col: any) => 
                !pkColumns.includes(col.columnName) && 
                !col.isIdentity && 
                !col.isComputed && 
                (col.generatedAlwaysType === 0 || col.generatedAlwaysType === null || col.generatedAlwaysType === undefined)
            );

            if (updateableColumns.length === 0) {
                vscode.window.showWarningMessage('Table has no updateable columns (excluding primary keys)');
                return;
            }

            // Generate UPDATE script
            let updateScript = `UPDATE [${schema}].[${table}]\nSET\n`;
            updateScript += updateableColumns.map((col: any, index: number) => {
                const prefix = index === 0 ? '    ' : '    -- ';
                if (['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext'].includes(col.dataType.toLowerCase())) {
                    return `${prefix}[${col.columnName}] = N''`;
                } else if (['date', 'datetime', 'datetime2', 'smalldatetime', 'time', 'datetimeoffset'].includes(col.dataType.toLowerCase())) {
                    return `${prefix}[${col.columnName}] = NULL`;
                } else if (['bit'].includes(col.dataType.toLowerCase())) {
                    return `${prefix}[${col.columnName}] = 0`;
                } else if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'].includes(col.dataType.toLowerCase())) {
                    return `${prefix}[${col.columnName}] = 0`;
                } else {
                    return `${prefix}[${col.columnName}] = NULL`;
                }
            }).join(',\n');

            // Add WHERE clause with primary key columns
            if (pkColumns.length > 0) {
                updateScript += '\nWHERE\n';
                updateScript += pkColumns.map((pkCol: string, index: number) => {
                    const operator = index === 0 ? '    ' : '    AND ';
                    return `${operator}[${pkCol}] = NULL`;
                }).join('\n');
            }

            await openSqlInCustomEditor(updateScript, `update_${table}.sql`, context);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to generate UPDATE script: ${errorMessage}`);
            outputChannel.appendLine(`Script Row UPDATE failed: ${errorMessage}`);
        }
    });

    const scriptRowDeleteCommand = vscode.commands.registerCommand('mssqlManager.scriptRowDelete', async (tableNode?: any, rowData?: any) => {
        try {
            if (!tableNode || !tableNode.connectionId || !tableNode.label) {
                vscode.window.showErrorMessage('Invalid table item');
                return;
            }

            const tableName = tableNode.label as string;
            const connection = connectionProvider.getConnection(tableNode.connectionId);
            let queryConnection = connection;
            
            if (!connection) {
                vscode.window.showErrorMessage('No active connection found');
                return;
            }

            // If we have a database context and this is a server connection, create a database-specific pool
            if (tableNode.database && tableNode.connectionId) {
                try {
                    queryConnection = await connectionProvider.createDbPool(tableNode.connectionId, tableNode.database);
                    outputChannel.appendLine(`[TableCommands] Using database-specific pool for ${tableNode.database}`);
                } catch (error) {
                    outputChannel.appendLine(`[TableCommands] Failed to create DB pool, using base connection: ${error}`);
                    queryConnection = connection;
                }
            }

            const [schema, table] = tableName.includes('.') ? tableName.split('.') : ['dbo', tableName];

            // Get primary key columns
            const pkQuery = `
                SELECT c.name AS COLUMN_NAME
                FROM sys.key_constraints kc
                INNER JOIN sys.indexes i ON kc.parent_object_id = i.object_id AND kc.unique_index_id = i.index_id
                INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                WHERE kc.parent_object_id = OBJECT_ID('[${schema}].[${table}]') AND kc.type = 'PK'
                ORDER BY ic.key_ordinal;
            `;

            if (!queryConnection) {
                throw new Error('No connection available for scripting row');
            }
            const pkResult = await queryConnection.request().query(pkQuery);

            // Get all foreign key dependencies (tables that reference this table)
            const fkDependenciesQuery = `
                WITH FKHierarchy AS (
                    -- Base case: tables that reference our target table (excluding self-references)
                    SELECT 
                        fk.object_id AS fk_id,
                        OBJECT_SCHEMA_NAME(fk.parent_object_id) AS ref_schema,
                        OBJECT_NAME(fk.parent_object_id) AS ref_table,
                        OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS target_schema,
                        OBJECT_NAME(fk.referenced_object_id) AS target_table,
                        fk.parent_object_id,
                        fk.referenced_object_id,
                        0 AS level,
                        CAST(OBJECT_NAME(fk.referenced_object_id) AS NVARCHAR(MAX)) AS path
                    FROM sys.foreign_keys fk
                    WHERE fk.referenced_object_id = OBJECT_ID('[${schema}].[${table}]')
                        AND fk.parent_object_id != fk.referenced_object_id  -- Exclude self-references
                    
                    UNION ALL
                    
                    -- Recursive case: tables that reference the referencing tables (excluding self-references)
                    SELECT 
                        fk.object_id AS fk_id,
                        OBJECT_SCHEMA_NAME(fk.parent_object_id) AS ref_schema,
                        OBJECT_NAME(fk.parent_object_id) AS ref_table,
                        OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS target_schema,
                        OBJECT_NAME(fk.referenced_object_id) AS target_table,
                        fk.parent_object_id,
                        fk.referenced_object_id,
                        h.level + 1,
                        h.path + ' -> ' + OBJECT_NAME(fk.referenced_object_id)
                    FROM sys.foreign_keys fk
                    INNER JOIN FKHierarchy h ON 
                        fk.referenced_object_id = h.parent_object_id
                    WHERE h.level < 10  -- Limit recursion depth
                        AND fk.parent_object_id != fk.referenced_object_id  -- Exclude self-references
                        AND h.path NOT LIKE '%' + OBJECT_NAME(fk.parent_object_id) + '%'  -- Prevent circular references
                )
                SELECT DISTINCT 
                    h.ref_schema,
                    h.ref_table,
                    h.target_schema,
                    h.target_table,
                    h.parent_object_id,
                    h.referenced_object_id,
                    STRING_AGG(CAST(pc.name AS NVARCHAR(MAX)), ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS ref_columns,
                    STRING_AGG(CAST(rc.name AS NVARCHAR(MAX)), ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS target_columns,
                    h.level,
                    h.path
                FROM FKHierarchy h
                INNER JOIN sys.foreign_keys fk ON 
                    fk.parent_object_id = h.parent_object_id AND
                    fk.referenced_object_id = h.referenced_object_id
                INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
                INNER JOIN sys.columns pc ON fkc.parent_object_id = pc.object_id AND fkc.parent_column_id = pc.column_id
                INNER JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
                GROUP BY h.ref_schema, h.ref_table, h.target_schema, h.target_table, h.level, h.path, h.parent_object_id, h.referenced_object_id
                ORDER BY level DESC, h.ref_schema, h.ref_table;
            `;

            const fkDepsResult = await queryConnection.request().query(fkDependenciesQuery);

            // Build a hierarchy map to trace back to the original table
            const hierarchyMap = new Map<string, any[]>();
            fkDepsResult.recordset.forEach((dep: any) => {
                const key = `${dep.ref_schema}.${dep.ref_table}`;
                if (!hierarchyMap.has(key)) {
                    hierarchyMap.set(key, []);
                }
                hierarchyMap.get(key)!.push(dep);
            });

            // Generate DELETE script with cascading deletes
            let deleteScript = `-- Cascading DELETE script for [${schema}].[${table}]\n`;
            deleteScript += `-- This script will delete the specified record and all related records in dependent tables\n`;
            deleteScript += `-- (Self-referencing foreign keys are excluded to prevent loops)\n\n`;

            // Add transaction wrapper
            deleteScript += `BEGIN TRANSACTION;\n`;
            deleteScript += `BEGIN TRY\n\n`;

            if (pkResult.recordset.length === 0) {
                deleteScript += `    -- WARNING: No primary key found on table [${schema}].[${table}]\n`;
                deleteScript += `    -- Please define a WHERE condition manually\n\n`;
            }

            // Add WHERE condition variables at the top
            if (pkResult.recordset.length > 0) {
                deleteScript += `    -- Define the target record to delete\n`;
                pkResult.recordset.forEach((pk: any) => {
                    let pkValue = 'NULL';
                    
                    // If rowData is provided, use actual values
                    // Try case-insensitive lookup since column names might have different casing
                    if (rowData) {
                        const pkColumnName = pk.COLUMN_NAME;
                        let actualValue: any = undefined;
                        
                        // Try exact match first
                        if (rowData[pkColumnName] !== undefined) {
                            actualValue = rowData[pkColumnName];
                        } else {
                            // Try case-insensitive match
                            const keys = Object.keys(rowData);
                            const matchingKey = keys.find(key => key.toLowerCase() === pkColumnName.toLowerCase());
                            if (matchingKey) {
                                actualValue = rowData[matchingKey];
                            }
                        }
                        
                        if (actualValue !== undefined && actualValue !== null) {
                            // Format based on data type
                            if (typeof actualValue === 'string') {
                                pkValue = `N'${actualValue.replace(/'/g, "''")}'`;
                            } else if (typeof actualValue === 'number') {
                                pkValue = String(actualValue);
                            } else if (actualValue instanceof Date) {
                                pkValue = `'${actualValue.toISOString()}'`;
                            } else if (typeof actualValue === 'boolean') {
                                pkValue = actualValue ? '1' : '0';
                            } else {
                                pkValue = `'${String(actualValue).replace(/'/g, "''")}'`;
                            }
                        }
                    }
                    
                    deleteScript += `    DECLARE @Target_${pk.COLUMN_NAME} NVARCHAR(MAX) = ${pkValue};  -- ${rowData && pkValue !== 'NULL' ? 'Actual value from row' : 'Set the value for ' + pk.COLUMN_NAME}\n`;
                });
                deleteScript += `\n`;
            }

            // Generate DELETE statements for dependent tables (from most dependent to least dependent)
            if (fkDepsResult.recordset.length > 0) {
                deleteScript += `    -- Delete dependent records (from most dependent to least dependent)\n\n`;

                // Group by level and table to avoid duplicates
                const processedTables = new Set<string>();
                const groupedByLevel = new Map<number, any[]>();
                
                fkDepsResult.recordset.forEach((dep: any) => {
                    const tableKey = `${dep.level}_${dep.ref_schema}.${dep.ref_table}`;
                    if (!processedTables.has(tableKey)) {
                        processedTables.add(tableKey);
                        if (!groupedByLevel.has(dep.level)) {
                            groupedByLevel.set(dep.level, []);
                        }
                        groupedByLevel.get(dep.level)!.push(dep);
                    }
                });

                // Sort levels in descending order
                const sortedLevels = Array.from(groupedByLevel.keys()).sort((a, b) => b - a);

                sortedLevels.forEach(level => {
                    const depsAtLevel = groupedByLevel.get(level)!;
                    
                    depsAtLevel.forEach((dep: any) => {
                        deleteScript += `    -- Level ${dep.level}: Delete from [${dep.ref_schema}].[${dep.ref_table}]\n`;
                        deleteScript += `    -- Path: ${dep.path}\n`;
                        deleteScript += `    DELETE [${dep.ref_schema}].[${dep.ref_table}]\n`;
                        deleteScript += `    WHERE [${dep.ref_columns}] IN (\n`;
                        deleteScript += `        SELECT [${dep.target_columns}]\n`;
                        deleteScript += `        FROM [${dep.target_schema}].[${dep.target_table}]\n`;
                        
                        // Build WHERE clause that traces back to the original table
                        if (dep.level === 0) {
                            // Direct dependency on the target table
                            if (pkResult.recordset.length > 0) {
                                deleteScript += `        WHERE `;
                                deleteScript += pkResult.recordset.map((pk: any, pkIndex: number) => {
                                    const operator = pkIndex === 0 ? '' : 'AND ';
                                    return `${operator}[${pk.COLUMN_NAME}] = @Target_${pk.COLUMN_NAME}`;
                                }).join(' ');
                                deleteScript += `\n`;
                            }
                        } else {
                            // For higher levels, check if we can use direct column reference
                            // Look for a column in ref_table that matches the root table's PK pattern
                            const rootTableNameSingular = table.endsWith('s') ? table.slice(0, -1) : table;
                            const potentialColumnNames = [
                                `${table}Id`,      // e.g., ProjectsId
                                `${rootTableNameSingular}Id`, // e.g., ProjectId
                                pkResult.recordset.length > 0 ? pkResult.recordset[0].COLUMN_NAME : null
                            ].filter(Boolean);
                            
                            // Check if any of the ref_columns contains a direct reference to root table
                            const refColumnsList = dep.ref_columns.split(', ');
                            const directColumn = refColumnsList.find((col: string) => 
                                potentialColumnNames.some(pcn => col === pcn)
                            );
                            
                            if (directColumn && pkResult.recordset.length > 0) {
                                // Use direct column comparison
                                deleteScript += `        WHERE [${directColumn}] = @Target_${pkResult.recordset[0].COLUMN_NAME}\n`;
                            } else {
                                // Fall back to subquery (for cases where there's no direct column)
                                const parentDep = fkDepsResult.recordset.find((d: any) => 
                                    d.ref_schema === dep.target_schema && 
                                    d.ref_table === dep.target_table &&
                                    d.level === dep.level - 1
                                );
                                
                                if (parentDep) {
                                    const parentRefColumns = parentDep.ref_columns.split(', ');
                                    const parentDirectColumn = parentRefColumns.find((col: string) => 
                                        potentialColumnNames.some(pcn => col === pcn)
                                    );
                                    
                                    if (parentDirectColumn && pkResult.recordset.length > 0) {
                                        deleteScript += `        WHERE [${parentDirectColumn}] = @Target_${pkResult.recordset[0].COLUMN_NAME}\n`;
                                    }
                                }
                            }
                        }
                        
                        deleteScript += `    );\n`;
                        deleteScript += `    PRINT 'Deleted ' + CAST(@@ROWCOUNT AS VARCHAR) + ' row(s) from [${dep.ref_schema}].[${dep.ref_table}]';\n\n`;
                    });
                });
            }

            // Generate DELETE statement for the main table
            deleteScript += `    -- Delete the main record from [${schema}].[${table}]\n`;
            deleteScript += `    DELETE FROM [${schema}].[${table}]`;

            if (pkResult.recordset.length > 0) {
                deleteScript += `\n    WHERE\n`;
                deleteScript += pkResult.recordset.map((pk: any, index: number) => {
                    const operator = index === 0 ? '        ' : '        AND ';
                    return `${operator}[${pk.COLUMN_NAME}] = @Target_${pk.COLUMN_NAME}`;
                }).join('\n');
            } else {
                deleteScript += `\n    -- WHERE <condition>  -- Define your condition here`;
            }

            deleteScript += `;\n`;
            deleteScript += `    PRINT 'Deleted ' + CAST(@@ROWCOUNT AS VARCHAR) + ' row(s) from [${schema}].[${table}]';\n\n`;

            // Close transaction
            deleteScript += `    COMMIT TRANSACTION;\n`;
            deleteScript += `    PRINT 'Transaction committed successfully.';\n\n`;
            deleteScript += `END TRY\n`;
            deleteScript += `BEGIN CATCH\n`;
            deleteScript += `    ROLLBACK TRANSACTION;\n`;
            deleteScript += `    PRINT 'Transaction rolled back due to error.';\n`;
            deleteScript += `    PRINT 'Error: ' + ERROR_MESSAGE();\n`;
            deleteScript += `    THROW;\n`;
            deleteScript += `END CATCH;\n`;

            await openSqlInCustomEditor(deleteScript, `delete_${table}_cascading.sql`, context);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to generate DELETE script: ${errorMessage}`);
            outputChannel.appendLine(`Script Row DELETE failed: ${errorMessage}`);
        }
    });

    return [
        selectTop1000Command,
        scriptTableCreateCommand,
        scriptTableDropCommand,
        refreshTableCommand,
        scriptRowInsertCommand,
        scriptRowUpdateCommand,
        scriptRowDeleteCommand
    ];
}
