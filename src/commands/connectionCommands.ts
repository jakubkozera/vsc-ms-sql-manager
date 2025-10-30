import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { UnifiedTreeProvider, ConnectionNode, DatabaseNode, ServerConnectionNode } from '../unifiedTreeProvider';
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

    const copyConnectionStringCommand = vscode.commands.registerCommand('mssqlManager.copyConnectionString', async (connectionItem?: any) => {
        try {
            if (!connectionItem || !connectionItem.connectionId) {
                vscode.window.showErrorMessage('Invalid connection item');
                return;
            }

            const connectionId = connectionItem.connectionId as string;

            // Try to get active config first, otherwise load saved and fetch secrets
            let cfg = connectionProvider.getConnectionConfig(connectionId) || null;
            if (!cfg) {
                const saved = await connectionProvider.getSavedConnectionsList();
                cfg = saved.find(c => c.id === connectionId) || null;
            }

            if (!cfg) {
                vscode.window.showErrorMessage('Connection configuration not found');
                return;
            }

            const complete = await connectionProvider.getCompleteConnectionConfig(cfg);

            // If invoked for a specific Database node under a server connection, prefer that database
            if (connectionItem && connectionItem.database) {
                complete.database = connectionItem.database;
            }

            // Prefer explicit connectionString if provided
            let connStr: string | null = null;
            if (complete.useConnectionString && complete.connectionString) {
                connStr = complete.connectionString;
            } else {
                // Synthesize an ADO-style connection string and include credentials (user requested)
                const parts: string[] = [];
                if (complete.server) parts.push(`Server=${complete.server}`);
                if (complete.database) parts.push(`Database=${complete.database}`);
                if (complete.authType === 'sql') {
                    if (complete.username) parts.push(`User Id=${complete.username}`);
                    if (complete.password) parts.push(`Password=${complete.password}`);
                } else if (complete.authType === 'windows') {
                    // Use a generic trusted connection flag
                    parts.push('Trusted_Connection=Yes');
                }
                // include common options
                if (typeof complete.encrypt === 'boolean') parts.push(`Encrypt=${complete.encrypt}`);
                if (typeof complete.trustServerCertificate === 'boolean') parts.push(`TrustServerCertificate=${complete.trustServerCertificate}`);
                if (complete.port) parts.push(`Port=${complete.port}`);

                connStr = parts.join(';') + (parts.length ? ';' : '');
            }

            if (!connStr) {
                vscode.window.showErrorMessage('Could not build connection string');
                return;
            }

            await vscode.env.clipboard.writeText(connStr);
            vscode.window.showInformationMessage('Connection string copied to clipboard (includes credentials)');
            outputChannel.appendLine(`[ConnectionCommands] Copied connection string for ${cfg.name || connectionId}`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to copy connection string: ${msg}`);
            outputChannel.appendLine(`Copy connection string failed: ${msg}`);
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

    // Reveal an object (table/column) in the explorer tree
    const revealInExplorerCommand = vscode.commands.registerCommand('mssqlManager.revealInExplorer', async (payload: any) => {
        try {
            if (!payload || !payload.connectionId) {
                vscode.window.showErrorMessage('No connection specified for reveal');
                return;
            }

            const connectionId: string = payload.connectionId;
            const schemaName: string | undefined = payload.schema;
            const tableName: string | undefined = payload.table;
            const columnName: string | undefined = payload.column;

            // Ensure connection is active
            if (!connectionProvider.isConnectionActive(connectionId)) {
                await connectionProvider.connectToSavedById(connectionId);
                unifiedTreeProvider.refresh();
                // wait briefly for tree to refresh
                await new Promise(resolve => setTimeout(resolve, 250));
            }

            if (!treeView) {
                vscode.window.showInformationMessage('Explorer view not available');
                return;
            }

            // Walk tree to find DatabaseNode / ConnectionNode and then expand to Tables -> table
            const rootNodes = await unifiedTreeProvider.getChildren();

            // Find the connection node (either ConnectionNode or ServerConnectionNode)
            let targetConnNode: any = null;
            const walkFindConnection = async () => {
                for (const n of rootNodes) {
                    // Narrow to known node types before accessing connectionId
                    if (n instanceof ConnectionNode || n instanceof ServerConnectionNode) {
                        if (n.connectionId === connectionId) {
                            targetConnNode = n;
                            return;
                        }
                    }

                    if (n.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                        const children = await unifiedTreeProvider.getChildren(n);
                        for (const c of children) {
                            if (c instanceof ConnectionNode || c instanceof ServerConnectionNode) {
                                if (c.connectionId === connectionId) {
                                    targetConnNode = c;
                                    return;
                                }
                            }
                        }
                    }
                }
            };

            await walkFindConnection();

            if (!targetConnNode) {
                vscode.window.showWarningMessage('Could not find connection node in explorer');
                return;
            }

            // Reveal the connection node first
            await treeView.reveal(targetConnNode, { select: true, focus: true, expand: true });

            // If table specified, expand schema/Tables -> find table node
            if (tableName) {
                // Find schema/Tables node under the connection
                const level1 = await unifiedTreeProvider.getChildren(targetConnNode);
                // Look for DatabaseNode or SchemaItemNode (Tables)
                let dbNode: any = null;
                for (const l1 of level1) {
                    if (l1 instanceof DatabaseNode && payload.database && l1.database === payload.database) {
                        dbNode = l1;
                        break;
                    }
                    // If this node is ConnectionNode with same database, use it
                    if (l1 instanceof ConnectionNode && l1.connectionId === connectionId) {
                        dbNode = l1;
                        break;
                    }
                }

                const parentForTables = dbNode || targetConnNode;
                const tablesSection = (await unifiedTreeProvider.getChildren(parentForTables)).find((n: any) => n.itemType === 'tables' || n.label && n.label.toLowerCase().startsWith('tables'));
                if (tablesSection) {
                    await treeView.reveal(tablesSection, { select: false, focus: false, expand: true });
                    // Wait a moment then search for the specific table node
                    await new Promise(resolve => setTimeout(resolve, 150));
                    const tables = await unifiedTreeProvider.getChildren(tablesSection);
                    const matched = tables.find((t: any) => {
                        const lbl = (t.label || '').toString();
                        // Label format might be schema.table
                        if (schemaName) {
                            return lbl.toLowerCase() === (schemaName + '.' + tableName).toLowerCase();
                        }
                        return lbl.toLowerCase().endsWith('.' + tableName.toLowerCase()) || lbl.toLowerCase() === tableName.toLowerCase();
                    });

                    if (matched) {
                        await treeView.reveal(matched, { select: true, focus: true, expand: true });

                        // If column specified, expand Columns and reveal column node
                        if (columnName) {
                            const childNodes = await unifiedTreeProvider.getChildren(matched);
                            const colsNode = childNodes.find((c: any) => c.itemType === 'columns');
                            if (colsNode) {
                                await treeView.reveal(colsNode, { select: false, focus: false, expand: true });
                                await new Promise(resolve => setTimeout(resolve, 100));
                                const colChildren = await unifiedTreeProvider.getChildren(colsNode);
                                const columnNode = colChildren.find((cn: any) => (cn.label || '').toLowerCase() === columnName.toLowerCase());
                                if (columnNode) {
                                    await treeView.reveal(columnNode, { select: true, focus: true, expand: false });
                                }
                            }
                        }
                        return;
                    }
                }
            }
        } catch (error) {
            console.error('[revealInExplorer] Error:', error);
            vscode.window.showErrorMessage(`Failed to reveal object: ${error instanceof Error ? error.message : error}`);
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
        copyConnectionStringCommand,
        createServerGroupCommand,
        editServerGroupCommand,
        debugConnectionsCommand,
        newQueryCommand
        , revealInExplorerCommand
    ];
}
