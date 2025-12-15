import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { QueryExecutor } from '../queryExecutor';
import { openSqlInCustomEditor } from '../utils/sqlDocumentHelper';

export function registerQueryCommands(
    context: vscode.ExtensionContext,
    connectionProvider: ConnectionProvider,
    queryExecutor: QueryExecutor,
    outputChannel: vscode.OutputChannel
): vscode.Disposable[] {
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

        if (!connectionProvider.isConnected()) {
            vscode.window.showWarningMessage('Not connected to database. Please connect first.');
            return;
        }

        let queryText: string;
        const selection = editor.selection;
        
        if (!selection.isEmpty) {
            queryText = document.getText(selection);
            outputChannel.appendLine(`[Extension] Executing selected query (${queryText.length} characters)`);
        } else {
            queryText = document.getText();
            outputChannel.appendLine(`[Extension] Executing entire file (${queryText.length} characters)`);
        }

        if (!queryText.trim()) {
            vscode.window.showWarningMessage('No query text found to execute');
            return;
        }

        try {
            outputChannel.appendLine(`[Extension] Executing query...`);
            // Query execution is handled by the SQL Editor webview directly
            vscode.window.showInformationMessage('Query execution is handled by the SQL Editor. Use the Run button or F5 in the SQL file.');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Query execution failed: ${errorMessage}`);
            outputChannel.appendLine(`Query execution error: ${errorMessage}`);
        }
    });

    const generateSelectCommand = vscode.commands.registerCommand('mssqlManager.generateSelectScript', async (item: any) => {
        if (item && item.label) {
            const fullLabel = item.label;
            let tableName: string;
            let schemaName: string;
            
            if (fullLabel.includes('.')) {
                const parts = fullLabel.split('.');
                schemaName = parts[0];
                tableName = parts[1];
            } else {
                tableName = fullLabel;
                schemaName = item.schema || 'dbo';
            }
            
            // Generate table alias (first 2-3 letters of table name, lowercase)
            const tableAlias = tableName.length <= 3 ? tableName.toLowerCase() : tableName.substring(0, 2).toLowerCase();
            
            // Get table columns to build explicit SELECT query
            let query: string;
            
            // Check if we have an active connection and try to get columns
            let connection = connectionProvider.getConnection(item.connectionId) || connectionProvider.getConnection();
            let queryConnection = connection;
            
            // If we have a database context and connection, try to create a database-specific pool
            if (item.database && item.connectionId && connection) {
                try {
                    queryConnection = await connectionProvider.createDbPool(item.connectionId, item.database);
                    outputChannel.appendLine(`[QueryCommands] Using database-specific pool for ${item.database}`);
                } catch (error) {
                    outputChannel.appendLine(`[QueryCommands] Failed to create DB pool, using base connection: ${error}`);
                    queryConnection = connection;
                }
            }
            
            if (queryConnection && queryConnection.connected) {
                try {
                    const columnsQuery = `
                        SELECT c.name AS COLUMN_NAME
                        FROM sys.columns c
                        WHERE c.object_id = OBJECT_ID('[${schemaName}].[${tableName}]')
                        ORDER BY c.column_id
                    `;
                    
                    const columnsResult = await queryConnection.request().query(columnsQuery);
                    
                    if (columnsResult.recordset && columnsResult.recordset.length > 0) {
                        const columns = columnsResult.recordset.map((col: any) => `[${col.COLUMN_NAME}]`).join(',\n      ');
                        query = `SELECT TOP (1000) ${columns}\n  FROM [${schemaName}].[${tableName}] [${tableAlias}]`;
                    } else {
                        // Fallback to * if we can't get columns
                        query = `SELECT TOP (1000) *\n  FROM [${schemaName}].[${tableName}] [${tableAlias}]`;
                    }
                } catch (error) {
                    // Fallback to * if column query fails
                    outputChannel.appendLine(`Failed to get columns for ${fullLabel}, using *: ${error}`);
                    query = `SELECT TOP (1000) *\n  FROM [${schemaName}].[${tableName}] [${tableAlias}]`;
                }
            } else {
                // No connection available or not connected, use basic query
                outputChannel.appendLine(`No active connection available for ${fullLabel}, using basic query`);
                query = `SELECT TOP (1000) *\n  FROM [${schemaName}].[${tableName}] [${tableAlias}]`;
            }
            
            // Set the preferred database context if available and execute query
            if (item.database && item.connectionId) {
                connectionProvider.setNextEditorPreferredDatabase(item.connectionId, item.database);
            }
            
            // Use newQuery command with autoExecute to run the query immediately
            await vscode.commands.executeCommand('mssqlManager.newQuery', item, query, true);
        }
    });

    const newQueryOnDatabaseCommand = vscode.commands.registerCommand('mssqlManager.newQueryOnDatabase', async (item: any) => {
        if (item && item.database && item.connectionId) {
            outputChannel.appendLine(`[QueryCommands] Opening new query for database: ${item.database}, connection: ${item.connectionId}`);
            
            try {
                // Check if connection is active, if not - connect
                if (!connectionProvider.isConnectionActive(item.connectionId)) {
                    outputChannel.appendLine(`[QueryCommands] Connection not active, connecting...`);
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Connecting to server...`,
                        cancellable: false
                    }, async () => {
                        await connectionProvider.connectToSavedById(item.connectionId);
                    });
                }
                
                // Set this connection as active
                connectionProvider.setActiveConnection(item.connectionId);
                
                // Set the preferred database for the next editor that opens
                connectionProvider.setNextEditorPreferredDatabase(item.connectionId, item.database);
                
                // Open empty SQL editor (no comment, completely empty)
                const query = ``;
                await openSqlInCustomEditor(query, `query_${item.database}.sql`, context);
                
                outputChannel.appendLine(`[QueryCommands] Opened new query for database: ${item.database}`);
                
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to open query: ${errorMessage}`);
                outputChannel.appendLine(`[QueryCommands] Error opening query: ${errorMessage}`);
            }
        }
    });

    return [executeQueryCommand, generateSelectCommand, newQueryOnDatabaseCommand];
}
