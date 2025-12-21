import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConnectionProvider } from './connectionProvider';
import { SchemaCache, TableInfo, ColumnInfo as CacheColumnInfo, ViewInfo, ProcedureInfo, FunctionInfo, ConstraintInfo as CacheConstraintInfo, IndexInfo as CacheIndexInfo } from './utils/schemaCache';

export interface TableSchema {
    schema: string;
    name: string;
    columns: ColumnInfo[];
    constraints?: ConstraintInfo[];
    indexes?: IndexInfo[];
    rowCount?: number;
}

export interface ColumnInfo {
    name: string;
    dataType: string;
    isNullable: boolean;
    defaultValue?: string;
    maxLength?: number;
    precision?: number;
    scale?: number;
    isIdentity?: boolean;
    isPrimaryKey?: boolean;
}

export interface ConstraintInfo {
    name: string;
    type: 'PRIMARY KEY' | 'FOREIGN KEY' | 'UNIQUE' | 'CHECK';
    columns: string[];
    referencedTable?: string;
    referencedColumns?: string[];
    definition?: string;
}

export interface IndexInfo {
    name: string;
    type: string;
    isUnique: boolean;
    columns: string[];
}

export interface DatabaseSchema {
    database: string;
    connectionId: string;
    tables: TableSchema[];
    views: { schema: string; name: string; columns: ColumnInfo[] }[];
    procedures: { schema: string; name: string }[];
    functions: { schema: string; name: string }[];
    lastUpdated: number;
}

export class SchemaContextBuilder {
    private schemaCache = new Map<string, DatabaseSchema>();
    private readonly CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
    private schemaDirectory: string;
    private centralSchemaCache: SchemaCache;

    constructor(
        private connectionProvider: ConnectionProvider,
        private outputChannel: vscode.OutputChannel,
        private context: vscode.ExtensionContext
    ) {
        // Initialize schema directory
        this.schemaDirectory = path.join(context.globalStorageUri.fsPath, 'schemas');
        this.ensureSchemaDirectory();
        
        // Initialize central schema cache
        this.centralSchemaCache = SchemaCache.getInstance(context);
    }

    /**
     * Ensure schema directory exists
     */
    private ensureSchemaDirectory(): void {
        try {
            if (!fs.existsSync(this.schemaDirectory)) {
                fs.mkdirSync(this.schemaDirectory, { recursive: true });
                this.outputChannel.appendLine(`[SchemaContextBuilder] Created schema directory: ${this.schemaDirectory}`);
            }
        } catch (error) {
            this.outputChannel.appendLine(`[SchemaContextBuilder] Error creating schema directory: ${error}`);
        }
    }

