import * as vscode from 'vscode';
import * as path from 'path';
import { ConnectionProvider } from './connectionProvider';

export interface SchemaChange {
    objectType: 'table' | 'column' | 'view' | 'procedure' | 'function' | 'trigger' | 'index' | 'constraint';
    objectName: string;
    changeType: 'add' | 'change' | 'delete';
    description?: string;
    details?: string;
}

export class CompareSchemaWebview {
    private panel: vscode.WebviewPanel | undefined;
    private sourceConnectionId: string;
    private sourceDatabase: string;
    private targetConnectionId: string;
    private targetDatabase: string;
    private definitionsCache: Map<string, string> = new Map();

    constructor(
        private connectionProvider: ConnectionProvider,
        private outputChannel: vscode.OutputChannel,
        private context: vscode.ExtensionContext
    ) {
        this.sourceConnectionId = '';
        this.sourceDatabase = '';
        this.targetConnectionId = '';
        this.targetDatabase = '';
    }

    async show(connectionId: string, database: string) {
        this.sourceConnectionId = connectionId;
        this.sourceDatabase = database;
        
        this.outputChannel.appendLine(`[CompareSchema] Opening comparison for database: ${database}`);

        // Get webview paths
        const webviewPath = path.join(this.context.extensionPath, 'webview', 'compareSchema');

        // Create or reveal webview panel
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'compareSchema',
                `Compare Schema: ${database}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [vscode.Uri.file(webviewPath)]
                }
            );

            // Load HTML content
            const htmlPath = path.join(webviewPath, 'compareSchema.html');
            const htmlContent = await this.getHtmlContent(htmlPath, this.panel.webview, webviewPath);
            this.panel.webview.html = htmlContent;

            // Handle panel disposal
            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });

            // Handle messages from webview
            this.panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'ready':
                            await this.initializeWebview();
                            break;
                        case 'getDatabasesForConnection':
                            await this.getDatabasesForConnection(message.connectionId);
                            break;
                        case 'compareSchemas':
                            await this.compareSchemas(message.targetConnectionId, message.targetDatabase);
                            break;
                        case 'getSchemaDetails':
                            await this.getSchemaDetailsForDiff(message.change);
                            break;
                        case 'showError':
                            vscode.window.showErrorMessage(message.message);
                            break;
                    }
                },
                undefined,
                this.context.subscriptions
            );
        }
    }

    private async initializeWebview() {
        try {
            // Get list of all connections
            const connections = await this.getConnectionList();
            
            this.panel?.webview.postMessage({
                command: 'init',
                sourceDatabase: this.sourceDatabase,
                connections: connections
            });
        } catch (error) {
            this.outputChannel.appendLine(`[CompareSchema] Error initializing: ${error}`);
            vscode.window.showErrorMessage(`Failed to initialize schema comparison: ${error}`);
        }
    }

    private async getConnectionList(): Promise<Array<{id: string, name: string}>> {
        try {
            const connections = await this.connectionProvider.getSavedConnectionsList();
            return connections.map(conn => ({
                id: conn.id,
                name: conn.name
            }));
        } catch (error) {
            this.outputChannel.appendLine(`[CompareSchema] Error getting connection list: ${error}`);
            throw error;
        }
    }

    private async getDatabasesForConnection(connectionId: string) {
        try {
            this.outputChannel.appendLine(`[CompareSchema] Getting databases for connection: ${connectionId}`);
            
            // Check if connection is active
            if (!this.connectionProvider.isConnectionActive(connectionId)) {
                // Try to connect
                await this.connectionProvider.connectToSavedById(connectionId);
            }
            
            const connection = this.connectionProvider.getConnection(connectionId);
            if (!connection) {
                throw new Error('Connection not found or not active');
            }

            // Get connection config to check type
            const config = this.connectionProvider.getConnectionConfig(connectionId);
            
            let databases: string[] = [];
            
            if (config?.connectionType === 'database') {
                // Direct database connection - return only that database
                databases = [config.database];
            } else {
                // Server connection - get all databases
                const query = `
                    SELECT name 
                    FROM sys.databases 
                    WHERE state = 0
                    ORDER BY name
                `;
                
                const result = await connection.request().query(query);
                databases = result.recordset.map((row: any) => row.name);
            }
            
            this.panel?.webview.postMessage({
                command: 'databasesForConnection',
                databases: databases,
                autoSelect: databases.length === 1
            });
        } catch (error) {
            this.outputChannel.appendLine(`[CompareSchema] Error getting databases for connection: ${error}`);
            this.panel?.webview.postMessage({
                command: 'comparisonError',
                error: error instanceof Error ? error.message : 'Failed to get databases'
            });
        }
    }

    private async compareSchemas(targetConnectionId: string, targetDatabase: string) {
        // Store target info for later use
        this.targetConnectionId = targetConnectionId;
        this.targetDatabase = targetDatabase;
        
        // Clear cache for new comparison
        this.definitionsCache.clear();
        
        this.outputChannel.appendLine(`[CompareSchema] Comparing ${this.sourceDatabase} with ${targetDatabase} (connection: ${targetConnectionId}`);
        
        this.panel?.webview.postMessage({
            command: 'comparisonStarted'
        });

        try {
            const changes = await this.detectSchemaChanges(targetConnectionId, targetDatabase);
            
            this.outputChannel.appendLine(`[CompareSchema] Comparison complete: ${changes.length} changes found`);
            this.outputChannel.appendLine(`[CompareSchema] Sending results to webview...`);
            
            this.panel?.webview.postMessage({
                command: 'comparisonResult',
                changes: changes
            });
            
            this.outputChannel.appendLine(`[CompareSchema] Results sent to webview`);
        } catch (error) {
            this.outputChannel.appendLine(`[CompareSchema] Comparison error: ${error}`);
            this.panel?.webview.postMessage({
                command: 'comparisonError',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    private async detectSchemaChanges(targetConnectionId: string, targetDatabase: string): Promise<SchemaChange[]> {
        const changes: SchemaChange[] = [];

        // Get schema information for both databases
        const sourceSchema = await this.getSchemaInfo(this.sourceConnectionId, this.sourceDatabase);
        const targetSchema = await this.getSchemaInfo(targetConnectionId, targetDatabase);
        
        // Cache all definitions upfront
        this.outputChannel.appendLine(`[CompareSchema] Caching object definitions...`);
        await this.cacheAllDefinitions(sourceSchema, targetSchema);
        this.outputChannel.appendLine(`[CompareSchema] Cached ${this.definitionsCache.size} object definitions`);

        // Compare tables (includes column, index, and constraint changes)
        const tableChanges = await this.compareTables(sourceSchema.tables, targetSchema.tables);
        changes.push(...tableChanges);
        
        // Compare views
        const viewChanges = await this.compareViews(sourceSchema.views, targetSchema.views);
        if (viewChanges && viewChanges.length > 0) {
            changes.push(...viewChanges);
        }
        
        // Compare stored procedures
        const procedureChanges = await this.compareProcedures(sourceSchema.procedures, targetSchema.procedures);
        if (procedureChanges && procedureChanges.length > 0) {
            changes.push(...procedureChanges);
        }
        
        // Compare functions
        const functionChanges = await this.compareFunctions(sourceSchema.functions, targetSchema.functions);
        if (functionChanges && functionChanges.length > 0) {
            changes.push(...functionChanges);
        }
        
        // Compare triggers
        const triggerChanges = await this.compareTriggers(sourceSchema.triggers, targetSchema.triggers);
        if (triggerChanges && triggerChanges.length > 0) {
            changes.push(...triggerChanges);
        }

        return changes;
    }

    private async getSchemaInfo(connectionId: string, database: string) {
        const dbPool = await this.connectionProvider.createDbPool(connectionId, database);

        try {
            this.outputChannel.appendLine(`[CompareSchema] Getting schema info for ${database}`);
            
            // Get tables
            this.outputChannel.appendLine(`[CompareSchema] Fetching tables...`);
            const tablesQuery = `
                SELECT 
                    TABLE_SCHEMA as [schema],
                    TABLE_NAME as name
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_SCHEMA, TABLE_NAME
            `;
            const tablesResult = await dbPool.request().query(tablesQuery);
            this.outputChannel.appendLine(`[CompareSchema] Found ${tablesResult.recordset.length} tables`);

            // Get columns
            this.outputChannel.appendLine(`[CompareSchema] Fetching columns...`);
            const columnsQuery = `
                SELECT 
                    TABLE_SCHEMA as [schema],
                    TABLE_NAME as tableName,
                    COLUMN_NAME as columnName,
                    DATA_TYPE as dataType,
                    IS_NULLABLE as isNullable,
                    CHARACTER_MAXIMUM_LENGTH as maxLength,
                    COLUMN_DEFAULT as defaultValue
                FROM INFORMATION_SCHEMA.COLUMNS
                ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
            `;
            const columnsResult = await dbPool.request().query(columnsQuery);
            this.outputChannel.appendLine(`[CompareSchema] Found ${columnsResult.recordset.length} columns`);

            // Get views
            this.outputChannel.appendLine(`[CompareSchema] Fetching views...`);
            const viewsQuery = `
                SELECT 
                    TABLE_SCHEMA as [schema],
                    TABLE_NAME as name
                FROM INFORMATION_SCHEMA.VIEWS
                ORDER BY TABLE_SCHEMA, TABLE_NAME
            `;
            const viewsResult = await dbPool.request().query(viewsQuery);
            this.outputChannel.appendLine(`[CompareSchema] Found ${viewsResult.recordset.length} views`);

            // Get stored procedures
            this.outputChannel.appendLine(`[CompareSchema] Fetching procedures...`);
            const proceduresQuery = `
                SELECT 
                    ROUTINE_SCHEMA as [schema],
                    ROUTINE_NAME as name
                FROM INFORMATION_SCHEMA.ROUTINES
                WHERE ROUTINE_TYPE = 'PROCEDURE'
                ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
            `;
            const proceduresResult = await dbPool.request().query(proceduresQuery);
            this.outputChannel.appendLine(`[CompareSchema] Found ${proceduresResult.recordset.length} procedures`);

            // Get functions
            this.outputChannel.appendLine(`[CompareSchema] Fetching functions...`);
            const functionsQuery = `
                SELECT 
                    ROUTINE_SCHEMA as [schema],
                    ROUTINE_NAME as name
                FROM INFORMATION_SCHEMA.ROUTINES
                WHERE ROUTINE_TYPE = 'FUNCTION'
                ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
            `;
            const functionsResult = await dbPool.request().query(functionsQuery);
            this.outputChannel.appendLine(`[CompareSchema] Found ${functionsResult.recordset.length} functions`);

            // Get indexes
            this.outputChannel.appendLine(`[CompareSchema] Fetching indexes...`);
            const indexesQuery = `
                SELECT 
                    SCHEMA_NAME(t.schema_id) as [schema],
                    t.name as tableName,
                    i.name as indexName,
                    i.type_desc as indexType,
                    i.is_unique as isUnique
                FROM sys.indexes i
                INNER JOIN sys.tables t ON i.object_id = t.object_id
                WHERE i.type > 0
                ORDER BY t.name, i.name
            `;
            const indexesResult = await dbPool.request().query(indexesQuery);
            this.outputChannel.appendLine(`[CompareSchema] Found ${indexesResult.recordset.length} indexes`);

            // Get constraints
            this.outputChannel.appendLine(`[CompareSchema] Fetching constraints...`);
            const constraintsQuery = `
                SELECT 
                    tc.TABLE_SCHEMA as [schema],
                    tc.TABLE_NAME as tableName,
                    tc.CONSTRAINT_NAME as constraintName,
                    tc.CONSTRAINT_TYPE as constraintType
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                ORDER BY tc.TABLE_SCHEMA, tc.TABLE_NAME, tc.CONSTRAINT_NAME
            `;
            const constraintsResult = await dbPool.request().query(constraintsQuery);
            this.outputChannel.appendLine(`[CompareSchema] Found ${constraintsResult.recordset.length} constraints`);

            // Get triggers
            this.outputChannel.appendLine(`[CompareSchema] Fetching triggers...`);
            const triggersQuery = `
                SELECT 
                    SCHEMA_NAME(tab.schema_id) as [schema],
                    tab.name as tableName,
                    trig.name as name,
                    trig.is_disabled as isDisabled
                FROM sys.triggers trig
                INNER JOIN sys.tables tab ON trig.parent_id = tab.object_id
                WHERE trig.parent_class = 1
                ORDER BY trig.name
            `;
            const triggersResult = await dbPool.request().query(triggersQuery);
            this.outputChannel.appendLine(`[CompareSchema] Found ${triggersResult.recordset.length} triggers`);

            await dbPool.close();
            this.outputChannel.appendLine(`[CompareSchema] Schema info fetch completed for ${database}`);

            return {
                tables: tablesResult.recordset,
                columns: columnsResult.recordset,
                views: viewsResult.recordset,
                procedures: proceduresResult.recordset,
                functions: functionsResult.recordset,
                indexes: indexesResult.recordset,
                constraints: constraintsResult.recordset,
                triggers: triggersResult.recordset
            };
        } catch (error) {
            await dbPool.close();
            throw error;
        }
    }

    private async compareTables(sourceTables: any[], targetTables: any[]): Promise<SchemaChange[]> {
        const changes: SchemaChange[] = [];
        const sourceTableMap = new Map(sourceTables.map(t => [`${t.schema}.${t.name}`, t]));
        const targetTableMap = new Map(targetTables.map(t => [`${t.schema}.${t.name}`, t]));

        // Tables in source but not in target (deleted)
        sourceTables.forEach(table => {
            const fullName = `${table.schema}.${table.name}`;
            if (!targetTableMap.has(fullName)) {
                changes.push({
                    objectType: 'table',
                    objectName: fullName,
                    changeType: 'delete',
                    description: 'Table exists in source but not in target database'
                });
            }
        });

        // Tables in target but not in source (added)
        targetTables.forEach(table => {
            const fullName = `${table.schema}.${table.name}`;
            if (!sourceTableMap.has(fullName)) {
                changes.push({
                    objectType: 'table',
                    objectName: fullName,
                    changeType: 'add',
                    description: 'Table exists in target but not in source database'
                });
            }
        });

        // Tables in both - check for changes by comparing full definitions
        for (const table of targetTables) {
            const fullName = `${table.schema}.${table.name}`;
            if (sourceTableMap.has(fullName)) {
                // Table exists in both - compare definitions
                const hasChanged = await this.hasObjectDefinitionChanged(
                    'table',
                    table.schema,
                    table.name
                );
                
                if (hasChanged) {
                    changes.push({
                        objectType: 'table',
                        objectName: fullName,
                        changeType: 'change',
                        description: 'Table definition has changed'
                    });
                }
            }
        }

        return changes;
    }

    private compareColumns(sourceColumns: any[], targetColumns: any[]): SchemaChange[] {
        const changes: SchemaChange[] = [];
        
        // Create maps for easier comparison
        const sourceMap = new Map<string, any>();
        sourceColumns.forEach(col => {
            const key = `${col.schema}.${col.tableName}.${col.columnName}`;
            sourceMap.set(key, col);
        });

        const targetMap = new Map<string, any>();
        targetColumns.forEach(col => {
            const key = `${col.schema}.${col.tableName}.${col.columnName}`;
            targetMap.set(key, col);
        });

        // Check for deleted columns
        sourceMap.forEach((col, key) => {
            if (!targetMap.has(key)) {
                changes.push({
                    objectType: 'column',
                    objectName: `${col.schema}.${col.tableName}.${col.columnName}`,
                    changeType: 'delete',
                    description: `Column deleted from table ${col.tableName}`,
                    details: `Type: ${col.dataType}${col.maxLength ? `(${col.maxLength})` : ''}`
                });
            }
        });

        // Check for added or changed columns
        targetMap.forEach((targetCol, key) => {
            const sourceCol = sourceMap.get(key);
            
            if (!sourceCol) {
                // Column added
                changes.push({
                    objectType: 'column',
                    objectName: `${targetCol.schema}.${targetCol.tableName}.${targetCol.columnName}`,
                    changeType: 'add',
                    description: `Column added to table ${targetCol.tableName}`,
                    details: `Type: ${targetCol.dataType}${targetCol.maxLength ? `(${targetCol.maxLength})` : ''}\nNullable: ${targetCol.isNullable}`
                });
            } else {
                // Check if column changed
                const differences: string[] = [];
                
                if (sourceCol.dataType !== targetCol.dataType) {
                    differences.push(`Data type changed: ${sourceCol.dataType} → ${targetCol.dataType}`);
                }
                
                if (sourceCol.isNullable !== targetCol.isNullable) {
                    differences.push(`Nullable changed: ${sourceCol.isNullable} → ${targetCol.isNullable}`);
                }
                
                if (sourceCol.maxLength !== targetCol.maxLength) {
                    differences.push(`Max length changed: ${sourceCol.maxLength || 'N/A'} → ${targetCol.maxLength || 'N/A'}`);
                }
                
                if (sourceCol.defaultValue !== targetCol.defaultValue) {
                    differences.push(`Default value changed`);
                }
                
                if (differences.length > 0) {
                    changes.push({
                        objectType: 'column',
                        objectName: `${targetCol.schema}.${targetCol.tableName}.${targetCol.columnName}`,
                        changeType: 'change',
                        description: `Column definition changed`,
                        details: differences.join('\n')
                    });
                }
            }
        });

        return changes;
    }

    private async compareViews(sourceViews: any[], targetViews: any[]): Promise<SchemaChange[]> {
        return await this.compareSimpleObjects(sourceViews, targetViews, 'view');
    }

    private async compareProcedures(sourceProcedures: any[], targetProcedures: any[]): Promise<SchemaChange[]> {
        return await this.compareSimpleObjects(sourceProcedures, targetProcedures, 'procedure');
    }

    private async compareFunctions(sourceFunctions: any[], targetFunctions: any[]): Promise<SchemaChange[]> {
        return await this.compareSimpleObjects(sourceFunctions, targetFunctions, 'function');
    }

    private async compareTriggers(sourceTriggers: any[], targetTriggers: any[]): Promise<SchemaChange[]> {
        return await this.compareSimpleObjects(sourceTriggers, targetTriggers, 'trigger');
    }

    private compareIndexes(sourceIndexes: any[], targetIndexes: any[]): SchemaChange[] {
        const changes: SchemaChange[] = [];
        
        const sourceMap = new Map<string, any>();
        sourceIndexes.forEach(idx => {
            const key = `${idx.schema}.${idx.tableName}.${idx.indexName}`;
            sourceMap.set(key, idx);
        });

        const targetMap = new Map<string, any>();
        targetIndexes.forEach(idx => {
            const key = `${idx.schema}.${idx.tableName}.${idx.indexName}`;
            targetMap.set(key, idx);
        });

        // Check for deleted indexes
        sourceMap.forEach((idx, key) => {
            if (!targetMap.has(key)) {
                changes.push({
                    objectType: 'index',
                    objectName: `${idx.schema}.${idx.tableName}.${idx.indexName}`,
                    changeType: 'delete',
                    description: `Index deleted from table ${idx.tableName}`,
                    details: `Type: ${idx.indexType}\nUnique: ${idx.isUnique ? 'Yes' : 'No'}`
                });
            }
        });

        // Check for added indexes
        targetMap.forEach((idx, key) => {
            if (!sourceMap.has(key)) {
                changes.push({
                    objectType: 'index',
                    objectName: `${idx.schema}.${idx.tableName}.${idx.indexName}`,
                    changeType: 'add',
                    description: `Index added to table ${idx.tableName}`,
                    details: `Type: ${idx.indexType}\nUnique: ${idx.isUnique ? 'Yes' : 'No'}`
                });
            }
        });

        return changes;
    }

    private compareConstraints(sourceConstraints: any[], targetConstraints: any[]): SchemaChange[] {
        const changes: SchemaChange[] = [];
        
        const sourceMap = new Map<string, any>();
        sourceConstraints.forEach(con => {
            const key = `${con.schema}.${con.tableName}.${con.constraintName}`;
            sourceMap.set(key, con);
        });

        const targetMap = new Map<string, any>();
        targetConstraints.forEach(con => {
            const key = `${con.schema}.${con.tableName}.${con.constraintName}`;
            targetMap.set(key, con);
        });

        // Check for deleted constraints
        sourceMap.forEach((con, key) => {
            if (!targetMap.has(key)) {
                changes.push({
                    objectType: 'constraint',
                    objectName: `${con.schema}.${con.tableName}.${con.constraintName}`,
                    changeType: 'delete',
                    description: `Constraint deleted from table ${con.tableName}`,
                    details: `Type: ${con.constraintType}`
                });
            }
        });

        // Check for added constraints
        targetMap.forEach((con, key) => {
            if (!sourceMap.has(key)) {
                changes.push({
                    objectType: 'constraint',
                    objectName: `${con.schema}.${con.tableName}.${con.constraintName}`,
                    changeType: 'add',
                    description: `Constraint added to table ${con.tableName}`,
                    details: `Type: ${con.constraintType}`
                });
            }
        });

        return changes;
    }

    private async compareSimpleObjects(sourceObjects: any[], targetObjects: any[], objectType: SchemaChange['objectType']): Promise<SchemaChange[]> {
        const changes: SchemaChange[] = [];
        const sourceMap = new Map(sourceObjects.map(o => [`${o.schema}.${o.name}`, o]));
        const targetMap = new Map(targetObjects.map(o => [`${o.schema}.${o.name}`, o]));

        this.outputChannel.appendLine(`[CompareSchema] Comparing ${objectType}s: ${sourceObjects.length} source, ${targetObjects.length} target`);

        // Objects in source but not in target (deleted)
        sourceObjects.forEach(obj => {
            const fullName = `${obj.schema}.${obj.name}`;
            if (!targetMap.has(fullName)) {
                changes.push({
                    objectType: objectType,
                    objectName: fullName,
                    changeType: 'delete',
                    description: `${objectType.charAt(0).toUpperCase() + objectType.slice(1)} exists in source but not in target`
                });
            }
        });

        // Objects in target but not in source (added)
        targetObjects.forEach(obj => {
            const fullName = `${obj.schema}.${obj.name}`;
            if (!sourceMap.has(fullName)) {
                changes.push({
                    objectType: objectType,
                    objectName: fullName,
                    changeType: 'add',
                    description: `${objectType.charAt(0).toUpperCase() + objectType.slice(1)} exists in target but not in source`
                });
            }
        });

        // Objects in both - check for changes by comparing definitions
        for (const obj of targetObjects) {
            const fullName = `${obj.schema}.${obj.name}`;
            if (sourceMap.has(fullName)) {
                // Object exists in both - compare definitions
                this.outputChannel.appendLine(`[CompareSchema] Checking ${objectType} ${fullName} for changes...`);
                const hasChanged = await this.hasObjectDefinitionChanged(
                    objectType,
                    obj.schema,
                    obj.name
                );
                
                if (hasChanged) {
                    this.outputChannel.appendLine(`[CompareSchema] Change detected in ${objectType} ${fullName}`);
                    changes.push({
                        objectType: objectType,
                        objectName: fullName,
                        changeType: 'change',
                        description: `${objectType.charAt(0).toUpperCase() + objectType.slice(1)} definition has changed`
                    });
                } else {
                    this.outputChannel.appendLine(`[CompareSchema] No change in ${objectType} ${fullName}`);
                }
            }
        }

        this.outputChannel.appendLine(`[CompareSchema] Found ${changes.length} ${objectType} changes`);
        return changes;
    }

    private async cacheAllDefinitions(sourceSchema: any, targetSchema: any) {
        // Create one pool per database for efficiency
        const sourcePool = await this.connectionProvider.createDbPool(this.sourceConnectionId, this.sourceDatabase);
        const targetPool = await this.connectionProvider.createDbPool(this.targetConnectionId, this.targetDatabase);
        
        try {
            // Cache all table definitions from source
            for (const table of sourceSchema.tables) {
                const key = `source:table:${table.schema}.${table.name}`;
                try {
                    const def = await this.getTableDefinitionWithPool(sourcePool, table.schema, table.name);
                    this.definitionsCache.set(key, def);
                } catch (error) {
                    this.outputChannel.appendLine(`[CompareSchema] Error caching source table ${table.schema}.${table.name}: ${error}`);
                }
            }
            
            // Cache all table definitions from target
            for (const table of targetSchema.tables) {
                const key = `target:table:${table.schema}.${table.name}`;
                try {
                    const def = await this.getTableDefinitionWithPool(targetPool, table.schema, table.name);
                    this.definitionsCache.set(key, def);
                } catch (error) {
                    this.outputChannel.appendLine(`[CompareSchema] Error caching target table ${table.schema}.${table.name}: ${error}`);
                }
            }
            
            // Cache view definitions from source
            for (const view of sourceSchema.views) {
                const key = `source:view:${view.schema}.${view.name}`;
                try {
                    const def = await this.getViewDefinition(sourcePool, view.schema, view.name);
                    this.definitionsCache.set(key, def);
                } catch (error) {
                    this.outputChannel.appendLine(`[CompareSchema] Error caching source view ${view.schema}.${view.name}: ${error}`);
                }
            }
            
            // Cache view definitions from target
            for (const view of targetSchema.views) {
                const key = `target:view:${view.schema}.${view.name}`;
                try {
                    const def = await this.getViewDefinition(targetPool, view.schema, view.name);
                    this.definitionsCache.set(key, def);
                } catch (error) {
                    this.outputChannel.appendLine(`[CompareSchema] Error caching target view ${view.schema}.${view.name}: ${error}`);
                }
            }
            
            // Cache procedure definitions from source
            for (const proc of sourceSchema.procedures) {
                const key = `source:procedure:${proc.schema}.${proc.name}`;
                try {
                    const def = await this.getProcedureDefinition(sourcePool, proc.schema, proc.name);
                    this.definitionsCache.set(key, def);
                } catch (error) {
                    this.outputChannel.appendLine(`[CompareSchema] Error caching source procedure ${proc.schema}.${proc.name}: ${error}`);
                }
            }
            
            // Cache procedure definitions from target
            for (const proc of targetSchema.procedures) {
                const key = `target:procedure:${proc.schema}.${proc.name}`;
                try {
                    const def = await this.getProcedureDefinition(targetPool, proc.schema, proc.name);
                    this.definitionsCache.set(key, def);
                } catch (error) {
                    this.outputChannel.appendLine(`[CompareSchema] Error caching target procedure ${proc.schema}.${proc.name}: ${error}`);
                }
            }
            
            // Cache function definitions from source
            for (const func of sourceSchema.functions) {
                const key = `source:function:${func.schema}.${func.name}`;
                try {
                    const def = await this.getFunctionDefinition(sourcePool, func.schema, func.name);
                    this.definitionsCache.set(key, def);
                } catch (error) {
                    this.outputChannel.appendLine(`[CompareSchema] Error caching source function ${func.schema}.${func.name}: ${error}`);
                }
            }
            
            // Cache function definitions from target
            for (const func of targetSchema.functions) {
                const key = `target:function:${func.schema}.${func.name}`;
                try {
                    const def = await this.getFunctionDefinition(targetPool, func.schema, func.name);
                    this.definitionsCache.set(key, def);
                } catch (error) {
                    this.outputChannel.appendLine(`[CompareSchema] Error caching target function ${func.schema}.${func.name}: ${error}`);
                }
            }
            
            // Cache trigger definitions from source
            for (const trigger of sourceSchema.triggers) {
                const key = `source:trigger:${trigger.schema}.${trigger.name}`;
                try {
                    const def = await this.getTriggerDefinition(sourcePool, trigger.schema, trigger.name);
                    this.definitionsCache.set(key, def);
                } catch (error) {
                    this.outputChannel.appendLine(`[CompareSchema] Error caching source trigger ${trigger.schema}.${trigger.name}: ${error}`);
                }
            }
            
            // Cache trigger definitions from target
            for (const trigger of targetSchema.triggers) {
                const key = `target:trigger:${trigger.schema}.${trigger.name}`;
                try {
                    const def = await this.getTriggerDefinition(targetPool, trigger.schema, trigger.name);
                    this.definitionsCache.set(key, def);
                } catch (error) {
                    this.outputChannel.appendLine(`[CompareSchema] Error caching target trigger ${trigger.schema}.${trigger.name}: ${error}`);
                }
            }
        } finally {
            await sourcePool.close();
            await targetPool.close();
        }
    }
    
    private async getViewDefinition(pool: any, schema: string, viewName: string): Promise<string> {
        const query = `
            SELECT definition
            FROM sys.sql_modules sm
            INNER JOIN sys.views v ON sm.object_id = v.object_id
            INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
            WHERE s.name = '${schema}' AND v.name = '${viewName}'
        `;
        const result = await pool.request().query(query);
        return result.recordset.length > 0 ? result.recordset[0].definition : `-- View ${schema}.${viewName} not found`;
    }
    
    private async getProcedureDefinition(pool: any, schema: string, procName: string): Promise<string> {
        const query = `
            SELECT definition
            FROM sys.sql_modules sm
            INNER JOIN sys.procedures p ON sm.object_id = p.object_id
            INNER JOIN sys.schemas s ON p.schema_id = s.schema_id
            WHERE s.name = '${schema}' AND p.name = '${procName}'
        `;
        const result = await pool.request().query(query);
        return result.recordset.length > 0 ? result.recordset[0].definition : `-- Procedure ${schema}.${procName} not found`;
    }
    
    private async getFunctionDefinition(pool: any, schema: string, funcName: string): Promise<string> {
        const query = `
            SELECT definition
            FROM sys.sql_modules sm
            INNER JOIN sys.objects o ON sm.object_id = o.object_id
            INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
            WHERE s.name = '${schema}' AND o.name = '${funcName}' AND o.type IN ('FN', 'IF', 'TF')
        `;
        const result = await pool.request().query(query);
        return result.recordset.length > 0 ? result.recordset[0].definition : `-- Function ${schema}.${funcName} not found`;
    }
    
    private async getTriggerDefinition(pool: any, schema: string, triggerName: string): Promise<string> {
        const query = `
            SELECT definition
            FROM sys.sql_modules sm
            INNER JOIN sys.triggers t ON sm.object_id = t.object_id
            INNER JOIN sys.tables tb ON t.parent_id = tb.object_id
            INNER JOIN sys.schemas s ON tb.schema_id = s.schema_id
            WHERE s.name = '${schema}' AND t.name = '${triggerName}'
        `;
        const result = await pool.request().query(query);
        return result.recordset.length > 0 ? result.recordset[0].definition : `-- Trigger ${schema}.${triggerName} not found`;
    }
    
    private async getTableDefinitionWithPool(pool: any, schema: string, tableName: string): Promise<string> {
        // Get columns
        const columnsQuery = `
            SELECT 
                c.COLUMN_NAME,
                c.DATA_TYPE,
                c.CHARACTER_MAXIMUM_LENGTH,
                c.NUMERIC_PRECISION,
                c.NUMERIC_SCALE,
                c.DATETIME_PRECISION,
                c.IS_NULLABLE,
                c.COLUMN_DEFAULT,
                c.ORDINAL_POSITION
            FROM INFORMATION_SCHEMA.COLUMNS c
            WHERE c.TABLE_SCHEMA = '${schema}' AND c.TABLE_NAME = '${tableName}'
            ORDER BY c.ORDINAL_POSITION
        `;
        
        const columnsResult = await pool.request().query(columnsQuery);
        
        // Get constraints (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK)
        const constraintsQuery = `
            SELECT 
                tc.CONSTRAINT_NAME,
                tc.CONSTRAINT_TYPE,
                kcu.COLUMN_NAME,
                rc.UPDATE_RULE,
                rc.DELETE_RULE,
                ccu.TABLE_SCHEMA AS REFERENCED_TABLE_SCHEMA,
                ccu.TABLE_NAME AS REFERENCED_TABLE_NAME,
                ccu.COLUMN_NAME AS REFERENCED_COLUMN_NAME,
                cc.CHECK_CLAUSE,
                ic.is_descending_key
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
                ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME 
                AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
                AND tc.TABLE_NAME = kcu.TABLE_NAME
            LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc 
                ON tc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
                AND tc.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
            LEFT JOIN INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu 
                ON rc.UNIQUE_CONSTRAINT_NAME = ccu.CONSTRAINT_NAME
            LEFT JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
                ON tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
            LEFT JOIN sys.index_columns ic
                ON OBJECT_ID('[${schema}].[${tableName}]') = ic.object_id
                AND COL_NAME(ic.object_id, ic.column_id) = kcu.COLUMN_NAME
                AND ic.index_id = (
                    SELECT i.index_id FROM sys.indexes i
                    WHERE i.object_id = OBJECT_ID('[${schema}].[${tableName}]')
                    AND i.name = tc.CONSTRAINT_NAME
                )
            WHERE tc.TABLE_SCHEMA = '${schema}' 
                AND tc.TABLE_NAME = '${tableName}'
            ORDER BY tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
        `;
        
        const constraintsResult = await pool.request().query(constraintsQuery);
        
        // Get indexes (non-constraint indexes)
        const indexesQuery = `
            SELECT 
                i.name AS INDEX_NAME,
                i.type_desc AS INDEX_TYPE,
                i.is_unique,
                i.is_primary_key,
                i.is_unique_constraint,
                COL_NAME(ic.object_id, ic.column_id) AS COLUMN_NAME,
                ic.is_descending_key,
                ic.is_included_column,
                ic.key_ordinal
            FROM sys.indexes i
            INNER JOIN sys.index_columns ic 
                ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            WHERE i.object_id = OBJECT_ID('[${schema}].[${tableName}]')
                AND i.is_primary_key = 0
                AND i.is_unique_constraint = 0
                AND i.type > 0
            ORDER BY i.name, ic.key_ordinal, ic.index_column_id
        `;
        
        const indexesResult = await pool.request().query(indexesQuery);
        
        // Build CREATE TABLE statement
        let sql = `CREATE TABLE [${schema}].[${tableName}] (\n`;
        
        // Add columns
        const columns = columnsResult.recordset;
        const columnDefs = columns.map((col: any) => {
            let colDef = ` [${col.COLUMN_NAME}] ${col.DATA_TYPE.toUpperCase()}`;
            
            // Add length/precision
            if (col.CHARACTER_MAXIMUM_LENGTH && col.CHARACTER_MAXIMUM_LENGTH > 0) {
                colDef += col.CHARACTER_MAXIMUM_LENGTH === -1 ? ' (MAX)' : ` (${col.CHARACTER_MAXIMUM_LENGTH})`;
            } else if (col.DATA_TYPE.toLowerCase() === 'decimal' || col.DATA_TYPE.toLowerCase() === 'numeric') {
                colDef += ` (${col.NUMERIC_PRECISION},${col.NUMERIC_SCALE})`;
            } else if (col.DATETIME_PRECISION !== null && ['datetime2', 'datetimeoffset', 'time'].includes(col.DATA_TYPE.toLowerCase())) {
                colDef += ` (${col.DATETIME_PRECISION})`;
            }
            
            // Add NULL/NOT NULL
            colDef += col.IS_NULLABLE === 'YES' ? ' NULL' : ' NOT NULL';
            
            return colDef;
        });
        
        sql += columnDefs.join(',\n');
        
        // Process constraints
        const constraints = constraintsResult.recordset;
        const groupedConstraints: { [key: string]: any[] } = {};
        
        constraints.forEach((c: any) => {
            if (!groupedConstraints[c.CONSTRAINT_NAME]) {
                groupedConstraints[c.CONSTRAINT_NAME] = [];
            }
            groupedConstraints[c.CONSTRAINT_NAME].push(c);
        });
        
        // Add constraints to table definition
        Object.keys(groupedConstraints).forEach(constraintName => {
            const constraintCols = groupedConstraints[constraintName];
            const constraint = constraintCols[0];
            
            if (constraint.CONSTRAINT_TYPE === 'PRIMARY KEY') {
                const cols = constraintCols.map((c: any) => 
                    `[${c.COLUMN_NAME}] ${c.is_descending_key ? 'DESC' : 'ASC'}`
                ).join(', ');
                sql += `,\n CONSTRAINT [${constraintName}] PRIMARY KEY CLUSTERED (${cols})`;
            } else if (constraint.CONSTRAINT_TYPE === 'FOREIGN KEY') {
                const cols = constraintCols.map((c: any) => `[${c.COLUMN_NAME}]`).join(', ');
                const refCols = constraintCols.map((c: any) => `[${c.REFERENCED_COLUMN_NAME}]`).join(', ');
                const refTable = `[${constraint.REFERENCED_TABLE_SCHEMA}].[${constraint.REFERENCED_TABLE_NAME}]`;
                
                let fkDef = ` CONSTRAINT [${constraintName}] FOREIGN KEY (${cols}) REFERENCES ${refTable} (${refCols})`;
                
                if (constraint.DELETE_RULE && constraint.DELETE_RULE !== 'NO ACTION') {
                    fkDef += ` ON DELETE ${constraint.DELETE_RULE}`;
                }
                if (constraint.UPDATE_RULE && constraint.UPDATE_RULE !== 'NO ACTION') {
                    fkDef += ` ON UPDATE ${constraint.UPDATE_RULE}`;
                }
                
                sql += `,\n${fkDef}`;
            } else if (constraint.CONSTRAINT_TYPE === 'UNIQUE') {
                const cols = constraintCols.map((c: any) => `[${c.COLUMN_NAME}]`).join(', ');
                sql += `,\n CONSTRAINT [${constraintName}] UNIQUE (${cols})`;
            } else if (constraint.CONSTRAINT_TYPE === 'CHECK' && constraint.CHECK_CLAUSE) {
                sql += `,\n CONSTRAINT [${constraintName}] CHECK ${constraint.CHECK_CLAUSE}`;
            }
        });
        
        sql += '\n);\nGO\n';
        
        // Add indexes
        const indexes = indexesResult.recordset;
        const groupedIndexes: { [key: string]: any[] } = {};
        
        indexes.forEach((idx: any) => {
            if (!groupedIndexes[idx.INDEX_NAME]) {
                groupedIndexes[idx.INDEX_NAME] = [];
            }
            groupedIndexes[idx.INDEX_NAME].push(idx);
        });
        
        Object.keys(groupedIndexes).forEach(indexName => {
            const indexCols = groupedIndexes[indexName];
            const index = indexCols[0];
            
            const indexType = index.INDEX_TYPE === 'CLUSTERED' ? 'CLUSTERED' : 'NONCLUSTERED';
            const unique = index.is_unique ? 'UNIQUE ' : '';
            
            const keyCols = indexCols
                .filter((c: any) => !c.is_included_column)
                .map((c: any) => `[${c.COLUMN_NAME}] ${c.is_descending_key ? 'DESC' : 'ASC'}`)
                .join(', ');
            
            const includedCols = indexCols
                .filter((c: any) => c.is_included_column)
                .map((c: any) => `[${c.COLUMN_NAME}]`)
                .join(', ');
            
            sql += `\nCREATE ${unique}${indexType} INDEX [${indexName}]`;
            sql += `\n ON [${schema}].[${tableName}](${keyCols})`;
            
            if (includedCols) {
                sql += `\n INCLUDE (${includedCols})`;
            }
            
            sql += ';\nGO\n';
        });
        
        return sql;
    }

    private getCachedDefinition(source: 'source' | 'target', objectType: string, schema: string, name: string): string | undefined {
        const key = `${source}:${objectType}:${schema}.${name}`;
        return this.definitionsCache.get(key);
    }

    private async getSchemaDetailsForDiff(change: SchemaChange) {
        try {
            let originalSchema = '';
            let modifiedSchema = '';

            const objectType = change.objectType;
            const objectName = change.objectName;
            const parts = objectName.split('.');
            const schema = parts[0];
            const name = parts.length > 1 ? parts[1] : parts[0];

            if (objectType === 'trigger') {
                if (change.changeType === 'delete') {
                    originalSchema = this.getCachedDefinition('source', 'trigger', schema, name) || `-- Trigger ${schema}.${name} not found`;
                    modifiedSchema = `-- Trigger deleted from target database`;
                } else if (change.changeType === 'add') {
                    originalSchema = `-- Trigger does not exist in source database`;
                    modifiedSchema = this.getCachedDefinition('target', 'trigger', schema, name) || `-- Trigger ${schema}.${name} not found`;
                } else {
                    originalSchema = this.getCachedDefinition('source', 'trigger', schema, name) || `-- Trigger ${schema}.${name} not found`;
                    modifiedSchema = this.getCachedDefinition('target', 'trigger', schema, name) || `-- Trigger ${schema}.${name} not found`;
                }
            } else if (objectType === 'table') {
                if (change.changeType === 'delete') {
                    originalSchema = this.getCachedDefinition('source', 'table', schema, name) || `-- Table ${schema}.${name} not found`;
                    modifiedSchema = `-- Table deleted from target database`;
                } else if (change.changeType === 'add') {
                    originalSchema = `-- Table does not exist in source database`;
                    modifiedSchema = this.getCachedDefinition('target', 'table', schema, name) || `-- Table ${schema}.${name} not found`;
                } else {
                    originalSchema = this.getCachedDefinition('source', 'table', schema, name) || `-- Table ${schema}.${name} not found`;
                    modifiedSchema = this.getCachedDefinition('target', 'table', schema, name) || `-- Table ${schema}.${name} not found`;
                }
            } else if (objectType === 'column') {
                // For columns, get table definition from both databases
                const tableName = parts.length > 2 ? parts[1] : schema;
                const tableSchema = parts.length > 2 ? schema : 'dbo';
                
                originalSchema = this.getCachedDefinition('source', 'table', tableSchema, tableName) || `-- Table ${tableSchema}.${tableName} not found`;
                modifiedSchema = this.getCachedDefinition('target', 'table', tableSchema, tableName) || `-- Table ${tableSchema}.${tableName} not found`;
            } else if (objectType === 'view') {
                if (change.changeType === 'delete') {
                    originalSchema = this.getCachedDefinition('source', 'view', schema, name) || `-- View ${schema}.${name} not found`;
                    modifiedSchema = `-- View deleted from target database`;
                } else if (change.changeType === 'add') {
                    originalSchema = `-- View does not exist in source database`;
                    modifiedSchema = this.getCachedDefinition('target', 'view', schema, name) || `-- View ${schema}.${name} not found`;
                } else {
                    originalSchema = this.getCachedDefinition('source', 'view', schema, name) || `-- View ${schema}.${name} not found`;
                    modifiedSchema = this.getCachedDefinition('target', 'view', schema, name) || `-- View ${schema}.${name} not found`;
                }
            } else if (objectType === 'procedure') {
                if (change.changeType === 'delete') {
                    originalSchema = this.getCachedDefinition('source', 'procedure', schema, name) || `-- Procedure ${schema}.${name} not found`;
                    modifiedSchema = `-- Procedure deleted from target database`;
                } else if (change.changeType === 'add') {
                    originalSchema = `-- Procedure does not exist in source database`;
                    modifiedSchema = this.getCachedDefinition('target', 'procedure', schema, name) || `-- Procedure ${schema}.${name} not found`;
                } else {
                    originalSchema = this.getCachedDefinition('source', 'procedure', schema, name) || `-- Procedure ${schema}.${name} not found`;
                    modifiedSchema = this.getCachedDefinition('target', 'procedure', schema, name) || `-- Procedure ${schema}.${name} not found`;
                }
            } else if (objectType === 'function') {
                if (change.changeType === 'delete') {
                    originalSchema = this.getCachedDefinition('source', 'function', schema, name) || `-- Function ${schema}.${name} not found`;
                    modifiedSchema = `-- Function deleted from target database`;
                } else if (change.changeType === 'add') {
                    originalSchema = `-- Function does not exist in source database`;
                    modifiedSchema = this.getCachedDefinition('target', 'function', schema, name) || `-- Function ${schema}.${name} not found`;
                } else {
                    originalSchema = this.getCachedDefinition('source', 'function', schema, name) || `-- Function ${schema}.${name} not found`;
                    modifiedSchema = this.getCachedDefinition('target', 'function', schema, name) || `-- Function ${schema}.${name} not found`;
                }
            } else {
                originalSchema = `-- ${change.objectType}: ${change.objectName}\n${change.description || ''}`;
                modifiedSchema = change.details || '-- No details available';
            }

            this.panel?.webview.postMessage({
                command: 'schemaDetails',
                originalSchema: originalSchema,
                modifiedSchema: modifiedSchema
            });

        } catch (error) {
            this.outputChannel.appendLine(`[CompareSchema] Error getting schema details: ${error}`);
            this.panel?.webview.postMessage({
                command: 'schemaDetails',
                originalSchema: `-- Error loading schema`,
                modifiedSchema: `-- ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }
    }

    private async hasObjectDefinitionChanged(objectType: string, schema: string, name: string): Promise<boolean> {
        // Get definitions from cache
        const sourceDef = this.getCachedDefinition('source', objectType, schema, name);
        const targetDef = this.getCachedDefinition('target', objectType, schema, name);
        
        // If either definition is missing, can't compare
        if (!sourceDef || !targetDef) {
            this.outputChannel.appendLine(`[CompareSchema] Missing definition for ${objectType} ${schema}.${name}: source=${!!sourceDef}, target=${!!targetDef}`);
            return false;
        }
        
        // Normalize definitions for comparison (remove whitespace differences)
        const normalizeSQL = (sql: string) => {
            return sql
                .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
                .replace(/\s*\(\s*/g, '(')  // Remove spaces around parentheses
                .replace(/\s*\)\s*/g, ')')
                .replace(/\s*,\s*/g, ',')  // Remove spaces around commas
                .replace(/\s*;\s*/g, ';')  // Remove spaces around semicolons
                .replace(/\s*\n\s*/g, '\n')  // Normalize line breaks
                .trim()
                .toLowerCase();
        };
        
        const normalizedSource = normalizeSQL(sourceDef);
        const normalizedTarget = normalizeSQL(targetDef);
        const hasChanged = normalizedSource !== normalizedTarget;
        
        if (hasChanged) {
            this.outputChannel.appendLine(`[CompareSchema] Detected change in ${objectType} ${schema}.${name}`);
            this.outputChannel.appendLine(`[CompareSchema]   Source length: ${normalizedSource.length}, Target length: ${normalizedTarget.length}`);
        }
        
        return hasChanged;
    }

    private async getTableDefinition(connectionId: string, database: string, schema: string, tableName: string): Promise<string> {
        const dbPool = await this.connectionProvider.createDbPool(connectionId, database);
        
        try {
            // Get columns
            const columnsQuery = `
                SELECT 
                    c.COLUMN_NAME,
                    c.DATA_TYPE,
                    c.CHARACTER_MAXIMUM_LENGTH,
                    c.NUMERIC_PRECISION,
                    c.NUMERIC_SCALE,
                    c.DATETIME_PRECISION,
                    c.IS_NULLABLE,
                    c.COLUMN_DEFAULT,
                    c.ORDINAL_POSITION
                FROM INFORMATION_SCHEMA.COLUMNS c
                WHERE c.TABLE_SCHEMA = '${schema}' AND c.TABLE_NAME = '${tableName}'
                ORDER BY c.ORDINAL_POSITION
            `;
            
            const columnsResult = await dbPool.request().query(columnsQuery);
            
            // Get constraints (PK, FK, CHECK, etc.)
            const constraintsQuery = `
                SELECT 
                    tc.CONSTRAINT_NAME,
                    tc.CONSTRAINT_TYPE,
                    kcu.COLUMN_NAME,
                    rc.UNIQUE_CONSTRAINT_NAME,
                    kcu2.TABLE_SCHEMA AS FK_TABLE_SCHEMA,
                    kcu2.TABLE_NAME AS FK_TABLE_NAME,
                    kcu2.COLUMN_NAME AS FK_COLUMN_NAME,
                    rc.DELETE_RULE,
                    rc.UPDATE_RULE
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
                    ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc 
                    ON tc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
                LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2 
                    ON rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME
                WHERE tc.TABLE_SCHEMA = '${schema}' AND tc.TABLE_NAME = '${tableName}'
                ORDER BY tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
            `;
            
            const constraintsResult = await dbPool.request().query(constraintsQuery);
            
            // Get indexes
            const indexesQuery = `
                SELECT 
                    i.name AS INDEX_NAME,
                    i.type_desc AS INDEX_TYPE,
                    i.is_unique AS IS_UNIQUE,
                    c.name AS COLUMN_NAME,
                    ic.is_descending_key AS IS_DESCENDING
                FROM sys.indexes i
                INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                INNER JOIN sys.tables t ON i.object_id = t.object_id
                INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE s.name = '${schema}' AND t.name = '${tableName}'
                    AND i.is_primary_key = 0 AND i.is_unique_constraint = 0
                ORDER BY i.name, ic.key_ordinal
            `;
            
            const indexesResult = await dbPool.request().query(indexesQuery);
            
            await dbPool.close();
            
            // Build CREATE TABLE statement
            let sql = `CREATE TABLE [${schema}].[${tableName}] (\n`;
            
            // Add columns
            const columns = columnsResult.recordset;
            sql += columns.map((col: any) => {
                let colDef = ` [${col.COLUMN_NAME}] ${col.DATA_TYPE.toUpperCase()}`;
                
                // Add length/precision
                if (col.CHARACTER_MAXIMUM_LENGTH && col.CHARACTER_MAXIMUM_LENGTH > 0) {
                    colDef += col.CHARACTER_MAXIMUM_LENGTH === -1 ? ' (MAX)' : ` (${col.CHARACTER_MAXIMUM_LENGTH})`;
                } else if (col.DATA_TYPE.toLowerCase() === 'decimal' || col.DATA_TYPE.toLowerCase() === 'numeric') {
                    colDef += ` (${col.NUMERIC_PRECISION}, ${col.NUMERIC_SCALE})`;
                } else if (col.DATETIME_PRECISION !== null && ['datetime2', 'datetimeoffset', 'time'].includes(col.DATA_TYPE.toLowerCase())) {
                    colDef += ` (${col.DATETIME_PRECISION})`;
                }
                
                // Add NULL/NOT NULL
                colDef += col.IS_NULLABLE === 'YES' ? ' NULL' : ' NOT NULL';
                
                return colDef;
            }).join(',\n');
            
            // Group constraints by type
            const constraints = constraintsResult.recordset;
            const pkConstraints = constraints.filter((c: any) => c.CONSTRAINT_TYPE === 'PRIMARY KEY');
            const fkConstraints = constraints.filter((c: any) => c.CONSTRAINT_TYPE === 'FOREIGN KEY');
            
            // Add PRIMARY KEY
            if (pkConstraints.length > 0) {
                const pkName = pkConstraints[0].CONSTRAINT_NAME;
                const pkColumns = pkConstraints.map((c: any) => `[${c.COLUMN_NAME}] ASC`).join(', ');
                sql += `,\n CONSTRAINT [${pkName}] PRIMARY KEY CLUSTERED (${pkColumns})`;
            }
            
            // Add FOREIGN KEYS
            const groupedFKs = new Map<string, any[]>();
            fkConstraints.forEach((fk: any) => {
                if (!groupedFKs.has(fk.CONSTRAINT_NAME)) {
                    groupedFKs.set(fk.CONSTRAINT_NAME, []);
                }
                groupedFKs.get(fk.CONSTRAINT_NAME)!.push(fk);
            });
            
            groupedFKs.forEach((fks, fkName) => {
                const fkColumns = fks.map((f: any) => `[${f.COLUMN_NAME}]`).join(', ');
                const refTable = `[${fks[0].FK_TABLE_SCHEMA}].[${fks[0].FK_TABLE_NAME}]`;
                const refColumns = fks.map((f: any) => `[${f.FK_COLUMN_NAME}]`).join(', ');
                const deleteRule = fks[0].DELETE_RULE === 'CASCADE' ? ' ON DELETE CASCADE' : '';
                sql += `,\n CONSTRAINT [${fkName}] FOREIGN KEY (${fkColumns}) REFERENCES ${refTable} (${refColumns})${deleteRule}`;
            });
            
            sql += '\n);\nGO';
            
            // Add indexes
            const groupedIndexes = new Map<string, any[]>();
            indexesResult.recordset.forEach((idx: any) => {
                if (!groupedIndexes.has(idx.INDEX_NAME)) {
                    groupedIndexes.set(idx.INDEX_NAME, []);
                }
                groupedIndexes.get(idx.INDEX_NAME)!.push(idx);
            });
            
            groupedIndexes.forEach((indexes, indexName) => {
                const indexType = indexes[0].INDEX_TYPE;
                const isUnique = indexes[0].IS_UNIQUE ? 'UNIQUE ' : '';
                const indexColumns = indexes.map((i: any) => 
                    `[${i.COLUMN_NAME}] ${i.IS_DESCENDING ? 'DESC' : 'ASC'}`
                ).join(', ');
                
                sql += `\n\nCREATE ${isUnique}NONCLUSTERED INDEX [${indexName}]\n ON [${schema}].[${tableName}](${indexColumns});\nGO`;
            });
            
            return sql;
        } catch (error) {
            await dbPool.close();
            throw error;
        }
    }

    private async getHtmlContent(htmlPath: string, webview: vscode.Webview, webviewPath: string): Promise<string> {
        const fs = require('fs');
        let html = fs.readFileSync(htmlPath, 'utf8');

        // Convert resource paths
        const cssPath = webview.asWebviewUri(vscode.Uri.file(path.join(webviewPath, 'compareSchema.css')));
        const jsPath = webview.asWebviewUri(vscode.Uri.file(path.join(webviewPath, 'compareSchema.js')));

        html = html.replace('compareSchema.css', cssPath.toString());
        html = html.replace('compareSchema.js', jsPath.toString());

        return html;
    }
}
