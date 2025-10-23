import * as vscode from 'vscode';
import { ConnectionProvider, ConnectionConfig, ServerGroup } from './connectionProvider';
import { createServerGroupIcon, createFolderIcon } from './serverGroupIcon';

export class UnifiedTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(
        private connectionProvider: ConnectionProvider,
        private outputChannel: vscode.OutputChannel
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
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
                    nodes.push(new ServerGroupNode(group, groupConnections.length));
                }
                
                // Add ungrouped connections
                const ungroupedConnections = connections.filter(conn => !conn.serverGroupId);
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${ungroupedConnections.length} ungrouped connections: ${JSON.stringify(ungroupedConnections.map(c => c.name))}`);
                for (const conn of ungroupedConnections) {
                    nodes.push(new ConnectionNode(
                        conn.name,
                        conn.server,
                        conn.database,
                        conn.id,
                        conn.authType || 'sql',
                        this.connectionProvider.isConnectionActive(conn.id)
                    ));
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
                
                return groupConnections.map(conn => new ConnectionNode(
                    conn.name,
                    conn.server,
                    conn.database,
                    conn.id,
                    conn.authType || 'sql',
                    this.connectionProvider.isConnectionActive(conn.id)
                ));
            } catch (error) {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading group connections: ${error}`);
                return [];
            }
        } else if (element instanceof ConnectionNode) {
            // Show schema for this specific connection
            if (this.connectionProvider.isConnectionActive(element.connectionId)) {
                // If this connection is active, show current schema
                return await this.getSchemaChildren(element.connectionId);
            } else {
                // Not active connection - show nothing or offer to connect
                return [];
            }
        } else if (element instanceof SchemaItemNode) {
            // Handle schema expansion (tables, views, etc.)
            return await this.getSchemaItemChildren(element);
        }
        
        return [];
    }

    private async getSchemaChildren(connectionId: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading schema for connection ${connectionId}...`);
            
            const items: SchemaItemNode[] = [];
            
            // Get tables
            const tablesQuery = `
                SELECT TABLE_NAME, TABLE_SCHEMA 
                FROM INFORMATION_SCHEMA.TABLES 
                WHERE TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_SCHEMA, TABLE_NAME
            `;
            
            const tablesRequest = connection.request();
            const tablesResult = await tablesRequest.query(tablesQuery);
            
            // Group tables by schema
            const tablesBySchema: { [schema: string]: any[] } = {};
            tablesResult.recordset.forEach((table: any) => {
                const schema = table.TABLE_SCHEMA;
                if (!tablesBySchema[schema]) {
                    tablesBySchema[schema] = [];
                }
                tablesBySchema[schema].push(table);
            });
            
            // Add schema nodes with tables - use folder icons
            for (const [schema, tables] of Object.entries(tablesBySchema)) {
                const tablesNode = new SchemaItemNode(
                    `Tables (${tables.length})`,
                    'tables',
                    schema,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                tablesNode.connectionId = connectionId;
                items.push(tablesNode);
            }
            
            // Get views
            const viewsQuery = `
                SELECT TABLE_NAME, TABLE_SCHEMA 
                FROM INFORMATION_SCHEMA.VIEWS 
                ORDER BY TABLE_SCHEMA, TABLE_NAME
            `;
            
            const viewsRequest = connection.request();
            const viewsResult = await viewsRequest.query(viewsQuery);
            
            if (viewsResult.recordset.length > 0) {
                const viewsNode = new SchemaItemNode(
                    `Views (${viewsResult.recordset.length})`,
                    'views',
                    'dbo',
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                viewsNode.connectionId = connectionId;
                items.push(viewsNode);
            }
            
            // Get stored procedures
            const procsQuery = `
                SELECT ROUTINE_NAME, ROUTINE_SCHEMA 
                FROM INFORMATION_SCHEMA.ROUTINES 
                WHERE ROUTINE_TYPE = 'PROCEDURE'
                ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
            `;
            
            const procsRequest = connection.request();
            const procsResult = await procsRequest.query(procsQuery);
            
            if (procsResult.recordset.length > 0) {
                const procsNode = new SchemaItemNode(
                    `Stored Procedures (${procsResult.recordset.length})`,
                    'procedures',
                    'dbo',
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                procsNode.connectionId = connectionId;
                items.push(procsNode);
            }
            
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Loaded ${items.length} schema categories`);
            return items;
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading schema: ${error}`);
            return [];
        }
    }

    private async getSchemaItemChildren(element: SchemaItemNode): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection(element.connectionId);
        if (!connection) {
            return [];
        }

        try {
            if (element.itemType === 'tables') {
                const query = `
                    SELECT TABLE_NAME, TABLE_SCHEMA 
                    FROM INFORMATION_SCHEMA.TABLES 
                    WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = '${element.schema}'
                    ORDER BY TABLE_NAME
                `;
                
                const request = connection.request();
                const result = await request.query(query);
                
                return result.recordset.map((table: any) => {
                    const tableNode = new SchemaItemNode(
                        table.TABLE_NAME,
                        'table',
                        table.TABLE_SCHEMA,
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    tableNode.connectionId = element.connectionId;
                    return tableNode;
                });
            } else if (element.itemType === 'views') {
                const query = `
                    SELECT TABLE_NAME, TABLE_SCHEMA 
                    FROM INFORMATION_SCHEMA.VIEWS 
                    ORDER BY TABLE_NAME
                `;
                
                const request = connection.request();
                const result = await request.query(query);
                
                return result.recordset.map((view: any) => {
                    const viewNode = new SchemaItemNode(
                        view.TABLE_NAME,
                        'view',
                        view.TABLE_SCHEMA,
                        vscode.TreeItemCollapsibleState.None
                    );
                    viewNode.connectionId = element.connectionId;
                    return viewNode;
                });
            } else if (element.itemType === 'procedures') {
                const query = `
                    SELECT ROUTINE_NAME, ROUTINE_SCHEMA 
                    FROM INFORMATION_SCHEMA.ROUTINES 
                    WHERE ROUTINE_TYPE = 'PROCEDURE'
                    ORDER BY ROUTINE_NAME
                `;
                
                const request = connection.request();
                const result = await request.query(query);
                
                return result.recordset.map((proc: any) => {
                    const procNode = new SchemaItemNode(
                        proc.ROUTINE_NAME,
                        'procedure',
                        proc.ROUTINE_SCHEMA,
                        vscode.TreeItemCollapsibleState.None
                    );
                    procNode.connectionId = element.connectionId;
                    return procNode;
                });
            } else if (element.itemType === 'table') {
                // Show table details (columns, keys, etc.)
                return await this.getTableDetails(element.label as string, element.schema, element.connectionId!);
            } else if (element.itemType === 'columns') {
                // Show individual columns - get table name from stored property
                const tableName = (element as any).tableName;
                if (tableName) {
                    return await this.getColumnDetails(tableName, element.schema, element.connectionId!);
                }
                return [];
            }
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading ${element.itemType}: ${error}`);
        }
        
        return [];
    }

    private async getTableDetails(tableName: string, schema: string, connectionId: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
            const items: SchemaItemNode[] = [];
            
            // Get columns
            const columnsQuery = `
                SELECT 
                    COLUMN_NAME,
                    DATA_TYPE,
                    IS_NULLABLE,
                    COLUMN_DEFAULT,
                    CHARACTER_MAXIMUM_LENGTH
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = '${tableName}' AND TABLE_SCHEMA = '${schema}'
                ORDER BY ORDINAL_POSITION
            `;
            
            const columnsRequest = connection.request();
            const columnsResult = await columnsRequest.query(columnsQuery);
            
            if (columnsResult.recordset.length > 0) {
                const columnsNode = new SchemaItemNode(
                    `Columns (${columnsResult.recordset.length})`,
                    'columns',
                    schema,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                // Store table name and connection ID for later use
                (columnsNode as any).tableName = tableName;
                columnsNode.connectionId = connectionId;
                items.push(columnsNode);
            }
            
            return items;
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading table details: ${error}`);
            return [];
        }
    }

    private async getColumnDetails(tableName: string, schema: string, connectionId: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
            const columnsQuery = `
                SELECT 
                    COLUMN_NAME,
                    DATA_TYPE,
                    IS_NULLABLE,
                    COLUMN_DEFAULT,
                    CHARACTER_MAXIMUM_LENGTH,
                    NUMERIC_PRECISION,
                    NUMERIC_SCALE
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = '${tableName}' AND TABLE_SCHEMA = '${schema}'
                ORDER BY ORDINAL_POSITION
            `;
            
            const columnsRequest = connection.request();
            const columnsResult = await columnsRequest.query(columnsQuery);
            
            return columnsResult.recordset.map((column: any) => {
                const dataType = column.CHARACTER_MAXIMUM_LENGTH 
                    ? `${column.DATA_TYPE}(${column.CHARACTER_MAXIMUM_LENGTH})`
                    : column.NUMERIC_PRECISION 
                        ? `${column.DATA_TYPE}(${column.NUMERIC_PRECISION},${column.NUMERIC_SCALE || 0})`
                        : column.DATA_TYPE;
                        
                const nullable = column.IS_NULLABLE === 'YES' ? ' (nullable)' : ' (not null)';
                const defaultValue = column.COLUMN_DEFAULT ? ` default: ${column.COLUMN_DEFAULT}` : '';
                
                const columnNode = new SchemaItemNode(
                    column.COLUMN_NAME,
                    'column',
                    schema,
                    vscode.TreeItemCollapsibleState.None
                );
                
                // Add detailed tooltip and description
                columnNode.description = dataType + nullable;
                columnNode.tooltip = `${column.COLUMN_NAME}: ${dataType}${nullable}${defaultValue}`;
                columnNode.connectionId = connectionId;
                
                return columnNode;
            });
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading column details: ${error}`);
            return [];
        }
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
        public readonly connectionCount: number
    ) {
        super(
            group.name,
            connectionCount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );
        
        this.description = `${connectionCount} connection(s)`;
        this.tooltip = `${group.name}\n${group.description || ''}\n${connectionCount} connection(s)`;
        this.contextValue = 'serverGroup';
        
        // Set colored icon
        this.iconPath = createServerGroupIcon(group.color);
    }
}