    /**
     * Build comprehensive schema context for a database connection
     */
    async buildSchemaContext(connectionId: string, database?: string): Promise<string> {
        try {
            const cacheKey = `${connectionId}::${database || 'default'}`;
            
            // Check cache first
            const cached = this.schemaCache.get(cacheKey);
            if (cached && this.isCacheValid(cached)) {
                this.outputChannel.appendLine(`[SchemaContextBuilder] Using cached schema for ${cacheKey}`);
                return this.formatSchemaAsCreateStatements(cached);
            }

            // Load fresh schema
            this.outputChannel.appendLine(`[SchemaContextBuilder] Loading fresh schema for ${cacheKey}`);
            const schema = await this.loadDatabaseSchema(connectionId, database);
            
            // Cache the result
            this.schemaCache.set(cacheKey, schema);
            
            // Save schema to file
            await this.saveSchemaToFile(connectionId, database, schema);
            
            // Clean up old cache entries
            this.cleanupCache();
            
            return this.formatSchemaAsCreateStatements(schema);
        } catch (error) {
            this.outputChannel.appendLine(`[SchemaContextBuilder] Error building schema context: ${error}`);
            return `-- Error loading database schema: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    /**
     * Save schema to file for chat context
     */
    private async saveSchemaToFile(connectionId: string, database: string | undefined, schema: DatabaseSchema): Promise<void> {
        try {
            const config = this.connectionProvider.getConnectionConfig(connectionId);
            if (!config) {
                return;
            }

            // Generate filename: connectionName_server_database.sql
            const safeName = (str: string) => str.replace(/[^a-zA-Z0-9_-]/g, '_');
            const fileName = `${safeName(config.name)}_${safeName(config.server)}_${safeName(database || config.database || 'default')}.sql`;
            const filePath = path.join(this.schemaDirectory, fileName);

            // Format schema as CREATE statements
            const schemaContent = this.formatSchemaAsCreateStatements(schema);

            // Write to file
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(filePath),
                Buffer.from(schemaContent, 'utf8')
            );

            this.outputChannel.appendLine(`[SchemaContextBuilder] Schema saved to: ${filePath}`);
        } catch (error) {
            this.outputChannel.appendLine(`[SchemaContextBuilder] Error saving schema to file: ${error}`);
        }
    }

    /**
     * Get schema file path for a connection
     */
    getSchemaFilePath(connectionId: string, database?: string): string | null {
        try {
            const config = this.connectionProvider.getConnectionConfig(connectionId);
            if (!config) {
                return null;
            }

            const safeName = (str: string) => str.replace(/[^a-zA-Z0-9_-]/g, '_');
            const fileName = `${safeName(config.name)}_${safeName(config.server)}_${safeName(database || config.database || 'default')}.sql`;
            const filePath = path.join(this.schemaDirectory, fileName);

            // Check if file exists
            if (fs.existsSync(filePath)) {
                return filePath;
            }

            return null;
        } catch (error) {
            this.outputChannel.appendLine(`[SchemaContextBuilder] Error getting schema file path: ${error}`);
            return null;
        }
    }

    /**
     * Load complete database schema from SQL Server
     */
    private async loadDatabaseSchema(connectionId: string, database?: string): Promise<DatabaseSchema> {
        const dbPool = database 
            ? await this.connectionProvider.createDbPool(connectionId, database)
            : this.connectionProvider.getConnection(connectionId);

        if (!dbPool) {
            throw new Error(`Unable to create database connection for ${connectionId}::${database || 'default'}`);
        }

        // Get connection info to use with SchemaCache
        const connectionInfo = this.connectionProvider.getConnectionConfig(connectionId);
        if (!connectionInfo) {
            throw new Error(`Unable to get connection config for ${connectionId}`);
        }

        // Create a connection info object for the cache
        const cacheConnection = {
            ...connectionInfo,
            database: database || connectionInfo.database || ''
        };

        // Use SchemaCache to get data
        const cachedSchema = await this.centralSchemaCache.getSchema(cacheConnection, dbPool);

        // Convert cache format to our format
        const schema: DatabaseSchema = {
            database: database || 'default',
            connectionId,
            tables: await this.convertCachedTables(cacheConnection, dbPool, cachedSchema.tables),
            views: Array.from(cachedSchema.views.values()).map(v => ({
                schema: v.schema,
                name: v.name,
                columns: [] // Views don't have detailed columns in this simplified version
            })),
            procedures: Array.from(cachedSchema.procedures.values()).map(p => ({
                schema: p.schema,
                name: p.name
            })),
            functions: Array.from(cachedSchema.functions.values()).map(f => ({
                schema: f.schema,
                name: f.name
            })),
            lastUpdated: cachedSchema.lastUpdated.getTime()
        };

        this.outputChannel.appendLine(
            `[SchemaContextBuilder] Loaded schema via SchemaCache: ${schema.tables.length} tables, ` +
            `${schema.views.length} views, ${schema.procedures.length} procedures, ` +
            `${schema.functions.length} functions`
        );

        return schema;
    }

    /**
     * Convert cached tables to our format with all details
     */
    private async convertCachedTables(connection: any, pool: any, tables: Map<string, TableInfo>): Promise<TableSchema[]> {
        const result: TableSchema[] = [];

        for (const table of tables.values()) {
            const columns = await this.centralSchemaCache.getTableColumns(connection, pool, table.schema, table.name);
            const indexes = await this.centralSchemaCache.getTableIndexes(connection, pool, table.schema, table.name);
            const constraints = await this.centralSchemaCache.getTableConstraints(connection, pool, table.schema, table.name);

            result.push({
                schema: table.schema,
                name: table.name,
                rowCount: table.rowCount,
                columns: columns.map(c => ({
                    name: c.columnName,
                    dataType: c.dataType,
                    isNullable: c.isNullable,
                    defaultValue: c.defaultValue,
                    maxLength: c.maxLength,
                    precision: c.precision,
                    scale: c.scale,
                    isIdentity: c.isIdentity,
                    isPrimaryKey: c.isPrimaryKey
                })),
                indexes: indexes.map(i => ({
                    name: i.indexName,
                    type: i.indexType,
                    isUnique: i.isUnique,
                    columns: i.columns
                })),
                constraints: constraints.map(c => ({
                    name: c.constraintName,
                    type: c.constraintType,
                    columns: c.columns || [],
                    referencedTable: c.referencedTableName ? `${c.referencedTableSchema}.${c.referencedTableName}` : undefined,
                    referencedColumns: c.referencedColumns,
                    definition: c.checkClause
                }))
            });
        }

        return result;
    }

    /**
     * Load all tables with detailed column information
     */
    private async loadTables(dbPool: any, schema: DatabaseSchema): Promise<void> {
        try {
            this.outputChannel.appendLine(`[SchemaContextBuilder] Starting loadTables...`);
            
            // First, get all tables with row counts
            const tablesQuery = `
                SELECT 
                    t.TABLE_SCHEMA as [schema],
                    t.TABLE_NAME as name,
                    ISNULL(SUM(p.rows), 0) as row_count
                FROM INFORMATION_SCHEMA.TABLES t
                INNER JOIN sys.tables st ON t.TABLE_NAME = st.name AND t.TABLE_SCHEMA = SCHEMA_NAME(st.schema_id)
                LEFT JOIN sys.partitions p ON st.object_id = p.object_id AND p.index_id IN (0, 1)
                WHERE t.TABLE_TYPE = 'BASE TABLE'
                GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME
                ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
            `;

            this.outputChannel.appendLine(`[SchemaContextBuilder] Executing tables query...`);
            const tablesResult = await dbPool.request().query(tablesQuery);
            this.outputChannel.appendLine(`[SchemaContextBuilder] Found ${tablesResult.recordset.length} tables in database`);
            
            // Then get detailed column information for all tables
            const columnsQuery = `
                SELECT 
                    c.TABLE_SCHEMA as tableSchema,
                    c.TABLE_NAME as tableName,
                    c.COLUMN_NAME as columnName,
                    c.DATA_TYPE as dataType,
                    c.IS_NULLABLE as isNullable,
                    c.COLUMN_DEFAULT as defaultValue,
                    c.CHARACTER_MAXIMUM_LENGTH as maxLength,
                    c.NUMERIC_PRECISION as precision,
                    c.NUMERIC_SCALE as scale,
                    c.ORDINAL_POSITION as position,
                    CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as isPrimaryKey,
                    CASE WHEN cc.is_identity = 1 THEN 1 ELSE 0 END as isIdentity
                FROM INFORMATION_SCHEMA.COLUMNS c
                LEFT JOIN (
                    SELECT 
                        kcu.TABLE_SCHEMA,
                        kcu.TABLE_NAME,
                        kcu.COLUMN_NAME
                    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                    INNER JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                        ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                    WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
                ) pk ON c.TABLE_SCHEMA = pk.TABLE_SCHEMA 
                    AND c.TABLE_NAME = pk.TABLE_NAME 
                    AND c.COLUMN_NAME = pk.COLUMN_NAME
                LEFT JOIN sys.columns cc ON cc.object_id = OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME))
                    AND cc.name = c.COLUMN_NAME
                WHERE c.TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
                ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
            `;

            this.outputChannel.appendLine(`[SchemaContextBuilder] Executing columns query...`);
            const columnsResult = await dbPool.request().query(columnsQuery);
            this.outputChannel.appendLine(`[SchemaContextBuilder] Found ${columnsResult.recordset.length} columns across all tables`);
            
            // Group columns by table
            const columnsMap = new Map<string, ColumnInfo[]>();
            for (const col of columnsResult.recordset) {
                const tableKey = `${col.tableSchema}.${col.tableName}`;
                if (!columnsMap.has(tableKey)) {
                    columnsMap.set(tableKey, []);
                }

                const column: ColumnInfo = {
                    name: col.columnName,
                    dataType: this.formatDataType(col.dataType, col.maxLength, col.precision, col.scale),
                    isNullable: col.isNullable === 'YES',
                    defaultValue: col.defaultValue,
                    maxLength: col.maxLength,
                    precision: col.precision,
                    scale: col.scale,
                    isIdentity: col.isIdentity === 1,
                    isPrimaryKey: col.isPrimaryKey === 1
                };

                columnsMap.get(tableKey)!.push(column);
            }

            // Load constraints for all tables
            const constraintsMap = await this.loadAllTableConstraints(dbPool);
            
            // Load indexes for all tables
            const indexesMap = await this.loadAllTableIndexes(dbPool);

            // Build table schemas
            for (const table of tablesResult.recordset) {
                const tableKey = `${table.schema}.${table.name}`;
                const columns = columnsMap.get(tableKey) || [];
                const constraints = constraintsMap.get(tableKey) || [];
                const indexes = indexesMap.get(tableKey) || [];

                schema.tables.push({
                    schema: table.schema,
                    name: table.name,
                    columns,
                    constraints,
                    indexes,
                    rowCount: table.row_count
                });
            }

        } catch (error) {
            this.outputChannel.appendLine(`[SchemaContextBuilder] Error loading tables: ${error}`);
        }
    }

    /**
     * Load constraints for all tables
     */
    private async loadAllTableConstraints(dbPool: any): Promise<Map<string, ConstraintInfo[]>> {
        this.outputChannel.appendLine(`[SchemaContextBuilder] Loading constraints...`);
        
        // Use a simpler approach - get all constraint columns first
        const constraintsQuery = `
            SELECT 
                tc.TABLE_SCHEMA as tableSchema,
                tc.TABLE_NAME as tableName,
                tc.CONSTRAINT_NAME as constraintName,
                tc.CONSTRAINT_TYPE as constraintType,
                kcu.COLUMN_NAME as columnName,
                kcu.ORDINAL_POSITION as ordinalPosition,
                rc.UPDATE_RULE as updateRule,
                rc.DELETE_RULE as deleteRule,
                ccu.TABLE_SCHEMA AS referencedTableSchema,
                ccu.TABLE_NAME AS referencedTableName,
                ccu.COLUMN_NAME AS referencedColumnName,
                cc.CHECK_CLAUSE as checkClause
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
            WHERE tc.TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
            ORDER BY tc.TABLE_SCHEMA, tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
        `;

        const result = await dbPool.request().query(constraintsQuery);
        this.outputChannel.appendLine(`[SchemaContextBuilder] Found ${result.recordset.length} constraint rows`);
        
        const constraintsMap = new Map<string, ConstraintInfo[]>();
        const constraintsByName = new Map<string, {
            tableSchema: string;
            tableName: string;
            constraintName: string;
            constraintType: string;
            columns: string[];
            referencedTable?: string;
            referencedColumns?: string[];
            definition?: string;
        }>();

        // Group constraint rows by constraint name
        for (const row of result.recordset) {
            const constraintKey = `${row.tableSchema}.${row.tableName}.${row.constraintName}`;
            
            if (!constraintsByName.has(constraintKey)) {
                constraintsByName.set(constraintKey, {
                    tableSchema: row.tableSchema,
                    tableName: row.tableName,
                    constraintName: row.constraintName,
                    constraintType: row.constraintType,
                    columns: [],
                    referencedColumns: [],
                    definition: row.checkClause
                });
            }
            
            const constraint = constraintsByName.get(constraintKey)!;
            
            // Add column if not already present
            if (row.columnName && !constraint.columns.includes(row.columnName)) {
                constraint.columns.push(row.columnName);
            }
            
            // Add referenced table/column info for FK constraints
            if (row.referencedTableName && row.referencedTableSchema) {
                constraint.referencedTable = `${row.referencedTableSchema}.${row.referencedTableName}`;
                if (row.referencedColumnName && !constraint.referencedColumns?.includes(row.referencedColumnName)) {
                    constraint.referencedColumns?.push(row.referencedColumnName);
                }
            }
        }

        // Convert to ConstraintInfo array grouped by table
        for (const [key, constraint] of constraintsByName.entries()) {
            const tableKey = `${constraint.tableSchema}.${constraint.tableName}`;
            if (!constraintsMap.has(tableKey)) {
                constraintsMap.set(tableKey, []);
            }

            const constraintInfo: ConstraintInfo = {
                name: constraint.constraintName,
                type: constraint.constraintType as any,
                columns: constraint.columns,
                referencedTable: constraint.referencedTable,
                referencedColumns: constraint.referencedColumns && constraint.referencedColumns.length > 0 
                    ? constraint.referencedColumns 
                    : undefined,
                definition: constraint.definition
            };

            constraintsMap.get(tableKey)!.push(constraintInfo);
        }

        this.outputChannel.appendLine(`[SchemaContextBuilder] Processed ${constraintsMap.size} tables with constraints`);
        return constraintsMap;
    }

    /**
     * Load indexes for all tables
     */
    private async loadAllTableIndexes(dbPool: any): Promise<Map<string, IndexInfo[]>> {
        this.outputChannel.appendLine(`[SchemaContextBuilder] Loading indexes...`);
        
        const indexesQuery = `
            SELECT 
                SCHEMA_NAME(t.schema_id) AS tableSchema,
                t.name AS tableName,
                i.name AS indexName,
                i.type_desc AS indexType,
                i.is_unique as isUnique,
                COL_NAME(ic.object_id, ic.column_id) AS columnName,
                ic.key_ordinal
            FROM sys.indexes i
            INNER JOIN sys.index_columns ic 
                ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            INNER JOIN sys.tables t 
                ON i.object_id = t.object_id
            WHERE i.type > 0
                AND SCHEMA_NAME(t.schema_id) NOT IN ('sys', 'INFORMATION_SCHEMA')
            ORDER BY SCHEMA_NAME(t.schema_id), t.name, i.name, ic.key_ordinal
        `;

        const result = await dbPool.request().query(indexesQuery);
        this.outputChannel.appendLine(`[SchemaContextBuilder] Found ${result.recordset.length} index column rows`);
        
        const indexesMap = new Map<string, IndexInfo[]>();
        const indexesByName = new Map<string, {
            tableSchema: string;
            tableName: string;
            indexName: string;
            indexType: string;
            isUnique: boolean;
            columns: string[];
        }>();

        // Group by index name
        for (const row of result.recordset) {
            const indexKey = `${row.tableSchema}.${row.tableName}.${row.indexName}`;
            
            if (!indexesByName.has(indexKey)) {
                indexesByName.set(indexKey, {
                    tableSchema: row.tableSchema,
                    tableName: row.tableName,
                    indexName: row.indexName,
                    indexType: row.indexType,
                    isUnique: row.isUnique,
                    columns: []
                });
            }
            
            const index = indexesByName.get(indexKey)!;
            if (row.columnName && !index.columns.includes(row.columnName)) {
                index.columns.push(row.columnName);
            }
        }

        // Convert to IndexInfo array grouped by table
        for (const [key, index] of indexesByName.entries()) {
            const tableKey = `${index.tableSchema}.${index.tableName}`;
            if (!indexesMap.has(tableKey)) {
                indexesMap.set(tableKey, []);
            }

            const indexInfo: IndexInfo = {
                name: index.indexName,
                type: index.indexType,
                isUnique: index.isUnique,
                columns: index.columns
            };

            indexesMap.get(tableKey)!.push(indexInfo);
        }

        this.outputChannel.appendLine(`[SchemaContextBuilder] Processed ${indexesMap.size} tables with indexes`);
        return indexesMap;
    }

    /**
     * Load all views with columns
     */
    private async loadViews(dbPool: any, schema: DatabaseSchema): Promise<void> {
        try {
            const viewsQuery = `
                SELECT 
                    v.TABLE_SCHEMA as [schema],
                    v.TABLE_NAME as name,
                    c.COLUMN_NAME as columnName,
                    c.DATA_TYPE as dataType,
                    c.IS_NULLABLE as isNullable,
                    c.CHARACTER_MAXIMUM_LENGTH as maxLength,
                    c.NUMERIC_PRECISION as precision,
                    c.NUMERIC_SCALE as scale
                FROM INFORMATION_SCHEMA.VIEWS v
                LEFT JOIN INFORMATION_SCHEMA.COLUMNS c 
                    ON v.TABLE_SCHEMA = c.TABLE_SCHEMA 
                    AND v.TABLE_NAME = c.TABLE_NAME
                WHERE v.TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
                ORDER BY v.TABLE_SCHEMA, v.TABLE_NAME, c.ORDINAL_POSITION
            `;

            const result = await dbPool.request().query(viewsQuery);
            const viewsMap = new Map<string, { schema: string; name: string; columns: ColumnInfo[] }>();

            for (const row of result.recordset) {
                const viewKey = `${row.schema}.${row.name}`;
                
                if (!viewsMap.has(viewKey)) {
                    viewsMap.set(viewKey, {
                        schema: row.schema,
                        name: row.name,
                        columns: []
                    });
                }

                if (row.columnName) {
                    const column: ColumnInfo = {
                        name: row.columnName,
                        dataType: this.formatDataType(row.dataType, row.maxLength, row.precision, row.scale),
                        isNullable: row.isNullable === 'YES',
                        maxLength: row.maxLength,
                        precision: row.precision,
                        scale: row.scale,
                        isIdentity: false,
                        isPrimaryKey: false
                    };
                    viewsMap.get(viewKey)!.columns.push(column);
                }
            }

            schema.views = Array.from(viewsMap.values());
        } catch (error) {
            this.outputChannel.appendLine(`[SchemaContextBuilder] Error loading views: ${error}`);
        }
    }

    /**
     * Load stored procedures
     */
    private async loadProcedures(dbPool: any, schema: DatabaseSchema): Promise<void> {
        try {
            const proceduresQuery = `
                SELECT 
                    ROUTINE_SCHEMA as [schema],
                    ROUTINE_NAME as name
                FROM INFORMATION_SCHEMA.ROUTINES
                WHERE ROUTINE_TYPE = 'PROCEDURE'
                    AND ROUTINE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
                ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
            `;

            const result = await dbPool.request().query(proceduresQuery);
            schema.procedures = result.recordset.map((row: any) => ({
                schema: row.schema,
                name: row.name
            }));
        } catch (error) {
            this.outputChannel.appendLine(`[SchemaContextBuilder] Error loading procedures: ${error}`);
        }
    }

    /**
     * Load functions
     */
    private async loadFunctions(dbPool: any, schema: DatabaseSchema): Promise<void> {
        try {
            const functionsQuery = `
                SELECT 
                    ROUTINE_SCHEMA as [schema],
                    ROUTINE_NAME as name
                FROM INFORMATION_SCHEMA.ROUTINES
                WHERE ROUTINE_TYPE = 'FUNCTION'
                    AND ROUTINE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
                ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
            `;

            const result = await dbPool.request().query(functionsQuery);
            schema.functions = result.recordset.map((row: any) => ({
                schema: row.schema,
                name: row.name
            }));
        } catch (error) {
            this.outputChannel.appendLine(`[SchemaContextBuilder] Error loading functions: ${error}`);
        }
    }

    /**
     * Format data type with length/precision
     */
    private formatDataType(dataType: string, maxLength?: number, precision?: number, scale?: number): string {
        switch (dataType.toLowerCase()) {
            case 'varchar':
            case 'nvarchar':
            case 'char':
            case 'nchar':
                return maxLength && maxLength !== -1 ? `${dataType}(${maxLength})` : `${dataType}(MAX)`;
            case 'decimal':
            case 'numeric':
                return precision !== null && precision !== undefined 
                    ? `${dataType}(${precision},${scale || 0})` 
                    : dataType;
            case 'float':
                return precision !== null && precision !== undefined 
                    ? `${dataType}(${precision})` 
                    : dataType;
            default:
                return dataType;
        }
    }

    /**
     * Format schema as CREATE TABLE statements for language model context
     */
    private formatSchemaAsCreateStatements(schema: DatabaseSchema): string {
        let context = `-- Database Schema for: ${schema.database}\n`;
        context += `-- Connection: ${schema.connectionId}\n`;
        context += `-- Last Updated: ${new Date(schema.lastUpdated).toISOString()}\n\n`;

        // Add tables
        if (schema.tables.length > 0) {
            context += `-- TABLES (${schema.tables.length})\n`;
            for (const table of schema.tables) {
                context += this.formatTableAsCreateStatement(table) + '\n\n';
            }
        }

        // Add views
        if (schema.views.length > 0) {
            context += `-- VIEWS (${schema.views.length})\n`;
            for (const view of schema.views) {
                context += this.formatViewAsCreateStatement(view) + '\n\n';
            }
        }

        // Add procedures and functions list
        if (schema.procedures.length > 0) {
            context += `-- STORED PROCEDURES (${schema.procedures.length})\n`;
            for (const proc of schema.procedures) {
                context += `-- EXEC [${proc.schema}].[${proc.name}]\n`;
            }
            context += '\n';
        }

        if (schema.functions.length > 0) {
            context += `-- FUNCTIONS (${schema.functions.length})\n`;
            for (const func of schema.functions) {
                context += `-- SELECT [${func.schema}].[${func.name}]()\n`;
            }
            context += '\n';
        }

        return context;
    }

    /**
     * Format single table as CREATE TABLE statement
     */
    private formatTableAsCreateStatement(table: TableSchema): string {
        let sql = `CREATE TABLE [${table.schema}].[${table.name}] (\n`;
        
        // Add columns
        const columnDefs = table.columns.map(col => {
            let colDef = `    [${col.name}] ${col.dataType.toUpperCase()}`;
            
            if (col.isIdentity) {
                colDef += ' IDENTITY(1,1)';
            }
            
            if (!col.isNullable) {
                colDef += ' NOT NULL';
            }
            
            if (col.defaultValue && !col.isIdentity) {
                colDef += ` DEFAULT ${col.defaultValue}`;
            }
            
            return colDef;
        });
        
        sql += columnDefs.join(',\n');
        
        // Add primary key constraint
        const pkColumns = table.columns.filter(c => c.isPrimaryKey).map(c => `[${c.name}]`);
        if (pkColumns.length > 0) {
            const pkConstraint = table.constraints?.find(c => c.type === 'PRIMARY KEY');
            const constraintName = pkConstraint?.name || `PK_${table.name}`;
            sql += `,\n    CONSTRAINT [${constraintName}] PRIMARY KEY (${pkColumns.join(', ')})`;
        }
        
        // Add other constraints
        const otherConstraints = table.constraints?.filter(c => c.type !== 'PRIMARY KEY') || [];
        for (const constraint of otherConstraints) {
            switch (constraint.type) {
                case 'FOREIGN KEY':
                    sql += `,\n    CONSTRAINT [${constraint.name}] FOREIGN KEY (${constraint.columns.map(c => `[${c}]`).join(', ')}) REFERENCES ${constraint.referencedTable} (${constraint.referencedColumns?.map(c => `[${c}]`).join(', ') || ''})`;
                    break;
                case 'UNIQUE':
                    sql += `,\n    CONSTRAINT [${constraint.name}] UNIQUE (${constraint.columns.map(c => `[${c}]`).join(', ')})`;
                    break;
                case 'CHECK':
                    sql += `,\n    CONSTRAINT [${constraint.name}] CHECK ${constraint.definition || ''}`;
                    break;
            }
        }
        
        sql += '\n);';
        
        // Add comment with row count if available
        if (table.rowCount !== undefined) {
            sql += ` -- Rows: ${table.rowCount.toLocaleString()}`;
        }
        
        // Add index information as comments
        if (table.indexes && table.indexes.length > 0) {
            sql += '\n-- Indexes:';
            for (const index of table.indexes) {
                sql += `\n-- ${index.isUnique ? 'UNIQUE ' : ''}${index.type} [${index.name}] ON (${index.columns.map(c => `[${c}]`).join(', ')})`;
            }
        }
        
        return sql;
    }

    /**
     * Format view as CREATE VIEW statement
     */
    private formatViewAsCreateStatement(view: { schema: string; name: string; columns: ColumnInfo[] }): string {
        let sql = `CREATE VIEW [${view.schema}].[${view.name}] AS SELECT\n`;
        
        if (view.columns.length > 0) {
            const columnList = view.columns.map(col => `    [${col.name}] -- ${col.dataType.toUpperCase()}`);
            sql += columnList.join(',\n');
            sql += '\nFROM [YourTable]; -- View definition not available';
        } else {
            sql += '    -- Column information not available\n    *\nFROM [YourTable]; -- View definition not available';
        }
        
        return sql;
    }

    /**
     * Check if cached schema is still valid
     */
    private isCacheValid(schema: DatabaseSchema): boolean {
        return (Date.now() - schema.lastUpdated) < this.CACHE_DURATION;
    }

    /**
     * Clean up expired cache entries
     */
    private cleanupCache(): void {
        const now = Date.now();
        for (const [key, schema] of this.schemaCache.entries()) {
            if (now - schema.lastUpdated > this.CACHE_DURATION) {
                this.schemaCache.delete(key);
            }
        }
    }

    /**
     * Clear cache for specific connection/database
     */
    clearCache(connectionId?: string, database?: string): void {
        if (connectionId && database) {
            const cacheKey = `${connectionId}::${database}`;
            this.schemaCache.delete(cacheKey);
        } else if (connectionId) {
            // Clear all cache entries for this connection
            for (const key of this.schemaCache.keys()) {
                if (key.startsWith(`${connectionId}::`)) {
                    this.schemaCache.delete(key);
                }
            }
        } else {
            // Clear all cache
            this.schemaCache.clear();
        }
    }

    /**
     * Get cached schema without database queries (for performance)
     */
    getCachedSchema(connectionId: string, database?: string): DatabaseSchema | null {
        const cacheKey = `${connectionId}::${database || 'default'}`;
        const cached = this.schemaCache.get(cacheKey);
        return (cached && this.isCacheValid(cached)) ? cached : null;
    }
}