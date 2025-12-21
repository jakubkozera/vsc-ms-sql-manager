import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { SchemaCache } from '../utils/schemaCache';

/**
 * Register schema cache management commands
 */
export function registerSchemaCacheCommands(
    context: vscode.ExtensionContext,
    connectionProvider: ConnectionProvider,
    outputChannel: vscode.OutputChannel
): void {
    const schemaCache = SchemaCache.getInstance(context);

    // Command: Refresh entire database schema
    context.subscriptions.push(
        vscode.commands.registerCommand('mssqlmanager.refreshDatabaseSchema', async (node?: any) => {
            try {
                let connectionId: string | undefined;
                let database: string | undefined;

                // Extract connection info from tree node if provided
                if (node && node.connectionId) {
                    connectionId = node.connectionId;
                    database = node.database;
                } else {
                    // Use active connection
                    const activeConnection = connectionProvider.getActiveConnectionInfo();
                    if (!activeConnection) {
                        vscode.window.showErrorMessage('No active database connection');
                        return;
                    }
                    connectionId = activeConnection.id;
                    database = activeConnection.database;
                }

                const connection = connectionProvider.getConnection(connectionId);
                if (!connection || !connectionId) {
                    vscode.window.showErrorMessage('Unable to get database connection');
                    return;
                }

                const connectionInfo = connectionProvider.getConnectionConfig(connectionId);
                if (!connectionInfo || !database || !connectionInfo.server) {
                    vscode.window.showErrorMessage('Unable to get connection configuration or database name');
                    return;
                }

                const cacheConnection = {
                    server: connectionInfo.server!,  // Checked above
                    database: database  // database is guaranteed non-null here
                };

                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Refreshing schema for ${database || 'database'}...`,
                    cancellable: false
                }, async () => {
                    await schemaCache.refreshAll(cacheConnection, connection);
                    outputChannel.appendLine(`[SchemaCache] Refreshed complete schema for ${database}`);
                });

                vscode.window.showInformationMessage(`Schema refreshed for ${database || 'database'}`);
                
                // Refresh tree view
                vscode.commands.executeCommand('mssqlmanager.refreshExplorer');
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to refresh schema: ${message}`);
                outputChannel.appendLine(`[SchemaCache] Error refreshing schema: ${message}`);
            }
        })
    );

    // Command: Refresh specific table
    context.subscriptions.push(
        vscode.commands.registerCommand('mssqlmanager.refreshTable', async (node?: any) => {
            try {
                if (!node || !node.connectionId || !node.database) {
                    vscode.window.showErrorMessage('Invalid table node');
                    return;
                }

                // Extract table schema and name from node
                const tableName = node.label?.replace(/\s*\(.*?\)\s*/g, '').trim(); // Remove row count
                const tableSchema = node.schema || 'dbo';

                const connection = connectionProvider.getConnection(node.connectionId);
                if (!connection) {
                    vscode.window.showErrorMessage('Unable to get database connection');
                    return;
                }

                const connectionInfo = connectionProvider.getConnectionConfig(node.connectionId);
                if (!connectionInfo || !connectionInfo.server) {
                    vscode.window.showErrorMessage('Unable to get connection configuration');
                    return;
                }

                const cacheConnection = {
                    server: connectionInfo.server,
                    database: node.database || connectionInfo.database || ''
                };

                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Refreshing table ${tableSchema}.${tableName}...`,
                    cancellable: false
                }, async () => {
                    await schemaCache.refreshTable(cacheConnection, connection, tableSchema, tableName);
                    outputChannel.appendLine(`[SchemaCache] Refreshed table ${tableSchema}.${tableName}`);
                });

                vscode.window.showInformationMessage(`Table ${tableSchema}.${tableName} refreshed`);
                
                // Refresh tree view
                vscode.commands.executeCommand('mssqlmanager.refreshExplorer');
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to refresh table: ${message}`);
                outputChannel.appendLine(`[SchemaCache] Error refreshing table: ${message}`);
            }
        })
    );

    // Command: Clear all schema cache
    context.subscriptions.push(
        vscode.commands.registerCommand('mssqlmanager.clearSchemaCache', async () => {
            try {
                const confirm = await vscode.window.showWarningMessage(
                    'Are you sure you want to clear all cached database schemas?',
                    { modal: true },
                    'Clear Cache'
                );

                if (confirm === 'Clear Cache') {
                    schemaCache.clearAll();
                    outputChannel.appendLine('[SchemaCache] Cleared all cached schemas');
                    vscode.window.showInformationMessage('Schema cache cleared');
                    
                    // Refresh tree view
                    vscode.commands.executeCommand('mssqlmanager.refreshExplorer');
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to clear cache: ${message}`);
                outputChannel.appendLine(`[SchemaCache] Error clearing cache: ${message}`);
            }
        })
    );

    // Command: Show schema cache info
    context.subscriptions.push(
        vscode.commands.registerCommand('mssqlmanager.showSchemaCacheInfo', async () => {
            try {
                const activeConnection = connectionProvider.getActiveConnectionInfo();
                if (!activeConnection) {
                    vscode.window.showInformationMessage('No active database connection');
                    return;
                }

                const connection = connectionProvider.getConnection(activeConnection.id);
                if (!connection) {
                    vscode.window.showErrorMessage('Unable to get database connection');
                    return;
                }

                const schema = await schemaCache.getSchema(activeConnection, connection);

                const info = [
                    `Database: ${activeConnection.database || 'default'}`,
                    `Server: ${activeConnection.server}`,
                    `Tables: ${schema.tables.size}`,
                    `Views: ${schema.views.size}`,
                    `Procedures: ${schema.procedures.size}`,
                    `Functions: ${schema.functions.size}`,
                    `Last Updated: ${schema.lastUpdated.toLocaleString()}`,
                    `Hash Checksum: ${schema.hash.objectsChecksum}`,
                    `Object Counts: Tables=${schema.hash.objectCounts.tables}, Views=${schema.hash.objectCounts.views}, Procedures=${schema.hash.objectCounts.procedures}, Functions=${schema.hash.objectCounts.functions}`
                ].join('\n');

                vscode.window.showInformationMessage(info, { modal: true });
                outputChannel.appendLine(`[SchemaCache] Cache info:\n${info}`);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to get cache info: ${message}`);
                outputChannel.appendLine(`[SchemaCache] Error getting cache info: ${message}`);
            }
        })
    );
}
