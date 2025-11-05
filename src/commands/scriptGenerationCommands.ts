import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { ScriptGenerationWebview, DatabaseObjects, DatabaseObject, ScriptGenerationRequest } from '../scriptGenerationWebview';
import { openSqlInCustomEditor } from '../utils/sqlDocumentHelper';

export function registerScriptGenerationCommands(
    context: vscode.ExtensionContext,
    connectionProvider: ConnectionProvider,
    outputChannel: vscode.OutputChannel
): vscode.Disposable[] {
    const generateScriptsCommand = vscode.commands.registerCommand(
        'mssqlManager.generateDatabaseScripts',
        async (node?: any) => {
            try {
                if (!node || !node.connectionId) {
                    vscode.window.showErrorMessage('No database selected');
                    return;
                }

                // Get database name from node
                let database = node.database;
                if (!database) {
                    const config = connectionProvider.getConnectionConfig(node.connectionId);
                    if (config && config.database) {
                        database = config.database;
                    }
                }

                if (!database) {
                    vscode.window.showErrorMessage('Could not determine database');
                    return;
                }

                const connection = connectionProvider.getConnection(node.connectionId);
                if (!connection) {
                    vscode.window.showErrorMessage('No active connection found');
                    return;
                }

                // Get server name
                const config = connectionProvider.getConnectionConfig(node.connectionId);
                const serverName = config?.server || 'Unknown Server';

                outputChannel.appendLine(`[ScriptGeneration] Querying database objects for ${database}...`);

                // Create database-specific pool
                let dbPool = connection;
                try {
                    dbPool = await connectionProvider.createDbPool(node.connectionId, database);
                } catch (error) {
                    outputChannel.appendLine(`[ScriptGeneration] Failed to create DB pool, using base connection: ${error}`);
                }

                // Query database objects
                const databaseObjects = await queryDatabaseObjects(dbPool, database, outputChannel);

                outputChannel.appendLine(
                    `[ScriptGeneration] Found ${databaseObjects.tables.length} tables, ` +
                    `${databaseObjects.views.length} views, ` +
                    `${databaseObjects.procedures.length} procedures, ` +
                    `${databaseObjects.functions.length} functions`
                );

                // Show webview wizard
                const webview = new ScriptGenerationWebview(
                    context,
                    async (request: ScriptGenerationRequest) => {
                        await handleScriptGeneration(
                            request,
                            node.connectionId,
                            database,
                            serverName,
                            connectionProvider,
                            context,
                            outputChannel
                        );
                    },
                    serverName,
                    database,
                    databaseObjects
                );

                await webview.show();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                vscode.window.showErrorMessage(`Failed to open script generation wizard: ${errorMessage}`);
                outputChannel.appendLine(`[ScriptGeneration] Error: ${errorMessage}`);
            }
        }
    );

    return [generateScriptsCommand];
}

