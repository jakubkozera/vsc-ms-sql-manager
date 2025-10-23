import * as vscode from 'vscode';
import { ConnectionProvider } from './connectionProvider';
import { UnifiedTreeProvider } from './unifiedTreeProvider';
import { QueryExecutor } from './queryExecutor';
import { ResultWebviewProvider } from './resultWebview';
import { ServerGroupWebview } from './serverGroupWebview';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('MS SQL Manager');
    outputChannel.appendLine('MS SQL Manager extension activated');

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = "$(database) Not Connected";
    statusBarItem.tooltip = "MS SQL Manager - No active connection";
    statusBarItem.show();

    // Initialize providers
    const connectionProvider = new ConnectionProvider(context, outputChannel, statusBarItem);
    const unifiedTreeProvider = new UnifiedTreeProvider(connectionProvider, outputChannel);
    const queryExecutor = new QueryExecutor(connectionProvider, outputChannel);
    const resultWebviewProvider = new ResultWebviewProvider(context.extensionUri);

    // Register webview provider for panel
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ResultWebviewProvider.viewType, resultWebviewProvider)
    );

    // Set up connection change callback
    connectionProvider.setConnectionChangeCallback(() => {
        outputChannel.appendLine('[Extension] Connection changed, refreshing tree view');
        unifiedTreeProvider.refresh();
    });

    // Register tree data provider
    vscode.window.registerTreeDataProvider('mssqlManager.explorer', unifiedTreeProvider);

    // Register commands
    const connectCommand = vscode.commands.registerCommand('mssqlManager.connect', async () => {
        await connectionProvider.connect();
    });

    // Add a debug command to check saved connections
    const debugConnectionsCommand = vscode.commands.registerCommand('mssqlManager.debugConnections', async () => {
        const connections = context.globalState.get<any[]>('mssqlManager.connections', []);
        outputChannel.appendLine(`[DEBUG] Found ${connections.length} saved connections:`);
        connections.forEach((conn, index) => {
            outputChannel.appendLine(`[DEBUG] ${index + 1}. ${conn.name} - ${conn.server}/${conn.database}`);
        });
        vscode.window.showInformationMessage(`Found ${connections.length} saved connections. Check output channel for details.`);
    });

    const executeQueryCommand = vscode.commands.registerCommand('mssqlManager.executeQuery', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        const document = editor.document;
        if (document.languageId !== 'sql') {
            vscode.window.showWarningMessage('Please open a SQL file to execute queries');
            return;
        }

        // Check if connected
        if (!connectionProvider.isConnected()) {
            vscode.window.showWarningMessage('Not connected to database. Please connect first.');
            return;
        }

        let queryText: string;
        const selection = editor.selection;
        
        if (!selection.isEmpty) {
            // Execute selected text
            queryText = document.getText(selection);
            outputChannel.appendLine(`[Extension] Executing selected query (${queryText.length} characters)`);
        } else {
            // Execute entire file content
            queryText = document.getText();
            outputChannel.appendLine(`[Extension] Executing entire file (${queryText.length} characters)`);
        }

        if (!queryText.trim()) {
            vscode.window.showWarningMessage('No query text found to execute');
            return;
        }

        try {
            // Try multiple ways to open the panel
            try {
                await vscode.commands.executeCommand('mssqlManager.results.focus');
            } catch {
                try {
                    await vscode.commands.executeCommand('workbench.view.extension.mssqlManager');
                } catch {
                    // Panel will be shown when results are posted
                    outputChannel.appendLine('[Extension] Panel focus commands failed, results will show anyway');
                }
            }
            
            // Show loading in panel
            resultWebviewProvider.showLoading();
            
            const results = await queryExecutor.executeQuery(queryText);
            
            // Show results in panel
            resultWebviewProvider.showResults(results.recordset, results.executionTime);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            
            // Try to show panel for error display
            try {
                await vscode.commands.executeCommand('mssqlManager.results.focus');
            } catch {
                // Panel will be shown when error is posted
            }
            
            // Show error in panel
            resultWebviewProvider.showError(errorMessage);
            
            vscode.window.showErrorMessage(`Query execution failed: ${errorMessage}`);
            outputChannel.appendLine(`Query execution error: ${errorMessage}`);
        }
    });

    const refreshCommand = vscode.commands.registerCommand('mssqlManager.refresh', () => {
        outputChannel.appendLine('[Extension] Refreshing tree view');
        unifiedTreeProvider.refresh();
    });

    const disconnectCommand = vscode.commands.registerCommand('mssqlManager.disconnect', async () => {
        await connectionProvider.disconnect();
        unifiedTreeProvider.refresh();
    });

    const generateSelectCommand = vscode.commands.registerCommand('mssqlManager.generateSelectScript', async (item: any) => {
        if (item && item.label) {
            const fullLabel = item.label;
            let tableName: string;
            let schemaName: string;
            
            // Parse the label format: schema.tableName
            if (fullLabel.includes('.')) {
                const parts = fullLabel.split('.');
                schemaName = parts[0];
                tableName = parts[1];
            } else {
                // Fallback for old format
                tableName = fullLabel;
                schemaName = item.schema || 'dbo';
            }
            
            // Generate proper SQL with brackets only in the query
            const query = `SELECT TOP 100 *\nFROM [${schemaName}].[${tableName}]`;
            
            const document = await vscode.workspace.openTextDocument({
                content: query,
                language: 'sql'
            });
            
            await vscode.window.showTextDocument(document);
        }
    });

    const manageConnectionsCommand = vscode.commands.registerCommand('mssqlManager.manageConnections', async () => {
        await connectionProvider.manageConnections();
    });

    const connectToSavedCommand = vscode.commands.registerCommand('mssqlManager.connectToSaved', async (connectionItem?: any) => {
        try {
            if (connectionItem && connectionItem.connectionId) {
                await connectionProvider.connectToSavedById(connectionItem.connectionId);
                // Refresh tree view to show expanded schema
                unifiedTreeProvider.refresh();
            } else {
                vscode.window.showErrorMessage('Invalid connection item');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to connect: ${errorMessage}`);
            outputChannel.appendLine(`Connect to saved failed: ${errorMessage}`);
        }
    });

    const editConnectionCommand = vscode.commands.registerCommand('mssqlManager.editConnection', async (connectionItem?: any) => {
        try {
            if (connectionItem && connectionItem.connectionId) {
                await connectionProvider.editConnection(connectionItem.connectionId);
            } else {
                vscode.window.showErrorMessage('Invalid connection item');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to edit connection: ${errorMessage}`);
            outputChannel.appendLine(`Edit connection failed: ${errorMessage}`);
        }
    });

    const deleteConnectionCommand = vscode.commands.registerCommand('mssqlManager.deleteConnection', async (connectionItem?: any) => {
        try {
            if (connectionItem && connectionItem.connectionId) {
                const connectionName = connectionItem.name || connectionItem.label || 'this connection';
                const confirmed = await vscode.window.showWarningMessage(
                    `Are you sure you want to delete "${connectionName}"?`,
                    { modal: true },
                    'Delete'
                );
                
                if (confirmed === 'Delete') {
                    await connectionProvider.deleteConnection(connectionItem.connectionId);
                    vscode.window.showInformationMessage(`Connection "${connectionName}" deleted successfully`);
                    unifiedTreeProvider.refresh();
                }
            } else {
                vscode.window.showErrorMessage('Invalid connection item');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to delete connection: ${errorMessage}`);
            outputChannel.appendLine(`Delete connection failed: ${errorMessage}`);
        }
    });

    const createServerGroupCommand = vscode.commands.registerCommand('mssqlManager.createServerGroup', async () => {
        const serverGroupWebview = new ServerGroupWebview(context, async (group) => {
            try {
                await connectionProvider.saveServerGroup(group);
                vscode.window.showInformationMessage(`Server group "${group.name}" created successfully`);
                unifiedTreeProvider.refresh();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                vscode.window.showErrorMessage(`Failed to create server group: ${errorMessage}`);
                outputChannel.appendLine(`Create server group failed: ${errorMessage}`);
            }
        });
        await serverGroupWebview.show();
    });

    const disconnectConnectionCommand = vscode.commands.registerCommand('mssqlManager.disconnectConnection', async (connectionItem?: any) => {
        try {
            if (connectionItem && connectionItem.connectionId) {
                await connectionProvider.disconnect(connectionItem.connectionId);
                const connectionName = connectionItem.name || connectionItem.label || 'Connection';
                vscode.window.showInformationMessage(`Disconnected from "${connectionName}"`);
                unifiedTreeProvider.refresh();
            } else {
                vscode.window.showErrorMessage('Invalid connection item');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to disconnect: ${errorMessage}`);
            outputChannel.appendLine(`Disconnect failed: ${errorMessage}`);
        }
    });

    // Edit Server Group command
    const editServerGroupCommand = vscode.commands.registerCommand('mssqlManager.editServerGroup', async (serverGroupNode?: any) => {
        try {
            if (!serverGroupNode || !serverGroupNode.group) {
                vscode.window.showErrorMessage('Invalid server group item');
                return;
            }
            const group = serverGroupNode.group;
            const serverGroupWebview = new ServerGroupWebview(context, async (updatedGroup) => {
                try {
                    await connectionProvider.saveServerGroup(updatedGroup);
                    vscode.window.showInformationMessage(`Server group "${updatedGroup.name}" updated successfully`);
                    unifiedTreeProvider.refresh();
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                    vscode.window.showErrorMessage(`Failed to update server group: ${errorMessage}`);
                    outputChannel.appendLine(`Update server group failed: ${errorMessage}`);
                }
            });
            await serverGroupWebview.show(group);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to edit server group: ${errorMessage}`);
            outputChannel.appendLine(`Edit server group failed: ${errorMessage}`);
        }
    });

    // Table context menu commands
    const selectTop1000Command = vscode.commands.registerCommand('mssqlManager.selectTop1000', async (tableNode?: any) => {
        try {
            if (!tableNode || !tableNode.connectionId || !tableNode.label) {
                vscode.window.showErrorMessage('Invalid table item');
                return;
            }

            // Verify the connection is active
            const connection = connectionProvider.getConnection(tableNode.connectionId);
            if (!connection) {
                vscode.window.showErrorMessage('No active connection found. Please connect to the database first.');
                return;
            }

            const tableName = tableNode.label as string;
            const query = `SELECT TOP 1000 * FROM ${tableName};`;
            
            // Create a new document with the query
            const document = await vscode.workspace.openTextDocument({
                content: query,
                language: 'sql'
            });
            
            // Show the document first
            const editor = await vscode.window.showTextDocument(document);
            
            // Wait a moment for the editor to be ready, then execute
            setTimeout(async () => {
                try {
                    // Execute using the active connection from the table's connection ID
                    const conn = connectionProvider.getConnection(tableNode.connectionId);
                    if (conn) {
                        resultWebviewProvider.showLoading();
                        const startTime = Date.now();
                        const result = await conn.request().query(query);
                        const executionTime = Date.now() - startTime;
                        
                        // Show results in webview
                        resultWebviewProvider.showResults(result.recordset, executionTime);
                        
                        outputChannel.appendLine(`Query executed successfully. ${result.recordset.length} rows returned in ${executionTime}ms.`);
                    } else {
                        vscode.window.showErrorMessage('Connection was lost. Please reconnect.');
                    }
                } catch (execError) {
                    const errorMessage = execError instanceof Error ? execError.message : 'Unknown error occurred';
                    resultWebviewProvider.showError(errorMessage);
                    vscode.window.showErrorMessage(`Failed to execute query: ${errorMessage}`);
                    outputChannel.appendLine(`Query execution failed: ${errorMessage}`);
                }
            }, 100);
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

            // Parse schema and table name
            const [schema, table] = tableName.includes('.') ? tableName.split('.') : ['dbo', tableName];

            let createScript = 'SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\n';

            // Get columns with more details
            const columnsQuery = `
                SELECT 
                    c.name AS COLUMN_NAME,
                    t.name AS DATA_TYPE,
                    c.max_length,
                    c.precision,
                    c.scale,
                    c.is_nullable,
                    OBJECT_DEFINITION(c.default_object_id) AS COLUMN_DEFAULT,
                    c.is_identity
                FROM sys.columns c
                INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
                WHERE c.object_id = OBJECT_ID('[${schema}].[${table}]')
                ORDER BY c.column_id;
            `;

            const colResult = await connection.request().query(columnsQuery);
            
            // Get filegroup info - simplified for compatibility
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

            // Build CREATE TABLE
            createScript += `CREATE TABLE [${schema}].[${table}](\n`;
            
            const columnDefs = colResult.recordset.map((col: any) => {
                let dataType = col.DATA_TYPE.toLowerCase();
                
                // Handle size for various data types
                if (['varchar', 'char', 'nvarchar', 'nchar', 'binary', 'varbinary'].includes(dataType)) {
                    if (col.max_length === -1) {
                        dataType = `[${dataType}](max)`;
                    } else {
                        const length = ['nvarchar', 'nchar'].includes(dataType) ? col.max_length / 2 : col.max_length;
                        dataType = `[${dataType}](${length})`;
                    }
                } else if (['decimal', 'numeric'].includes(dataType)) {
                    dataType = `[${dataType}](${col.precision},${col.scale})`;
                } else {
                    dataType = `[${dataType}]`;
                }
                
                const nullable = col.is_nullable ? 'NULL' : 'NOT NULL';
                
                return `\t[${col.COLUMN_NAME}] ${dataType} ${nullable}`;
            });
            
            createScript += columnDefs.join(',\n');
            createScript += `\n) ON [${dataSpace}]`;
            if (lobDataSpace && lobDataSpace !== dataSpace) {
                createScript += ` TEXTIMAGE_ON [${lobDataSpace}]`;
            }
            createScript += '\nGO\n';

            // Get primary key
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

            // Get non-primary key indexes
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

            const document = await vscode.workspace.openTextDocument({
                content: createScript,
                language: 'sql'
            });
            
            await vscode.window.showTextDocument(document);
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
            // Parse schema and table name
            const [schema, table] = tableName.includes('.') ? tableName.split('.') : ['dbo', tableName];
            
            const dropScript = `IF  EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[${schema}].[${table}]') AND type in (N'U'))
DROP TABLE [${schema}].[${table}]
GO`;

            const document = await vscode.workspace.openTextDocument({
                content: dropScript,
                language: 'sql'
            });
            
            await vscode.window.showTextDocument(document);
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

            // Refresh the tree view
            unifiedTreeProvider.refresh();
            vscode.window.showInformationMessage('Table refreshed');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to refresh table: ${errorMessage}`);
            outputChannel.appendLine(`Refresh table failed: ${errorMessage}`);
        }
    });

    // Register all commands
    context.subscriptions.push(
        outputChannel,
        statusBarItem,
        connectCommand,
        debugConnectionsCommand,
        executeQueryCommand,
        refreshCommand,
        disconnectCommand,
        generateSelectCommand,
        manageConnectionsCommand,
        connectToSavedCommand,
        editConnectionCommand,
        deleteConnectionCommand,
        createServerGroupCommand,
        disconnectConnectionCommand,
        editServerGroupCommand,
        selectTop1000Command,
        scriptTableCreateCommand,
        scriptTableDropCommand,
        refreshTableCommand
    );

    outputChannel.appendLine('MS SQL Manager commands registered successfully');
}

export function deactivate() {
    if (outputChannel) {
        outputChannel.appendLine('MS SQL Manager extension deactivated');
        outputChannel.dispose();
    }
    
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
