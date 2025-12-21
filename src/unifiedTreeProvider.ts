import * as vscode from 'vscode';
import * as sql from 'mssql';
import { ConnectionProvider, ConnectionConfig, ServerGroup } from './connectionProvider';
import { createServerGroupIcon, createTableIcon, createColumnIcon, createStoredProcedureIcon, createViewIcon, createLoadingSpinnerIcon, createDatabaseIcon, createFunctionIcon, createTriggerIcon, createTypeIcon, createSequenceIcon, createSynonymIcon, createAssemblyIcon } from './serverGroupIcon';
import { SchemaCache } from './utils/schemaCache';

export class UnifiedTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.FileDecorationProvider, vscode.TreeDragAndDropController<TreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[]> = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
    readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[]> = this._onDidChangeFileDecorations.event;

    // Drag and drop support
    readonly dropMimeTypes = ['application/vnd.code.tree.mssqlmanagerexplorer'];
    readonly dragMimeTypes = ['application/vnd.code.tree.mssqlmanagerexplorer'];
    private databaseInstructionsManager?: any; // DatabaseInstructionsManager
    private schemaCache?: SchemaCache;

    constructor(
        private connectionProvider: ConnectionProvider,
        private outputChannel: vscode.OutputChannel,
        private context?: vscode.ExtensionContext
    ) {
        if (context) {
            this.schemaCache = SchemaCache.getInstance(context);
        }
    }

    setDatabaseInstructionsManager(manager: any): void {
        this.databaseInstructionsManager = manager;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
        this._onDidChangeFileDecorations.fire(undefined as any);
    }

    refreshNode(node?: TreeNode): void {
        this._onDidChangeTreeData.fire(node);
    }

    // Drag and drop implementation
    public async handleDrag(source: TreeNode[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        // Allow dragging ConnectionNode and ServerConnectionNode items
        const connectionNodes = source.filter(node => (node instanceof ConnectionNode) || (node instanceof ServerConnectionNode)) as Array<ConnectionNode | ServerConnectionNode>;
        if (connectionNodes.length === 0) {
            return;
        }

        // Store connection IDs in data transfer
        const connectionIds = connectionNodes.map(node => node.connectionId);
        dataTransfer.set(
            'application/vnd.code.tree.mssqlmanagerexplorer',
            new vscode.DataTransferItem(connectionIds)
        );
    }

    public async handleDrop(target: TreeNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        // Get dragged connection IDs
        const transferItem = dataTransfer.get('application/vnd.code.tree.mssqlmanagerexplorer');
        if (!transferItem) {
            return;
        }

        const connectionIds = transferItem.value as string[];
        if (!connectionIds || connectionIds.length === 0) {
            return;
        }

        try {
            // Single DB pool variable reused across branches when needed
            let dbPoolForElement: any;
            // Determine target server group ID
            let targetServerGroupId: string | undefined;

            if (target instanceof ServerGroupNode) {
                // Dropped on a server group - assign to that group
                targetServerGroupId = target.group.id;
            } else if (target instanceof ConnectionNode || target instanceof ServerConnectionNode) {
                // Dropped on a connection - get its parent group
                const connections = await this.connectionProvider.getSavedConnectionsList();
                const targetConnection = connections.find(c => c.id === target.connectionId);
                targetServerGroupId = targetConnection?.serverGroupId;
            } else {
                // Dropped on root level - unassign from group
                targetServerGroupId = undefined;
            }

            // Move each connection to target group
            for (const connectionId of connectionIds) {
                await this.connectionProvider.moveConnectionToGroup(connectionId, targetServerGroupId);
            }

            // Refresh tree
            this.refresh();

            vscode.window.showInformationMessage(
                `Moved ${connectionIds.length} connection(s) ${targetServerGroupId ? 'to group' : 'to root level'}`
            );
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error during drop: ${error}`);
            vscode.window.showErrorMessage(`Failed to move connection: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        // Update contextValue for database and connection nodes based on linked instructions
        if (this.databaseInstructionsManager) {
            if (element instanceof DatabaseNode && element.database) {
                const hasInstructions = this.databaseInstructionsManager.hasInstructions(element.connectionId, element.database);
                element.contextValue = hasInstructions ? 'databaseWithInstructions' : 'database';
            } else if (element instanceof ConnectionNode) {
                const hasInstructions = this.databaseInstructionsManager.hasInstructions(element.connectionId);
                
                // Determine base context while preserving failed state
                let baseContext: string;
                if (element.contextValue === 'connectionFailed') {
                    baseContext = 'connectionFailed';
                } else {
                    baseContext = element.isActive ? 'connectionActive' : 'connectionInactive';
                }
                
                element.contextValue = hasInstructions ? `${baseContext}WithInstructions` : baseContext;
            } else if (element instanceof ServerConnectionNode) {
                const hasInstructions = this.databaseInstructionsManager.hasInstructions(element.connectionId);
                
                // Determine base context while preserving failed state
                let baseContext: string;
                if (element.contextValue === 'serverConnectionFailed') {
                    baseContext = 'serverConnectionFailed';
                } else {
                    baseContext = element.isActive ? 'serverConnectionActive' : 'serverConnectionInactive';
                }
                
                element.contextValue = hasInstructions ? `${baseContext}WithInstructions` : baseContext;
            }
        }
        return element;
    }

    async getParent(element: TreeNode): Promise<TreeNode | undefined> {
        // Root level nodes (ServerGroupNode and ungrouped ConnectionNode) have no parent
        if (element instanceof ServerGroupNode) {
            return undefined;
        }
        
        // ConnectionNode and ServerConnectionNode might be inside a ServerGroupNode or at root level
        if (element instanceof ConnectionNode || element instanceof ServerConnectionNode) {
            // Check if this connection belongs to a server group
            const connections = await this.connectionProvider.getSavedConnectionsList();
            const connection = connections.find(c => c.id === element.connectionId);
            
            if (connection?.serverGroupId) {
                // Find the server group
                const serverGroups = this.connectionProvider.getServerGroups();
                const serverGroup = serverGroups.find(g => g.id === connection.serverGroupId);
                
                if (serverGroup) {
                    const groupConnections = connections.filter(conn => conn.serverGroupId === serverGroup.id);
                    return new ServerGroupNode(serverGroup, groupConnections.length, this.connectionProvider);
                }
            }
            
            // Ungrouped connection has no parent
            return undefined;
        }
        
        // DatabaseNode, SecurityNode, and LoginNode have ServerConnectionNode as parent
        if (element instanceof DatabaseNode || element instanceof SecurityNode || element instanceof LoginNode) {
            if (element.connectionId) {
                const connections = await this.connectionProvider.getSavedConnectionsList();
                const connection = connections.find(c => c.id === element.connectionId);
                
                if (connection && connection.connectionType === 'server') {
                    return new ServerConnectionNode(
                        connection.name,
                        connection.server,
                        connection.id,
                        connection.authType || 'sql',
                        this.connectionProvider.isConnectionActive(connection.id),
                        this.connectionProvider.isConnectionPending(connection.id),
                        this.connectionProvider.hasDatabaseFilter(connection.id),
                        this.connectionProvider.isConnectionFailed(connection.id)
                    );
                }
            }
        }
        
        // SchemaItemNode has a ConnectionNode or DatabaseNode as parent
        if (element instanceof SchemaItemNode) {
            if (element.connectionId) {
                const connections = await this.connectionProvider.getSavedConnectionsList();
                const connection = connections.find(c => c.id === element.connectionId);
                
                if (connection) {
                    if (connection.connectionType === 'server' && element.database) {
                        // Parent is a DatabaseNode
                        return new DatabaseNode(
                            element.database,
                            element.connectionId,
                            vscode.TreeItemCollapsibleState.Collapsed
                        );
                    } else if (connection.connectionType === 'database') {
                        // Parent is a ConnectionNode
                        return new ConnectionNode(
                            connection.name,
                            connection.server,
                            connection.database,
                            connection.id,
                            connection.authType || 'sql',
                            this.connectionProvider.isConnectionActive(connection.id),
                            this.connectionProvider.isConnectionPending(connection.id),
                            this.connectionProvider.isConnectionFailed(connection.id)
                        );
                    } else if (connection.connectionType === 'server' && element.schema === 'security') {
                        // Parent is a SecurityNode for security-related items
                        return new SecurityNode(
                            'Security',
                            element.connectionId,
                            vscode.TreeItemCollapsibleState.Collapsed
                        );
                    }
                }
            }
        }
        
        return undefined;
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme === 'mssql-connection' && uri.fragment === 'active') {
            return new vscode.FileDecoration(
                "",
                "Active",
                new vscode.ThemeColor("charts.green")
            );
        }
        return undefined;
    }

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        console.log(`[DEBUG] getChildren called with element:`, element ? {type: element.constructor.name, label: element.label} : 'root');
        this.outputChannel.appendLine(`[UnifiedTreeProvider] getChildren called with element: ${element ? `${element.constructor.name}(${element.label})` : 'root'}`);
        
        if (!element) {
            // Root level - show server groups and ungrouped connections
            try {
                const serverGroups = this.connectionProvider.getServerGroups();
                const connections = await this.connectionProvider.getSavedConnectionsList();
                
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${serverGroups.length} server groups and ${connections.length} connections`);
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Server groups: ${JSON.stringify(serverGroups.map(g => ({id: g.id, name: g.name})))}`);
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Connections: ${JSON.stringify(connections.map(c => ({id: c.id, name: c.name, serverGroupId: c.serverGroupId})))}`);
                
                const nodes: TreeNode[] = [];
                
                // Add server groups
                for (const group of serverGroups) {
                    const groupConnections = connections.filter(conn => conn.serverGroupId === group.id);
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Group ${group.name} has ${groupConnections.length} connections: ${JSON.stringify(groupConnections.map(c => c.name))}`);
                    nodes.push(new ServerGroupNode(group, groupConnections.length, this.connectionProvider));
                }
                
                // Add ungrouped connections
                const ungroupedConnections = connections.filter(conn => !conn.serverGroupId);
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${ungroupedConnections.length} ungrouped connections: ${JSON.stringify(ungroupedConnections.map(c => c.name))}`);
                for (const conn of ungroupedConnections) {
                    if (conn.connectionType === 'server') {
                        nodes.push(new ServerConnectionNode(
                            conn.name,
                            conn.server,
                            conn.id,
                            conn.authType || 'sql',
                            this.connectionProvider.isConnectionActive(conn.id),
                            this.connectionProvider.isConnectionPending(conn.id),
                            this.connectionProvider.hasDatabaseFilter(conn.id),
                            this.connectionProvider.isConnectionFailed(conn.id)
                        ));
                    } else {
                        nodes.push(new ConnectionNode(
                            conn.name,
                            conn.server,
                            conn.database,
                            conn.id,
                            conn.authType || 'sql',
                            this.connectionProvider.isConnectionActive(conn.id),
                            this.connectionProvider.isConnectionPending(conn.id),
                            this.connectionProvider.isConnectionFailed(conn.id)
                        ));
                    }
                }
                
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Returning ${nodes.length} root nodes`);
                return nodes;
            } catch (error) {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading root nodes: ${error}`);
                return [];
            }
        } else if (element instanceof ServerGroupNode) {
            // Show connections in this server group
            try {
                const connections = await this.connectionProvider.getSavedConnectionsList();
                const groupConnections = connections.filter(conn => conn.serverGroupId === element.group.id);
                
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading connections for group ${element.group.name}: found ${groupConnections.length} connections`);
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Group connections: ${JSON.stringify(groupConnections.map(c => ({name: c.name, serverGroupId: c.serverGroupId})))}`);
                
                return groupConnections.map(conn => {
                    if (conn.connectionType === 'server') {
                        return new ServerConnectionNode(
                            conn.name,
                            conn.server,
                            conn.id,
                            conn.authType || 'sql',
                            this.connectionProvider.isConnectionActive(conn.id),
                            this.connectionProvider.isConnectionPending(conn.id),
                            this.connectionProvider.hasDatabaseFilter(conn.id),
                            this.connectionProvider.isConnectionFailed(conn.id)
                        );
                    } else {
                        return new ConnectionNode(
                            conn.name,
                            conn.server,
                            conn.database,
                            conn.id,
                            conn.authType || 'sql',
                            this.connectionProvider.isConnectionActive(conn.id),
                            this.connectionProvider.isConnectionPending(conn.id),
                            this.connectionProvider.isConnectionFailed(conn.id)
                        );
                    }
                });
            } catch (error) {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading group connections: ${error}`);
                return [];
            }
        } else if (element instanceof ServerConnectionNode) {
            // Show server-level items: databases and security
            if (this.connectionProvider.isConnectionActive(element.connectionId)) {
                return await this.getServerChildren(element.connectionId);
            } else {
                // Not active - start auto-connect in background and return empty for now
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Starting auto-connect to server ${element.connectionId}...`);
                
                // Start connection in background (don't await)
                // Error notifications are now handled in ConnectionProvider
                this.connectionProvider.connectToSavedById(element.connectionId).catch(error => {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Server auto-connect failed: ${error}`);
                });
                
                return [];
            }
        } else if (element instanceof ConnectionNode) {
            // Show schema for this specific connection
            if (this.connectionProvider.isConnectionActive(element.connectionId)) {
                // If this connection is active, show current schema
                return await this.getSchemaChildren(element.connectionId, element.database);
            } else {
                // Not active - start auto-connect in background and return empty for now
                // The connection process will trigger refresh when done
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Starting auto-connect to ${element.connectionId}...`);
                
                // Start connection in background (don't await)
                // Error notifications are now handled in ConnectionProvider
                this.connectionProvider.connectToSavedById(element.connectionId).catch(error => {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Auto-connect failed: ${error}`);
                });
                
                // Return empty immediately - tree will refresh when connection completes
                return [];
            }
        } else if (element instanceof DatabaseNode) {
            // Show schema for a specific database from server connection
            console.log(`[DEBUG] DatabaseNode - database: ${element.database}, connectionId: ${element.connectionId}`);
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Expanding DatabaseNode: ${element.database}, connectionId: ${element.connectionId}`);
            
            const isActive = this.connectionProvider.isConnectionActive(element.connectionId);
            console.log(`[DEBUG] Connection active check: ${isActive}`);
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Connection active: ${isActive}`);
            
            if (isActive) {
                // Preload schema cache when database is expanded
                if (this.schemaCache) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Preloading schema cache for database: ${element.database}`);
                    try {
                        const config = this.connectionProvider.getConnectionConfig(element.connectionId);
                        // Create a database-specific pool for the target database
                        const pool = await this.connectionProvider.createDbPool(element.connectionId, element.database);
                        if (config && pool) {
                            const connectionInfo = {
                                server: config.server,
                                database: element.database
                            };
                            await this.schemaCache.getSchema(connectionInfo, pool);
                            this.outputChannel.appendLine(`[UnifiedTreeProvider] Schema cache preloaded successfully for ${element.database}`);
                        }
                    } catch (error) {
                        this.outputChannel.appendLine(`[UnifiedTreeProvider] Failed to preload schema cache: ${error}`);
                    }
                }
                
                console.log(`[DEBUG] About to call getSchemaChildren for database: ${element.database}`);
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Connection is active, calling getSchemaChildren...`);
                try {
                    const result = await this.getSchemaChildren(element.connectionId, element.database);
                    console.log(`[DEBUG] getSchemaChildren result:`, result);
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] getSchemaChildren returned ${result.length} items`);
                    return result;
                } catch (error) {
                    console.error(`[DEBUG] Error in getSchemaChildren:`, error);
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Error in getSchemaChildren: ${error}`);
                    return [];
                }
            } else {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Connection is not active for ${element.connectionId}`);
            }
            return [];
        } else if (element instanceof SecurityNode) {
            // Show security items like logins
            if (this.connectionProvider.isConnectionActive(element.connectionId)) {
                return await this.getSecurityChildren(element.connectionId);
            }
            return [];
        } else if (element instanceof SchemaItemNode) {
            // Handle schema expansion (tables, views, etc.)
            console.log(`[DEBUG] SchemaItemNode - type: ${element.itemType}, schema: ${element.schema}, database: ${element.database}, connectionId: ${element.connectionId}`);
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Expanding SchemaItemNode: type=${element.itemType}, database=${element.database}`);
            return await this.getSchemaItemChildren(element);
        }
        
        return [];
    }

    private async getServerChildren(connectionId: string): Promise<TreeNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading server-level items for connection ${connectionId}...`);
            
            const items: TreeNode[] = [];
            
            // Get all databases from the server
            const databasesQuery = `
                SELECT name, database_id, collation_name, state_desc
                FROM sys.databases 
                WHERE state = 0  -- Online databases only
                ORDER BY name
            `;
            
            const databasesRequest = connection.request();
            const databasesResult = await databasesRequest.query(databasesQuery);
            
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${databasesResult.recordset.length} databases before filtering`);
            
            // Apply database filter if exists
            const filter = this.connectionProvider.getDatabaseFilter(connectionId);
            let filteredDatabases = databasesResult.recordset;
            
            if (filter) {
                filteredDatabases = this.applyDatabaseFilter(databasesResult.recordset, filter);
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Filtered down to ${filteredDatabases.length} databases`);
            }
            
            // Add each database as a DatabaseNode
            for (const db of filteredDatabases) {
                const databaseNode = new DatabaseNode(
                    db.name,
                    connectionId,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                databaseNode.description = db.state_desc;
                databaseNode.tooltip = `Database: ${db.name}\nState: ${db.state_desc}\nCollation: ${db.collation_name}`;
                items.push(databaseNode);
            }
            
            // Add Security section
            const securityNode = new SecurityNode(
                'Security',
                connectionId,
                vscode.TreeItemCollapsibleState.Collapsed
            );
            items.push(securityNode);
            
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Total server items created: ${items.length}`);
            return items;
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading server items: ${error}`);
            return [];
        }
    }

    private async getSecurityChildren(connectionId: string): Promise<TreeNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading security items for connection ${connectionId}...`);
            
            const items: TreeNode[] = [];
            
            // Get logins from server
            const loginsQuery = `
                SELECT 
                    name,
                    type_desc,
                    is_disabled,
                    create_date,
                    modify_date,
                    default_database_name
                FROM sys.server_principals 
                WHERE type IN ('S', 'U', 'G', 'R', 'C', 'K')
                ORDER BY name
            `;
            
            const loginsRequest = connection.request();
            const loginsResult = await loginsRequest.query(loginsQuery);
            
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${loginsResult.recordset.length} logins`);
            
            // Add Logins section
            const loginsSection = new SchemaItemNode(
                `Logins (${loginsResult.recordset.length})`,
                'logins',
                'security',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            loginsSection.connectionId = connectionId;
            items.push(loginsSection);
            
            return items;
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading security items: ${error}`);
            return [];
        }
    }

    private async getSchemaChildren(connectionId: string, database: string): Promise<SchemaItemNode[]> {
        console.log(`[DEBUG] getSchemaChildren called with connectionId: ${connectionId}, database: ${database}`);
        
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            console.log(`[DEBUG] No connection found for ${connectionId}`);
            return [];
        }

        try {
            console.log(`[DEBUG] Starting schema loading for database: ${database}`);
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading schema for connection ${connectionId}, database: ${database}...`);
            
            const items: SchemaItemNode[] = [];
            
            // Use a per-database pool to avoid USE [db] which is not supported by some drivers
            let dbPool: any = null;
            try {
                dbPool = await this.connectionProvider.createDbPool(connectionId, database);
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Using DB pool for ${database}`);
            } catch (err) {
                console.error(`[DEBUG] Failed to create DB pool for ${database}:`, err);
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Failed to create DB pool for ${database}: ${err}`);
                return [];
            }
            
            // Get tables from cache
            let tablesCount = 0;
            if (this.schemaCache) {
                try {
                    const config = this.connectionProvider.getConnectionConfig(connectionId);
                    const connectionInfo = {
                        server: config?.server || '',
                        database: database
                    };
                    const tables = await this.schemaCache.getTables(connectionInfo, dbPool);
                    tablesCount = tables.length;
                    console.log(`[DEBUG] Tables from cache:`, tablesCount);
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${tablesCount} tables in cache for database ${database}`);
                } catch (error) {
                    console.error(`[DEBUG] Failed to get tables from cache:`, error);
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Failed to get tables from cache: ${error}`);
                }
            }
            
            // Add a single "Tables" node instead of one per schema
            if (tablesCount > 0) {
                // Check if table filter is active
                const hasTableFilter = this.connectionProvider.hasTableFilter(connectionId, database);
                const tablesLabel = hasTableFilter 
                    ? `Tables (${tablesCount}) (filtered)`
                    : `Tables (${tablesCount})`;
                
                const tablesNode = new SchemaItemNode(
                    tablesLabel,
                    'tables',
                    'all', // Use 'all' to indicate all schemas
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                tablesNode.connectionId = connectionId;
                tablesNode.database = database;
                tablesNode.contextValue = 'tables';
                items.push(tablesNode);
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Added single Tables node with ${tablesCount} tables for database ${database}${hasTableFilter ? ' (filtered)' : ''}`);
            }
            
            // Get views from cache
            let viewsCount = 0;
            if (this.schemaCache) {
                try {
                    const config = this.connectionProvider.getConnectionConfig(connectionId);
                    const connectionInfo = {
                        server: config?.server || '',
                        database: database
                    };
                    const views = await this.schemaCache.getViews(connectionInfo, dbPool);
                    viewsCount = views.length;
                    console.log(`[DEBUG] Views from cache:`, viewsCount);
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${viewsCount} views in cache for database ${database}`);
                } catch (error) {
                    console.error(`[DEBUG] Failed to get views from cache:`, error);
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Failed to get views from cache: ${error}`);
                }
            }
            
            if (viewsCount > 0) {
                const viewsNode = new SchemaItemNode(
                    `Views (${viewsCount})`,
                    'views',
                    'all',
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                viewsNode.connectionId = connectionId;
                viewsNode.database = database;
                viewsNode.contextValue = 'views';
                items.push(viewsNode);
            }
            
            // Add Programmability node
            const programmabilityNode = new SchemaItemNode(
                'Programmability',
                'programmability',
                'all',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            programmabilityNode.connectionId = connectionId;
            programmabilityNode.database = database;
            programmabilityNode.contextValue = 'programmability';
            items.push(programmabilityNode);
            
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Total schema items created for database ${database}: ${items.length}`);
            return items;
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading schema for database ${database}: ${error}`);
            return [];
        }
    }

    private async getSchemaItemChildren(element: SchemaItemNode): Promise<TreeNode[]> {
        console.log(`[DEBUG] getSchemaItemChildren - element:`, {type: element.itemType, schema: element.schema, database: element.database, connectionId: element.connectionId});
        this.outputChannel.appendLine(`[UnifiedTreeProvider] getSchemaItemChildren called for type: ${element.itemType}, database: ${element.database}`);
        
        const connection = this.connectionProvider.getConnection(element.connectionId);
        if (!connection) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] No connection found for ${element.connectionId}`);
            return [];
        }
        // Prepare a DB-scoped pool when this SchemaItemNode belongs to a specific database.
        // Many branches below previously used `USE [db]` or ran queries on the base connection
        // which caused the driver to run them against the master DB. Create a per-database pool
        // and prefer it when executing database-scoped queries.
        let dbPoolForElement: any = null;
        if (element.database) {
            try {
                dbPoolForElement = await this.connectionProvider.createDbPool(element.connectionId!, element.database);
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Using DB pool for element.database: ${element.database}`);
            } catch (err) {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Failed to create DB pool for ${element.database}: ${err}`);
                // Fall back to the base connection; some server-scoped queries still use it.
                dbPoolForElement = null;
            }
        }

        try {
            if (element.itemType === 'tables') {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading all tables for database: ${element.database || 'current'}`);
                
                // Check if table statistics should be displayed
                const showStats = vscode.workspace.getConfiguration('mssqlManager').get<boolean>('showTableStatistics', true);
                
                // Use SchemaCache instead of direct queries
                if (!this.schemaCache) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] SchemaCache not available, falling back to direct query`);
                    return [];
                }

                try {
                    dbPoolForElement = await this.connectionProvider.createDbPool(element.connectionId!, element.database || 'master');
                } catch (err) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Failed to create DB pool for ${element.database || 'master'}: ${err}`);
                    return [];
                }

                // Get connection info for cache
                const connectionInfo = { 
                    server: this.connectionProvider.getActiveConnectionInfo()?.server || '', 
                    database: element.database || 'master' 
                };

                try {
                    // Use cache to get tables (0 SQL queries after initial cache load)
                    const cachedTables = await this.schemaCache.getTables(connectionInfo, dbPoolForElement);
                    
                    // Apply table filter if exists
                    const tableFilter = this.connectionProvider.getTableFilter(element.connectionId!, element.database || 'master');
                    let tablesToDisplay = cachedTables;
                    
                    if (tableFilter && (tableFilter.name || tableFilter.schema || tableFilter.owner)) {
                        // Use applyTableFilter which supports operators like Contains, Equals, etc.
                        // Convert cache format to filter format
                        const tablesForFilter = cachedTables.map(t => ({
                            TABLE_NAME: t.name,
                            TABLE_SCHEMA: t.schema,
                            OWNER: t.owner
                        }));
                        
                        const filteredTablesData = this.applyTableFilter(tablesForFilter, tableFilter);
                        
                        // Map back to cache format
                        const filteredKeys = new Set(filteredTablesData.map(t => `${t.TABLE_SCHEMA}.${t.TABLE_NAME}`.toLowerCase()));
                        tablesToDisplay = cachedTables.filter(t => filteredKeys.has(`${t.schema}.${t.name}`.toLowerCase()));
                        
                        this.outputChannel.appendLine(`[UnifiedTreeProvider] Applied table filter - ${tablesToDisplay.length}/${cachedTables.length} tables match`);
                    } else {
                        this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${cachedTables.length} tables to display in database ${element.database || 'current'}`);
                    }
                    
                    return tablesToDisplay.map((table) => {
                        const tableNode = new SchemaItemNode(
                            `${table.schema}.${table.name}`,
                            'table',
                            table.schema,
                            vscode.TreeItemCollapsibleState.Collapsed
                        );
                        tableNode.connectionId = element.connectionId;
                        tableNode.database = element.database;
                        
                        if (showStats && table.rowCount !== undefined && table.sizeMB !== undefined) {
                            // Format row count (e.g., 1.6k, 23k, 1.2M)
                            const rowCount = table.rowCount || 0;
                            let formattedRows: string;
                            if (rowCount >= 1000000) {
                                formattedRows = (rowCount / 1000000).toFixed(1) + 'M';
                            } else if (rowCount >= 1000) {
                                formattedRows = (rowCount / 1000).toFixed(1) + 'k';
                            } else {
                                formattedRows = rowCount.toString();
                            }
                            
                            // Format size (e.g., 34 MB, 1.2 GB)
                            const sizeMb = table.sizeMB || 0;
                            let formattedSize: string;
                            if (sizeMb >= 1024) {
                                formattedSize = (sizeMb / 1024).toFixed(1) + ' GB';
                            } else if (sizeMb >= 1) {
                                formattedSize = Math.round(sizeMb) + ' MB';
                            } else {
                                formattedSize = '< 1 MB';
                            }
                            
                            // Set description: "1.6k Rows 34 MB"
                            tableNode.description = `${formattedRows} Rows ${formattedSize}`;
                        }
                        
                        return tableNode;
                    });
                } catch (error) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Error getting tables from cache: ${error}`);
                    return [];
                }
            } else if (element.itemType === 'views') {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading all views for database: ${element.database || 'current'}`);
                
                // Use SchemaCache instead of direct queries
                if (!this.schemaCache) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] SchemaCache not available`);
                    return [];
                }

                try {
                    dbPoolForElement = await this.connectionProvider.createDbPool(element.connectionId!, element.database || 'master');
                } catch (err) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Failed to create DB pool for ${element.database || 'master'}: ${err}`);
                    return [];
                }

                const connectionInfo = { 
                    server: this.connectionProvider.getActiveConnectionInfo()?.server || '', 
                    database: element.database || 'master' 
                };

                try {
                    // Use cache to get views (0 SQL queries after initial cache load)
                    const cachedViews = await this.schemaCache.getViews(connectionInfo, dbPoolForElement);
                    
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${cachedViews.length} views to display in database ${element.database || 'current'}`);
                    
                    return cachedViews.map((view) => {
                        const viewNode = new SchemaItemNode(
                            `${view.schema}.${view.name}`,
                            'view',
                            view.schema,
                            vscode.TreeItemCollapsibleState.None
                        );
                        viewNode.connectionId = element.connectionId;
                        viewNode.database = element.database;
                        return viewNode;
                    });
                } catch (error) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Error getting views from cache: ${error}`);
                    return [];
                }
            } else if (element.itemType === 'programmability') {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading programmability items for database: ${element.database || 'current'}`);
                
                const items: SchemaItemNode[] = [];
                
                // Use SchemaCache instead of direct queries
                if (!this.schemaCache) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] SchemaCache not available`);
                    return [];
                }

                try {
                    dbPoolForElement = await this.connectionProvider.createDbPool(element.connectionId!, element.database || 'master');
                } catch (err) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Failed to create DB pool for ${element.database || 'master'}: ${err}`);
                    return [];
                }

                const connectionInfo = { 
                    server: this.connectionProvider.getActiveConnectionInfo()?.server || '', 
                    database: element.database || 'master' 
                };

                try {
                    // Use cache to get procedures (0 SQL queries after initial cache load)
                    const cachedProcedures = await this.schemaCache.getProcedures(connectionInfo, dbPoolForElement);
                    const procsCount = cachedProcedures.length;
                    
                    if (procsCount > 0) {
                        const storedProcsNode = new SchemaItemNode(
                            `Stored Procedures (${procsCount})`,
                            'stored-procedures',
                            'all',
                            vscode.TreeItemCollapsibleState.Collapsed
                        );
                        storedProcsNode.connectionId = element.connectionId;
                        storedProcsNode.database = element.database;
                        items.push(storedProcsNode);
                    }
                    
                    // Use cache to get functions (0 SQL queries after initial cache load)
                    const cachedFunctions = await this.schemaCache.getFunctions(connectionInfo, dbPoolForElement);
                    const functionsCount = cachedFunctions.length;
                    
                    if (functionsCount > 0) {
                        const functionsNode = new SchemaItemNode(
                            `Functions (${functionsCount})`,
                            'functions',
                            'all',
                            vscode.TreeItemCollapsibleState.Collapsed
                        );
                        functionsNode.connectionId = element.connectionId;
                        functionsNode.database = element.database;
                        items.push(functionsNode);
                    }
                    
                    // Use cache to get triggers (0 SQL queries after initial cache load)
                    const cachedTriggers = await this.schemaCache.getTriggers(connectionInfo, dbPoolForElement);
                    // Filter only database-level triggers (tableName is undefined)
                    const dbTriggers = cachedTriggers.filter(t => !t.tableName);
                    const triggersCount = dbTriggers.length;
                
                if (triggersCount > 0) {
                    const triggersNode = new SchemaItemNode(
                        `Database Triggers (${triggersCount})`,
                        'database-triggers',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    triggersNode.connectionId = element.connectionId;
                    triggersNode.database = element.database;
                    items.push(triggersNode);
                }
                } catch (error) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Error getting programmability items from cache: ${error}`);
                    return [];
                }
                
                return items;
            } else if (element.itemType === 'stored-procedures') {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading stored procedures subcategories for database: ${element.database || 'current'}`);
                
                const items: SchemaItemNode[] = [];
                // Use DB pool for this database
                try {
                    dbPoolForElement = await this.connectionProvider.createDbPool(element.connectionId!, element.database || 'master');
                } catch (err) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Failed to create DB pool for ${element.database || 'master'}: ${err}`);
                    return [];
                }
                
                // System Stored Procedures
                const systemProcsQuery = `SELECT COUNT(*) as count FROM sys.procedures WHERE is_ms_shipped = 1`;
                const systemProcsResult = await (dbPoolForElement ? dbPoolForElement.request().query(systemProcsQuery) : connection.request().query(systemProcsQuery));
                const systemProcsCount = systemProcsResult.recordset[0]?.count || 0;
                
                if (systemProcsCount > 0) {
                    const systemProcsNode = new SchemaItemNode(
                        `System Stored Procedures (${systemProcsCount})`,
                        'system-procedures',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    systemProcsNode.connectionId = element.connectionId;
                    systemProcsNode.database = element.database;
                    items.push(systemProcsNode);
                }
                
                // Extended Stored Procedures
                const extendedProcsQuery = `SELECT COUNT(*) as count FROM sys.objects WHERE type = 'X'`;
                const extendedProcsResult = await (dbPoolForElement ? dbPoolForElement.request().query(extendedProcsQuery) : connection.request().query(extendedProcsQuery));
                const extendedProcsCount = extendedProcsResult.recordset[0]?.count || 0;
                
                if (extendedProcsCount > 0) {
                    const extendedProcsNode = new SchemaItemNode(
                        `Extended Stored Procedures (${extendedProcsCount})`,
                        'extended-procedures',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    extendedProcsNode.connectionId = element.connectionId;
                    extendedProcsNode.database = element.database;
                    items.push(extendedProcsNode);
                }
                
                // User Stored Procedures
                // Use DB pool for this database
                try {
                    dbPoolForElement = await this.connectionProvider.createDbPool(element.connectionId!, element.database || 'master');
                } catch (err) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Failed to create DB pool for ${element.database || 'master'}: ${err}`);
                    return [];
                }
                
                const query = `
                    SELECT ROUTINE_NAME, ROUTINE_SCHEMA 
                    FROM INFORMATION_SCHEMA.ROUTINES 
                    WHERE ROUTINE_TYPE = 'PROCEDURE'
                    ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
                `;
                
                const request = connection.request();
                const result = await (dbPoolForElement ? dbPoolForElement.request().query(query) : request.query(query));
                
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${result.recordset.length} user procedures to display in database ${element.database || 'current'}`);
                
                const userProcs = result.recordset.map((proc: any) => {
                    const procNode = new SchemaItemNode(
                        `${proc.ROUTINE_SCHEMA}.${proc.ROUTINE_NAME}`,
                        'procedure',
                        proc.ROUTINE_SCHEMA,
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    procNode.connectionId = element.connectionId;
                    procNode.database = element.database;
                    procNode.name = proc.ROUTINE_NAME;
                    return procNode;
                });
                
                return [...items, ...userProcs];
            } else if (element.itemType === 'functions') {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading functions subcategories for database: ${element.database || 'current'}`);
                
                const items: SchemaItemNode[] = [];
                
                // Use DB pool for this database
                let dbPoolForElement: any;
                try {
                    dbPoolForElement = await this.connectionProvider.createDbPool(element.connectionId!, element.database || 'master');
                } catch (err) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Failed to create DB pool for ${element.database || 'master'}: ${err}`);
                    return [];
                }
                
                // Table-valued Functions
                const tvfQuery = `SELECT COUNT(*) as count FROM sys.objects WHERE type IN ('TF', 'IF')`;
                const tvfResult = await (dbPoolForElement ? dbPoolForElement.request().query(tvfQuery) : connection.request().query(tvfQuery));
                const tvfCount = tvfResult.recordset[0]?.count || 0;
                
                if (tvfCount > 0) {
                    const tvfNode = new SchemaItemNode(
                        `Table-valued Functions (${tvfCount})`,
                        'table-valued-functions',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    tvfNode.connectionId = element.connectionId;
                    tvfNode.database = element.database;
                    items.push(tvfNode);
                }
                
                // Scalar-valued Functions
                const svfQuery = `SELECT COUNT(*) as count FROM sys.objects WHERE type = 'FN'`;
                const svfResult = await (dbPoolForElement ? dbPoolForElement.request().query(svfQuery) : connection.request().query(svfQuery));
                const svfCount = svfResult.recordset[0]?.count || 0;
                
                if (svfCount > 0) {
                    const svfNode = new SchemaItemNode(
                        `Scalar-valued Functions (${svfCount})`,
                        'scalar-valued-functions',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    svfNode.connectionId = element.connectionId;
                    svfNode.database = element.database;
                    items.push(svfNode);
                }
                
                // Aggregate Functions
                const aggQuery = `SELECT COUNT(*) as count FROM sys.objects WHERE type = 'AF'`;
                const aggResult = await (dbPoolForElement ? dbPoolForElement.request().query(aggQuery) : connection.request().query(aggQuery));
                const aggCount = aggResult.recordset[0]?.count || 0;
                
                if (aggCount > 0) {
                    const aggNode = new SchemaItemNode(
                        `Aggregate Functions (${aggCount})`,
                        'aggregate-functions',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    aggNode.connectionId = element.connectionId;
                    aggNode.database = element.database;
                    items.push(aggNode);
                }
                
                return items;
            } else if (element.itemType === 'types') {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading types subcategories`);
                
                const items: SchemaItemNode[] = [];
                
                // User-Defined Data Types
                const uddtQuery = `SELECT COUNT(*) as count FROM sys.types WHERE is_user_defined = 1 AND is_table_type = 0 AND is_assembly_type = 0`;
                const uddtResult = await (dbPoolForElement ? dbPoolForElement.request().query(uddtQuery) : connection.request().query(uddtQuery));
                const uddtCount = uddtResult.recordset[0]?.count || 0;
                
                if (uddtCount > 0) {
                    const uddtNode = new SchemaItemNode(
                        `User-Defined Data Types (${uddtCount})`,
                        'user-defined-data-types',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    uddtNode.connectionId = element.connectionId;
                    items.push(uddtNode);
                }
                
                // User-Defined Table Types
                const udttQuery = `SELECT COUNT(*) as count FROM sys.types WHERE is_user_defined = 1 AND is_table_type = 1`;
                const udttResult = await (dbPoolForElement ? dbPoolForElement.request().query(udttQuery) : connection.request().query(udttQuery));
                const udttCount = udttResult.recordset[0]?.count || 0;
                
                if (udttCount > 0) {
                    const udttNode = new SchemaItemNode(
                        `User-Defined Table Types (${udttCount})`,
                        'user-defined-table-types',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    udttNode.connectionId = element.connectionId;
                    items.push(udttNode);
                }
                
                // CLR Types
                const clrQuery = `SELECT COUNT(*) as count FROM sys.types WHERE is_assembly_type = 1`;
                const clrResult = await (dbPoolForElement ? dbPoolForElement.request().query(clrQuery) : connection.request().query(clrQuery));
                const clrCount = clrResult.recordset[0]?.count || 0;
                
                if (clrCount > 0) {
                    const clrNode = new SchemaItemNode(
                        `User-Defined Types (CLR) (${clrCount})`,
                        'clr-types',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    clrNode.connectionId = element.connectionId;
                    items.push(clrNode);
                }
                
                // XML Schema Collections
                const xmlQuery = `SELECT COUNT(*) as count FROM sys.xml_schema_collections WHERE xml_collection_id > 65535`;
                const xmlResult = await (dbPoolForElement ? dbPoolForElement.request().query(xmlQuery) : connection.request().query(xmlQuery));
                const xmlCount = xmlResult.recordset[0]?.count || 0;
                
                if (xmlCount > 0) {
                    const xmlNode = new SchemaItemNode(
                        `XML Schema Collections (${xmlCount})`,
                        'xml-schema-collections',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    xmlNode.connectionId = element.connectionId;
                    items.push(xmlNode);
                }
                
                return items;
            } else if (element.itemType === 'table') {
                // Show table details (columns, keys, etc.)
                // Extract table name from label format schema.tableName
                const fullLabel = element.label as string;
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Expanding table with label: ${fullLabel} in database: ${element.database || 'current'}`);
                
                let tableName: string;
                let schema: string;
                
                if (fullLabel.includes('.')) {
                    // Format: schema.tableName
                    const parts = fullLabel.split('.');
                    schema = parts[0];
                    tableName = parts[1];
                } else {
                    // Fallback: use existing schema and full label as table name
                    tableName = fullLabel;
                    schema = element.schema;
                }
                
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Parsed table: ${tableName}, schema: ${schema}, database: ${element.database || 'current'}`);
                return await this.getTableDetails(tableName, schema, element.connectionId!, element.database);
            } else if (element.itemType === 'columns') {
                // Show individual columns - get table name from stored property
                const tableName = (element as any).tableName;
                if (tableName) {
                    return await this.getColumnDetails(tableName, element.schema, element.connectionId!, element.database);
                }
                return [];
            } else if (element.itemType === 'keys') {
                const tableName = (element as any).tableName;
                if (tableName) {
                    return await this.getKeyDetails(tableName, element.schema, element.connectionId!, element.database);
                }
                return [];
            } else if (element.itemType === 'constraints') {
                const tableName = (element as any).tableName;
                if (tableName) {
                    return await this.getConstraintDetails(tableName, element.schema, element.connectionId!, element.database);
                }
                return [];
            } else if (element.itemType === 'triggers') {
                const tableName = (element as any).tableName;
                if (tableName) {
                    return await this.getTriggerDetails(tableName, element.schema, element.connectionId!, element.database);
                }
                return [];
            } else if (element.itemType === 'indexes') {
                const tableName = (element as any).tableName;
                if (tableName) {
                    return await this.getIndexDetails(tableName, element.schema, element.connectionId!, element.database);
                }
                return [];
            } else if (element.itemType === 'statistics') {
                const tableName = (element as any).tableName;
                if (tableName) {
                    return await this.getStatisticsDetails(tableName, element.schema, element.connectionId!, element.database);
                }
                return [];
            } else if (element.itemType === 'system-procedures' || element.itemType === 'extended-procedures') {
                // For now, return empty - these are system objects
                return [];
            } else if (element.itemType === 'table-valued-functions') {
                // Use DB pool for this database
                let dbPoolForElement: any;
                try {
                    dbPoolForElement = await this.connectionProvider.createDbPool(element.connectionId!, element.database || 'master');
                } catch (err) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Failed to create DB pool for ${element.database || 'master'}: ${err}`);
                    return [];
                }
                
                const query = `
                    SELECT SCHEMA_NAME(schema_id) as ROUTINE_SCHEMA, name as ROUTINE_NAME
                    FROM sys.objects 
                    WHERE type IN ('TF', 'IF')
                    ORDER BY SCHEMA_NAME(schema_id), name
                `;
                const result = await connection.request().query(query);
                return result.recordset.map((func: any) => {
                    const funcNode = new SchemaItemNode(
                        `${func.ROUTINE_SCHEMA}.${func.ROUTINE_NAME}`,
                        'function',
                        func.ROUTINE_SCHEMA,
                        vscode.TreeItemCollapsibleState.None
                    );
                    funcNode.connectionId = element.connectionId;
                    funcNode.database = element.database;
                    return funcNode;
                });
            } else if (element.itemType === 'scalar-valued-functions') {
                // Switch to the database first
                await connection.request().query(`USE [${element.database || 'master'}]`);
                
                const query = `
                    SELECT SCHEMA_NAME(schema_id) as ROUTINE_SCHEMA, name as ROUTINE_NAME
                    FROM sys.objects 
                    WHERE type = 'FN'
                    ORDER BY SCHEMA_NAME(schema_id), name
                `;
                const result = await connection.request().query(query);
                return result.recordset.map((func: any) => {
                    const funcNode = new SchemaItemNode(
                        `${func.ROUTINE_SCHEMA}.${func.ROUTINE_NAME}`,
                        'function',
                        func.ROUTINE_SCHEMA,
                        vscode.TreeItemCollapsibleState.None
                    );
                    funcNode.connectionId = element.connectionId;
                    funcNode.database = element.database;
                    return funcNode;
                });
            } else if (element.itemType === 'aggregate-functions') {
                // Switch to the database first
                await connection.request().query(`USE [${element.database || 'master'}]`);
                
                const query = `
                    SELECT SCHEMA_NAME(schema_id) as ROUTINE_SCHEMA, name as ROUTINE_NAME
                    FROM sys.objects 
                    WHERE type = 'AF'
                    ORDER BY SCHEMA_NAME(schema_id), name
                `;
                const result = await connection.request().query(query);
                return result.recordset.map((func: any) => {
                    const funcNode = new SchemaItemNode(
                        `${func.ROUTINE_SCHEMA}.${func.ROUTINE_NAME}`,
                        'function',
                        func.ROUTINE_SCHEMA,
                        vscode.TreeItemCollapsibleState.None
                    );
                    funcNode.connectionId = element.connectionId;
                    funcNode.database = element.database;
                    return funcNode;
                });
            } else if (element.itemType === 'database-triggers') {
                const query = `
                    SELECT name, OBJECT_SCHEMA_NAME(parent_id) as schema_name
                    FROM sys.triggers 
                    WHERE parent_class = 0
                    ORDER BY name
                `;
                const result = await connection.request().query(query);
                return result.recordset.map((trigger: any) => {
                    const triggerNode = new SchemaItemNode(
                        trigger.name,
                        'database-trigger',
                        trigger.schema_name || 'dbo',
                        vscode.TreeItemCollapsibleState.None
                    );
                    triggerNode.connectionId = element.connectionId;
                    return triggerNode;
                });
            } else if (element.itemType === 'assemblies') {
                const query = `
                    SELECT name
                    FROM sys.assemblies 
                    WHERE is_user_defined = 1
                    ORDER BY name
                `;
                const result = await connection.request().query(query);
                return result.recordset.map((assembly: any) => {
                    const assemblyNode = new SchemaItemNode(
                        assembly.name,
                        'assembly',
                        'dbo',
                        vscode.TreeItemCollapsibleState.None
                    );
                    assemblyNode.connectionId = element.connectionId;
                    return assemblyNode;
                });
            } else if (element.itemType === 'user-defined-data-types') {
                const query = `
                    SELECT SCHEMA_NAME(schema_id) as schema_name, name, system_type_id, max_length, precision, scale
                    FROM sys.types 
                    WHERE is_user_defined = 1 AND is_table_type = 0 AND is_assembly_type = 0
                    ORDER BY SCHEMA_NAME(schema_id), name
                `;
                const result = await connection.request().query(query);
                return result.recordset.map((type: any) => {
                    const typeNode = new SchemaItemNode(
                        `${type.schema_name}.${type.name}`,
                        'user-defined-type',
                        type.schema_name,
                        vscode.TreeItemCollapsibleState.None
                    );
                    typeNode.connectionId = element.connectionId;
                    return typeNode;
                });
            } else if (element.itemType === 'user-defined-table-types') {
                const query = `
                    SELECT SCHEMA_NAME(schema_id) as schema_name, name
                    FROM sys.types 
                    WHERE is_user_defined = 1 AND is_table_type = 1
                    ORDER BY SCHEMA_NAME(schema_id), name
                `;
                const result = await connection.request().query(query);
                return result.recordset.map((type: any) => {
                    const typeNode = new SchemaItemNode(
                        `${type.schema_name}.${type.name}`,
                        'user-defined-table-type',
                        type.schema_name,
                        vscode.TreeItemCollapsibleState.None
                    );
                    typeNode.connectionId = element.connectionId;
                    return typeNode;
                });
            } else if (element.itemType === 'clr-types') {
                const query = `
                    SELECT SCHEMA_NAME(schema_id) as schema_name, name
                    FROM sys.types 
                    WHERE is_assembly_type = 1
                    ORDER BY SCHEMA_NAME(schema_id), name
                `;
                const result = await connection.request().query(query);
                return result.recordset.map((type: any) => {
                    const typeNode = new SchemaItemNode(
                        `${type.schema_name}.${type.name}`,
                        'clr-type',
                        type.schema_name,
                        vscode.TreeItemCollapsibleState.None
                    );
                    typeNode.connectionId = element.connectionId;
                    return typeNode;
                });
            } else if (element.itemType === 'xml-schema-collections') {
                const query = `
                    SELECT SCHEMA_NAME(schema_id) as schema_name, name
                    FROM sys.xml_schema_collections 
                    WHERE xml_collection_id > 65535
                    ORDER BY SCHEMA_NAME(schema_id), name
                `;
                const result = await connection.request().query(query);
                return result.recordset.map((collection: any) => {
                    const collectionNode = new SchemaItemNode(
                        `${collection.schema_name}.${collection.name}`,
                        'xml-schema-collection',
                        collection.schema_name,
                        vscode.TreeItemCollapsibleState.None
                    );
                    collectionNode.connectionId = element.connectionId;
                    return collectionNode;
                });
            } else if (element.itemType === 'sequences') {
                const query = `
                    SELECT SCHEMA_NAME(schema_id) as schema_name, name, 
                           CAST(start_value as varchar) as start_value, 
                           CAST(increment as varchar) as increment
                    FROM sys.sequences
                    ORDER BY SCHEMA_NAME(schema_id), name
                `;
                const result = await connection.request().query(query);
                return result.recordset.map((sequence: any) => {
                    const sequenceNode = new SchemaItemNode(
                        `${sequence.schema_name}.${sequence.name}`,
                        'sequence',
                        sequence.schema_name,
                        vscode.TreeItemCollapsibleState.None
                    );
                    sequenceNode.connectionId = element.connectionId;
                    return sequenceNode;
                });
            } else if (element.itemType === 'synonyms') {
                const query = `
                    SELECT SCHEMA_NAME(schema_id) as schema_name, name, base_object_name
                    FROM sys.synonyms
                    ORDER BY SCHEMA_NAME(schema_id), name
                `;
                const result = await connection.request().query(query);
                return result.recordset.map((synonym: any) => {
                    const synonymNode = new SchemaItemNode(
                        `${synonym.schema_name}.${synonym.name}`,
                        'synonym',
                        synonym.schema_name,
                        vscode.TreeItemCollapsibleState.None
                    );
                    synonymNode.connectionId = element.connectionId;
                    return synonymNode;
                });
            } else if (element.itemType === 'rules') {
                const query = `
                    SELECT SCHEMA_NAME(schema_id) as schema_name, name
                    FROM sys.objects 
                    WHERE type = 'R'
                    ORDER BY SCHEMA_NAME(schema_id), name
                `;
                const result = await connection.request().query(query);
                return result.recordset.map((rule: any) => {
                    const ruleNode = new SchemaItemNode(
                        `${rule.schema_name}.${rule.name}`,
                        'rule',
                        rule.schema_name,
                        vscode.TreeItemCollapsibleState.None
                    );
                    ruleNode.connectionId = element.connectionId;
                    return ruleNode;
                });
            } else if (element.itemType === 'defaults') {
                const query = `
                    SELECT SCHEMA_NAME(schema_id) as schema_name, name
                    FROM sys.objects 
                    WHERE type = 'D' AND parent_object_id = 0
                    ORDER BY SCHEMA_NAME(schema_id), name
                `;
                const result = await connection.request().query(query);
                return result.recordset.map((defaultObj: any) => {
                    const defaultNode = new SchemaItemNode(
                        `${defaultObj.schema_name}.${defaultObj.name}`,
                        'default',
                        defaultObj.schema_name,
                        vscode.TreeItemCollapsibleState.None
                    );
                    defaultNode.connectionId = element.connectionId;
                    return defaultNode;
                });
            } else if (element.itemType === 'logins') {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading all logins`);
                
                const query = `
                    SELECT 
                        name,
                        type_desc,
                        is_disabled,
                        create_date,
                        modify_date,
                        default_database_name
                    FROM sys.server_principals 
                    WHERE type IN ('S', 'U', 'G', 'R', 'C', 'K')
                    ORDER BY name
                `;
                
                const request = connection.request();
                const result = await request.query(query);
                
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${result.recordset.length} logins to display`);
                
                return result.recordset.map((login: any) => {
                    const loginNode = new LoginNode(
                        login.name,
                        element.connectionId!,
                        login.type_desc,
                        login.is_disabled
                    );
                    loginNode.description = `${login.type_desc}${login.is_disabled ? ' (Disabled)' : ''}`;
                    loginNode.tooltip = `Login: ${login.name}\nType: ${login.type_desc}\nStatus: ${login.is_disabled ? 'Disabled' : 'Enabled'}\nDefault DB: ${login.default_database_name}`;
                    return loginNode;
                });
            }
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading ${element.itemType}: ${error}`);
        }
        
        return [];
    }

    private async getTableDetails(tableName: string, schema: string, connectionId: string, database?: string): Promise<SchemaItemNode[]> {
        this.outputChannel.appendLine(`[UnifiedTreeProvider] Getting table details for: ${tableName} in schema: ${schema}, database: ${database || 'current'}`);
        
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] No connection found for connectionId: ${connectionId}`);
            return [];
        }

        try {
            const items: SchemaItemNode[] = [];
            
            // Try to use SchemaCache if available
            if (this.schemaCache && database) {
                const connectionConfig = this.connectionProvider.getConnectionConfig(connectionId);
                if (connectionConfig) {
                    const cacheConnection = { ...connectionConfig, database };
                    
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Using SchemaCache for table ${tableName}`);
                    
                    // Get columns from cache
                    const columns = await this.schemaCache.getTableColumns(cacheConnection, connection, schema, tableName);
                    if (columns.length > 0) {
                        const columnsNode = new SchemaItemNode(
                            `Columns (${columns.length})`,
                            'columns',
                            schema,
                            vscode.TreeItemCollapsibleState.Collapsed
                        );
                        (columnsNode as any).tableName = tableName;
                        columnsNode.connectionId = connectionId;
                        columnsNode.database = database;
                        items.push(columnsNode);
                    }
                    
                    // Get constraints from cache
                    const constraints = await this.schemaCache.getTableConstraints(cacheConnection, connection, schema, tableName);
                    const keys = constraints.filter(c => ['PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE'].includes(c.constraintType));
                    const checks = constraints.filter(c => c.constraintType === 'CHECK');
                    
                    if (keys.length > 0) {
                        const keysNode = new SchemaItemNode(
                            `Keys (${keys.length})`,
                            'keys',
                            schema,
                            vscode.TreeItemCollapsibleState.Collapsed
                        );
                        (keysNode as any).tableName = tableName;
                        keysNode.connectionId = connectionId;
                        keysNode.database = database;
                        items.push(keysNode);
                    }
                    
                    if (checks.length > 0) {
                        const constraintsNode = new SchemaItemNode(
                            `Constraints (${checks.length})`,
                            'constraints',
                            schema,
                            vscode.TreeItemCollapsibleState.Collapsed
                        );
                        (constraintsNode as any).tableName = tableName;
                        constraintsNode.connectionId = connectionId;
                        constraintsNode.database = database;
                        items.push(constraintsNode);
                    }
                    
                    // Get indexes from cache
                    const indexes = await this.schemaCache.getTableIndexes(cacheConnection, connection, schema, tableName);
                    if (indexes.length > 0) {
                        const indexesNode = new SchemaItemNode(
                            `Indexes (${indexes.length})`,
                            'indexes',
                            schema,
                            vscode.TreeItemCollapsibleState.Collapsed
                        );
                        (indexesNode as any).tableName = tableName;
                        indexesNode.connectionId = connectionId;
                        indexesNode.database = database;
                        items.push(indexesNode);
                    }
                    
                    // Get Triggers from cache (all triggers are cached)
                    if (this.schemaCache) {
                        const allTriggers = await this.schemaCache.getTriggers(cacheConnection, connection);
                        // Filter triggers for this specific table
                        const tableTriggers = allTriggers.filter(t => 
                            t.tableName?.toLowerCase() === tableName.toLowerCase() &&
                            t.schema?.toLowerCase() === schema.toLowerCase()
                        );
                        
                        if (tableTriggers.length > 0) {
                            const triggersNode = new SchemaItemNode(
                                `Triggers (${tableTriggers.length})`,
                                'triggers',
                                schema,
                                vscode.TreeItemCollapsibleState.Collapsed
                            );
                            (triggersNode as any).tableName = tableName;
                            triggersNode.connectionId = connectionId;
                            triggersNode.database = database;
                            items.push(triggersNode);
                        }
                    }
                    
                    // Statistics - lazy load only when expanded (not loaded by default to avoid queries)
                    // The statistics node will load data when user expands it
                    const statisticsNode = new SchemaItemNode(
                        `Statistics`,
                        'statistics',
                        schema,
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    (statisticsNode as any).tableName = tableName;
                    statisticsNode.connectionId = connectionId;
                    statisticsNode.database = database;
                    items.push(statisticsNode);
                    
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Returning ${items.length} items from cache for table ${tableName}`);
                    return items;
                }
            }
            
            // Fallback to direct SQL queries if cache not available
            this.outputChannel.appendLine(`[UnifiedTreeProvider] SchemaCache not available, using direct SQL queries`);
            
            let dbPool: any = null;
            if (database) {
                try {
                    dbPool = await this.connectionProvider.createDbPool(connectionId, database);
                } catch (err) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Failed to create DB pool: ${err}`);
                }
            }

            // Get columns
            const columnsQuery = `
                SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = '${tableName}' AND TABLE_SCHEMA = '${schema}'
                ORDER BY ORDINAL_POSITION
            `;
            const columnsResult = await (dbPool ? dbPool.request().query(columnsQuery) : connection.request().query(columnsQuery));
            
            if (columnsResult.recordset.length > 0) {
                const columnsNode = new SchemaItemNode(
                    `Columns (${columnsResult.recordset.length})`,
                    'columns',
                    schema,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                (columnsNode as any).tableName = tableName;
                columnsNode.connectionId = connectionId;
                columnsNode.database = database;
                items.push(columnsNode);
            }
            
            // Get Keys
            const keysQuery = `
                SELECT tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE, STRING_AGG(kcu.COLUMN_NAME, ', ') AS COLUMNS
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
                    ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
                WHERE tc.TABLE_NAME = '${tableName}' AND tc.TABLE_SCHEMA = '${schema}'
                    AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')
                GROUP BY tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE
            `;
            const keysResult = await (dbPool ? dbPool.request().query(keysQuery) : connection.request().query(keysQuery));
            
            if (keysResult.recordset.length > 0) {
                const keysNode = new SchemaItemNode(
                    `Keys (${keysResult.recordset.length})`,
                    'keys',
                    schema,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                (keysNode as any).tableName = tableName;
                keysNode.connectionId = connectionId;
                keysNode.database = database;
                items.push(keysNode);
            }
            
            // Get Constraints
            const constraintsQuery = `
                SELECT CONSTRAINT_NAME, CHECK_CLAUSE
                FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
                WHERE EXISTS (
                    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                    WHERE tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
                        AND tc.TABLE_NAME = '${tableName}' AND tc.TABLE_SCHEMA = '${schema}'
                )
            `;
            const constraintsResult = await (dbPool ? dbPool.request().query(constraintsQuery) : connection.request().query(constraintsQuery));
            
            if (constraintsResult.recordset.length > 0) {
                const constraintsNode = new SchemaItemNode(
                    `Constraints (${constraintsResult.recordset.length})`,
                    'constraints',
                    schema,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                (constraintsNode as any).tableName = tableName;
                constraintsNode.connectionId = connectionId;
                constraintsNode.database = database;
                items.push(constraintsNode);
            }
            
            // Get Triggers
            const triggersQuery = `
                SELECT name, is_disabled, is_instead_of_trigger
                FROM sys.triggers
                WHERE parent_id = OBJECT_ID('${schema}.${tableName}')
            `;
            const triggersResult = await (dbPool ? dbPool.request().query(triggersQuery) : connection.request().query(triggersQuery));
            
            if (triggersResult.recordset.length > 0) {
                const triggersNode = new SchemaItemNode(
                    `Triggers (${triggersResult.recordset.length})`,
                    'triggers',
                    schema,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                (triggersNode as any).tableName = tableName;
                triggersNode.connectionId = connectionId;
                triggersNode.database = database;
                items.push(triggersNode);
            }
            
            // Get Indexes
            const indexesQuery = `
                SELECT i.name, i.type_desc, i.is_unique, i.is_primary_key,
                       STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
                FROM sys.indexes i
                INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                WHERE i.object_id = OBJECT_ID('${schema}.${tableName}') AND i.type > 0
                GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key
            `;
            const indexesResult = await (dbPool ? dbPool.request().query(indexesQuery) : connection.request().query(indexesQuery));
            
            if (indexesResult.recordset.length > 0) {
                const indexesNode = new SchemaItemNode(
                    `Indexes (${indexesResult.recordset.length})`,
                    'indexes',
                    schema,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                (indexesNode as any).tableName = tableName;
                indexesNode.connectionId = connectionId;
                indexesNode.database = database;
                items.push(indexesNode);
            }
            
            // Get Statistics
            const statisticsQuery = `
                SELECT s.name, s.auto_created, s.user_created,
                       STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY sc.stats_column_id) AS columns
                FROM sys.stats s
                INNER JOIN sys.stats_columns sc ON s.object_id = sc.object_id AND s.stats_id = sc.stats_id
                INNER JOIN sys.columns c ON sc.object_id = c.object_id AND sc.column_id = c.column_id
                WHERE s.object_id = OBJECT_ID('${schema}.${tableName}')
                GROUP BY s.name, s.auto_created, s.user_created
            `;
            const statisticsResult = await (dbPool ? dbPool.request().query(statisticsQuery) : connection.request().query(statisticsQuery));
            
            if (statisticsResult.recordset.length > 0) {
                const statisticsNode = new SchemaItemNode(
                    `Statistics (${statisticsResult.recordset.length})`,
                    'statistics',
                    schema,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                (statisticsNode as any).tableName = tableName;
                statisticsNode.connectionId = connectionId;
                statisticsNode.database = database;
                items.push(statisticsNode);
            }
            
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Returning ${items.length} items for table ${tableName}`);
            return items;
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading table details for ${tableName} in database ${database || 'current'}: ${error}`);
            return [];
        }
    }

    private async getColumnDetails(tableName: string, schema: string, connectionId: string, database?: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
            // Use SchemaCache instead of direct SQL query
            if (this.schemaCache && database) {
                const dbPool = await this.connectionProvider.createDbPool(connectionId, database);
                const cacheConnection = { 
                    server: this.connectionProvider.getActiveConnectionInfo()?.server || '', 
                    database: database 
                };
                
                const columns = await this.schemaCache.getTableColumns(cacheConnection, dbPool, schema, tableName);
                
                return columns.map((column) => {
                    const dataType = column.maxLength 
                        ? `${column.dataType}(${column.maxLength})`
                        : column.precision 
                            ? `${column.dataType}(${column.precision},${column.scale || 0})`
                            : column.dataType;
                            
                    const nullable = column.isNullable ? ' (nullable)' : ' (not null)';
                    const defaultValue = column.defaultValue ? ` default: ${column.defaultValue}` : '';
                    
                    const columnNode = new SchemaItemNode(
                        column.columnName,
                        'column',
                        schema,
                        vscode.TreeItemCollapsibleState.None
                    );
                    
                    // Add detailed tooltip and description
                    columnNode.description = dataType + nullable;
                    columnNode.tooltip = `${column.columnName}: ${dataType}${nullable}${defaultValue}`;
                    columnNode.connectionId = connectionId;
                    columnNode.database = database;
                    
                    return columnNode;
                });
            }
            return [];
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading column details: ${error}`);
            return [];
        }
    }

    private async getKeyDetails(tableName: string, schema: string, connectionId: string, database?: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
            // Use SchemaCache instead of direct SQL query
            if (this.schemaCache && database) {
                const dbPool = await this.connectionProvider.createDbPool(connectionId, database);
                const cacheConnection = { 
                    server: this.connectionProvider.getActiveConnectionInfo()?.server || '', 
                    database: database 
                };
                
                const constraints = await this.schemaCache.getTableConstraints(cacheConnection, dbPool, schema, tableName);
                const keys = constraints.filter(c => ['PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE'].includes(c.constraintType));
                
                return keys.map((key) => {
                    const keyNode = new SchemaItemNode(
                        key.constraintName,
                        'key',
                        schema,
                        vscode.TreeItemCollapsibleState.None
                    );
                    
                    keyNode.description = key.constraintType;
                    keyNode.tooltip = `${key.constraintName}\nType: ${key.constraintType}\nColumns: ${key.columns?.join(', ') || ''}`;
                    keyNode.connectionId = connectionId;
                    keyNode.database = database;
                    
                    return keyNode;
                });
            }
            return [];
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading key details: ${error}`);
            return [];
        }
    }

    private async getConstraintDetails(tableName: string, schema: string, connectionId: string, database?: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
            // Prefer a DB-scoped pool for database-specific queries
            let dbPool: any = null;
            if (database) {
                try {
                    dbPool = await this.connectionProvider.createDbPool(connectionId, database);
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Using DB pool for getConstraintDetails: ${database}`);
                } catch (err) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Failed to create DB pool for getConstraintDetails ${database}: ${err}`);
                    dbPool = null;
                }
            }

            const constraintsQuery = `
                SELECT 
                    cc.CONSTRAINT_NAME,
                    cc.CHECK_CLAUSE
                FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
                WHERE EXISTS (
                    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                    WHERE tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
                        AND tc.TABLE_NAME = '${tableName}'
                        AND tc.TABLE_SCHEMA = '${schema}'
                )
            `;
            const constraintsResult = await (dbPool ? dbPool.request().query(constraintsQuery) : connection.request().query(constraintsQuery));
            
            return constraintsResult.recordset.map((constraint: any) => {
                const constraintNode = new SchemaItemNode(
                    constraint.CONSTRAINT_NAME,
                    'constraint',
                    schema,
                    vscode.TreeItemCollapsibleState.None
                );
                
                constraintNode.description = 'CHECK';
                constraintNode.tooltip = `${constraint.CONSTRAINT_NAME}\n${constraint.CHECK_CLAUSE}`;
                constraintNode.connectionId = connectionId;
                constraintNode.database = database;
                
                return constraintNode;
            });
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading constraint details: ${error}`);
            return [];
        }
    }

    private async getTriggerDetails(tableName: string, schema: string, connectionId: string, database?: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
            // Use SchemaCache instead of direct SQL query
            if (this.schemaCache && database) {
                const dbPool = await this.connectionProvider.createDbPool(connectionId, database);
                const cacheConnection = { 
                    server: this.connectionProvider.getActiveConnectionInfo()?.server || '', 
                    database: database 
                };
                
                const allTriggers = await this.schemaCache.getTriggers(cacheConnection, dbPool);
                const tableTriggers = allTriggers.filter(t => 
                    t.tableName?.toLowerCase() === tableName.toLowerCase() &&
                    t.schema?.toLowerCase() === schema.toLowerCase()
                );
                
                return tableTriggers.map((trigger) => {
                    const triggerNode = new SchemaItemNode(
                        trigger.name,
                        'trigger',
                        schema,
                        vscode.TreeItemCollapsibleState.None
                    );
                    
                    const status = trigger.isDisabled ? 'Disabled' : 'Enabled';
                    const type = trigger.isInsteadOf ? 'INSTEAD OF' : 'AFTER';
                    
                    triggerNode.description = `${type} - ${status}`;
                    triggerNode.tooltip = `${trigger.name}\nType: ${type}\nStatus: ${status}`;
                    triggerNode.connectionId = connectionId;
                    triggerNode.database = database;
                    
                    return triggerNode;
                });
            }
            return [];
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading trigger details: ${error}`);
            return [];
        }
    }

    private async getIndexDetails(tableName: string, schema: string, connectionId: string, database?: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
            // Use SchemaCache instead of direct SQL query
            if (this.schemaCache && database) {
                const dbPool = await this.connectionProvider.createDbPool(connectionId, database);
                const cacheConnection = { 
                    server: this.connectionProvider.getActiveConnectionInfo()?.server || '', 
                    database: database 
                };
                
                const indexes = await this.schemaCache.getTableIndexes(cacheConnection, dbPool, schema, tableName);
                
                return indexes.map((index) => {
                    const indexNode = new SchemaItemNode(
                        index.indexName,
                        'index',
                        schema,
                        vscode.TreeItemCollapsibleState.None
                    );
                    
                    const unique = index.isUnique ? 'Unique' : 'Non-unique';
                    const pk = index.isPrimaryKey ? ' (Primary Key)' : '';
                    
                    indexNode.description = `${index.indexType}${pk}`;
                    indexNode.tooltip = `${index.indexName}\nType: ${index.indexType}\n${unique}${pk}\nColumns: ${index.columns.join(', ')}`;
                    indexNode.connectionId = connectionId;
                    indexNode.database = database;
                    
                    return indexNode;
                });
            }
            return [];
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading index details: ${error}`);
            return [];
        }
    }

    private async getStatisticsDetails(tableName: string, schema: string, connectionId: string, database?: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
            // Prefer a DB-scoped pool for database-specific queries
            let dbPool: any = null;
            if (database) {
                try {
                    dbPool = await this.connectionProvider.createDbPool(connectionId, database);
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Using DB pool for getStatisticsDetails: ${database}`);
                } catch (err) {
                    this.outputChannel.appendLine(`[UnifiedTreeProvider] Failed to create DB pool for getStatisticsDetails ${database}: ${err}`);
                    dbPool = null;
                }
            }

            const statisticsQuery = `
                SELECT 
                    s.name,
                    s.auto_created,
                    s.user_created,
                    STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY sc.stats_column_id) AS columns
                FROM sys.stats s
                INNER JOIN sys.stats_columns sc ON s.object_id = sc.object_id AND s.stats_id = sc.stats_id
                INNER JOIN sys.columns c ON sc.object_id = c.object_id AND sc.column_id = c.column_id
                WHERE s.object_id = OBJECT_ID('${schema}.${tableName}')
                GROUP BY s.name, s.auto_created, s.user_created
            `;
            const statisticsResult = await (dbPool ? dbPool.request().query(statisticsQuery) : connection.request().query(statisticsQuery));
            
            return statisticsResult.recordset.map((stat: any) => {
                const statNode = new SchemaItemNode(
                    stat.name,
                    'statistic',
                    schema,
                    vscode.TreeItemCollapsibleState.None
                );
                
                const type = stat.auto_created ? 'Auto-created' : stat.user_created ? 'User-created' : 'System';
                
                statNode.description = type;
                statNode.tooltip = `${stat.name}\nType: ${type}\nColumns: ${stat.columns}`;
                statNode.connectionId = connectionId;
                statNode.database = database;
                
                return statNode;
            });
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading statistics details: ${error}`);
            return [];
        }
    }

    private applyDatabaseFilter(databases: any[], filter: any): any[] {
        return databases.filter(db => {
            // Filter by name
            if (filter.name && filter.name.value) {
                const nameValue = filter.name.value.toLowerCase();
                const dbName = db.name.toLowerCase();
                const operator = filter.name.operator;

                switch (operator) {
                    case 'Contains':
                        if (!dbName.includes(nameValue)) { return false; }
                        break;
                    case 'Not Contains':
                        if (dbName.includes(nameValue)) { return false; }
                        break;
                    case 'Starts With':
                        if (!dbName.startsWith(nameValue)) { return false; }
                        break;
                    case 'Not Starts With':
                        if (dbName.startsWith(nameValue)) { return false; }
                        break;
                    case 'Ends With':
                        if (!dbName.endsWith(nameValue)) { return false; }
                        break;
                    case 'Not Ends With':
                        if (dbName.endsWith(nameValue)) { return false; }
                        break;
                    case 'Equals':
                        if (dbName !== nameValue) { return false; }
                        break;
                    case 'Not Equals':
                        if (dbName === nameValue) { return false; }
                        break;
                }
            }

            // Filter by state
            if (filter.state && filter.state.value) {
                const stateValue = filter.state.value.toLowerCase();
                const dbState = (db.state_desc || '').toLowerCase();
                const operator = filter.state.operator;

                switch (operator) {
                    case 'Equals':
                        if (dbState !== stateValue) { return false; }
                        break;
                    case 'Not Equals':
                        if (dbState === stateValue) { return false; }
                        break;
                }
            }

            // Filter by collation
            if (filter.collation && filter.collation.value) {
                const collationValue = filter.collation.value.toLowerCase();
                const dbCollation = (db.collation_name || '').toLowerCase();
                const operator = filter.collation.operator;

                switch (operator) {
                    case 'Contains':
                        if (!dbCollation.includes(collationValue)) { return false; }
                        break;
                    case 'Not Contains':
                        if (dbCollation.includes(collationValue)) { return false; }
                        break;
                    case 'Equals':
                        if (dbCollation !== collationValue) { return false; }
                        break;
                    case 'Not Equals':
                        if (dbCollation === collationValue) { return false; }
                        break;
                }
            }

            return true;
        });
    }

    private applyTableFilter(tables: any[], filter: any): any[] {
        return tables.filter(table => {
            // Filter by name
            if (filter.name && filter.name.value) {
                const nameValue = filter.name.value.toLowerCase();
                const tableName = table.TABLE_NAME.toLowerCase();
                const operator = filter.name.operator;

                switch (operator) {
                    case 'Contains':
                        if (!tableName.includes(nameValue)) { return false; }
                        break;
                    case 'Not Contains':
                        if (tableName.includes(nameValue)) { return false; }
                        break;
                    case 'Starts With':
                        if (!tableName.startsWith(nameValue)) { return false; }
                        break;
                    case 'Not Starts With':
                        if (tableName.startsWith(nameValue)) { return false; }
                        break;
                    case 'Ends With':
                        if (!tableName.endsWith(nameValue)) { return false; }
                        break;
                    case 'Not Ends With':
                        if (tableName.endsWith(nameValue)) { return false; }
                        break;
                    case 'Equals':
                        if (tableName !== nameValue) { return false; }
                        break;
                    case 'Not Equals':
                        if (tableName === nameValue) { return false; }
                        break;
                }
            }

            // Filter by schema
            if (filter.schema && filter.schema.value) {
                const schemaValue = filter.schema.value.toLowerCase();
                const tableSchema = (table.TABLE_SCHEMA || '').toLowerCase();
                const operator = filter.schema.operator;

                switch (operator) {
                    case 'Contains':
                        if (!tableSchema.includes(schemaValue)) { return false; }
                        break;
                    case 'Not Contains':
                        if (tableSchema.includes(schemaValue)) { return false; }
                        break;
                    case 'Starts With':
                        if (!tableSchema.startsWith(schemaValue)) { return false; }
                        break;
                    case 'Not Starts With':
                        if (tableSchema.startsWith(schemaValue)) { return false; }
                        break;
                    case 'Ends With':
                        if (!tableSchema.endsWith(schemaValue)) { return false; }
                        break;
                    case 'Not Ends With':
                        if (tableSchema.endsWith(schemaValue)) { return false; }
                        break;
                    case 'Equals':
                        if (tableSchema !== schemaValue) { return false; }
                        break;
                    case 'Not Equals':
                        if (tableSchema === schemaValue) { return false; }
                        break;
                }
            }

            // Filter by owner
            if (filter.owner && filter.owner.value) {
                const ownerValue = filter.owner.value.toLowerCase();
                const tableOwner = (table.TABLE_OWNER || '').toLowerCase();
                const operator = filter.owner.operator;

                switch (operator) {
                    case 'Contains':
                        if (!tableOwner.includes(ownerValue)) { return false; }
                        break;
                    case 'Not Contains':
                        if (tableOwner.includes(ownerValue)) { return false; }
                        break;
                    case 'Starts With':
                        if (!tableOwner.startsWith(ownerValue)) { return false; }
                        break;
                    case 'Not Starts With':
                        if (tableOwner.startsWith(ownerValue)) { return false; }
                        break;
                    case 'Ends With':
                        if (!tableOwner.endsWith(ownerValue)) { return false; }
                        break;
                    case 'Not Ends With':
                        if (tableOwner.endsWith(ownerValue)) { return false; }
                        break;
                    case 'Equals':
                        if (tableOwner !== ownerValue) { return false; }
                        break;
                    case 'Not Equals':
                        if (tableOwner === ownerValue) { return false; }
                        break;
                }
            }

            return true;
        });
    }
}

// Base class for tree nodes
abstract class TreeNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
    }
}

// Server Group nodes
export class ServerGroupNode extends TreeNode {
    constructor(
        public readonly group: ServerGroup,
        public readonly connectionCount: number,
        private connectionProvider?: ConnectionProvider
    ) {
        super(
            group.name,
            connectionCount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );
        
        this.description = `${connectionCount} connection(s)`;
        this.tooltip = `${group.name}\n${group.description || ''}\n${connectionCount} connection(s)`;
        
        // Set contextValue based on group name
        // Docker group gets special contextValue to show Deploy MS SQL option
        if (group.name === 'Docker') {
            this.contextValue = 'serverGroupDocker';
        } else {
            this.contextValue = 'serverGroup';
        }
        
        // Set colored icon - use theme-aware icons
        const isOpen = this.collapsibleState === vscode.TreeItemCollapsibleState.Expanded;
        
        // Get custom icon SVG if using custom icon or Azure/Docker group
        let customIconSvg: string | undefined;
        if (group.iconType === 'custom' && group.customIconId && connectionProvider) {
            const customIcons = connectionProvider.getCustomIcons();
            const customIcon = customIcons.find(icon => icon.id === group.customIconId);
            if (customIcon) {
                customIconSvg = customIcon.svgContent;
            }
        } else if (group.name === 'Azure') {
            // Use Azure icon for Azure group (optimized for small size)
            customIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 96 96">
                <defs>
                    <linearGradient id="azure-grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0" stop-color="#114a8b"/>
                        <stop offset="1" stop-color="#0669bc"/>
                    </linearGradient>
                    <linearGradient id="azure-grad2" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0" stop-color="#3ccbf4"/>
                        <stop offset="1" stop-color="#2892df"/>
                    </linearGradient>
                </defs>
                <path fill="url(#azure-grad1)" d="M33.338 6.544h26.038l-27.03 80.087a4.152 4.152 0 0 1-3.933 2.824H8.149a4.145 4.145 0 0 1-3.928-5.47L29.404 9.368a4.152 4.152 0 0 1 3.934-2.825z"/>
                <path fill="#0078d4" d="M71.175 60.261h-41.29a1.911 1.911 0 0 0-1.305 3.309l26.532 24.764a4.171 4.171 0 0 0 2.846 1.121h23.38z"/>
                <path fill="url(#azure-grad2)" d="M66.595 9.364a4.145 4.145 0 0 0-3.928-2.82H33.648a4.146 4.146 0 0 1 3.928 2.82l25.184 74.62a4.146 4.146 0 0 1-3.928 5.472h29.02a4.146 4.146 0 0 0 3.927-5.472z"/>
            </svg>`;
        } else if (group.name === 'Docker') {
            customIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="#0DB7ED" width="800px" height="800px" viewBox="0 0 24 24" xml:space="preserve"><path d="M21.803 10.242c-.054-.043-.561-.425-1.628-.425a5.152 5.152 0 0 0-.841.072c-.207-1.417-1.378-2.107-1.43-2.138l-.287-.165-.189.272a3.851 3.851 0 0 0-.51 1.192c-.191.809-.075 1.568.336 2.218-.496.276-1.292.344-1.453.35H2.626a.626.626 0 0 0-.625.623 9.483 9.483 0 0 0 .577 3.385c.454 1.19 1.129 2.067 2.007 2.603.984.603 2.584.947 4.396.947.819.003 1.636-.072 2.441-.221a10.235 10.235 0 0 0 3.186-1.157 8.75 8.75 0 0 0 2.174-1.78c1.044-1.182 1.666-2.497 2.128-3.667h.184c1.143 0 1.846-.457 2.233-.841.258-.244.459-.542.589-.872l.084-.24-.197-.156z"><script xmlns=""/></path><path d="M3.847 11.231h1.765a.154.154 0 0 0 .154-.154V9.505a.154.154 0 0 0-.153-.155H3.847a.154.154 0 0 0-.154.154V11.078c0 .084.069.153.154.153M6.28 11.231h1.765a.154.154 0 0 0 .154-.154V9.505a.153.153 0 0 0-.153-.155H6.28a.154.154 0 0 0-.155.155v1.573c.001.084.07.153.155.153M8.75 11.231h1.765a.154.154 0 0 0 .154-.154V9.505a.154.154 0 0 0-.153-.155H8.75a.154.154 0 0 0-.154.154V11.078c0 .084.069.153.154.153M11.19 11.231h1.765a.155.155 0 0 0 .155-.154V9.505a.154.154 0 0 0-.155-.155H11.19a.154.154 0 0 0-.154.154V11.078c0 .084.069.153.154.153M6.28 8.969h1.765c.085 0 .154-.07.154-.155V7.242a.154.154 0 0 0-.154-.154H6.28a.155.155 0 0 0-.155.154v1.573c.001.084.07.154.155.154M8.75 8.969h1.765c.085 0 .154-.07.154-.155V7.242a.154.154 0 0 0-.154-.154H8.75a.154.154 0 0 0-.154.154v1.573c0 .084.069.154.154.154M11.19 8.969h1.765c.085 0 .155-.07.155-.155V7.242a.155.155 0 0 0-.155-.154H11.19a.154.154 0 0 0-.154.154v1.573c0 .084.069.154.154.154M11.19 6.706h1.765a.155.155 0 0 0 .155-.154V4.978a.155.155 0 0 0-.155-.154H11.19a.154.154 0 0 0-.154.154v1.573c0 .086.069.155.154.155M13.653 11.231h1.765a.155.155 0 0 0 .155-.154V9.505a.154.154 0 0 0-.155-.155h-1.765a.154.154 0 0 0-.154.154V11.078a.153.153 0 0 0 .154.153"/></svg>`;
        } else if (group.name === 'Local') {
            // Use Local/Server icon for Local group - theme-aware based on VS Code theme
            // Determine color based on current theme (light vs dark)
            const isDarkTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark || 
                                vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
            const strokeColor = isDarkTheme ? '#FFFFFF' : '#000000';
            
            customIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 4m0 3a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3z" />
                <path d="M3 12m0 3a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3z" />
                <path d="M7 8l0 .01" />
                <path d="M7 16l0 .01" />
                <path d="M11 8h6" />
                <path d="M11 16h6" />
            </svg>`;
        }
        
        this.iconPath = createServerGroupIcon(
            group.color || '#0078D4', 
            isOpen, 
            group.name === 'Azure' || group.name === 'Docker' || group.name === 'Local' || group.iconType === 'custom' ? 'custom' : (group.iconType || 'folder'),
            customIconSvg
        );

        // Add edit button (VS Code TreeItem button API)
        // Only available in VS Code 1.78+
        (this as any).buttons = [
            {
                iconPath: new vscode.ThemeIcon('edit'),
                tooltip: 'Edit Server Group',
                command: {
                    command: 'mssqlManager.editServerGroup',
                    title: 'Edit Server Group',
                    arguments: [this]
                }
            }
        ];
    }
}