async function queryDatabaseObjects(
    connection: any,
    database: string,
    outputChannel: vscode.OutputChannel
): Promise<DatabaseObjects> {
    const objects: DatabaseObjects = {
        tables: [],
        views: [],
        procedures: [],
        functions: []
    };

    try {
        // Query tables with row counts
        const tablesQuery = `
            SELECT 
                t.TABLE_SCHEMA as [schema],
                t.TABLE_NAME as name,
                ISNULL(SUM(p.rows), 0) as row_count
            FROM INFORMATION_SCHEMA.TABLES t
            INNER JOIN sys.tables st ON t.TABLE_NAME = st.name AND t.TABLE_SCHEMA = SCHEMA_NAME(st.schema_id)
            LEFT JOIN sys.partitions p ON st.object_id = p.object_id AND p.index_id IN (0, 1)
            WHERE t.TABLE_TYPE = 'BASE TABLE'
            GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME
            ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
        `;
        const tablesResult = await connection.request().query(tablesQuery);
        objects.tables = tablesResult.recordset.map((row: any) => ({
            schema: row.schema,
            name: row.name,
            rowCount: row.row_count || 0
        }));

        // Query views
        const viewsQuery = `
            SELECT 
                TABLE_SCHEMA as [schema],
                TABLE_NAME as name
            FROM INFORMATION_SCHEMA.VIEWS
            ORDER BY TABLE_SCHEMA, TABLE_NAME
        `;
        const viewsResult = await connection.request().query(viewsQuery);
        objects.views = viewsResult.recordset.map((row: any) => ({
            schema: row.schema,
            name: row.name
        }));

        // Query stored procedures
        const proceduresQuery = `
            SELECT 
                ROUTINE_SCHEMA as [schema],
                ROUTINE_NAME as name
            FROM INFORMATION_SCHEMA.ROUTINES
            WHERE ROUTINE_TYPE = 'PROCEDURE'
            ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
        `;
        const proceduresResult = await connection.request().query(proceduresQuery);
        objects.procedures = proceduresResult.recordset.map((row: any) => ({
            schema: row.schema,
            name: row.name
        }));

        // Query functions
        const functionsQuery = `
            SELECT 
                SCHEMA_NAME(schema_id) as [schema],
                name
            FROM sys.objects
            WHERE type IN ('TF', 'IF', 'FN', 'AF')
            ORDER BY SCHEMA_NAME(schema_id), name
        `;
        const functionsResult = await connection.request().query(functionsQuery);
        objects.functions = functionsResult.recordset.map((row: any) => ({
            schema: row.schema,
            name: row.name
        }));
    } catch (error) {
        outputChannel.appendLine(`[ScriptGeneration] Error querying database objects: ${error}`);
        throw error;
    }

    return objects;
}

