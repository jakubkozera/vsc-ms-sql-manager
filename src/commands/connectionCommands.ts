import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { UnifiedTreeProvider, ConnectionNode, DatabaseNode, ServerConnectionNode } from '../unifiedTreeProvider';
import { ServerGroupWebview } from '../serverGroupWebview';
import { addFirewallRule, openAzurePortalFirewall, clearAllServerCache, showServerCacheInfo } from '../utils/azureFirewallHelper';
import { SchemaContextBuilder } from '../schemaContextBuilder';
import { DatabaseInstructionsManager } from '../databaseInstructions';
import { DeployDockerMssqlWebview } from '../deployDockerMssql';

export function registerConnectionCommands(
    context: vscode.ExtensionContext,
    connectionProvider: ConnectionProvider,
    unifiedTreeProvider: UnifiedTreeProvider,
    outputChannel: vscode.OutputChannel,
    treeView?: vscode.TreeView<any>,
    sqlEditorProvider?: any,
    schemaContextBuilder?: SchemaContextBuilder,
    databaseInstructionsManager?: DatabaseInstructionsManager
): vscode.Disposable[] {
    
    // Helper function to trigger background schema generation for chat context
    const triggerSchemaGeneration = async (connectionId: string, database?: string) => {
        if (!schemaContextBuilder) {
            outputChannel.appendLine(`[ConnectionCommands] Schema context builder NOT AVAILABLE!`);
            return;
        }
        
        try {
            outputChannel.appendLine(`[ConnectionCommands] ========================================`);
            outputChannel.appendLine(`[ConnectionCommands] STARTING SCHEMA GENERATION for ${connectionId}::${database || 'default'}`);
            outputChannel.appendLine(`[ConnectionCommands] ========================================`);
            await schemaContextBuilder.buildSchemaContext(connectionId, database);
            outputChannel.appendLine(`[ConnectionCommands] ========================================`);
            outputChannel.appendLine(`[ConnectionCommands] SCHEMA GENERATION COMPLETED for ${connectionId}::${database || 'default'}`);
            outputChannel.appendLine(`[ConnectionCommands] ========================================`);
        } catch (error) {
            outputChannel.appendLine(`[ConnectionCommands] !!!ERROR!!! Schema generation failed: ${error}`);
            outputChannel.appendLine(`[ConnectionCommands] Error stack: ${error instanceof Error ? error.stack : 'No stack'}`);
        }
    };
    
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
                // Clear any previous failure status for manual retry
                connectionProvider.clearConnectionFailure(connectionId);
                await connectionProvider.connectToSavedById(connectionId);
                unifiedTreeProvider.refresh();
                
                // Trigger background schema generation for chat context
                outputChannel.appendLine(`[ConnectionCommands] About to trigger schema generation for ${connectionId}...`);
                triggerSchemaGeneration(connectionId, connectionItem.database).catch(err => {
                    outputChannel.appendLine(`[ConnectionCommands] Catch block: Schema generation promise rejected: ${err}`);
                });
                
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
                if (complete.database && complete.database.trim() !== '') parts.push(`Database=${complete.database}`);
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

    const addConnectionToServerGroupCommand = vscode.commands.registerCommand('mssqlManager.addConnectionToServerGroup', async (serverGroupNode?: any) => {
        try {
            const serverGroupId = serverGroupNode?.group?.id;
            await connectionProvider.connect(serverGroupId);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to add connection: ${errorMessage}`);
            outputChannel.appendLine(`Add connection to server group failed: ${errorMessage}`);
        }
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

    const deleteServerGroupCommand = vscode.commands.registerCommand('mssqlManager.deleteServerGroup', async (serverGroupNode?: any) => {
        try {
            if (!serverGroupNode || !serverGroupNode.group) {
                vscode.window.showErrorMessage('Invalid server group item');
                return;
            }

            const group = serverGroupNode.group;
            const connectionCount = serverGroupNode.connectionCount || 0;

            // Show confirmation dialog
            const message = connectionCount > 0
                ? `Are you sure you want to delete the server group "${group.name}" and its ${connectionCount} connection(s)?`
                : `Are you sure you want to delete the server group "${group.name}"?`;

            const confirmed = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                'Delete'
            );

            if (confirmed !== 'Delete') {
                return;
            }

            // Delete the server group
            await connectionProvider.deleteServerGroup(group.id);
            vscode.window.showInformationMessage(`Server group "${group.name}" deleted successfully`);
            unifiedTreeProvider.refresh();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to delete server group: ${errorMessage}`);
            outputChannel.appendLine(`Delete server group failed: ${errorMessage}`);
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

    const newQueryCommand = vscode.commands.registerCommand('mssqlManager.newQuery', async (connectionItem?: any, initialQuery?: string, autoExecute: boolean = false) => {
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

            // Always set this connection as active (even if it was already active)
            // This ensures that the editor dropdown will show the correct connection
            connectionProvider.setActiveConnection(connectionId);

            // Set preferred connection for the next editor that opens
            // For ServerConnectionNode, we don't have a specific database, so just set the connection
            if (connectionItem.database) {
                // ConnectionNode - has specific database
                connectionProvider.setNextEditorPreferredDatabase(connectionId, connectionItem.database);
            } else {
                // ServerConnectionNode - set as preferred connection without specific database
                // This will still update the connection dropdown in the editor
                connectionProvider.setNextEditorPreferredDatabase(connectionId, 'master');
            }

            // Get extension storage path
            const storagePath = context.globalStorageUri.fsPath;
            const fs = await import('fs');
            const path = await import('path');

            // Ensure storage directory exists
            if (!fs.existsSync(storagePath)) {
                fs.mkdirSync(storagePath, { recursive: true });
            }

            // First, check if there's already an empty SQL file we can reuse
            let queryFilePath: string | null = null;
            let reusingFile = false;

            // Look for existing query files and check if any are empty
            const files = fs.readdirSync(storagePath);
            const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();
            
            for (const sqlFile of sqlFiles) {
                const filePath = path.join(storagePath, sqlFile);
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    if (content.trim().length === 0) {
                        // Found an empty file, reuse it
                        queryFilePath = filePath;
                        reusingFile = true;
                        outputChannel.appendLine(`[New Query] Reusing empty file: ${sqlFile}`);
                        break;
                    }
                } catch (error) {
                    // If we can't read the file, skip it
                    continue;
                }
            }

            // If no empty file found, create a new one
            if (!queryFilePath) {
                let queryNumber = 0;
                let queryFileName = 'query.sql';
                queryFilePath = path.join(storagePath, queryFileName);

                while (fs.existsSync(queryFilePath)) {
                    queryNumber++;
                    queryFileName = `query (${queryNumber}).sql`;
                    queryFilePath = path.join(storagePath, queryFileName);
                }

                // Create empty query content (or use initialQuery if provided)
                const initialContent = initialQuery || '';
                
                // Write the content to the file
                const uri = vscode.Uri.file(queryFilePath);
                await vscode.workspace.fs.writeFile(uri, Buffer.from(initialContent, 'utf8'));
                outputChannel.appendLine(`[New Query] Created new file: ${path.basename(queryFilePath)}`);
            } else {
                // If reusing file and initialQuery provided, write it
                if (initialQuery) {
                    const uri = vscode.Uri.file(queryFilePath);
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(initialQuery, 'utf8'));
                }
            }

            // Open the file with the custom SQL editor
            const uri = vscode.Uri.file(queryFilePath);
            await vscode.commands.executeCommand('vscode.openWith', uri, 'mssqlManager.sqlEditor');

            outputChannel.appendLine(`[New Query] Opened query file in SQL Editor`);

            // Force connection update for existing files (when reusing empty files)
            if (reusingFile && sqlEditorProvider) {
                // Add a small delay to ensure webview is fully loaded
                setTimeout(() => {
                    const databaseName = connectionItem.database || (connectionItem.database ? undefined : 'master');
                    sqlEditorProvider.forceConnectionUpdate(uri, connectionId, databaseName);
                    
                    // If initialQuery was provided and we're reusing a file, also insert the query
                    if (initialQuery) {
                        setTimeout(() => {
                            sqlEditorProvider.insertTextToEditor(uri, initialQuery);
                            
                            // Auto-execute if requested
                            if (autoExecute) {
                                setTimeout(() => {
                                    sqlEditorProvider.triggerAutoExecute(uri);
                                }, 100);
                            }
                        }, 100);
                    }
                }, 100);
            } else if (autoExecute && sqlEditorProvider) {
                // For new files with autoExecute, trigger execution after editor loads
                setTimeout(() => {
                    sqlEditorProvider.triggerAutoExecute(uri);
                }, 200);
            }

            return uri;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to create new query: ${errorMessage}`);
            outputChannel.appendLine(`New query failed: ${errorMessage}`);
            return null;
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

    const filterDatabasesCommand = vscode.commands.registerCommand('mssqlManager.filterDatabases', async (serverConnectionNode?: any) => {
        try {
            if (!serverConnectionNode || !serverConnectionNode.connectionId) {
                vscode.window.showErrorMessage('Invalid server connection item');
                return;
            }

            const connectionId = serverConnectionNode.connectionId;
            const connections = await connectionProvider.getSavedConnectionsList();
            const connection = connections.find(c => c.id === connectionId);

            if (!connection) {
                vscode.window.showErrorMessage('Connection not found');
                return;
            }

            // Use require to load the module
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { DatabaseFilterWebview } = require('../databaseFilterWebview');
            
            const existingFilter = connectionProvider.getDatabaseFilter(connectionId);
            const filterWebview = new DatabaseFilterWebview(
                context,
                async (filter: any) => {
                    await connectionProvider.setDatabaseFilter(connectionId, filter);
                    unifiedTreeProvider.refresh();
                },
                connection.server,
                existingFilter
            );

            await filterWebview.show();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to open database filter: ${errorMessage}`);
            outputChannel.appendLine(`Filter databases failed: ${errorMessage}`);
        }
    });

    const filterTablesCommand = vscode.commands.registerCommand('mssqlManager.filterTables', async (tablesNode?: any) => {
        try {
            if (!tablesNode || !tablesNode.connectionId || !tablesNode.database) {
                vscode.window.showErrorMessage('Invalid tables node');
                return;
            }

            const connectionId = tablesNode.connectionId;
            const database = tablesNode.database;
            const connections = await connectionProvider.getSavedConnectionsList();
            const connection = connections.find(c => c.id === connectionId);

            if (!connection) {
                vscode.window.showErrorMessage('Connection not found');
                return;
            }

            // Use require to load the module
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { TableFilterWebview } = require('../tableFilterWebview');
            
            const existingFilter = connectionProvider.getTableFilter(connectionId, database);
            const filterWebview = new TableFilterWebview(
                context,
                async (filter: any) => {
                    await connectionProvider.setTableFilter(connectionId, database, filter);
                    unifiedTreeProvider.refresh();
                },
                `${connection.server} - ${database}`,
                existingFilter
            );

            await filterWebview.show();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to open table filter: ${errorMessage}`);
            outputChannel.appendLine(`Filter tables failed: ${errorMessage}`);
        }
    });

    // Azure Firewall Commands
    const addAzureFirewallRuleCommand = vscode.commands.registerCommand('mssqlManager.addAzureFirewallRule', async (connectionItem?: any) => {
        try {
            if (!connectionItem || !connectionItem.connectionId) {
                vscode.window.showErrorMessage('Invalid connection item');
                return;
            }

            const connectionId = connectionItem.connectionId;
            const connections = await connectionProvider.getSavedConnectionsList();
            const connection = connections.find(c => c.id === connectionId);

            if (!connection) {
                vscode.window.showErrorMessage('Connection not found');
                return;
            }

            // Ask user for their public IP or try to detect it automatically
            const ipInput = await vscode.window.showInputBox({
                prompt: 'Enter your public IP address (leave empty to auto-detect)',
                placeHolder: 'e.g. 192.168.1.100 or leave empty for auto-detection'
            });

            if (ipInput === undefined) {
                return; // User cancelled
            }

            let clientIP = ipInput?.trim();
            
            // If no IP provided, try to get it from a recent Azure error or use a placeholder
            if (!clientIP) {
                // Try to detect IP automatically (simplified version)
                const choice = await vscode.window.showWarningMessage(
                    'Auto-detection of public IP is not implemented yet. Please enter your public IP manually.',
                    'Enter IP manually',
                    'Cancel'
                );
                
                if (choice === 'Enter IP manually') {
                    const manualIP = await vscode.window.showInputBox({
                        prompt: 'Enter your public IP address',
                        placeHolder: 'e.g. 192.168.1.100'
                    });
                    
                    if (!manualIP?.trim()) {
                        vscode.window.showErrorMessage('IP address is required');
                        return;
                    }
                    clientIP = manualIP.trim();
                } else {
                    return;
                }
            }

            outputChannel.appendLine(`[Azure Firewall] Adding firewall rule for ${connection.server} with IP ${clientIP}...`);
            const success = await addFirewallRule(connection.server, clientIP, connectionId);
            
            if (success) {
                vscode.window.showInformationMessage('Firewall rule added successfully! Connection will be attempted automatically.');
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to add Azure firewall rule: ${errorMessage}`);
            outputChannel.appendLine(`Add Azure firewall rule failed: ${errorMessage}`);
        }
    });

    const openAzurePortalCommand = vscode.commands.registerCommand('mssqlManager.openAzurePortal', async (connectionItem?: any) => {
        try {
            if (!connectionItem || !connectionItem.connectionId) {
                vscode.window.showErrorMessage('Invalid connection item');
                return;
            }

            const connectionId = connectionItem.connectionId;
            const connections = await connectionProvider.getSavedConnectionsList();
            const connection = connections.find(c => c.id === connectionId);

            if (!connection) {
                vscode.window.showErrorMessage('Connection not found');
                return;
            }

            outputChannel.appendLine(`[Azure Portal] Opening Azure Portal for ${connection.server}...`);
            openAzurePortalFirewall(connection.server);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to open Azure Portal: ${errorMessage}`);
            outputChannel.appendLine(`Open Azure Portal failed: ${errorMessage}`);
        }
    });

    const clearAzureServerCacheCommand = vscode.commands.registerCommand('mssqlManager.clearAzureServerCache', async () => {
        try {
            const confirmed = await vscode.window.showWarningMessage(
                'Are you sure you want to clear the Azure servers cache? This will require re-discovery of server locations on next firewall operations.',
                { modal: true },
                'Clear Cache'
            );
            
            if (confirmed === 'Clear Cache') {
                clearAllServerCache();
                outputChannel.appendLine('[Azure Cache] Azure servers cache cleared');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to clear cache: ${errorMessage}`);
            outputChannel.appendLine(`Clear Azure cache failed: ${errorMessage}`);
        }
    });

    const showAzureServerCacheCommand = vscode.commands.registerCommand('mssqlManager.showAzureServerCache', async () => {
        try {
            showServerCacheInfo();
            outputChannel.appendLine('[Azure Cache] Showed Azure servers cache info');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to show cache info: ${errorMessage}`);
            outputChannel.appendLine(`Show Azure cache info failed: ${errorMessage}`);
        }
    });

    const discoverAzureServersCommand = vscode.commands.registerCommand('mssqlManager.discoverAzureServers', async () => {
        try {
            const choice = await vscode.window.showInformationMessage(
                'This will discover Azure SQL servers across all your subscriptions and add them to the Azure group. Continue?',
                { modal: true },
                'Discover Servers'
            );
            
            if (choice === 'Discover Servers') {
                outputChannel.appendLine('[Azure Discovery] Manual Azure discovery initiated');
                
                // Reset the discovery flag to allow re-running
                const context = (connectionProvider as any).context;
                await context.globalState.update('mssqlManager.azureDiscoveryDone', false);
                
                // Run discovery
                await connectionProvider.discoverAzureServersOnce();
                
                vscode.window.showInformationMessage('Azure SQL server discovery completed. Check the Azure group in the explorer.');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to discover Azure servers: ${errorMessage}`);
            outputChannel.appendLine(`Azure discovery failed: ${errorMessage}`);
        }
    });

    const discoverDockerContainersCommand = vscode.commands.registerCommand('mssqlManager.discoverDockerContainers', async () => {
        try {
            const choice = await vscode.window.showInformationMessage(
                'This will discover running Docker SQL Server containers and add them to the Docker group. Continue?',
                { modal: true },
                'Discover Containers'
            );
            
            if (choice === 'Discover Containers') {
                outputChannel.appendLine('[Docker Discovery] Manual Docker discovery initiated');
                
                // Reset the discovery flag to allow re-running
                await connectionProvider.resetDockerDiscoveryFlag();
                
                // Run discovery
                await connectionProvider.discoverDockerServersOnce();
                
                // Refresh tree
                unifiedTreeProvider.refresh();
                
                // Get discovered containers count
                const allConnections = await connectionProvider.getSavedConnectionsList();
                const dockerConnections = allConnections.filter(c => c.id.startsWith('docker-'));
                const message = dockerConnections.length > 0 
                    ? `Docker discovery completed. Found ${dockerConnections.length} SQL Server container(s).`
                    : 'Docker discovery completed. No SQL Server containers found.';
                
                vscode.window.showInformationMessage(message);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to discover Docker containers: ${errorMessage}`);
            outputChannel.appendLine(`Docker discovery failed: ${errorMessage}`);
        }
    });

    const discoverLocalServersCommand = vscode.commands.registerCommand('mssqlManager.discoverLocalServers', async () => {
        try {
            // Check if running on Windows
            if (process.platform !== 'win32') {
                vscode.window.showWarningMessage('Local SQL Server discovery is only available on Windows.');
                return;
            }

            const choice = await vscode.window.showInformationMessage(
                'This will discover local SQL Server instances (LocalDB, SQL Express, localhost) and add them to the Local group. Continue?',
                { modal: true },
                'Discover Servers'
            );
            
            if (choice === 'Discover Servers') {
                outputChannel.appendLine('[Local Discovery] Manual local discovery initiated');
                
                // Reset the discovery flag to allow re-running
                const context = (connectionProvider as any).context;
                await context.globalState.update('mssqlManager.localDiscoveryDone', false);
                
                // Run discovery
                await connectionProvider.discoverLocalServersOnce();
                
                // Refresh tree
                unifiedTreeProvider.refresh();
                
                vscode.window.showInformationMessage('Local SQL Server discovery completed. Check the Local group in the explorer.');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to discover local SQL servers: ${errorMessage}`);
            outputChannel.appendLine(`Local discovery failed: ${errorMessage}`);
        }
    });

    const collapseAllCommand = vscode.commands.registerCommand('mssqlManager.collapseAll', async () => {
        try {
            await vscode.commands.executeCommand('workbench.actions.treeView.mssqlManager.explorer.collapseAll');
            
            outputChannel.appendLine('[Explorer] Collapsed all tree items');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            outputChannel.appendLine(`[Explorer] Error collapsing tree: ${errorMessage}`);
            // Fallback to manual refresh if built-in command fails
            unifiedTreeProvider.refresh();
        }
    });

    const deployDockerMssqlCommand = vscode.commands.registerCommand('mssqlManager.deployDockerMssql', async () => {
        try {
            const deployWebview = new DeployDockerMssqlWebview(connectionProvider, outputChannel, context);
            await deployWebview.show();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to open Deploy MS SQL webview: ${errorMessage}`);
            outputChannel.appendLine(`Deploy Docker MSSQL failed: ${errorMessage}`);
        }
    });

    // Database Instructions Commands
    const addDatabaseInstructionsCommand = vscode.commands.registerCommand('mssqlManager.addDatabaseInstructions', async (node?: any) => {
        try {
            if (!databaseInstructionsManager) {
                vscode.window.showErrorMessage('Database instructions manager not available');
                return;
            }

            let connectionId: string | undefined;
            let database: string | undefined;

            if (node instanceof DatabaseNode) {
                // DatabaseNode is a child of ServerConnectionNode - we need both connectionId and database name
                connectionId = node.connectionId;
                database = node.database;
            } else if (node instanceof ConnectionNode) {
                // ConnectionNode represents a database connection - connectionId already includes the database
                connectionId = node.connectionId;
                database = undefined;  // Don't pass database for database-type connections
            } else if (node instanceof ServerConnectionNode) {
                // ServerConnectionNode represents a server - no specific database
                connectionId = node.connectionId;
                database = undefined;
            }

            if (!connectionId) {
                vscode.window.showErrorMessage('Please select a database or connection');
                return;
            }

            await databaseInstructionsManager.showAddInstructionsDialog(connectionId, database);
            unifiedTreeProvider.refresh();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to add instructions: ${errorMessage}`);
            outputChannel.appendLine(`Add instructions failed: ${errorMessage}`);
        }
    });

    const unlinkDatabaseInstructionsCommand = vscode.commands.registerCommand('mssqlManager.unlinkDatabaseInstructions', async (node?: any) => {
        try {
            if (!databaseInstructionsManager) {
                vscode.window.showErrorMessage('Database instructions manager not available');
                return;
            }

            let connectionId: string | undefined;
            let database: string | undefined;

            if (node instanceof DatabaseNode) {
                // DatabaseNode is a child of ServerConnectionNode - we need both connectionId and database name
                connectionId = node.connectionId;
                database = node.database;
            } else if (node instanceof ConnectionNode) {
                // ConnectionNode represents a database connection - connectionId already includes the database
                connectionId = node.connectionId;
                database = undefined;  // Don't pass database for database-type connections
            } else if (node instanceof ServerConnectionNode) {
                // ServerConnectionNode represents a server - no specific database
                connectionId = node.connectionId;
                database = undefined;
            }

            if (!connectionId) {
                vscode.window.showErrorMessage('Please select a database or connection');
                return;
            }

            await databaseInstructionsManager.showUnlinkInstructionsDialog(connectionId, database);
            unifiedTreeProvider.refresh();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to unlink instructions: ${errorMessage}`);
            outputChannel.appendLine(`Unlink instructions failed: ${errorMessage}`);
        }
    });

    const editDatabaseInstructionsCommand = vscode.commands.registerCommand(
        'mssqlManager.editDatabaseInstructions',
        async (node?: any) => {
            try {
                if (!node) {
                    vscode.window.showErrorMessage('Please select a database or connection from the tree view');
                    return;
                }

                let connectionId: string | undefined;
                let database: string | undefined;

                if (node instanceof DatabaseNode) {
                    // DatabaseNode is a child of ServerConnectionNode - we need both connectionId and database name
                    connectionId = node.connectionId;
                    database = node.database;
                } else if (node instanceof ConnectionNode) {
                    // ConnectionNode represents a database connection - connectionId already includes the database
                    connectionId = node.connectionId;
                    database = undefined;  // Don't pass database for database-type connections
                } else if (node instanceof ServerConnectionNode) {
                    // ServerConnectionNode represents a server - no specific database
                    connectionId = node.connectionId;
                    database = undefined;
                }

                if (!connectionId) {
                    vscode.window.showErrorMessage('Please select a database or connection');
                    return;
                }

                if (!databaseInstructionsManager) {
                    vscode.window.showErrorMessage('Database instructions manager not initialized');
                    return;
                }

                // Get the instructions file path and open it
                const instructionsFilePath = await databaseInstructionsManager.getInstructionsFilePath(connectionId, database);
                
                if (!instructionsFilePath) {
                    vscode.window.showWarningMessage('No instructions file linked to this database');
                    return;
                }

                // Open the file in editor
                const doc = await vscode.workspace.openTextDocument(instructionsFilePath);
                await vscode.window.showTextDocument(doc);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                vscode.window.showErrorMessage(`Failed to open instructions: ${errorMessage}`);
                outputChannel.appendLine(`Edit instructions failed: ${errorMessage}`);
            }
        }
    );

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
        addConnectionToServerGroupCommand,
        editServerGroupCommand,
        deleteServerGroupCommand,
        debugConnectionsCommand,
        newQueryCommand,
        revealInExplorerCommand,
        filterDatabasesCommand,
        filterTablesCommand,
        addAzureFirewallRuleCommand,
        openAzurePortalCommand,
        clearAzureServerCacheCommand,
        showAzureServerCacheCommand,
        discoverAzureServersCommand,
        discoverDockerContainersCommand,
        discoverLocalServersCommand,
        collapseAllCommand,
        deployDockerMssqlCommand,
        addDatabaseInstructionsCommand,
        unlinkDatabaseInstructionsCommand,
        editDatabaseInstructionsCommand
    ];
}