// Connection nodes
export class ConnectionNode extends TreeNode {
    constructor(
        public readonly name: string,
        public readonly server: string,
        public readonly database: string,
        public readonly connectionId: string,
        public readonly authType: string,
        public readonly isActive: boolean
    ) {
        // Determine collapsible state based on active status
        const collapsibleState = isActive 
            ? vscode.TreeItemCollapsibleState.Expanded 
            : vscode.TreeItemCollapsibleState.Collapsed;
            
        super(
            isActive ? `${name} (Active)` : name, 
            collapsibleState
        );
        
        this.description = `${server}/${database}`;
        this.tooltip = `Server: ${server}\nDatabase: ${database}\nAuth: ${authType}${isActive ? '\n(Active)' : ''}`;
        this.contextValue = 'connection';
        
        // Set icon based on active state
        if (isActive) {
            this.iconPath = new vscode.ThemeIcon('database', new vscode.ThemeColor('charts.green'));
        } else {
            this.iconPath = new vscode.ThemeIcon('database');
        }
        
        // Add command to connect on click (will trigger expansion)
        this.command = {
            command: 'mssqlManager.connectToSaved',
            title: 'Connect',
            arguments: [this]
        };
    }
}

// Schema item nodes (tables, views, procedures, columns, etc.)
export class SchemaItemNode extends TreeNode {
    public connectionId?: string;
    
    constructor(
        public readonly label: string,
        public readonly itemType: string,
        public readonly schema: string,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        
        this.contextValue = itemType;
        this.schema = schema;
        
        // Set icons based on item type - use folder icons for database-level items
        switch (itemType) {
            case 'tables':
            case 'views':  
            case 'procedures':
                this.iconPath = createFolderIcon();
                break;
            case 'table':
                this.iconPath = createFolderIcon();
                this.contextValue = 'table';
                break;
            case 'view':
                this.iconPath = createFolderIcon();
                this.contextValue = 'view';
                break;
            case 'procedure':
                this.iconPath = createFolderIcon();
                break;
            case 'columns':
                this.iconPath = new vscode.ThemeIcon('symbol-field');
                break;
            case 'column':
                this.iconPath = new vscode.ThemeIcon('symbol-property');
                break;
            default:
                this.iconPath = new vscode.ThemeIcon('circle-outline');
        }
    }
}