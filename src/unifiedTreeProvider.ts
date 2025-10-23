import * as vscode from 'vscode';
import { ConnectionProvider, ConnectionConfig, ServerGroup } from './connectionProvider';
import { createServerGroupIcon, createTableIcon, createColumnIcon, createStoredProcedureIcon, createViewIcon, createLoadingSpinnerIcon, createDatabaseIcon } from './serverGroupIcon';

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
                        this.connectionProvider.isConnectionActive(conn.id),
                        this.connectionProvider.isConnectionPending(conn.id)
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
                    this.connectionProvider.isConnectionActive(conn.id),
                    this.connectionProvider.isConnectionPending(conn.id)
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
            
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${tablesResult.recordset.length} tables`);
            
            // Group tables by schema
            const tablesBySchema: { [schema: string]: any[] } = {};
            tablesResult.recordset.forEach((table: any) => {
                const schema = table.TABLE_SCHEMA;
                if (!tablesBySchema[schema]) {
                    tablesBySchema[schema] = [];
                }
                tablesBySchema[schema].push(table);
            });
            
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Tables grouped by schema: ${JSON.stringify(Object.keys(tablesBySchema).map(schema => `${schema}: ${tablesBySchema[schema].length}`))}`);
            
            // Add a single "Tables" node instead of one per schema
            if (tablesResult.recordset.length > 0) {
                const tablesNode = new SchemaItemNode(
                    `Tables (${tablesResult.recordset.length})`,
                    'tables',
                    'all', // Use 'all' to indicate all schemas
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                tablesNode.connectionId = connectionId;
                items.push(tablesNode);
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Added single Tables node with ${tablesResult.recordset.length} tables`);
            }
            
            // Get views
            const viewsQuery = `
                SELECT TABLE_NAME, TABLE_SCHEMA 
                FROM INFORMATION_SCHEMA.VIEWS 
                ORDER BY TABLE_SCHEMA, TABLE_NAME
            `;
            
            const viewsRequest = connection.request();
            const viewsResult = await viewsRequest.query(viewsQuery);
            
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${viewsResult.recordset.length} views`);
            
            if (viewsResult.recordset.length > 0) {
                const viewsNode = new SchemaItemNode(
                    `Views (${viewsResult.recordset.length})`,
                    'views',
                    'all',
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
            
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${procsResult.recordset.length} stored procedures`);
            
            if (procsResult.recordset.length > 0) {
                const procsNode = new SchemaItemNode(
                    `Stored Procedures (${procsResult.recordset.length})`,
                    'procedures',
                    'all',
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                procsNode.connectionId = connectionId;
                items.push(procsNode);
            }
            
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Total schema items created: ${items.length}`);
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
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading all tables for schema: ${element.schema}`);
                
                // Load all tables regardless of schema since we now have a single "Tables" node
                const query = `
                    SELECT TABLE_NAME, TABLE_SCHEMA 
                    FROM INFORMATION_SCHEMA.TABLES 
                    WHERE TABLE_TYPE = 'BASE TABLE'
                    ORDER BY TABLE_SCHEMA, TABLE_NAME
                `;
                
                const request = connection.request();
                const result = await request.query(query);
                
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${result.recordset.length} tables to display`);
                
                return result.recordset.map((table: any) => {
                    const tableNode = new SchemaItemNode(
                        `${table.TABLE_SCHEMA}.${table.TABLE_NAME}`, // Simple format: schema.tableName
                        'table',
                        table.TABLE_SCHEMA,
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    tableNode.connectionId = element.connectionId;
                    return tableNode;
                });
            } else if (element.itemType === 'views') {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading all views`);
                
                const query = `
                    SELECT TABLE_NAME, TABLE_SCHEMA 
                    FROM INFORMATION_SCHEMA.VIEWS 
                    ORDER BY TABLE_SCHEMA, TABLE_NAME
                `;
                
                const request = connection.request();
                const result = await request.query(query);
                
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${result.recordset.length} views to display`);
                
                return result.recordset.map((view: any) => {
                    const viewNode = new SchemaItemNode(
                        `${view.TABLE_SCHEMA}.${view.TABLE_NAME}`, // Simple format: schema.tableName
                        'view',
                        view.TABLE_SCHEMA,
                        vscode.TreeItemCollapsibleState.None
                    );
                    viewNode.connectionId = element.connectionId;
                    return viewNode;
                });
            } else if (element.itemType === 'procedures') {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading all procedures`);
                
                const query = `
                    SELECT ROUTINE_NAME, ROUTINE_SCHEMA 
                    FROM INFORMATION_SCHEMA.ROUTINES 
                    WHERE ROUTINE_TYPE = 'PROCEDURE'
                    ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
                `;
                
                const request = connection.request();
                const result = await request.query(query);
                
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${result.recordset.length} procedures to display`);
                
                return result.recordset.map((proc: any) => {
                    const procNode = new SchemaItemNode(
                        `${proc.ROUTINE_SCHEMA}.${proc.ROUTINE_NAME}`, // Simple format: schema.procedureName
                        'procedure',
                        proc.ROUTINE_SCHEMA,
                        vscode.TreeItemCollapsibleState.None
                    );
                    procNode.connectionId = element.connectionId;
                    return procNode;
                });
            } else if (element.itemType === 'table') {
                // Show table details (columns, keys, etc.)
                // Extract table name from label format schema.tableName
                const fullLabel = element.label as string;
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Expanding table with label: ${fullLabel}`);
                
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
                
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Parsed table: ${tableName}, schema: ${schema}`);
                return await this.getTableDetails(tableName, schema, element.connectionId!);
            } else if (element.itemType === 'columns') {
                // Show individual columns - get table name from stored property
                const tableName = (element as any).tableName;
                if (tableName) {
                    return await this.getColumnDetails(tableName, element.schema, element.connectionId!);
                }
                return [];
            } else if (element.itemType === 'keys') {
                const tableName = (element as any).tableName;
                if (tableName) {
                    return await this.getKeyDetails(tableName, element.schema, element.connectionId!);
                }
                return [];
            } else if (element.itemType === 'constraints') {
                const tableName = (element as any).tableName;
                if (tableName) {
                    return await this.getConstraintDetails(tableName, element.schema, element.connectionId!);
                }
                return [];
            } else if (element.itemType === 'triggers') {
                const tableName = (element as any).tableName;
                if (tableName) {
                    return await this.getTriggerDetails(tableName, element.schema, element.connectionId!);
                }
                return [];
            } else if (element.itemType === 'indexes') {
                const tableName = (element as any).tableName;
                if (tableName) {
                    return await this.getIndexDetails(tableName, element.schema, element.connectionId!);
                }
                return [];
            } else if (element.itemType === 'statistics') {
                const tableName = (element as any).tableName;
                if (tableName) {
                    return await this.getStatisticsDetails(tableName, element.schema, element.connectionId!);
                }
                return [];
            }
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading ${element.itemType}: ${error}`);
        }
        
        return [];
    }

    private async getTableDetails(tableName: string, schema: string, connectionId: string): Promise<SchemaItemNode[]> {
        this.outputChannel.appendLine(`[UnifiedTreeProvider] Getting table details for: ${tableName} in schema: ${schema}`);
        
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] No connection found for connectionId: ${connectionId}`);
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
            
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Executing columns query: ${columnsQuery}`);
            
            const columnsRequest = connection.request();
            const columnsResult = await columnsRequest.query(columnsQuery);
            
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${columnsResult.recordset.length} columns for table ${tableName}`);
            
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
                
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Created columns node for table ${tableName}`);
            }
            
            // Get Keys (Primary Keys, Foreign Keys, Unique Keys)
            const keysQuery = `
                SELECT 
                    tc.CONSTRAINT_NAME,
                    tc.CONSTRAINT_TYPE,
                    STRING_AGG(kcu.COLUMN_NAME, ', ') AS COLUMNS
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
                    ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME 
                    AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
                WHERE tc.TABLE_NAME = '${tableName}' AND tc.TABLE_SCHEMA = '${schema}'
                    AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')
                GROUP BY tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE
            `;
            
            const keysRequest = connection.request();
            const keysResult = await keysRequest.query(keysQuery);
            
            if (keysResult.recordset.length > 0) {
                const keysNode = new SchemaItemNode(
                    `Keys (${keysResult.recordset.length})`,
                    'keys',
                    schema,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                (keysNode as any).tableName = tableName;
                keysNode.connectionId = connectionId;
                items.push(keysNode);
            }
            
            // Get Constraints (Check Constraints)
            const constraintsQuery = `
                SELECT 
                    CONSTRAINT_NAME,
                    CHECK_CLAUSE
                FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
                WHERE EXISTS (
                    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                    WHERE tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
                        AND tc.TABLE_NAME = '${tableName}'
                        AND tc.TABLE_SCHEMA = '${schema}'
                )
            `;
            
            const constraintsRequest = connection.request();
            const constraintsResult = await constraintsRequest.query(constraintsQuery);
            
            if (constraintsResult.recordset.length > 0) {
                const constraintsNode = new SchemaItemNode(
                    `Constraints (${constraintsResult.recordset.length})`,
                    'constraints',
                    schema,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                (constraintsNode as any).tableName = tableName;
                constraintsNode.connectionId = connectionId;
                items.push(constraintsNode);
            }
            
            // Get Triggers
            const triggersQuery = `
                SELECT 
                    name,
                    is_disabled,
                    is_instead_of_trigger
                FROM sys.triggers
                WHERE parent_id = OBJECT_ID('${schema}.${tableName}')
            `;
            
            const triggersRequest = connection.request();
            const triggersResult = await triggersRequest.query(triggersQuery);
            
            if (triggersResult.recordset.length > 0) {
                const triggersNode = new SchemaItemNode(
                    `Triggers (${triggersResult.recordset.length})`,
                    'triggers',
                    schema,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                (triggersNode as any).tableName = tableName;
                triggersNode.connectionId = connectionId;
                items.push(triggersNode);
            }
            
            // Get Indexes
            const indexesQuery = `
                SELECT 
                    i.name,
                    i.type_desc,
                    i.is_unique,
                    i.is_primary_key,
                    STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
                FROM sys.indexes i
                INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                WHERE i.object_id = OBJECT_ID('${schema}.${tableName}')
                    AND i.type > 0
                GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key
            `;
            
            const indexesRequest = connection.request();
            const indexesResult = await indexesRequest.query(indexesQuery);
            
            if (indexesResult.recordset.length > 0) {
                const indexesNode = new SchemaItemNode(
                    `Indexes (${indexesResult.recordset.length})`,
                    'indexes',
                    schema,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                (indexesNode as any).tableName = tableName;
                indexesNode.connectionId = connectionId;
                items.push(indexesNode);
            }
            
            // Get Statistics
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
            
            const statisticsRequest = connection.request();
            const statisticsResult = await statisticsRequest.query(statisticsQuery);
            
            if (statisticsResult.recordset.length > 0) {
                const statisticsNode = new SchemaItemNode(
                    `Statistics (${statisticsResult.recordset.length})`,
                    'statistics',
                    schema,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                (statisticsNode as any).tableName = tableName;
                statisticsNode.connectionId = connectionId;
                items.push(statisticsNode);
            }
            
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Returning ${items.length} items for table ${tableName}`);
            return items;
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading table details for ${tableName}: ${error}`);
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

    private async getKeyDetails(tableName: string, schema: string, connectionId: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
            const keysQuery = `
                SELECT 
                    tc.CONSTRAINT_NAME,
                    tc.CONSTRAINT_TYPE,
                    STRING_AGG(kcu.COLUMN_NAME, ', ') AS COLUMNS
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
                    ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME 
                    AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
                WHERE tc.TABLE_NAME = '${tableName}' AND tc.TABLE_SCHEMA = '${schema}'
                    AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')
                GROUP BY tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE
            `;
            
            const keysRequest = connection.request();
            const keysResult = await keysRequest.query(keysQuery);
            
            return keysResult.recordset.map((key: any) => {
                const keyNode = new SchemaItemNode(
                    key.CONSTRAINT_NAME,
                    'key',
                    schema,
                    vscode.TreeItemCollapsibleState.None
                );
                
                keyNode.description = key.CONSTRAINT_TYPE;
                keyNode.tooltip = `${key.CONSTRAINT_NAME}\nType: ${key.CONSTRAINT_TYPE}\nColumns: ${key.COLUMNS}`;
                keyNode.connectionId = connectionId;
                
                return keyNode;
            });
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading key details: ${error}`);
            return [];
        }
    }

    private async getConstraintDetails(tableName: string, schema: string, connectionId: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
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
            
            const constraintsRequest = connection.request();
            const constraintsResult = await constraintsRequest.query(constraintsQuery);
            
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
                
                return constraintNode;
            });
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading constraint details: ${error}`);
            return [];
        }
    }

    private async getTriggerDetails(tableName: string, schema: string, connectionId: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
            const triggersQuery = `
                SELECT 
                    name,
                    is_disabled,
                    is_instead_of_trigger
                FROM sys.triggers
                WHERE parent_id = OBJECT_ID('${schema}.${tableName}')
            `;
            
            const triggersRequest = connection.request();
            const triggersResult = await triggersRequest.query(triggersQuery);
            
            return triggersResult.recordset.map((trigger: any) => {
                const triggerNode = new SchemaItemNode(
                    trigger.name,
                    'trigger',
                    schema,
                    vscode.TreeItemCollapsibleState.None
                );
                
                const status = trigger.is_disabled ? 'Disabled' : 'Enabled';
                const type = trigger.is_instead_of_trigger ? 'INSTEAD OF' : 'AFTER';
                
                triggerNode.description = `${type} - ${status}`;
                triggerNode.tooltip = `${trigger.name}\nType: ${type}\nStatus: ${status}`;
                triggerNode.connectionId = connectionId;
                
                return triggerNode;
            });
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading trigger details: ${error}`);
            return [];
        }
    }

    private async getIndexDetails(tableName: string, schema: string, connectionId: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
            const indexesQuery = `
                SELECT 
                    i.name,
                    i.type_desc,
                    i.is_unique,
                    i.is_primary_key,
                    STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
                FROM sys.indexes i
                INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                WHERE i.object_id = OBJECT_ID('${schema}.${tableName}')
                    AND i.type > 0
                GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key
            `;
            
            const indexesRequest = connection.request();
            const indexesResult = await indexesRequest.query(indexesQuery);
            
            return indexesResult.recordset.map((index: any) => {
                const indexNode = new SchemaItemNode(
                    index.name,
                    'index',
                    schema,
                    vscode.TreeItemCollapsibleState.None
                );
                
                const unique = index.is_unique ? 'Unique' : 'Non-unique';
                const pk = index.is_primary_key ? ' (Primary Key)' : '';
                
                indexNode.description = `${index.type_desc}${pk}`;
                indexNode.tooltip = `${index.name}\nType: ${index.type_desc}\n${unique}${pk}\nColumns: ${index.columns}`;
                indexNode.connectionId = connectionId;
                
                return indexNode;
            });
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading index details: ${error}`);
            return [];
        }
    }

    private async getStatisticsDetails(tableName: string, schema: string, connectionId: string): Promise<SchemaItemNode[]> {
        const connection = this.connectionProvider.getConnection(connectionId);
        if (!connection) {
            return [];
        }

        try {
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
            
            const statisticsRequest = connection.request();
            const statisticsResult = await statisticsRequest.query(statisticsQuery);
            
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
                
                return statNode;
            });
            
        } catch (error) {
            this.outputChannel.appendLine(`[UnifiedTreeProvider] Error loading statistics details: ${error}`);
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
        
        // Set colored icon - use theme-aware icons
        const isOpen = this.collapsibleState === vscode.TreeItemCollapsibleState.Expanded;
        this.iconPath = createServerGroupIcon(group.color, isOpen);

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
        isPending: boolean = false
    ) {
        // Determine collapsible state based on active status
        const collapsibleState = isActive 
            ? vscode.TreeItemCollapsibleState.Expanded 
            : vscode.TreeItemCollapsibleState.Collapsed;
            
        super(
            isPending ? `${name} (Connecting...)` : name, 
            collapsibleState
        );
        
        this.isPending = isPending;
        this.description = `${server}/${database}`;
        this.tooltip = `Server: ${server}\nDatabase: ${database}\nAuth: ${authType}${isActive ? '\n(Active)' : isPending ? '\n(Connecting...)' : ''}`;
        this.contextValue = 'connection';
        
        // Set icon based on connection state
        if (isPending) {
            this.iconPath = createLoadingSpinnerIcon();
        } else if (isActive) {
            this.iconPath = createDatabaseIcon(true);
        } else {
            this.iconPath = createDatabaseIcon();
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