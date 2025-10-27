import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { UnifiedTreeProvider, ConnectionNode } from '../unifiedTreeProvider';
import { ServerGroupWebview } from '../serverGroupWebview';

export function registerConnectionCommands(
    context: vscode.ExtensionContext,
    connectionProvider: ConnectionProvider,
    unifiedTreeProvider: UnifiedTreeProvider,
    outputChannel: vscode.OutputChannel,
    treeView?: vscode.TreeView<any>
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
                const connectionId = connectionItem.connectionId;
                await connectionProvider.connectToSavedById(connectionId);
                unifiedTreeProvider.refresh();
                
                // Expand the tree node after connection
                if (treeView) {
                    // Wait a bit for the refresh to complete
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Find the refreshed node by walking the tree
                    const refreshedNode = await findConnectionNode(treeView, unifiedTreeProvider, connectionId);
                    if (refreshedNode) {
                        // Reveal and expand the connection node
                        await treeView.reveal(refreshedNode, { select: true, focus: false, expand: true });
                    }
                }
            } else {
                vscode.window.showErrorMessage('Invalid connection item');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to connect: ${errorMessage}`);
            outputChannel.appendLine(`Connect to saved failed: ${errorMessage}`);
        }
    });
    
    // Helper function to find a connection node in the tree
    async function findConnectionNode(
        treeView: vscode.TreeView<any>,
        provider: UnifiedTreeProvider,
        connectionId: string
    ): Promise<any> {
        // Get root nodes
        const rootNodes = await provider.getChildren();
        
        // Search through root nodes and their children
        for (const node of rootNodes) {
            // Check if this is the connection node we're looking for
            if (node instanceof ConnectionNode && node.connectionId === connectionId) {
                return node;
            }
            
            // If it's a server group, check its children
            if (node.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                const children = await provider.getChildren(node);
                for (const child of children) {
                    if (child instanceof ConnectionNode && child.connectionId === connectionId) {
                        return child;
                    }
                }
            }
        }
        
        return null;
    }

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
                const connectionId = connectionItem.connectionId;
                await connectionProvider.disconnect(connectionId);
                
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

    const newQueryCommand = vscode.commands.registerCommand('mssqlManager.newQuery', async (connectionItem?: any) => {
        try {
            if (!connectionItem || !connectionItem.connectionId) {
                vscode.window.showErrorMessage('Invalid connection item');
                return;
            }

            const connectionId = connectionItem.connectionId;
            const isActive = connectionProvider.isConnectionActive(connectionId);

            // Connect if not active
            if (!isActive) {
                outputChannel.appendLine(`[New Query] Connecting to ${connectionId}...`);
                await connectionProvider.connectToSavedById(connectionId);
                unifiedTreeProvider.refresh();
            }

            // Get extension storage path
            const storagePath = context.globalStorageUri.fsPath;
            const fs = await import('fs');
            const path = await import('path');

            // Ensure storage directory exists
            if (!fs.existsSync(storagePath)) {
                fs.mkdirSync(storagePath, { recursive: true });
            }

            // Find next available query filename
            let queryNumber = 0;
            let queryFileName = 'query.sql';
            let queryFilePath = path.join(storagePath, queryFileName);

            while (fs.existsSync(queryFilePath)) {
                queryNumber++;
                queryFileName = `query (${queryNumber}).sql`;
                queryFilePath = path.join(storagePath, queryFileName);
            }

            // Create empty query content
            const initialContent = '';
            
            // Write the content to the file
            const uri = vscode.Uri.file(queryFilePath);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(initialContent, 'utf8'));

            outputChannel.appendLine(`[New Query] Created file: ${queryFilePath}`);

            // Open the file with the custom SQL editor
            await vscode.commands.executeCommand('vscode.openWith', uri, 'mssqlManager.sqlEditor');

            outputChannel.appendLine(`[New Query] Opened query file in SQL Editor`);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to create new query: ${errorMessage}`);
            outputChannel.appendLine(`New query failed: ${errorMessage}`);
        }
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
        debugConnectionsCommand,
        newQueryCommand
    ];
}