// Server Connection nodes (connects to server, not specific database)
export class ServerConnectionNode extends TreeNode {
    public isPending: boolean = false;
    
    constructor(
        public readonly name: string,
        public readonly server: string,
        public readonly connectionId: string,
        public readonly authType: string,
        public readonly isActive: boolean,
        isPending: boolean = false,
        public readonly hasFilter: boolean = false,
        isFailed: boolean = false
    ) {
        // Determine collapsible state - Expanded when active, Collapsed otherwise
        const collapsibleState = isActive 
            ? vscode.TreeItemCollapsibleState.Expanded 
            : vscode.TreeItemCollapsibleState.Collapsed;
        
        let displayName = name;
        if (isPending) {
            displayName = `${name} (Connecting...)`;
        } else if (isFailed) {
            displayName = `${name} (Failed)`;
        }
            
        super(displayName, collapsibleState);
        
        this.isPending = isPending;
        this.description = `${server} (Server)${hasFilter ? ' (filtered)' : ''}`;
        
        let tooltipSuffix = '';
        if (isActive) {
            tooltipSuffix = '\n(Active)';
        } else if (isPending) {
            tooltipSuffix = '\n(Connecting...)';
        } else if (isFailed) {
            tooltipSuffix = '\n(Connection Failed)';
        }
        
        this.tooltip = `Server: ${server}\nAuth: ${authType}${tooltipSuffix}${hasFilter ? '\nFiltered' : ''}\nConnection Type: Server`;
        
        // Set contextValue based on connection state
        if (isActive) {
            this.contextValue = 'serverConnectionActive';
        } else if (isFailed) {
            this.contextValue = 'serverConnectionFailed';
        } else {
            this.contextValue = 'serverConnectionInactive';
        }
        
        // Set icon based on connection state
        if (isPending) {
            this.iconPath = createLoadingSpinnerIcon();
        } else if (isFailed) {
            this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
        } else if (isActive) {
            this.iconPath = new vscode.ThemeIcon('server-environment', new vscode.ThemeColor('charts.green'));
        } else {
            this.iconPath = new vscode.ThemeIcon('server-environment');
        }
        
        // Set resource URI for file decoration
        if (isActive) {
            this.resourceUri = vscode.Uri.parse(`mssql-server-connection:${connectionId}#active`);
        }
        
        // Set unique ID that changes with connection state to force VS Code to reset expand/collapse state
        this.id = `server-connection-${connectionId}-${isActive ? 'active' : 'inactive'}`;
    }
}