async function handleScriptGeneration(
    request: ScriptGenerationRequest,
    connectionId: string,
    database: string,
    serverName: string,
    connectionProvider: ConnectionProvider,
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    const { selectedObjects, options } = request;

    // Calculate total work for progress tracking
    const totalTables = selectedObjects.tables.length;
    const totalViews = selectedObjects.views.length;
    const totalProcedures = selectedObjects.procedures.length;
    const totalFunctions = selectedObjects.functions.length;
    const totalObjects = totalTables + totalViews + totalProcedures + totalFunctions;

    if (totalObjects === 0) {
        vscode.window.showWarningMessage('No objects selected for scripting');
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Generating SQL Scripts',
            cancellable: false
        },
        async (progress) => {
            try {
                progress.report({ message: 'Initializing...', increment: 0 });

                const connection = connectionProvider.getConnection(connectionId);
                if (!connection) {
                    throw new Error('Connection not found');
                }

                let dbPool = connection;
                try {
                    dbPool = await connectionProvider.createDbPool(connectionId, database);
                } catch (error) {
                    outputChannel.appendLine(`[ScriptGeneration] Using base connection: ${error}`);
                }

                let script = '';
                let processedObjects = 0;

                // Add header comment
                script += `-- =============================================\n`;
                script += `-- SQL Script Generated by MS SQL Manager\n`;
                script += `-- Database: ${database}\n`;
                script += `-- Server: ${serverName}\n`;
                script += `-- Generated: ${new Date().toLocaleString()}\n`;
                script += `-- Script Type: ${getScriptTypeLabel(options.scriptType)}\n`;
                script += `-- Total Objects: ${totalObjects}\n`;
                script += `-- =============================================\n\n`;

                if (options.includeUseDatabase) {
                    script += `USE [${database}]\nGO\n\n`;
                }

                // Resolve dependencies if requested
                let orderedObjects = selectedObjects;
                if (options.sortByDependencies) {
                    progress.report({ message: 'Resolving dependencies...' });
                    orderedObjects = await resolveDependencies(selectedObjects, dbPool, outputChannel);
                }

                // Generate schema scripts
                if (options.scriptType === 'schema' || options.scriptType === 'schemaAndData') {
                    // Tables
                    for (const table of orderedObjects.tables) {
                        progress.report({
                            message: `Scripting table ${table.schema}.${table.name}...`,
                            increment: (100 / totalObjects)
                        });

                        const tableScript = await generateTableSchemaScript(
                            table,
                            dbPool,
                            options,
                            outputChannel
                        );
                        script += tableScript + '\n';
                        processedObjects++;
                    }

                    // Views
                    for (const view of orderedObjects.views) {
                        progress.report({
                            message: `Scripting view ${view.schema}.${view.name}...`,
                            increment: (100 / totalObjects)
                        });

                        const viewScript = await generateViewScript(
                            view,
                            dbPool,
                            options,
                            outputChannel
                        );
                        script += viewScript + '\n';
                        processedObjects++;
                    }

                    // Stored Procedures
                    for (const proc of orderedObjects.procedures) {
                        progress.report({
                            message: `Scripting procedure ${proc.schema}.${proc.name}...`,
                            increment: (100 / totalObjects)
                        });

                        const procScript = await generateProcedureScript(
                            proc,
                            dbPool,
                            options,
                            outputChannel
                        );
                        script += procScript + '\n';
                        processedObjects++;
                    }

                    // Functions
                    for (const func of orderedObjects.functions) {
                        progress.report({
                            message: `Scripting function ${func.schema}.${func.name}...`,
                            increment: (100 / totalObjects)
                        });

                        const funcScript = await generateFunctionScript(
                            func,
                            dbPool,
                            options,
                            outputChannel
                        );
                        script += funcScript + '\n';
                        processedObjects++;
                    }
                }

                // Generate data scripts
                if (options.scriptType === 'data' || options.scriptType === 'schemaAndData') {
                    if (options.scriptType === 'schemaAndData') {
                        script += `\n-- =============================================\n`;
                        script += `-- DATA INSERTION\n`;
                        script += `-- =============================================\n\n`;
                    }

                    for (const table of selectedObjects.tables) {
                        progress.report({
                            message: `Exporting data from ${table.schema}.${table.name}...`,
                            increment: options.scriptType === 'data' ? (100 / totalObjects) : 0
                        });

                        const dataScript = await generateTableDataScript(
                            table,
                            dbPool,
                            options,
                            outputChannel
                        );
                        if (dataScript) {
                            script += dataScript + '\n';
                        }
                        if (options.scriptType === 'data') {
                            processedObjects++;
                        }
                    }
                }

                progress.report({ message: 'Finalizing script...' });

                // Output the script
                await outputScript(script, database, options, context, outputChannel);

                vscode.window.showInformationMessage(
                    `Successfully generated scripts for ${totalObjects} database objects`
                );
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Script generation failed: ${errorMessage}`);
                outputChannel.appendLine(`[ScriptGeneration] Error: ${errorMessage}`);
            }
        }
    );
}

function getScriptTypeLabel(scriptType: string): string {
    switch (scriptType) {
        case 'schema': return 'Schema Only';
        case 'data': return 'Data Only';
        case 'schemaAndData': return 'Schema and Data';
        default: return scriptType;
    }
}

async function resolveDependencies(
    objects: DatabaseObjects,
    connection: any,
    outputChannel: vscode.OutputChannel
): Promise<DatabaseObjects> {
    // For now, return objects as-is. Full dependency resolution would require
    // querying sys.sql_expression_dependencies and implementing topological sort
    // This is a placeholder for future enhancement
    outputChannel.appendLine('[ScriptGeneration] Dependency resolution not yet implemented, using original order');
    return objects;
}

async function generateTableSchemaScript(
    table: DatabaseObject,
    connection: any,
    options: any,
    outputChannel: vscode.OutputChannel
): Promise<string> {
    try {
        let script = `-- =============================================\n`;
        script += `-- Table: [${table.schema}].[${table.name}]\n`;
        script += `-- =============================================\n`;

        // Add DROP statement if requested
        if (options.includeDropStatements) {
            script += `DROP TABLE IF EXISTS [${table.schema}].[${table.name}]\nGO\n\n`;
        } else if (options.includeIfExists) {
            script += `IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[${table.schema}].[${table.name}]') AND type = 'U')\n`;
            script += `    DROP TABLE [${table.schema}].[${table.name}]\nGO\n\n`;
        }

        script += 'SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\n\n';

        // Get columns
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
                c.is_hidden
            FROM sys.columns c
            INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
            LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
            WHERE c.object_id = OBJECT_ID('[${table.schema}].[${table.name}]')
            ORDER BY c.column_id
        `;
        const colResult = await connection.request().query(columnsQuery);

        script += `CREATE TABLE [${table.schema}].[${table.name}](\n`;

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

            let colDef = `    [${col.COLUMN_NAME}] ${dataType}`;

            if (col.is_identity) {
                colDef += ' IDENTITY(1,1)';
            }

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

        script += columnDefs.join(',\n');
        script += `\n) ON [PRIMARY]\nGO\n\n`;

        // Get primary key
        const pkQuery = `
            SELECT 
                kc.name AS constraint_name,
                i.type_desc,
                STRING_AGG(CAST(c.name AS NVARCHAR(MAX)) + ' ' + CASE WHEN ic.is_descending_key = 1 THEN 'DESC' ELSE 'ASC' END, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
            FROM sys.key_constraints kc
            INNER JOIN sys.indexes i ON kc.parent_object_id = i.object_id AND kc.unique_index_id = i.index_id
            INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            WHERE kc.parent_object_id = OBJECT_ID('[${table.schema}].[${table.name}]') AND kc.type = 'PK'
            GROUP BY kc.name, i.type_desc
        `;
        const pkResult = await connection.request().query(pkQuery);

        if (pkResult.recordset.length > 0) {
            const pk = pkResult.recordset[0];
            const clustered = pk.type_desc === 'CLUSTERED' ? 'CLUSTERED' : 'NONCLUSTERED';
            script += `ALTER TABLE [${table.schema}].[${table.name}] ADD CONSTRAINT [${pk.constraint_name}] PRIMARY KEY ${clustered} (${pk.columns})\nGO\n\n`;
        }

        // Get indexes
        const indexQuery = `
            SELECT 
                i.name AS index_name,
                i.type_desc,
                i.is_unique,
                STRING_AGG(CAST(c.name AS NVARCHAR(MAX)) + ' ' + CASE WHEN ic.is_descending_key = 1 THEN 'DESC' ELSE 'ASC' END, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
            FROM sys.indexes i
            INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            WHERE i.object_id = OBJECT_ID('[${table.schema}].[${table.name}]') 
                AND i.is_primary_key = 0 
                AND i.type > 0
            GROUP BY i.name, i.type_desc, i.is_unique
        `;
        const indexResult = await connection.request().query(indexQuery);

        for (const idx of indexResult.recordset) {
            const unique = idx.is_unique ? 'UNIQUE ' : '';
            const clustered = idx.type_desc === 'CLUSTERED' ? 'CLUSTERED' : 'NONCLUSTERED';
            script += `CREATE ${unique}${clustered} INDEX [${idx.index_name}] ON [${table.schema}].[${table.name}] (${idx.columns})\nGO\n\n`;
        }

        // Get foreign keys
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
            WHERE fk.parent_object_id = OBJECT_ID('[${table.schema}].[${table.name}]')
            GROUP BY fk.name, fk.referenced_object_id, fk.delete_referential_action_desc, fk.update_referential_action_desc
        `;
        const fkResult = await connection.request().query(fkQuery);

        for (const fk of fkResult.recordset) {
            script += `ALTER TABLE [${table.schema}].[${table.name}] ADD CONSTRAINT [${fk.constraint_name}] `;
            script += `FOREIGN KEY (${fk.columns}) REFERENCES [${fk.ref_schema}].[${fk.ref_table}] (${fk.ref_columns})`;
            if (fk.delete_referential_action_desc !== 'NO_ACTION') {
                script += ` ON DELETE ${fk.delete_referential_action_desc.replace('_', ' ')}`;
            }
            if (fk.update_referential_action_desc !== 'NO_ACTION') {
                script += ` ON UPDATE ${fk.update_referential_action_desc.replace('_', ' ')}`;
            }
            script += '\nGO\n\n';
        }

        // Script permissions if requested
        if (options.scriptPermissions) {
            const permScript = await generatePermissionsScript(table.schema, table.name, 'U', connection);
            if (permScript) {
                script += permScript;
            }
        }

        return script;
    } catch (error) {
        outputChannel.appendLine(`[ScriptGeneration] Error scripting table ${table.schema}.${table.name}: ${error}`);
        return `-- Error scripting table ${table.schema}.${table.name}: ${error}\n\n`;
    }
}

async function generateViewScript(
    view: DatabaseObject,
    connection: any,
    options: any,
    outputChannel: vscode.OutputChannel
): Promise<string> {
    try {
        let script = `-- =============================================\n`;
        script += `-- View: [${view.schema}].[${view.name}]\n`;
        script += `-- =============================================\n`;

        if (options.includeDropStatements) {
            script += `DROP VIEW IF EXISTS [${view.schema}].[${view.name}]\nGO\n\n`;
        } else if (options.includeIfExists) {
            script += `IF EXISTS (SELECT * FROM sys.views WHERE object_id = OBJECT_ID(N'[${view.schema}].[${view.name}]'))\n`;
            script += `    DROP VIEW [${view.schema}].[${view.name}]\nGO\n\n`;
        }

        const defQuery = `SELECT OBJECT_DEFINITION(OBJECT_ID('[${view.schema}].[${view.name}]')) AS definition`;
        const result = await connection.request().query(defQuery);

        if (result.recordset[0]?.definition) {
            script += result.recordset[0].definition + '\nGO\n\n';
        }

        if (options.scriptPermissions) {
            const permScript = await generatePermissionsScript(view.schema, view.name, 'V', connection);
            if (permScript) {
                script += permScript;
            }
        }

        return script;
    } catch (error) {
        outputChannel.appendLine(`[ScriptGeneration] Error scripting view ${view.schema}.${view.name}: ${error}`);
        return `-- Error scripting view ${view.schema}.${view.name}: ${error}\n\n`;
    }
}

async function generateProcedureScript(
    proc: DatabaseObject,
    connection: any,
    options: any,
    outputChannel: vscode.OutputChannel
): Promise<string> {
    try {
        let script = `-- =============================================\n`;
        script += `-- Stored Procedure: [${proc.schema}].[${proc.name}]\n`;
        script += `-- =============================================\n`;

        if (options.includeDropStatements) {
            script += `DROP PROCEDURE IF EXISTS [${proc.schema}].[${proc.name}]\nGO\n\n`;
        } else if (options.includeIfExists) {
            script += `IF EXISTS (SELECT * FROM sys.procedures WHERE object_id = OBJECT_ID(N'[${proc.schema}].[${proc.name}]'))\n`;
            script += `    DROP PROCEDURE [${proc.schema}].[${proc.name}]\nGO\n\n`;
        }

        const defQuery = `SELECT OBJECT_DEFINITION(OBJECT_ID('[${proc.schema}].[${proc.name}]')) AS definition`;
        const result = await connection.request().query(defQuery);

        if (result.recordset[0]?.definition) {
            script += result.recordset[0].definition + '\nGO\n\n';
        }

        if (options.scriptPermissions) {
            const permScript = await generatePermissionsScript(proc.schema, proc.name, 'P', connection);
            if (permScript) {
                script += permScript;
            }
        }

        return script;
    } catch (error) {
        outputChannel.appendLine(`[ScriptGeneration] Error scripting procedure ${proc.schema}.${proc.name}: ${error}`);
        return `-- Error scripting procedure ${proc.schema}.${proc.name}: ${error}\n\n`;
    }
}

async function generateFunctionScript(
    func: DatabaseObject,
    connection: any,
    options: any,
    outputChannel: vscode.OutputChannel
): Promise<string> {
    try {
        let script = `-- =============================================\n`;
        script += `-- Function: [${func.schema}].[${func.name}]\n`;
        script += `-- =============================================\n`;

        if (options.includeDropStatements) {
            script += `DROP FUNCTION IF EXISTS [${func.schema}].[${func.name}]\nGO\n\n`;
        } else if (options.includeIfExists) {
            script += `IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[${func.schema}].[${func.name}]') AND type IN ('FN', 'IF', 'TF', 'AF'))\n`;
            script += `    DROP FUNCTION [${func.schema}].[${func.name}]\nGO\n\n`;
        }

        const defQuery = `SELECT OBJECT_DEFINITION(OBJECT_ID('[${func.schema}].[${func.name}]')) AS definition`;
        const result = await connection.request().query(defQuery);

        if (result.recordset[0]?.definition) {
            script += result.recordset[0].definition + '\nGO\n\n';
        }

        if (options.scriptPermissions) {
            const permScript = await generatePermissionsScript(func.schema, func.name, 'FN', connection);
            if (permScript) {
                script += permScript;
            }
        }

        return script;
    } catch (error) {
        outputChannel.appendLine(`[ScriptGeneration] Error scripting function ${func.schema}.${func.name}: ${error}`);
        return `-- Error scripting function ${func.schema}.${func.name}: ${error}\n\n`;
    }
}

async function generateTableDataScript(
    table: DatabaseObject,
    connection: any,
    options: any,
    outputChannel: vscode.OutputChannel
): Promise<string> {
    try {
        // Check if table has data
        const countQuery = `SELECT COUNT(*) as cnt FROM [${table.schema}].[${table.name}]`;
        const countResult = await connection.request().query(countQuery);
        const rowCount = countResult.recordset[0]?.cnt || 0;

        if (rowCount === 0) {
            return `-- Table [${table.schema}].[${table.name}] has no data\n\n`;
        }

        let script = `-- =============================================\n`;
        script += `-- Data: [${table.schema}].[${table.name}] (${rowCount} rows)\n`;
        script += `-- =============================================\n`;

        // Get column information
        const columnsQuery = `
            SELECT 
                c.name,
                t.name as type_name,
                c.is_identity
            FROM sys.columns c
            INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
            WHERE c.object_id = OBJECT_ID('[${table.schema}].[${table.name}]')
            ORDER BY c.column_id
        `;
        const columnsResult = await connection.request().query(columnsQuery);
        const columns = columnsResult.recordset;

        // Check if table has identity column
        const hasIdentity = columns.some((col: any) => col.is_identity);

        if (hasIdentity) {
            script += `SET IDENTITY_INSERT [${table.schema}].[${table.name}] ON\nGO\n\n`;
        }

        // Fetch data in batches
        const batchSize = options.batchSize || 1000;
        let offset = 0;

        while (offset < rowCount) {
            const dataQuery = `
                SELECT * FROM [${table.schema}].[${table.name}]
                ORDER BY (SELECT NULL)
                OFFSET ${offset} ROWS
                FETCH NEXT ${batchSize} ROWS ONLY
            `;
            const dataResult = await connection.request().query(dataQuery);

            if (dataResult.recordset.length === 0) {
                break;
            }

            // Generate INSERT statements with multiple VALUES
            const columnNames = columns.map((col: any) => `[${col.name}]`).join(', ');
            
            script += `INSERT INTO [${table.schema}].[${table.name}] (${columnNames})\n`;
            script += 'VALUES\n';
            
            const valueRows = dataResult.recordset.map((row: any, index: number) => {
                const values = columns.map((col: any) => {
                    const value = row[col.name];
                    return formatSqlValue(value, col.type_name);
                }).join(', ');
                
                const isLast = index === dataResult.recordset.length - 1;
                return `    (${values})${isLast ? '' : ','}`;
            });
            
            script += valueRows.join('\n');
            script += '\nGO\n\n';
            offset += batchSize;
        }

        if (hasIdentity) {
            script += `SET IDENTITY_INSERT [${table.schema}].[${table.name}] OFF\nGO\n\n`;
        }

        return script;
    } catch (error) {
        outputChannel.appendLine(`[ScriptGeneration] Error generating data for ${table.schema}.${table.name}: ${error}`);
        return `-- Error generating data for ${table.schema}.${table.name}: ${error}\n\n`;
    }
}

function formatSqlValue(value: any, dataType: string): string {
    if (value === null || value === undefined) {
        return 'NULL';
    }

    const lowerType = dataType.toLowerCase();

    // String types
    if (['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext'].includes(lowerType)) {
        const escaped = value.toString().replace(/'/g, "''");
        return `'${escaped}'`;
    }

    // Date/time types
    if (['datetime', 'datetime2', 'date', 'time', 'smalldatetime', 'datetimeoffset'].includes(lowerType)) {
        return `'${value.toISOString ? value.toISOString() : value.toString()}'`;
    }

    // Binary types
    if (['binary', 'varbinary', 'image'].includes(lowerType)) {
        if (Buffer.isBuffer(value)) {
            return `0x${value.toString('hex')}`;
        }
        return 'NULL';
    }

    // Bit type
    if (lowerType === 'bit') {
        return value ? '1' : '0';
    }

    // Numeric types
    if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'].includes(lowerType)) {
        return value.toString();
    }

    // UniqueIdentifier
    if (lowerType === 'uniqueidentifier') {
        return `'${value.toString()}'`;
    }

    // XML
    if (lowerType === 'xml') {
        const escaped = value.toString().replace(/'/g, "''");
        return `'${escaped}'`;
    }

    // Default: treat as string
    const escaped = value.toString().replace(/'/g, "''");
    return `'${escaped}'`;
}

async function generatePermissionsScript(
    schema: string,
    objectName: string,
    objectType: string,
    connection: any
): Promise<string> {
    try {
        const permQuery = `
            SELECT 
                dp.state_desc,
                dp.permission_name,
                USER_NAME(dp.grantee_principal_id) AS grantee
            FROM sys.database_permissions dp
            WHERE dp.major_id = OBJECT_ID('[${schema}].[${objectName}]')
        `;
        const permResult = await connection.request().query(permQuery);

        if (permResult.recordset.length === 0) {
            return '';
        }

        let script = `-- Permissions\n`;
        for (const perm of permResult.recordset) {
            script += `${perm.state_desc} ${perm.permission_name} ON [${schema}].[${objectName}] TO [${perm.grantee}]\nGO\n`;
        }
        script += '\n';

        return script;
    } catch (error) {
        return '';
    }
}

async function outputScript(
    script: string,
    database: string,
    options: any,
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    const scriptTypeLabel = getScriptTypeLabel(options.scriptType).replace(/ /g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `${database}_${scriptTypeLabel}_${timestamp}.sql`;

    switch (options.destination) {
        case 'editor':
            await openSqlInCustomEditor(script, filename, context);
            break;

        case 'file':
            const fileUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(filename),
                filters: { 'SQL Files': ['sql'], 'All Files': ['*'] }
            });

            if (fileUri) {
                await vscode.workspace.fs.writeFile(fileUri, Buffer.from(script, 'utf8'));
                vscode.window.showInformationMessage(`Script saved to ${fileUri.fsPath}`);
            }
            break;

        case 'clipboard':
            await vscode.env.clipboard.writeText(script);
            vscode.window.showInformationMessage('Script copied to clipboard');
            break;
    }
}
