import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { UnifiedTreeProvider } from '../unifiedTreeProvider';
import { ResultWebviewProvider } from '../resultWebview';
import { openSqlInCustomEditor } from '../utils/sqlDocumentHelper';

export function registerTableCommands(
    context: vscode.ExtensionContext,
    connectionProvider: ConnectionProvider,
    unifiedTreeProvider: UnifiedTreeProvider,
    resultWebviewProvider: ResultWebviewProvider,
    outputChannel: vscode.OutputChannel
): vscode.Disposable[] {
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

            const tableName = tableNode.label as string;
            const query = `SELECT TOP 1000 * FROM ${tableName};`;
            
            await openSqlInCustomEditor(query, `select_top_1000_${tableName.replace('.', '_')}.sql`, context);
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
            
            if (!connection) {
                vscode.window.showErrorMessage('No active connection found');
                return;
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

            const colResult = await connection.request().query(columnsQuery);
            
            const fileGroupQuery = `
                SELECT 
                    'PRIMARY' AS data_space,
                    CASE 
                        WHEN EXISTS(SELECT 1 FROM sys.columns c WHERE c.object_id = OBJECT_ID('[${schema}].[${table}]') AND c.max_length = -1)
                        THEN 'PRIMARY'
                        ELSE NULL
                    END AS lob_data_space
            `;
            const fgResult = await connection.request().query(fileGroupQuery);
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
            const temporalResult = await connection.request().query(temporalQuery);
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
            const pkResult = await connection.request().query(pkQuery);
            
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
            const indexResult = await connection.request().query(indexQuery);
            
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
            const fkResult = await connection.request().query(fkQuery);
            
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

    return [
        selectTop1000Command,
        scriptTableCreateCommand,
        scriptTableDropCommand,
        refreshTableCommand
    ];
}