// Database nodes (for server connections)
export class DatabaseNode extends TreeNode {
    public database: string;
    public connectionId: string;
    
    constructor(
        database: string,
        connectionId: string,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(database, collapsibleState);
        
        this.database = database;
        this.connectionId = connectionId;
        this.contextValue = 'database';
        this.iconPath = createDatabaseIcon();
    }
}

// Security nodes
export class SecurityNode extends TreeNode {
    public connectionId: string;
    
    constructor(
        label: string,
        connectionId: string,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        
        this.connectionId = connectionId;
        this.contextValue = 'security';
        this.iconPath = new vscode.ThemeIcon('shield');
    }
}

// Login nodes
export class LoginNode extends TreeNode {
    public connectionId: string;
    public loginType: string;
    public isDisabled: boolean;
    
    constructor(
        name: string,
        connectionId: string,
        loginType: string,
        isDisabled: boolean
    ) {
        super(name, vscode.TreeItemCollapsibleState.None);
        
        this.connectionId = connectionId;
        this.loginType = loginType;
        this.isDisabled = isDisabled;
        this.contextValue = 'login';
        
        // Set icon based on login type and status
        if (isDisabled) {
            this.iconPath = new vscode.ThemeIcon('account', new vscode.ThemeColor('problemsErrorIcon.foreground'));
        } else if (loginType === 'WINDOWS_LOGIN' || loginType === 'WINDOWS_GROUP') {
            this.iconPath = new vscode.ThemeIcon('account', new vscode.ThemeColor('charts.blue'));
        } else {
            this.iconPath = new vscode.ThemeIcon('account');
        }
    }
}

