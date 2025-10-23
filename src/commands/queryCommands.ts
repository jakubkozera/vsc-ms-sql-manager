import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { QueryExecutor } from '../queryExecutor';
import { ResultWebviewProvider } from '../resultWebview';

export function registerQueryCommands(
    connectionProvider: ConnectionProvider,
    queryExecutor: QueryExecutor,
    resultWebviewProvider: ResultWebviewProvider,
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
            try {
                await vscode.commands.executeCommand('mssqlManager.results.focus');
            } catch {
                try {
                    await vscode.commands.executeCommand('workbench.view.extension.mssqlManager');
                } catch {
                    outputChannel.appendLine('[Extension] Panel focus commands failed, results will show anyway');
                }
            }
            
            resultWebviewProvider.showLoading();
            
            const results = await queryExecutor.executeQuery(queryText);
            
            resultWebviewProvider.showResults(results.recordset, results.executionTime);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            
            try {
                await vscode.commands.executeCommand('mssqlManager.results.focus');
            } catch {
                // Panel will be shown when error is posted
            }
            
            resultWebviewProvider.showError(errorMessage);
            
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
            
            const document = await vscode.workspace.openTextDocument({
                content: query,
                language: 'sql'
            });
            
            await vscode.window.showTextDocument(document);
        }
    });

    return [executeQueryCommand, generateSelectCommand];
}
