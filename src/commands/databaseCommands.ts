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
    
    // Create refresh callback for backup import
    const refreshCallback = () => {
        if (treeProvider) {
            outputChannel.appendLine('[DatabaseCommands] Refreshing tree view after database import');
            treeProvider.refresh();
        }
    };
    
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
                // Create new export webview instance for each operation
                const backupExportWebview = new BackupExportWebview(connectionProvider, outputChannel, context);
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
                // Create new import webview instance for each operation
                const backupImportWebview = new BackupImportWebview(connectionProvider, outputChannel, context, refreshCallback);
                await backupImportWebview.show(node.connectionId);
            } catch (error: any) {
                outputChannel.appendLine(`[DatabaseCommands] Error showing backup import: ${error.message}`);
                vscode.window.showErrorMessage(`Failed to show backup import: ${error.message}`);
            }
        }
    );

    const deleteDatabase = vscode.commands.registerCommand(
        'mssqlManager.deleteDatabase',
        async (node?: any) => {
            outputChannel.appendLine('[DatabaseCommands] Delete database command triggered');

            if (!node || !node.connectionId || !node.database) {
                vscode.window.showErrorMessage('Please select a database from the explorer');
                return;
            }

            const database = node.database;
            const connectionId = node.connectionId;

            // Show options similar to Azure Data Studio
            const action = await vscode.window.showWarningMessage(
                `What would you like to do with database "${database}"?`,
                { modal: true, detail: 'Choose an action for this database.' },
                'Close Connection',
                'Drop Database'
            );

            if (!action) {
                return;
            }

            if (action === 'Close Connection') {
                try {
                    // Close the DB pool for this specific database
                    await connectionProvider.closeDbPool(connectionId, database);
                    outputChannel.appendLine(`[DatabaseCommands] Closed connection to database: ${database}`);
                    vscode.window.showInformationMessage(`Closed connection to database "${database}"`);
                    if (treeProvider) {
                        treeProvider.refresh();
                    }
                } catch (error: any) {
                    outputChannel.appendLine(`[DatabaseCommands] Error closing database connection: ${error.message}`);
                    vscode.window.showErrorMessage(`Failed to close connection: ${error.message}`);
                }
            } else if (action === 'Drop Database') {
                // Double confirmation for destructive action
                const confirm = await vscode.window.showWarningMessage(
                    `Are you sure you want to permanently drop database "${database}"? This action cannot be undone.`,
                    { modal: true },
                    'Drop'
                );

                if (confirm !== 'Drop') {
                    return;
                }

                try {
                    // Close DB pool for this database first
                    await connectionProvider.closeDbPool(connectionId, database);

                    // Use the server-level connection to drop the database
                    const connection = connectionProvider.getConnection(connectionId);
                    if (!connection) {
                        vscode.window.showErrorMessage('Server connection is not active');
                        return;
                    }

                    await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: `Dropping database "${database}"...` },
                        async () => {
                            const request = connection.request();
                            // Set database to single-user mode to force close all connections, then drop
                            await request.query(`
                                ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                                DROP DATABASE [${database}];
                            `);
                        }
                    );

                    outputChannel.appendLine(`[DatabaseCommands] Successfully dropped database: ${database}`);
                    vscode.window.showInformationMessage(`Database "${database}" has been dropped successfully`);
                    if (treeProvider) {
                        treeProvider.refresh();
                    }
                } catch (error: any) {
                    outputChannel.appendLine(`[DatabaseCommands] Error dropping database: ${error.message}`);
                    vscode.window.showErrorMessage(`Failed to drop database: ${error.message}`);
                }
            }
        }
    );

    const createDatabase = vscode.commands.registerCommand(
        'mssqlManager.createDatabase',
        async (node?: any) => {
            outputChannel.appendLine('[DatabaseCommands] Create database command triggered');

            if (!node || !node.connectionId) {
                vscode.window.showErrorMessage('Please select a server connection from the explorer');
                return;
            }

            const connectionId = node.connectionId;

            const databaseName = await vscode.window.showInputBox({
                prompt: 'Enter the name for the new database',
                placeHolder: 'DatabaseName',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Database name is required';
                    }
                    if (/[[\]'";]/.test(value)) {
                        return 'Database name contains invalid characters';
                    }
                    if (value.length > 128) {
                        return 'Database name must be 128 characters or less';
                    }
                    return undefined;
                }
            });

            if (!databaseName) {
                return;
            }

            try {
                const connection = connectionProvider.getConnection(connectionId);
                if (!connection) {
                    vscode.window.showErrorMessage('Server connection is not active');
                    return;
                }

                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `Creating database "${databaseName}"...` },
                    async () => {
                        const request = connection.request();
                        await request.query(`CREATE DATABASE [${databaseName}]`);
                    }
                );

                outputChannel.appendLine(`[DatabaseCommands] Successfully created database: ${databaseName}`);
                vscode.window.showInformationMessage(`Database "${databaseName}" has been created successfully`);
                if (treeProvider) {
                    treeProvider.refresh();
                }
            } catch (error: any) {
                outputChannel.appendLine(`[DatabaseCommands] Error creating database: ${error.message}`);
                vscode.window.showErrorMessage(`Failed to create database: ${error.message}`);
            }
        }
    );

    return [showDatabaseDiagram, compareSchema, exportBackup, importBackup, deleteDatabase, createDatabase];
}