// Connection nodes
export class ConnectionNode extends TreeNode {
    public isPending: boolean = false;
    
    constructor(
        public readonly name: string,
        public readonly server: string,
        public readonly database: string,
        public readonly connectionId: string,
        public readonly authType: string,
        public readonly isActive: boolean,
        isPending: boolean = false,
        isFailed: boolean = false
    ) {
        // Determine collapsible state - Expanded when active, Collapsed otherwise
        const collapsibleState = isActive 
            ? vscode.TreeItemCollapsibleState.Expanded 
            : vscode.TreeItemCollapsibleState.Collapsed;
        
        let displayName = name;
        if (isPending) {
            displayName = `${name} (Connecting...)`;
        } else if (isFailed) {
            displayName = `${name} (Failed)`;
        }
            
        super(displayName, collapsibleState);
        
        this.isPending = isPending;
        this.description = `${server}/${database}`;
        
        let tooltipSuffix = '';
        if (isActive) {
            tooltipSuffix = '\n(Active)';
        } else if (isPending) {
            tooltipSuffix = '\n(Connecting...)';
        } else if (isFailed) {
            tooltipSuffix = '\n(Connection Failed)';
        }
        
        this.tooltip = `Server: ${server}\nDatabase: ${database}\nAuth: ${authType}${tooltipSuffix}`;
        
        // Set contextValue based on connection state
        if (isActive) {
            this.contextValue = 'connectionActive';
        } else if (isFailed) {
            this.contextValue = 'connectionFailed';
        } else {
            this.contextValue = 'connectionInactive';
        }
        
        // Set icon based on connection state
        if (isPending) {
            this.iconPath = createLoadingSpinnerIcon();
        } else if (isActive) {
            this.iconPath = createDatabaseIcon(true);
        } else if (isFailed) {
            this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
        } else {
            this.iconPath = createDatabaseIcon();
        }
        
        // Set resource URI for file decoration
        if (isActive) {
            this.resourceUri = vscode.Uri.parse(`mssql-connection:${connectionId}#active`);
        }
        
        // Set unique ID that changes with connection state to force VS Code to reset expand/collapse state
        this.id = `connection-${connectionId}-${isActive ? 'active' : 'inactive'}`;
        
        // Don't add click command - let expand/collapse work naturally
        // Connection will happen automatically when user expands the node
    }
}

