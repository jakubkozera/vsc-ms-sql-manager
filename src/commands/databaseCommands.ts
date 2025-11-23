import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { DatabaseDiagramWebview } from '../databaseDiagramWebview';
import { CompareSchemaWebview } from '../compareSchemaWebview';
import { BackupExportWebview } from '../backupExportWebviewNew';
import { BackupImportWebview } from '../backupImportWebviewNew';

export function registerDatabaseCommands(
    context: vscode.ExtensionContext,
    connectionProvider: ConnectionProvider,
    outputChannel: vscode.OutputChannel,
    treeProvider?: any
): vscode.Disposable[] {
    
    const diagramWebview = new DatabaseDiagramWebview(connectionProvider, outputChannel, context);
    const compareSchemaWebview = new CompareSchemaWebview(connectionProvider, outputChannel, context);
    const backupExportWebview = new BackupExportWebview(connectionProvider, outputChannel, context);
    
    // Create backup import webview with refresh callback
    const refreshCallback = () => {
        if (treeProvider) {
            outputChannel.appendLine('[DatabaseCommands] Refreshing tree view after database import');
            treeProvider.refresh();
        }
    };
    const backupImportWebview = new BackupImportWebview(connectionProvider, outputChannel, context, refreshCallback);
    
    // Register Compare Schema webview to receive connection updates
    compareSchemaWebview.registerForConnectionUpdates();

    const showDatabaseDiagram = vscode.commands.registerCommand(
        'mssqlManager.showDatabaseDiagram',
        async (node?: any) => {
            outputChannel.appendLine('[DatabaseCommands] Show database diagram command triggered');

            if (!node || !node.connectionId) {
                vscode.window.showErrorMessage('Please select a database or connection from the explorer');
                return;
            }

            // If node has database property, use it; otherwise use the connection's database
            let database = node.database;
            
            if (!database) {
                // For connectionActive/connectionInactive nodes, get database from config
                const config = connectionProvider.getConnectionConfig(node.connectionId);
                if (config && config.database) {
                    database = config.database;
                } else {
                    vscode.window.showErrorMessage('No database specified for this connection');
                    return;
                }
            }

            try {
                await diagramWebview.show(node.connectionId, database);
            } catch (error: any) {
                outputChannel.appendLine(`[DatabaseCommands] Error showing diagram: ${error.message}`);
                vscode.window.showErrorMessage(`Failed to show database diagram: ${error.message}`);
            }
        }
    );

    const compareSchema = vscode.commands.registerCommand(
        'mssqlManager.compareSchema',
        async (node?: any) => {
            outputChannel.appendLine('[DatabaseCommands] Compare schema command triggered');

            if (!node || !node.connectionId) {
                vscode.window.showErrorMessage('Please select a database or connection from the explorer');
                return;
            }

            // If node has database property, use it; otherwise use the connection's database
            let database = node.database;
            
            if (!database) {
                // For connectionActive/connectionInactive nodes, get database from config
                const config = connectionProvider.getConnectionConfig(node.connectionId);
                if (config && config.database) {
                    database = config.database;
                } else {
                    vscode.window.showErrorMessage('No database specified for this connection');
                    return;
                }
            }

            try {
                await compareSchemaWebview.show(node.connectionId, database);
            } catch (error: any) {
                outputChannel.appendLine(`[DatabaseCommands] Error showing schema comparison: ${error.message}`);
                vscode.window.showErrorMessage(`Failed to show schema comparison: ${error.message}`);
            }
        }
    );

    const exportBackup = vscode.commands.registerCommand(
        'mssqlManager.exportBackup',
        async (node?: any) => {
            outputChannel.appendLine('[DatabaseCommands] Export backup command triggered');

            if (!node || !node.connectionId) {
                vscode.window.showErrorMessage('Please select a database or connection from the explorer');
                return;
            }

            // If node has database property, use it; otherwise use the connection's database
            let database = node.database;
            
            if (!database) {
                // For connectionActive/connectionInactive nodes, get database from config
                const config = connectionProvider.getConnectionConfig(node.connectionId);
                if (config && config.database) {
                    database = config.database;
                } else {
                    vscode.window.showErrorMessage('No database specified for this connection');
                    return;
                }
            }

            try {
                await backupExportWebview.show(node.connectionId, database);
            } catch (error: any) {
                outputChannel.appendLine(`[DatabaseCommands] Error showing backup export: ${error.message}`);
                vscode.window.showErrorMessage(`Failed to show backup export: ${error.message}`);
            }
        }
    );

    const importBackup = vscode.commands.registerCommand(
        'mssqlManager.importBackup',
        async (node?: any) => {
            outputChannel.appendLine('[DatabaseCommands] Import backup command triggered');

            if (!node || !node.connectionId) {
                vscode.window.showErrorMessage('Please select a server connection from the explorer');
                return;
            }

            try {
                await backupImportWebview.show(node.connectionId);
            } catch (error: any) {
                outputChannel.appendLine(`[DatabaseCommands] Error showing backup import: ${error.message}`);
                vscode.window.showErrorMessage(`Failed to show backup import: ${error.message}`);
            }
        }
    );

    return [showDatabaseDiagram, compareSchema, exportBackup, importBackup];
}
