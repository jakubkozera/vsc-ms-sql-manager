import * as vscode from 'vscode';
import { ConnectionProvider, ConnectionConfig, ServerGroup } from './connectionProvider';
import { createServerGroupIcon, createTableIcon, createColumnIcon, createStoredProcedureIcon, createViewIcon, createLoadingSpinnerIcon, createDatabaseIcon, createFunctionIcon, createTriggerIcon, createTypeIcon, createSequenceIcon, createSynonymIcon, createAssemblyIcon } from './serverGroupIcon';

export class UnifiedTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.FileDecorationProvider {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[]> = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
    readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[]> = this._onDidChangeFileDecorations.event;

    constructor(
        private connectionProvider: ConnectionProvider,
        private outputChannel: vscode.OutputChannel
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
        this._onDidChangeFileDecorations.fire(undefined as any);
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
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
                return await this.getSchemaChildren(element.connectionId, element.database);
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

    private async getSchemaChildren(connectionId: string, database: string): Promise<SchemaItemNode[]> {
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
                tablesNode.database = database;
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
                viewsNode.database = database;
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
            items.push(programmabilityNode);
            
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
            } else if (element.itemType === 'programmability') {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading programmability items`);
                
                const items: SchemaItemNode[] = [];
                
                // Get stored procedures count
                const procsQuery = `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_TYPE = 'PROCEDURE'`;
                const procsResult = await connection.request().query(procsQuery);
                const procsCount = procsResult.recordset[0]?.count || 0;
                
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
                
                // Get functions count
                const functionsQuery = `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_TYPE = 'FUNCTION'`;
                const functionsResult = await connection.request().query(functionsQuery);
                const functionsCount = functionsResult.recordset[0]?.count || 0;
                
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
                
                // Get database triggers count
                const triggersQuery = `SELECT COUNT(*) as count FROM sys.triggers WHERE parent_class = 0`;
                const triggersResult = await connection.request().query(triggersQuery);
                const triggersCount = triggersResult.recordset[0]?.count || 0;
                
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
                
                // Get assemblies count
                const assembliesQuery = `SELECT COUNT(*) as count FROM sys.assemblies WHERE is_user_defined = 1`;
                const assembliesResult = await connection.request().query(assembliesQuery);
                const assembliesCount = assembliesResult.recordset[0]?.count || 0;
                
                if (assembliesCount > 0) {
                    const assembliesNode = new SchemaItemNode(
                        `Assemblies (${assembliesCount})`,
                        'assemblies',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    assembliesNode.connectionId = element.connectionId;
                    assembliesNode.database = element.database;
                    items.push(assembliesNode);
                }
                
                // Add Types node
                const typesNode = new SchemaItemNode(
                    'Types',
                    'types',
                    'all',
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                typesNode.connectionId = element.connectionId;
                typesNode.database = element.database;
                items.push(typesNode);
                
                // Get sequences count
                const sequencesQuery = `SELECT COUNT(*) as count FROM sys.sequences`;
                const sequencesResult = await connection.request().query(sequencesQuery);
                const sequencesCount = sequencesResult.recordset[0]?.count || 0;
                
                if (sequencesCount > 0) {
                    const sequencesNode = new SchemaItemNode(
                        `Sequences (${sequencesCount})`,
                        'sequences',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    sequencesNode.connectionId = element.connectionId;
                    sequencesNode.database = element.database;
                    items.push(sequencesNode);
                }
                
                // Get synonyms count
                const synonymsQuery = `SELECT COUNT(*) as count FROM sys.synonyms`;
                const synonymsResult = await connection.request().query(synonymsQuery);
                const synonymsCount = synonymsResult.recordset[0]?.count || 0;
                
                if (synonymsCount > 0) {
                    const synonymsNode = new SchemaItemNode(
                        `Synonyms (${synonymsCount})`,
                        'synonyms',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    synonymsNode.connectionId = element.connectionId;
                    synonymsNode.database = element.database;
                    items.push(synonymsNode);
                }
                
                // Get rules count (deprecated but still queryable)
                const rulesQuery = `SELECT COUNT(*) as count FROM sys.objects WHERE type = 'R'`;
                const rulesResult = await connection.request().query(rulesQuery);
                const rulesCount = rulesResult.recordset[0]?.count || 0;
                
                if (rulesCount > 0) {
                    const rulesNode = new SchemaItemNode(
                        `Rules (${rulesCount})`,
                        'rules',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    rulesNode.connectionId = element.connectionId;
                    rulesNode.database = element.database;
                    items.push(rulesNode);
                }
                
                // Get defaults count (deprecated but still queryable)
                const defaultsQuery = `SELECT COUNT(*) as count FROM sys.objects WHERE type = 'D' AND parent_object_id = 0`;
                const defaultsResult = await connection.request().query(defaultsQuery);
                const defaultsCount = defaultsResult.recordset[0]?.count || 0;
                
                if (defaultsCount > 0) {
                    const defaultsNode = new SchemaItemNode(
                        `Defaults (${defaultsCount})`,
                        'defaults',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    defaultsNode.connectionId = element.connectionId;
                    defaultsNode.database = element.database;
                    items.push(defaultsNode);
                }
                
                return items;
            } else if (element.itemType === 'stored-procedures') {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading stored procedures subcategories`);
                
                const items: SchemaItemNode[] = [];
                
                // System Stored Procedures
                const systemProcsQuery = `SELECT COUNT(*) as count FROM sys.procedures WHERE is_ms_shipped = 1`;
                const systemProcsResult = await connection.request().query(systemProcsQuery);
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
                const extendedProcsResult = await connection.request().query(extendedProcsQuery);
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
                const query = `
                    SELECT ROUTINE_NAME, ROUTINE_SCHEMA 
                    FROM INFORMATION_SCHEMA.ROUTINES 
                    WHERE ROUTINE_TYPE = 'PROCEDURE'
                    ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
                `;
                
                const request = connection.request();
                const result = await request.query(query);
                
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Found ${result.recordset.length} user procedures to display`);
                
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
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading functions subcategories`);
                