// Schema item nodes (tables, views, procedures, columns, etc.)
export class SchemaItemNode extends TreeNode {
    public connectionId?: string;
    public database?: string;
    public name?: string;
    
    constructor(
        public readonly label: string,
        public readonly itemType: string,
        public readonly schema: string,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        
        this.contextValue = itemType;
        this.schema = schema;
        
        // Set icons based on item type (theme-aware for schema items)
        switch (itemType) {
            case 'tables':
                this.iconPath = new vscode.ThemeIcon('folder');
                break;
            case 'views':
                this.iconPath = new vscode.ThemeIcon('folder');
                break;
            case 'procedures':
                this.iconPath = new vscode.ThemeIcon('folder');
                break;
            case 'programmability':
                this.iconPath = new vscode.ThemeIcon('folder');
                break;
            case 'stored-procedures':
                this.iconPath = createStoredProcedureIcon();
                this.contextValue = 'stored-procedures';
                break;
            case 'functions':
                this.iconPath = createFunctionIcon();
                break;
            case 'table-valued-functions':
            case 'scalar-valued-functions':
            case 'aggregate-functions':
                this.iconPath = new vscode.ThemeIcon('symbol-method');
                break;
            case 'function':
                this.iconPath = createFunctionIcon();
                break;
            case 'database-triggers':
                this.iconPath = createTriggerIcon();
                break;
            case 'database-trigger':
                this.iconPath = createTriggerIcon();
                break;
            case 'assemblies':
                this.iconPath = createAssemblyIcon();
                break;
            case 'assembly':
                this.iconPath = createAssemblyIcon();
                break;
            case 'types':
                this.iconPath = createTypeIcon();
                break;
            case 'user-defined-data-types':
            case 'user-defined-table-types':
            case 'clr-types':
            case 'xml-schema-collections':
                this.iconPath = new vscode.ThemeIcon('symbol-class');
                break;
            case 'user-defined-type':
            case 'user-defined-table-type':
            case 'clr-type':
            case 'xml-schema-collection':
                this.iconPath = createTypeIcon();
                break;
            case 'sequences':
                this.iconPath = createSequenceIcon();
                break;
            case 'sequence':
                this.iconPath = createSequenceIcon();
                break;
            case 'synonyms':
                this.iconPath = createSynonymIcon();
                break;
            case 'synonym':
                this.iconPath = createSynonymIcon();
                break;
            case 'rules':
            case 'rule':
                this.iconPath = new vscode.ThemeIcon('symbol-ruler');
                break;
            case 'defaults':
            case 'default':
                this.iconPath = new vscode.ThemeIcon('symbol-constant');
                break;
            case 'system-procedures':
            case 'extended-procedures':
                this.iconPath = new vscode.ThemeIcon('package');
                break;
            case 'table':
                this.iconPath = createTableIcon();
                this.contextValue = 'table';
                break;
            case 'view':
                this.iconPath = createViewIcon();
                this.contextValue = 'view';
                break;
            case 'procedure':
                this.iconPath = createStoredProcedureIcon();
                this.contextValue = 'procedure';
                break;
            case 'columns':
                this.iconPath = createColumnIcon();
                break;
            case 'column':
                // Individual columns use a simple theme icon, not the columns aggregate icon
                this.iconPath = new vscode.ThemeIcon('symbol-field');
                break;
            case 'keys':
                this.iconPath = new vscode.ThemeIcon('key');
                break;
            case 'key':
                this.iconPath = new vscode.ThemeIcon('symbol-key');
                break;
            case 'constraints':
                this.iconPath = new vscode.ThemeIcon('shield');
                break;
            case 'constraint':
                this.iconPath = new vscode.ThemeIcon('symbol-ruler');
                break;
            case 'triggers':
                this.iconPath = new vscode.ThemeIcon('zap');
                break;
            case 'trigger':
                this.iconPath = new vscode.ThemeIcon('symbol-event');
                break;
            case 'indexes':
                this.iconPath = new vscode.ThemeIcon('list-tree');
                break;
            case 'index':
                this.iconPath = new vscode.ThemeIcon('symbol-array');
                break;
            case 'statistics':
                this.iconPath = new vscode.ThemeIcon('graph');
                break;
            case 'statistic':
                this.iconPath = new vscode.ThemeIcon('symbol-numeric');
                break;
            default:
                this.iconPath = new vscode.ThemeIcon('circle-outline');
        }
    }
}