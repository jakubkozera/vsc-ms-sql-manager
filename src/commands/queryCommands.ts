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
            
            const query = `SELECT TOP 100 *\nFROM [${schemaName}].[${tableName}]`;
            
            await openSqlInCustomEditor(query, `select_${tableName}.sql`, context);
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
