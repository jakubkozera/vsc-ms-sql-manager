import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { UnifiedTreeProvider } from '../unifiedTreeProvider';
import { ServerGroupWebview } from '../serverGroupWebview';

export function registerConnectionCommands(
    context: vscode.ExtensionContext,
    connectionProvider: ConnectionProvider,
    unifiedTreeProvider: UnifiedTreeProvider,
    outputChannel: vscode.OutputChannel
): vscode.Disposable[] {
    const connectCommand = vscode.commands.registerCommand('mssqlManager.connect', async () => {
        await connectionProvider.connect();
    });

    const disconnectCommand = vscode.commands.registerCommand('mssqlManager.disconnect', async () => {
        await connectionProvider.disconnect();
        unifiedTreeProvider.refresh();
    });

    const manageConnectionsCommand = vscode.commands.registerCommand('mssqlManager.manageConnections', async () => {
        await connectionProvider.manageConnections();
    });

    const connectToSavedCommand = vscode.commands.registerCommand('mssqlManager.connectToSaved', async (connectionItem?: any) => {
        try {
            if (connectionItem && connectionItem.connectionId) {
                await connectionProvider.connectToSavedById(connectionItem.connectionId);
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

    const debugConnectionsCommand = vscode.commands.registerCommand('mssqlManager.debugConnections', async () => {
        const connections = context.globalState.get<any[]>('mssqlManager.connections', []);
        outputChannel.appendLine(`[DEBUG] Found ${connections.length} saved connections:`);
        connections.forEach((conn, index) => {
            outputChannel.appendLine(`[DEBUG] ${index + 1}. ${conn.name} - ${conn.server}/${conn.database}`);
        });
        vscode.window.showInformationMessage(`Found ${connections.length} saved connections. Check output channel for details.`);
    });

    return [
        connectCommand,
        disconnectCommand,
        manageConnectionsCommand,
        connectToSavedCommand,
        editConnectionCommand,
        deleteConnectionCommand,
        disconnectConnectionCommand,
        createServerGroupCommand,
        editServerGroupCommand,
        debugConnectionsCommand
    ];
}