                const items: SchemaItemNode[] = [];
                
                // Table-valued Functions
                const tvfQuery = `SELECT COUNT(*) as count FROM sys.objects WHERE type IN ('TF', 'IF')`;
                const tvfResult = await connection.request().query(tvfQuery);
                const tvfCount = tvfResult.recordset[0]?.count || 0;
                
                if (tvfCount > 0) {
                    const tvfNode = new SchemaItemNode(
                        `Table-valued Functions (${tvfCount})`,
                        'table-valued-functions',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    tvfNode.connectionId = element.connectionId;
                    items.push(tvfNode);
                }
                
                // Scalar-valued Functions
                const svfQuery = `SELECT COUNT(*) as count FROM sys.objects WHERE type = 'FN'`;
                const svfResult = await connection.request().query(svfQuery);
                const svfCount = svfResult.recordset[0]?.count || 0;
                
                if (svfCount > 0) {
                    const svfNode = new SchemaItemNode(
                        `Scalar-valued Functions (${svfCount})`,
                        'scalar-valued-functions',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    svfNode.connectionId = element.connectionId;
                    items.push(svfNode);
                }
                
                // Aggregate Functions
                const aggQuery = `SELECT COUNT(*) as count FROM sys.objects WHERE type = 'AF'`;
                const aggResult = await connection.request().query(aggQuery);
                const aggCount = aggResult.recordset[0]?.count || 0;
                
                if (aggCount > 0) {
                    const aggNode = new SchemaItemNode(
                        `Aggregate Functions (${aggCount})`,
                        'aggregate-functions',
                        'all',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    aggNode.connectionId = element.connectionId;
                    items.push(aggNode);
                }
                
                return items;
            } else if (element.itemType === 'types') {
                this.outputChannel.appendLine(`[UnifiedTreeProvider] Loading types subcategories`);
                
                const items: SchemaItemNode[] = [];
                
                // User-Defined Data Types
                const uddtQuery = `SELECT COUNT(*) as count FROM sys.types WHERE is_user_defined = 1 AND is_table_type = 0 AND is_assembly_type = 0`;
                const uddtResult = await connection.request().query(uddtQuery);
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
                const udttResult = await connection.request().query(udttQuery);
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
                const clrResult = await connection.request().query(clrQuery);
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
                const xmlResult = await connection.request().query(xmlQuery);
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
            } else if (element.itemType === 'system-procedures' || element.itemType === 'extended-procedures') {
                // For now, return empty - these are system objects
                return [];
            } else if (element.itemType === 'table-valued-functions') {
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
                    return funcNode;
                });
            } else if (element.itemType === 'scalar-valued-functions') {
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
                    return funcNode;
                });
            } else if (element.itemType === 'aggregate-functions') {
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
        
        // Set resource URI for file decoration
        if (isActive) {
            this.resourceUri = vscode.Uri.parse(`mssql-connection:${connectionId}#active`);
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