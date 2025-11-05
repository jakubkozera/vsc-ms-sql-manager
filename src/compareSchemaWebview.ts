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
                databases: databases
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
        
        this.outputChannel.appendLine(`[CompareSchema] Comparing ${this.sourceDatabase} with ${targetDatabase} (connection: ${targetConnectionId}`);
        
        this.panel?.webview.postMessage({
            command: 'comparisonStarted'
        });

        try {
            const changes = await this.detectSchemaChanges(targetConnectionId, targetDatabase);
            
            this.panel?.webview.postMessage({
                command: 'comparisonResult',
                changes: changes
            });
            
            this.outputChannel.appendLine(`[CompareSchema] Comparison complete: ${changes.length} changes found`);
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

        // Compare tables
        changes.push(...this.compareTables(sourceSchema.tables, targetSchema.tables));
        
        // Compare columns
        changes.push(...this.compareColumns(sourceSchema.columns, targetSchema.columns));
        
        // Compare views
        changes.push(...this.compareViews(sourceSchema.views, targetSchema.views));
        
        // Compare stored procedures
        changes.push(...this.compareProcedures(sourceSchema.procedures, targetSchema.procedures));
        
        // Compare functions
        changes.push(...this.compareFunctions(sourceSchema.functions, targetSchema.functions));
        
        // Compare indexes
        changes.push(...this.compareIndexes(sourceSchema.indexes, targetSchema.indexes));

        // Compare constraints
        changes.push(...this.compareConstraints(sourceSchema.constraints, targetSchema.constraints));

        return changes;
    }

    private async getSchemaInfo(connectionId: string, database: string) {
        const dbPool = await this.connectionProvider.createDbPool(connectionId, database);

        try {
            // Get tables
            const tablesQuery = `
                SELECT 
                    TABLE_SCHEMA as [schema],
                    TABLE_NAME as name
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_SCHEMA, TABLE_NAME
            `;
            const tablesResult = await dbPool.request().query(tablesQuery);

            // Get columns
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

            // Get views
            const viewsQuery = `
                SELECT 
                    TABLE_SCHEMA as [schema],
                    TABLE_NAME as name
                FROM INFORMATION_SCHEMA.VIEWS
                ORDER BY TABLE_SCHEMA, TABLE_NAME
            `;
            const viewsResult = await dbPool.request().query(viewsQuery);

            // Get stored procedures
            const proceduresQuery = `
                SELECT 
                    ROUTINE_SCHEMA as [schema],
                    ROUTINE_NAME as name
                FROM INFORMATION_SCHEMA.ROUTINES
                WHERE ROUTINE_TYPE = 'PROCEDURE'
                ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
            `;
            const proceduresResult = await dbPool.request().query(proceduresQuery);

            // Get functions
            const functionsQuery = `
                SELECT 
                    ROUTINE_SCHEMA as [schema],
                    ROUTINE_NAME as name
                FROM INFORMATION_SCHEMA.ROUTINES
                WHERE ROUTINE_TYPE = 'FUNCTION'
                ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
            `;
            const functionsResult = await dbPool.request().query(functionsQuery);

            // Get indexes
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

            // Get constraints
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

            await dbPool.close();

            return {
                tables: tablesResult.recordset,
                columns: columnsResult.recordset,
                views: viewsResult.recordset,
                procedures: proceduresResult.recordset,
                functions: functionsResult.recordset,
                indexes: indexesResult.recordset,
                constraints: constraintsResult.recordset
            };
        } catch (error) {
            await dbPool.close();
            throw error;
        }
    }

    private compareTables(sourceTables: any[], targetTables: any[]): SchemaChange[] {
        const changes: SchemaChange[] = [];
        const sourceTableNames = new Set(sourceTables.map(t => `${t.schema}.${t.name}`));
        const targetTableNames = new Set(targetTables.map(t => `${t.schema}.${t.name}`));

        // Tables in source but not in target (deleted)
        sourceTables.forEach(table => {
            const fullName = `${table.schema}.${table.name}`;
            if (!targetTableNames.has(fullName)) {
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
            if (!sourceTableNames.has(fullName)) {
                changes.push({
                    objectType: 'table',
                    objectName: fullName,
                    changeType: 'add',
                    description: 'Table exists in target but not in source database'
                });
            }
        });

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

    private compareViews(sourceViews: any[], targetViews: any[]): SchemaChange[] {
        return this.compareSimpleObjects(sourceViews, targetViews, 'view');
    }

    private compareProcedures(sourceProcedures: any[], targetProcedures: any[]): SchemaChange[] {
        return this.compareSimpleObjects(sourceProcedures, targetProcedures, 'procedure');
    }

    private compareFunctions(sourceFunctions: any[], targetFunctions: any[]): SchemaChange[] {
        return this.compareSimpleObjects(sourceFunctions, targetFunctions, 'function');
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

    private compareSimpleObjects(sourceObjects: any[], targetObjects: any[], objectType: SchemaChange['objectType']): SchemaChange[] {
        const changes: SchemaChange[] = [];
        const sourceNames = new Set(sourceObjects.map(o => `${o.schema}.${o.name}`));
        const targetNames = new Set(targetObjects.map(o => `${o.schema}.${o.name}`));

        // Objects in source but not in target (deleted)
        sourceObjects.forEach(obj => {
            const fullName = `${obj.schema}.${obj.name}`;
            if (!targetNames.has(fullName)) {
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
            if (!sourceNames.has(fullName)) {
                changes.push({
                    objectType: objectType,
                    objectName: fullName,
                    changeType: 'add',
                    description: `${objectType.charAt(0).toUpperCase() + objectType.slice(1)} exists in target but not in source`
                });
            }
        });

        return changes;
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

            if (objectType === 'table') {
                if (change.changeType === 'delete') {
                    originalSchema = await this.getTableDefinition(this.sourceConnectionId, this.sourceDatabase, schema, name);
                    modifiedSchema = `-- Table deleted from target database`;
                } else if (change.changeType === 'add') {
                    originalSchema = `-- Table does not exist in source database`;
                    modifiedSchema = await this.getTableDefinition(this.targetConnectionId, this.targetDatabase, schema, name);
                } else {
                    originalSchema = await this.getTableDefinition(this.sourceConnectionId, this.sourceDatabase, schema, name);
                    modifiedSchema = await this.getTableDefinition(this.targetConnectionId, this.targetDatabase, schema, name);
                }
            } else if (objectType === 'column') {
                // For columns, get table definition from both databases
                const tableName = parts.length > 2 ? parts[1] : schema;
                const tableSchema = parts.length > 2 ? schema : 'dbo';
                
                if (change.changeType === 'delete') {
                    originalSchema = await this.getTableDefinition(this.sourceConnectionId, this.sourceDatabase, tableSchema, tableName);
                    modifiedSchema = await this.getTableDefinition(this.targetConnectionId, this.targetDatabase, tableSchema, tableName);
                } else if (change.changeType === 'add') {
                    originalSchema = await this.getTableDefinition(this.sourceConnectionId, this.sourceDatabase, tableSchema, tableName);
                    modifiedSchema = await this.getTableDefinition(this.targetConnectionId, this.targetDatabase, tableSchema, tableName);
                } else {
                    originalSchema = await this.getTableDefinition(this.sourceConnectionId, this.sourceDatabase, tableSchema, tableName);
                    modifiedSchema = await this.getTableDefinition(this.targetConnectionId, this.targetDatabase, tableSchema, tableName);
                }
            } else if (objectType === 'view') {
                if (change.changeType === 'delete') {
                    originalSchema = await this.getViewDefinition(this.sourceConnectionId, this.sourceDatabase, schema, name);
                    modifiedSchema = `-- View deleted from target database`;
                } else if (change.changeType === 'add') {
                    originalSchema = `-- View does not exist in source database`;
                    modifiedSchema = await this.getViewDefinition(this.targetConnectionId, this.targetDatabase, schema, name);
                } else {
                    originalSchema = await this.getViewDefinition(this.sourceConnectionId, this.sourceDatabase, schema, name);
                    modifiedSchema = await this.getViewDefinition(this.targetConnectionId, this.targetDatabase, schema, name);
                }
            } else if (objectType === 'procedure') {
                if (change.changeType === 'delete') {
                    originalSchema = await this.getProcedureDefinition(this.sourceConnectionId, this.sourceDatabase, schema, name);
                    modifiedSchema = `-- Procedure deleted from target database`;
                } else if (change.changeType === 'add') {
                    originalSchema = `-- Procedure does not exist in source database`;
                    modifiedSchema = await this.getProcedureDefinition(this.targetConnectionId, this.targetDatabase, schema, name);
                } else {
                    originalSchema = await this.getProcedureDefinition(this.sourceConnectionId, this.sourceDatabase, schema, name);
                    modifiedSchema = await this.getProcedureDefinition(this.targetConnectionId, this.targetDatabase, schema, name);
                }
            } else if (objectType === 'function') {
                if (change.changeType === 'delete') {
                    originalSchema = await this.getFunctionDefinition(this.sourceConnectionId, this.sourceDatabase, schema, name);
                    modifiedSchema = `-- Function deleted from target database`;
                } else if (change.changeType === 'add') {
                    originalSchema = `-- Function does not exist in source database`;
                    modifiedSchema = await this.getFunctionDefinition(this.targetConnectionId, this.targetDatabase, schema, name);
                } else {
                    originalSchema = await this.getFunctionDefinition(this.sourceConnectionId, this.sourceDatabase, schema, name);
                    modifiedSchema = await this.getFunctionDefinition(this.targetConnectionId, this.targetDatabase, schema, name);
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

    private async getTableDefinition(connectionId: string, database: string, schema: string, tableName: string): Promise<string> {
        const dbPool = await this.connectionProvider.createDbPool(connectionId, database);
        
        try {
            const query = `
                SELECT 
                    'CREATE TABLE [' + TABLE_SCHEMA + '].[' + TABLE_NAME + '] (' + CHAR(13) + CHAR(10) +
                    STRING_AGG(
                        '    [' + COLUMN_NAME + '] ' + 
                        DATA_TYPE + 
                        CASE 
                            WHEN CHARACTER_MAXIMUM_LENGTH IS NOT NULL THEN '(' + CAST(CHARACTER_MAXIMUM_LENGTH AS VARCHAR) + ')'
                            WHEN NUMERIC_PRECISION IS NOT NULL THEN '(' + CAST(NUMERIC_PRECISION AS VARCHAR) + ',' + CAST(NUMERIC_SCALE AS VARCHAR) + ')'
                            ELSE ''
                        END +
                        CASE WHEN IS_NULLABLE = 'NO' THEN ' NOT NULL' ELSE ' NULL' END +
                        CASE WHEN COLUMN_DEFAULT IS NOT NULL THEN ' DEFAULT ' + COLUMN_DEFAULT ELSE '' END,
                        ',' + CHAR(13) + CHAR(10)
                    ) WITHIN GROUP (ORDER BY ORDINAL_POSITION) +
                    CHAR(13) + CHAR(10) + ');' as definition
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${tableName}'
                GROUP BY TABLE_SCHEMA, TABLE_NAME
            `;
            
            const result = await dbPool.request().query(query);
            await dbPool.close();
            
            return result.recordset[0]?.definition || `-- Table ${schema}.${tableName} not found`;
        } catch (error) {
            await dbPool.close();
            throw error;
        }
    }

    private async getViewDefinition(connectionId: string, database: string, schema: string, viewName: string): Promise<string> {
        const dbPool = await this.connectionProvider.createDbPool(connectionId, database);
        
        try {
            const query = `
                SELECT VIEW_DEFINITION
                FROM INFORMATION_SCHEMA.VIEWS
                WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${viewName}'
            `;
            
            const result = await dbPool.request().query(query);
            await dbPool.close();
            
            return result.recordset[0]?.VIEW_DEFINITION || `-- View ${schema}.${viewName} not found`;
        } catch (error) {
            await dbPool.close();
            throw error;
        }
    }

    private async getProcedureDefinition(connectionId: string, database: string, schema: string, procedureName: string): Promise<string> {
        const dbPool = await this.connectionProvider.createDbPool(connectionId, database);
        
        try {
            const query = `
                SELECT ROUTINE_DEFINITION
                FROM INFORMATION_SCHEMA.ROUTINES
                WHERE ROUTINE_SCHEMA = '${schema}' AND ROUTINE_NAME = '${procedureName}' AND ROUTINE_TYPE = 'PROCEDURE'
            `;
            
            const result = await dbPool.request().query(query);
            await dbPool.close();
            
            return result.recordset[0]?.ROUTINE_DEFINITION || `-- Procedure ${schema}.${procedureName} not found`;
        } catch (error) {
            await dbPool.close();
            throw error;
        }
    }

    private async getFunctionDefinition(connectionId: string, database: string, schema: string, functionName: string): Promise<string> {
        const dbPool = await this.connectionProvider.createDbPool(connectionId, database);
        
        try {
            const query = `
                SELECT ROUTINE_DEFINITION
                FROM INFORMATION_SCHEMA.ROUTINES
                WHERE ROUTINE_SCHEMA = '${schema}' AND ROUTINE_NAME = '${functionName}' AND ROUTINE_TYPE = 'FUNCTION'
            `;
            
            const result = await dbPool.request().query(query);
            await dbPool.close();
            
            return result.recordset[0]?.ROUTINE_DEFINITION || `-- Function ${schema}.${functionName} not found`;
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
