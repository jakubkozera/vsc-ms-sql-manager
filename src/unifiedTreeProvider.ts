import * as vscode from 'vscode';
import { ConnectionProvider, ConnectionConfig } from './connectionProvider';

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
            // Root level - show saved connections directly
            try {
                const connections = await this.connectionProvider.getSavedConnectionsList();
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${connections.length} saved connections`);
                
                return connections.map(conn => new ConnectionNode(
                    conn.name,
                    conn.server,
                    conn.database,
                    conn.id,
                    conn.authType || 'sql',
                    this.connectionProvider.isCurrentConnection(conn)
                ));
            } catch (error) {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading connections: ${error}`);
                return [];
            }
        } else if (element instanceof ConnectionNode) {
            // Show schema for this specific connection
            if (this.connectionProvider.isCurrentConnection({ id: element.connectionId } as any)) {
                // If this is the active connection, show current schema
                return await this.getSchemaChildren();
            } else {
                // Not active connection - could auto-connect or show message
                return [];
            }
        } else if (element instanceof SchemaItemNode) {
            // Handle schema expansion (tables, views, etc.)
            return await this.getSchemaItemChildren(element);
        }
        
        return [];
    }

    private async getSchemaChildren(): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection();
        if (!connection) {
            return [];
        }

        try {
            this.outputChannel.appendLine('[UnifiedTreeProvider] Loading schema...');
            
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
            
            // Add schema nodes with tables
            for (const [schema, tables] of Object.entries(tablesBySchema)) {
                items.push(new SchemaItemNode(
                    `Tables (${tables.length})`,
                    'tables',
                    schema,
                    vscode.TreeItemCollapsibleState.Collapsed
                ));
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
                items.push(new SchemaItemNode(
                    `Views (${viewsResult.recordset.length})`,
                    'views',
                    'dbo',
                    vscode.TreeItemCollapsibleState.Collapsed
                ));
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
                items.push(new SchemaItemNode(
                    `Stored Procedures (${procsResult.recordset.length})`,
                    'procedures',
                    'dbo',
                    vscode.TreeItemCollapsibleState.Collapsed
                ));
            }
            
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Loaded ${items.length} schema categories`);
            return items;
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading schema: ${error}`);
            return [];
        }
    }

    private async getSchemaItemChildren(element: SchemaItemNode): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection();
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
                
                return result.recordset.map((table: any) => 
                    new SchemaItemNode(
                        table.TABLE_NAME,
                        'table',
                        table.TABLE_SCHEMA,
                        vscode.TreeItemCollapsibleState.Collapsed
                    )
                );
            } else if (element.itemType === 'views') {
                const query = `
                    SELECT TABLE_NAME, TABLE_SCHEMA 
                    FROM INFORMATION_SCHEMA.VIEWS 
                    ORDER BY TABLE_NAME
                `;
                
                const request = connection.request();
                const result = await request.query(query);
                
                return result.recordset.map((view: any) => 
                    new SchemaItemNode(
                        view.TABLE_NAME,
                        'view',
                        view.TABLE_SCHEMA,
                        vscode.TreeItemCollapsibleState.None
                    )
                );
            } else if (element.itemType === 'procedures') {
                const query = `
                    SELECT ROUTINE_NAME, ROUTINE_SCHEMA 
                    FROM INFORMATION_SCHEMA.ROUTINES 
                    WHERE ROUTINE_TYPE = 'PROCEDURE'
                    ORDER BY ROUTINE_NAME
                `;
                
                const request = connection.request();
                const result = await request.query(query);
                
                return result.recordset.map((proc: any) => 
                    new SchemaItemNode(
                        proc.ROUTINE_NAME,
                        'procedure',
                        proc.ROUTINE_SCHEMA,
                        vscode.TreeItemCollapsibleState.None
                    )
                );
            } else if (element.itemType === 'table') {
                // Show table details (columns, keys, etc.)
                return await this.getTableDetails(element.label as string, element.schema);
            } else if (element.itemType === 'columns') {
                // Show individual columns - get table name from stored property
                const tableName = (element as any).tableName;
                if (tableName) {
                    return await this.getColumnDetails(tableName, element.schema);
                }
                return [];
            }
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading ${element.itemType}: ${error}`);
        }
        
        return [];
    }

    private async getTableDetails(tableName: string, schema: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection();
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
                // Store table name for later use
                (columnsNode as any).tableName = tableName;
                items.push(columnsNode);
            }
            
            return items;
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading table details: ${error}`);
            return [];
        }
    }

    private async getColumnDetails(tableName: string, schema: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection();
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
    constructor(
        public readonly label: string,
        public readonly itemType: string,
        public readonly schema: string,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        
        this.contextValue = itemType;
        this.schema = schema;
        
        // Set icons based on item type
        switch (itemType) {
            case 'tables':
                this.iconPath = new vscode.ThemeIcon('table');
                break;
            case 'views':
                this.iconPath = new vscode.ThemeIcon('mirror');
                break;
            case 'procedures':
                this.iconPath = new vscode.ThemeIcon('gear');
                break;
            case 'table':
                this.iconPath = new vscode.ThemeIcon('table');
                this.contextValue = 'table';
                break;
            case 'view':
                this.iconPath = new vscode.ThemeIcon('mirror');
                this.contextValue = 'view';
                break;
            case 'procedure':
                this.iconPath = new vscode.ThemeIcon('gear');
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