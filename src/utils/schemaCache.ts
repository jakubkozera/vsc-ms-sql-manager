import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { DBPool } from '../dbClient';
import * as sql from 'mssql';

/**
 * Get configured cache validity duration in milliseconds
 */
function getCacheValidityMs(): number {
    const config = vscode.workspace.getConfiguration('mssqlManager');
    const seconds = config.get<number>('schemaCacheValiditySeconds', 120);
    return seconds * 1000;
}

/**
 * Connection information for cache key generation
 */
export interface ConnectionInfo {
    server: string;
    database: string;
}

/**
 * Schema object types for granular cache management
 */
export enum SchemaObjectType {
    Table = 'table',
    View = 'view',
    Procedure = 'procedure',
    Function = 'function',
    Trigger = 'trigger',
    Index = 'index',
    Constraint = 'constraint',
    Column = 'column'
}

/**
 * Table metadata with statistics
 */
export interface TableInfo {
    schema: string;
    name: string;
    owner?: string;
    rowCount?: number;
    sizeMB?: number;
    type: 'table';
    lastModified?: Date;
}

/**
 * Column metadata
 */
export interface ColumnInfo {
    tableSchema: string;
    tableName: string;
    columnName: string;
    dataType: string;
    isNullable: boolean;
    defaultValue?: string;
    maxLength?: number;
    precision?: number;
    scale?: number;
    position: number;
    isPrimaryKey: boolean;
    isIdentity: boolean;
    isComputed?: boolean;
    generatedAlwaysType?: number;
}

/**
 * View metadata
 */
export interface ViewInfo {
    schema: string;
    name: string;
    type: 'view';
    lastModified?: Date;
}

/**
 * Stored procedure metadata
 */
export interface ProcedureInfo {
    schema: string;
    name: string;
    type: 'procedure';
    lastModified?: Date;
}

/**
 * Function metadata
 */
export interface FunctionInfo {
    schema: string;
    name: string;
    functionType?: string; // 'scalar' | 'table-valued' | 'aggregate'
    type: 'function';
    lastModified?: Date;
}

/**
 * Index metadata
 */
export interface IndexInfo {
    tableSchema: string;
    tableName: string;
    indexName: string;
    indexType: string;
    isUnique: boolean;
    isPrimaryKey?: boolean;
    columns: string[];
}

/**
 * Constraint metadata
 */
export interface ConstraintInfo {
    tableSchema: string;
    tableName: string;
    constraintName: string;
    constraintType: 'PRIMARY KEY' | 'FOREIGN KEY' | 'UNIQUE' | 'CHECK';
    columns?: string[];
    referencedTableSchema?: string;
    referencedTableName?: string;
    referencedColumns?: string[];
    checkClause?: string;
}

/**
 * Trigger metadata
 */
export interface TriggerInfo {
    schema: string;
    tableName?: string;
    name: string;
    isDisabled: boolean;
    isInsteadOf?: boolean;
    type: 'trigger';
}

/**
 * Database schema hash for change detection
 */
interface DatabaseHash {
    objectsChecksum: number;
    maxModifyDate: string;
    objectCounts: {
        tables: number;
        views: number;
        procedures: number;
        functions: number;
    };
    computedAt: Date;
}

/**
 * Cached schema data structure
 */
interface CachedSchema {
    hash: DatabaseHash;
    tables: Map<string, TableInfo>; // key: schema.name
    columns: Map<string, ColumnInfo[]>; // key: schema.tableName
    views: Map<string, ViewInfo>; // key: schema.name
    procedures: Map<string, ProcedureInfo>; // key: schema.name
    functions: Map<string, FunctionInfo>; // key: schema.name
    indexes: Map<string, IndexInfo[]>; // key: schema.tableName
    constraints: Map<string, ConstraintInfo[]>; // key: schema.tableName
    triggers: Map<string, TriggerInfo>; // key: schema.name (or schema.tableName.triggerName)
    lastUpdated: Date;
}

/**
 * Centralized schema cache with persistent storage and hash-based validation
 */
export class SchemaCache {
    private static instance: SchemaCache;
    private caches: Map<string, CachedSchema> = new Map();
    private cachePath: string;
    private loadingPromises: Map<string, Promise<void>> = new Map();
    private hashComputations: Map<string, Promise<DatabaseHash>> = new Map();
    private lastValidationCheck: Map<string, { timestamp: Date, wasValid: boolean }> = new Map();
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.cachePath = path.join(context.globalStorageUri.fsPath, 'schema-cache');
    }

    /**
     * Get singleton instance
     */
    public static getInstance(context?: vscode.ExtensionContext): SchemaCache {
        if (!SchemaCache.instance && context) {
            SchemaCache.instance = new SchemaCache(context);
        }
        return SchemaCache.instance;
    }

    /**
     * Get cache key for a connection
     */
    private getCacheKey(connection: ConnectionInfo): string {
        return `${connection.server}:${connection.database}`.toLowerCase();
    }

    /**
     * Get pool identifier for hash computation caching
     */
    private getPoolKey(connection: ConnectionInfo): string {
        return this.getCacheKey(connection);
    }

    /**
     * Get file path for cached schema
     */
    private getCacheFilePath(cacheKey: string): string {
        const safeName = cacheKey.replace(/[^a-z0-9]/gi, '_');
        return path.join(this.cachePath, `${safeName}.json`);
    }

    /**
     * Compute database schema hash for change detection
     * Uses caching to prevent multiple simultaneous computations
     */
    private async computeDatabaseHash(cacheKey: string, pool: DBPool): Promise<DatabaseHash> {
        console.log(`[SchemaCache] computeDatabaseHash() called for ${cacheKey}`);
        
        // If already computing hash for this cache key, wait for that computation
        if (this.hashComputations.has(cacheKey)) {
            console.log(`[SchemaCache] computeDatabaseHash() - Using existing computation promise`);
            return await this.hashComputations.get(cacheKey)!;
        }

        // Start new hash computation
        console.log(`[SchemaCache] computeDatabaseHash() - Starting new hash computation`);
        const computePromise = this._computeDatabaseHashInternal(pool);
        this.hashComputations.set(cacheKey, computePromise);
        
        try {
            const result = await computePromise;
            // Cache result based on user configuration (default: 120 seconds)
            const validityMs = getCacheValidityMs();
            console.log(`[SchemaCache] computeDatabaseHash() - Hash computed, caching for ${validityMs/1000}s`);
            setTimeout(() => {
                this.hashComputations.delete(cacheKey);
                console.log(`[SchemaCache] computeDatabaseHash() - Hash cache expired for ${cacheKey}`);
            }, validityMs);
            return result;
        } catch (error) {
            console.error(`[SchemaCache] computeDatabaseHash() - Error:`, error);
            // Remove failed computation immediately
            this.hashComputations.delete(cacheKey);
            throw error;
        }
    }

    /**
     * Internal method that actually computes the hash
     * Optimized: Single query instead of 3 separate queries
     */
    private async _computeDatabaseHashInternal(pool: DBPool): Promise<DatabaseHash> {
        // Combined query - all hash components in one round-trip
        const query = `
            SELECT 
                CHECKSUM_AGG(BINARY_CHECKSUM(object_id, modify_date, type)) as objectsChecksum,
                MAX(modify_date) as maxModifyDate,
                SUM(CASE WHEN type = 'U' THEN 1 ELSE 0 END) as tables,
                SUM(CASE WHEN type = 'V' THEN 1 ELSE 0 END) as views,
                SUM(CASE WHEN type = 'P' THEN 1 ELSE 0 END) as procedures,
                SUM(CASE WHEN type IN ('FN', 'IF', 'TF') THEN 1 ELSE 0 END) as functions
            FROM sys.objects
            WHERE type IN ('U', 'V', 'P', 'FN', 'IF', 'TF', 'TR')
                AND is_ms_shipped = 0
        `;

        const result = await pool.request().query(query);
        const row = result.recordset[0];

        return {
            objectsChecksum: row?.objectsChecksum || 0,
            maxModifyDate: row?.maxModifyDate?.toISOString() || new Date().toISOString(),
            objectCounts: {
                tables: row?.tables || 0,
                views: row?.views || 0,
                procedures: row?.procedures || 0,
                functions: row?.functions || 0
            },
            computedAt: new Date()
        };
    }

    /**
     * Load schema from persistent storage
     */
    private async loadFromDisk(cacheKey: string): Promise<CachedSchema | undefined> {
        try {
            const filePath = this.getCacheFilePath(cacheKey);
            const data = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(data);

            // Convert plain objects back to Maps
            return {
                hash: parsed.hash,
                tables: new Map(Object.entries(parsed.tables)),
                columns: new Map(Object.entries(parsed.columns)),
                views: new Map(Object.entries(parsed.views)),
                procedures: new Map(Object.entries(parsed.procedures)),
                functions: new Map(Object.entries(parsed.functions)),
                indexes: new Map(Object.entries(parsed.indexes)),
                constraints: new Map(Object.entries(parsed.constraints)),
                triggers: new Map(Object.entries(parsed.triggers)),
                lastUpdated: new Date(parsed.lastUpdated)
            };
        } catch (error) {
            // Cache file doesn't exist or is corrupted
            return undefined;
        }
    }

    /**
     * Save schema to persistent storage
     */
    private async saveToDisk(cacheKey: string, schema: CachedSchema): Promise<void> {
        try {
            await fs.mkdir(this.cachePath, { recursive: true });
            
            const filePath = this.getCacheFilePath(cacheKey);
            
            // Convert Maps to plain objects for JSON serialization
            const serializable = {
                hash: schema.hash,
                tables: Object.fromEntries(schema.tables),
                columns: Object.fromEntries(schema.columns),
                views: Object.fromEntries(schema.views),
                procedures: Object.fromEntries(schema.procedures),
                functions: Object.fromEntries(schema.functions),
                indexes: Object.fromEntries(schema.indexes),
                constraints: Object.fromEntries(schema.constraints),
                triggers: Object.fromEntries(schema.triggers),
                lastUpdated: schema.lastUpdated.toISOString()
            };

            await fs.writeFile(filePath, JSON.stringify(serializable, null, 2), 'utf-8');
        } catch (error) {
            console.error('Failed to save schema cache to disk:', error);
        }
    }

    /**
     * Check if cached schema is still valid by comparing hashes
     */
    private async isCacheValid(cacheKey: string, pool: DBPool, cachedSchema: CachedSchema): Promise<boolean> {
        try {
            // Check if we validated recently (within last 5 seconds)
            const lastCheck = this.lastValidationCheck.get(cacheKey);
            if (lastCheck) {
                const timeSinceLastCheck = Date.now() - lastCheck.timestamp.getTime();
                if (timeSinceLastCheck < 5000) { // 5 seconds
                    console.log(`[SchemaCache] isCacheValid() - Using recent validation result (${timeSinceLastCheck}ms ago): ${lastCheck.wasValid}`);
                    return lastCheck.wasValid;
                }
            }

            console.log(`[SchemaCache] isCacheValid() - Validating cache for ${cacheKey}`);
            const currentHash = await this.computeDatabaseHash(cacheKey, pool);
            
            const isValid = (
                cachedSchema.hash.objectsChecksum === currentHash.objectsChecksum &&
                cachedSchema.hash.maxModifyDate === currentHash.maxModifyDate &&
                cachedSchema.hash.objectCounts.tables === currentHash.objectCounts.tables &&
                cachedSchema.hash.objectCounts.views === currentHash.objectCounts.views &&
                cachedSchema.hash.objectCounts.procedures === currentHash.objectCounts.procedures &&
                cachedSchema.hash.objectCounts.functions === currentHash.objectCounts.functions
            );
            
            console.log(`[SchemaCache] isCacheValid() - Result: ${isValid}`, {
                cached: { checksum: cachedSchema.hash.objectsChecksum, date: cachedSchema.hash.maxModifyDate },
                current: { checksum: currentHash.objectsChecksum, date: currentHash.maxModifyDate }
            });
            
            // Store validation result with timestamp
            this.lastValidationCheck.set(cacheKey, {
                timestamp: new Date(),
                wasValid: isValid
            });
            
            return isValid;
        } catch (error) {
            console.error('[SchemaCache] isCacheValid() - Failed to validate cache:', error);
            return false;
        }
    }

    /**
     * Fetch all tables from database
     */
    private async fetchTables(pool: DBPool): Promise<Map<string, TableInfo>> {
        const query = `
            SELECT 
                t.TABLE_SCHEMA as [schema],
                t.TABLE_NAME as name,
                USER_NAME(st.principal_id) AS owner,
                ISNULL(SUM(p.rows), 0) as [rowCount],
                SUM(a.total_pages) * 8 / 1024.0 AS [sizeMB],
                st.modify_date as lastModified
            FROM INFORMATION_SCHEMA.TABLES t
            INNER JOIN sys.tables st ON t.TABLE_NAME = st.name AND t.TABLE_SCHEMA = SCHEMA_NAME(st.schema_id)
            LEFT JOIN sys.indexes i ON st.object_id = i.object_id AND i.index_id <= 1
            LEFT JOIN sys.partitions p ON st.object_id = p.object_id AND i.index_id = p.index_id
            LEFT JOIN sys.allocation_units a ON p.partition_id = a.container_id
            WHERE t.TABLE_TYPE = 'BASE TABLE'
            GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME, st.principal_id, st.modify_date
            ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
        `;

        const result = await pool.request().query(query);
        const tables = new Map<string, TableInfo>();

        for (const row of result.recordset) {
            const key = `${row.schema}.${row.name}`.toLowerCase();
            tables.set(key, {
                schema: row.schema,
                name: row.name,
                owner: row.owner,
                rowCount: row.rowCount,
                sizeMB: row.sizeMB,
                type: 'table',
                lastModified: row.lastModified
            });
        }

        return tables;
    }

    /**
     * Fetch all columns from database
     */
    private async fetchColumns(pool: DBPool): Promise<Map<string, ColumnInfo[]>> {
        const query = `
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
                CASE WHEN cc.is_identity = 1 THEN 1 ELSE 0 END as isIdentity,
                CASE WHEN cc.is_computed = 1 THEN 1 ELSE 0 END as isComputed,
                cc.generated_always_type as generatedAlwaysType
            FROM INFORMATION_SCHEMA.COLUMNS c
            LEFT JOIN (
                SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku 
                    ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME 
                    AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
                WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
            ) pk ON c.TABLE_SCHEMA = pk.TABLE_SCHEMA 
                AND c.TABLE_NAME = pk.TABLE_NAME 
                AND c.COLUMN_NAME = pk.COLUMN_NAME
            LEFT JOIN sys.columns cc ON cc.object_id = OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME))
                AND cc.name = c.COLUMN_NAME
            WHERE c.TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
            ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
        `;

        const result = await pool.request().query(query);
        const columns = new Map<string, ColumnInfo[]>();

        for (const row of result.recordset) {
            const key = `${row.tableSchema}.${row.tableName}`.toLowerCase();
            
            if (!columns.has(key)) {
                columns.set(key, []);
            }

            columns.get(key)!.push({
                tableSchema: row.tableSchema,
                tableName: row.tableName,
                columnName: row.columnName,
                dataType: row.dataType,
                isNullable: row.isNullable === 'YES',
                defaultValue: row.defaultValue,
                maxLength: row.maxLength,
                precision: row.precision,
                scale: row.scale,
                position: row.position,
                isPrimaryKey: row.isPrimaryKey === 1,
                isIdentity: row.isIdentity === 1,
                isComputed: row.isComputed === 1,
                generatedAlwaysType: row.generatedAlwaysType
            });
        }

        return columns;
    }

    /**
     * Fetch all views from database
     */
    private async fetchViews(pool: DBPool): Promise<Map<string, ViewInfo>> {
        const query = `
            SELECT 
                v.TABLE_SCHEMA as [schema],
                v.TABLE_NAME as name,
                o.modify_date as lastModified
            FROM INFORMATION_SCHEMA.VIEWS v
            LEFT JOIN sys.views o ON v.TABLE_NAME = o.name 
                AND v.TABLE_SCHEMA = SCHEMA_NAME(o.schema_id)
            ORDER BY v.TABLE_SCHEMA, v.TABLE_NAME
        `;

        const result = await pool.request().query(query);
        const views = new Map<string, ViewInfo>();

        for (const row of result.recordset) {
            const key = `${row.schema}.${row.name}`.toLowerCase();
            views.set(key, {
                schema: row.schema,
                name: row.name,
                type: 'view',
                lastModified: row.lastModified
            });
        }

        return views;
    }

    /**
     * Fetch all stored procedures from database
     */
    private async fetchProcedures(pool: DBPool): Promise<Map<string, ProcedureInfo>> {
        const query = `
            SELECT 
                ROUTINE_SCHEMA as [schema],
                ROUTINE_NAME as name,
                o.modify_date as lastModified
            FROM INFORMATION_SCHEMA.ROUTINES r
            INNER JOIN sys.procedures o ON r.ROUTINE_NAME = o.name 
                AND r.ROUTINE_SCHEMA = SCHEMA_NAME(o.schema_id)
            WHERE ROUTINE_TYPE = 'PROCEDURE' 
                AND ROUTINE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
            ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
        `;

        const result = await pool.request().query(query);
        const procedures = new Map<string, ProcedureInfo>();

        for (const row of result.recordset) {
            const key = `${row.schema}.${row.name}`.toLowerCase();
            procedures.set(key, {
                schema: row.schema,
                name: row.name,
                type: 'procedure',
                lastModified: row.lastModified
            });
        }

        return procedures;
    }

    /**
     * Fetch all functions from database
     */
    private async fetchFunctions(pool: DBPool): Promise<Map<string, FunctionInfo>> {
        const query = `
            SELECT 
                ROUTINE_SCHEMA as [schema],
                ROUTINE_NAME as name,
                o.type_desc as functionType,
                o.modify_date as lastModified
            FROM INFORMATION_SCHEMA.ROUTINES r
            INNER JOIN sys.objects o ON r.ROUTINE_NAME = o.name 
                AND r.ROUTINE_SCHEMA = SCHEMA_NAME(o.schema_id)
            WHERE ROUTINE_TYPE = 'FUNCTION' 
                AND ROUTINE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
            ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
        `;

        const result = await pool.request().query(query);
        const functions = new Map<string, FunctionInfo>();

        for (const row of result.recordset) {
            const key = `${row.schema}.${row.name}`.toLowerCase();
            functions.set(key, {
                schema: row.schema,
                name: row.name,
                functionType: row.functionType,
                type: 'function',
                lastModified: row.lastModified
            });
        }

        return functions;
    }

    /**
     * Fetch all indexes from database
     */
    private async fetchIndexes(pool: DBPool): Promise<Map<string, IndexInfo[]>> {
        const query = `
            SELECT 
                SCHEMA_NAME(t.schema_id) AS tableSchema,
                t.name AS tableName,
                i.name AS indexName,
                i.type_desc AS indexType,
                i.is_unique as isUnique,
                i.is_primary_key as isPrimaryKey,
                COL_NAME(ic.object_id, ic.column_id) AS columnName,
                ic.key_ordinal
            FROM sys.indexes i
            INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            INNER JOIN sys.tables t ON i.object_id = t.object_id
            WHERE i.type > 0 
                AND SCHEMA_NAME(t.schema_id) NOT IN ('sys', 'INFORMATION_SCHEMA')
            ORDER BY t.schema_id, t.name, i.name, ic.key_ordinal
        `;

        const result = await pool.request().query(query);
        const indexes = new Map<string, IndexInfo[]>();
        const indexMap = new Map<string, IndexInfo>();

        for (const row of result.recordset) {
            const tableKey = `${row.tableSchema}.${row.tableName}`.toLowerCase();
            const indexKey = `${tableKey}.${row.indexName}`.toLowerCase();

            if (!indexMap.has(indexKey)) {
                indexMap.set(indexKey, {
                    tableSchema: row.tableSchema,
                    tableName: row.tableName,
                    indexName: row.indexName,
                    indexType: row.indexType,
                    isUnique: row.isUnique,
                    isPrimaryKey: row.isPrimaryKey,
                    columns: []
                });
            }

            indexMap.get(indexKey)!.columns.push(row.columnName);
        }

        // Group by table
        for (const index of indexMap.values()) {
            const tableKey = `${index.tableSchema}.${index.tableName}`.toLowerCase();
            if (!indexes.has(tableKey)) {
                indexes.set(tableKey, []);
            }
            indexes.get(tableKey)!.push(index);
        }

        return indexes;
    }

    /**
     * Fetch all constraints from database
     */
    private async fetchConstraints(pool: DBPool): Promise<Map<string, ConstraintInfo[]>> {
        const query = `
            SELECT 
                tc.TABLE_SCHEMA as tableSchema,
                tc.TABLE_NAME as tableName,
                tc.CONSTRAINT_NAME as constraintName,
                tc.CONSTRAINT_TYPE as constraintType,
                kcu.COLUMN_NAME as columnName,
                ccu.TABLE_SCHEMA AS referencedTableSchema,
                ccu.TABLE_NAME AS referencedTableName,
                ccu.COLUMN_NAME AS referencedColumnName,
                cc.CHECK_CLAUSE as checkClause
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
                ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME 
                AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
            LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc 
                ON tc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
            LEFT JOIN INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu 
                ON rc.UNIQUE_CONSTRAINT_NAME = ccu.CONSTRAINT_NAME
            LEFT JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc 
                ON tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
            WHERE tc.TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
            ORDER BY tc.TABLE_SCHEMA, tc.TABLE_NAME, tc.CONSTRAINT_NAME
        `;

        const result = await pool.request().query(query);
        const constraints = new Map<string, ConstraintInfo[]>();
        const constraintMap = new Map<string, ConstraintInfo>();

        for (const row of result.recordset) {
            const tableKey = `${row.tableSchema}.${row.tableName}`.toLowerCase();
            const constraintKey = `${tableKey}.${row.constraintName}`.toLowerCase();

            if (!constraintMap.has(constraintKey)) {
                constraintMap.set(constraintKey, {
                    tableSchema: row.tableSchema,
                    tableName: row.tableName,
                    constraintName: row.constraintName,
                    constraintType: row.constraintType,
                    columns: [],
                    referencedTableSchema: row.referencedTableSchema,
                    referencedTableName: row.referencedTableName,
                    referencedColumns: [],
                    checkClause: row.checkClause
                });
            }

            const constraint = constraintMap.get(constraintKey)!;
            if (row.columnName && !constraint.columns!.includes(row.columnName)) {
                constraint.columns!.push(row.columnName);
            }
            if (row.referencedColumnName && !constraint.referencedColumns!.includes(row.referencedColumnName)) {
                constraint.referencedColumns!.push(row.referencedColumnName);
            }
        }

        // Group by table
        for (const constraint of constraintMap.values()) {
            const tableKey = `${constraint.tableSchema}.${constraint.tableName}`.toLowerCase();
            if (!constraints.has(tableKey)) {
                constraints.set(tableKey, []);
            }
            constraints.get(tableKey)!.push(constraint);
        }

        return constraints;
    }

    /**
     * Fetch all triggers from database
     */
    private async fetchTriggers(pool: DBPool): Promise<Map<string, TriggerInfo>> {
        const query = `
            SELECT 
                SCHEMA_NAME(tab.schema_id) as [schema],
                tab.name as tableName,
                trig.name as name,
                trig.is_disabled as isDisabled,
                trig.is_instead_of_trigger as isInsteadOf
            FROM sys.triggers trig
            LEFT JOIN sys.tables tab ON trig.parent_id = tab.object_id
            WHERE trig.parent_class IN (0, 1)
                AND (tab.schema_id IS NULL OR SCHEMA_NAME(tab.schema_id) NOT IN ('sys', 'INFORMATION_SCHEMA'))
            ORDER BY tab.schema_id, tab.name, trig.name
        `;

        const result = await pool.request().query(query);
        const triggers = new Map<string, TriggerInfo>();

        for (const row of result.recordset) {
            const key = row.tableName 
                ? `${row.schema}.${row.tableName}.${row.name}`.toLowerCase()
                : `${row.schema}.${row.name}`.toLowerCase();
            
            triggers.set(key, {
                schema: row.schema,
                tableName: row.tableName,
                name: row.name,
                isDisabled: row.isDisabled,
                isInsteadOf: row.isInsteadOf,
                type: 'trigger'
            });
        }

        return triggers;
    }

    /**
     * Fetch complete schema from database
     */
    private async fetchCompleteSchema(cacheKey: string, pool: DBPool): Promise<CachedSchema> {
        console.log(`[SchemaCache] fetchCompleteSchema() - Starting for ${cacheKey}`);
        const startTime = Date.now();

        const [hash, tables, columns, views, procedures, functions, indexes, constraints, triggers] = await Promise.all([
            this.computeDatabaseHash(cacheKey, pool),
            this.fetchTables(pool),
            this.fetchColumns(pool),
            this.fetchViews(pool),
            this.fetchProcedures(pool),
            this.fetchFunctions(pool),
            this.fetchIndexes(pool),
            this.fetchConstraints(pool),
            this.fetchTriggers(pool)
        ]);

        const elapsed = Date.now() - startTime;
        console.log(`[SchemaCache] fetchCompleteSchema() - Completed in ${elapsed}ms: ${tables.size} tables, ${views.size} views, ${procedures.size} procedures, ${functions.size} functions`);

        return {
            hash,
            tables,
            columns,
            views,
            procedures,
            functions,
            indexes,
            constraints,
            triggers,
            lastUpdated: new Date()
        };
    }

    /**
     * Get or create schema cache for a connection
     */
    public async getSchema(connection: ConnectionInfo, pool: DBPool): Promise<CachedSchema> {
        const cacheKey = this.getCacheKey(connection);
        console.log(`[SchemaCache] getSchema() called for ${cacheKey}`);

        // Check if already loading
        if (this.loadingPromises.has(cacheKey)) {
            console.log(`[SchemaCache] getSchema() - Already loading, waiting...`);
            await this.loadingPromises.get(cacheKey);
        }

        // Check memory cache first - if exists and was recently validated, return immediately
        let schema = this.caches.get(cacheKey);
        if (schema) {
            const lastCheck = this.lastValidationCheck.get(cacheKey);
            if (lastCheck && lastCheck.wasValid) {
                const timeSinceValidation = Date.now() - lastCheck.timestamp.getTime();
                // If validated within last 60 seconds, trust it and return immediately
                if (timeSinceValidation < 60000) {
                    console.log(`[SchemaCache] getSchema() - Using recently validated cache (${timeSinceValidation}ms ago)`);
                    return schema;
                }
            }
        }

        if (!schema) {
            console.log(`[SchemaCache] getSchema() - Not in memory cache, checking disk...`);
            // Try loading from disk
            schema = await this.loadFromDisk(cacheKey);
            if (schema) {
                console.log(`[SchemaCache] getSchema() - Loaded from disk`);
            } else {
                console.log(`[SchemaCache] getSchema() - Not on disk`);
            }
        } else {
            console.log(`[SchemaCache] getSchema() - Found in memory cache, validating...`);
        }

        // Validate cache or fetch new
        if (!schema || !(await this.isCacheValid(cacheKey, pool, schema))) {
            console.log(`[SchemaCache] getSchema() - Cache invalid or missing, fetching from database...`);
            const loadPromise = this.fetchCompleteSchema(cacheKey, pool).then(async (newSchema) => {
                this.caches.set(cacheKey, newSchema);
                await this.saveToDisk(cacheKey, newSchema);
                console.log(`[SchemaCache] getSchema() - Schema fetched and cached`);
                return newSchema;
            });

            this.loadingPromises.set(cacheKey, loadPromise.then(() => {}));
            schema = await loadPromise;
            this.loadingPromises.delete(cacheKey);
        } else if (!this.caches.has(cacheKey)) {
            console.log(`[SchemaCache] getSchema() - Cache valid, loading into memory`);
            // Cache is valid, just not in memory
            this.caches.set(cacheKey, schema);
        } else {
            console.log(`[SchemaCache] getSchema() - Using valid cached schema`);
        }

        return schema!; // Guaranteed non-null after validation/fetch
    }

    /**
     * Get all tables
     */
    public async getTables(connection: ConnectionInfo, pool: DBPool): Promise<TableInfo[]> {
        const cacheKey = this.getCacheKey(connection);
        console.log(`[SchemaCache] getTables() called for ${cacheKey}`);
        const schema = await this.getSchema(connection, pool);
        const tables = Array.from(schema.tables.values());
        console.log(`[SchemaCache] getTables() - Returning ${tables.length} tables`);
        return tables;
    }

    /**
     * Get a specific table
     */
    public async getTable(connection: ConnectionInfo, pool: DBPool, schemaName: string, tableName: string): Promise<TableInfo | undefined> {
        const schema = await this.getSchema(connection, pool);
        const key = `${schemaName}.${tableName}`.toLowerCase();
        return schema.tables.get(key);
    }

    /**
     * Get columns for a table
     */
    public async getTableColumns(connection: ConnectionInfo, pool: DBPool, schemaName: string, tableName: string): Promise<ColumnInfo[]> {
        const schema = await this.getSchema(connection, pool);
        const key = `${schemaName}.${tableName}`.toLowerCase();
        return schema.columns.get(key) || [];
    }

    /**
     * Get all views
     */
    public async getViews(connection: ConnectionInfo, pool: DBPool): Promise<ViewInfo[]> {
        const cacheKey = this.getCacheKey(connection);
        console.log(`[SchemaCache] getViews() called for ${cacheKey}`);
        const schema = await this.getSchema(connection, pool);
        const views = Array.from(schema.views.values());
        console.log(`[SchemaCache] getViews() - Returning ${views.length} views`);
        return views;
    }

    /**
     * Get all stored procedures
     */
    public async getProcedures(connection: ConnectionInfo, pool: DBPool): Promise<ProcedureInfo[]> {
        const cacheKey = this.getCacheKey(connection);
        console.log(`[SchemaCache] getProcedures() called for ${cacheKey}`);
        const schema = await this.getSchema(connection, pool);
        const procedures = Array.from(schema.procedures.values());
        console.log(`[SchemaCache] getProcedures() - Returning ${procedures.length} procedures`);
        return procedures;
    }

    /**
     * Get all functions
     */
    public async getFunctions(connection: ConnectionInfo, pool: DBPool): Promise<FunctionInfo[]> {
        const cacheKey = this.getCacheKey(connection);
        console.log(`[SchemaCache] getFunctions() called for ${cacheKey}`);
        const schema = await this.getSchema(connection, pool);
        const functions = Array.from(schema.functions.values());
        console.log(`[SchemaCache] getFunctions() - Returning ${functions.length} functions`);
        return functions;
    }

    /**
     * Get indexes for a table
     */
    public async getTableIndexes(connection: ConnectionInfo, pool: DBPool, schemaName: string, tableName: string): Promise<IndexInfo[]> {
        const schema = await this.getSchema(connection, pool);
        const key = `${schemaName}.${tableName}`.toLowerCase();
        return schema.indexes.get(key) || [];
    }

    /**
     * Get constraints for a table
     */
    public async getTableConstraints(connection: ConnectionInfo, pool: DBPool, schemaName: string, tableName: string): Promise<ConstraintInfo[]> {
        const schema = await this.getSchema(connection, pool);
        const key = `${schemaName}.${tableName}`.toLowerCase();
        return schema.constraints.get(key) || [];
    }

    /**
     * Get all foreign key relationships across all tables
     */
    public async getAllForeignKeys(connection: ConnectionInfo, pool: DBPool): Promise<ConstraintInfo[]> {
        const schema = await this.getSchema(connection, pool);
        const allForeignKeys: ConstraintInfo[] = [];
        
        for (const constraints of schema.constraints.values()) {
            for (const constraint of constraints) {
                if (constraint.constraintType === 'FOREIGN KEY') {
                    allForeignKeys.push(constraint);
                }
            }
        }
        
        return allForeignKeys;
    }

    /**
     * Get all triggers
     */
    public async getTriggers(connection: ConnectionInfo, pool: DBPool): Promise<TriggerInfo[]> {
        const schema = await this.getSchema(connection, pool);
        return Array.from(schema.triggers.values());
    }

    /**
     * Invalidate a specific object and refresh it
     */
    public async invalidateObject(
        connection: ConnectionInfo,
        pool: DBPool,
        type: SchemaObjectType,
        schemaName: string,
        objectName: string
    ): Promise<void> {
        const cacheKey = this.getCacheKey(connection);
        const schema = this.caches.get(cacheKey);

        if (!schema) {
            return; // No cache to invalidate
        }

        const key = `${schemaName}.${objectName}`.toLowerCase();

        switch (type) {
            case SchemaObjectType.Table:
                // Remove table and all related data
                schema.tables.delete(key);
                schema.columns.delete(key);
                schema.indexes.delete(key);
                schema.constraints.delete(key);
                
                // Refresh table data
                await this.refreshTable(connection, pool, schemaName, objectName);
                break;

            case SchemaObjectType.View:
                schema.views.delete(key);
                await this.refreshView(connection, pool, schemaName, objectName);
                break;

            case SchemaObjectType.Procedure:
                schema.procedures.delete(key);
                await this.refreshProcedure(connection, pool, schemaName, objectName);
                break;

            case SchemaObjectType.Function:
                schema.functions.delete(key);
                await this.refreshFunction(connection, pool, schemaName, objectName);
                break;

            case SchemaObjectType.Trigger:
                schema.triggers.delete(key);
                // Triggers are complex to refresh individually, might need full refresh
                break;
        }

        // Update hash after change
        schema.hash = await this.computeDatabaseHash(cacheKey, pool);
        schema.lastUpdated = new Date();
        
        // Save to disk
        await this.saveToDisk(cacheKey, schema);
    }

    /**
     * Refresh a specific table
     */
    public async refreshTable(connection: ConnectionInfo, pool: DBPool, schemaName: string, tableName: string): Promise<void> {
        const cacheKey = this.getCacheKey(connection);
        const schema = this.caches.get(cacheKey);

        if (!schema) {
            return;
        }

        const key = `${schemaName}.${tableName}`.toLowerCase();

        // Fetch table data
        const tableQuery = `
            SELECT 
                t.TABLE_SCHEMA as [schema],
                t.TABLE_NAME as name,
                USER_NAME(st.principal_id) AS owner,
                ISNULL(SUM(p.rows), 0) as [rowCount],
                SUM(a.total_pages) * 8 / 1024.0 AS [sizeMB],
                st.modify_date as lastModified
            FROM INFORMATION_SCHEMA.TABLES t
            INNER JOIN sys.tables st ON t.TABLE_NAME = st.name AND t.TABLE_SCHEMA = SCHEMA_NAME(st.schema_id)
            LEFT JOIN sys.indexes i ON st.object_id = i.object_id AND i.index_id <= 1
            LEFT JOIN sys.partitions p ON st.object_id = p.object_id AND i.index_id = p.index_id
            LEFT JOIN sys.allocation_units a ON p.partition_id = a.container_id
            WHERE t.TABLE_TYPE = 'BASE TABLE'
                AND t.TABLE_SCHEMA = @schemaName
                AND t.TABLE_NAME = @tableName
            GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME, st.principal_id, st.modify_date
        `;

        const tableResult = await (pool.request() as any)
            .input('schemaName', sql.NVarChar, schemaName)
            .input('tableName', sql.NVarChar, tableName)
            .query(tableQuery);

        if (tableResult.recordset.length > 0) {
            const row = tableResult.recordset[0];
            schema.tables.set(key, {
                schema: row.schema,
                name: row.name,
                owner: row.owner,
                rowCount: row.rowCount,
                sizeMB: row.sizeMB,
                type: 'table',
                lastModified: row.lastModified
            });

            // Refresh columns, indexes, and constraints
            const [columns, indexes, constraints] = await Promise.all([
                this.fetchColumnsForTable(pool, schemaName, tableName),
                this.fetchIndexesForTable(pool, schemaName, tableName),
                this.fetchConstraintsForTable(pool, schemaName, tableName)
            ]);

            schema.columns.set(key, columns);
            schema.indexes.set(key, indexes);
            schema.constraints.set(key, constraints);
        }

        await this.saveToDisk(cacheKey, schema);
    }

    /**
     * Fetch columns for a specific table
     */
    private async fetchColumnsForTable(pool: DBPool, schemaName: string, tableName: string): Promise<ColumnInfo[]> {
        const query = `
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
                CASE WHEN cc.is_identity = 1 THEN 1 ELSE 0 END as isIdentity,
                CASE WHEN cc.is_computed = 1 THEN 1 ELSE 0 END as isComputed,
                cc.generated_always_type as generatedAlwaysType
            FROM INFORMATION_SCHEMA.COLUMNS c
            LEFT JOIN (
                SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku 
                    ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME 
                    AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
                WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
            ) pk ON c.TABLE_SCHEMA = pk.TABLE_SCHEMA 
                AND c.TABLE_NAME = pk.TABLE_NAME 
                AND c.COLUMN_NAME = pk.COLUMN_NAME
            LEFT JOIN sys.columns cc ON cc.object_id = OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME))
                AND cc.name = c.COLUMN_NAME
            WHERE c.TABLE_SCHEMA = @schemaName AND c.TABLE_NAME = @tableName
            ORDER BY c.ORDINAL_POSITION
        `;

        const result = await (pool.request() as any).input('schemaName', sql.NVarChar, schemaName)
            .input('tableName', sql.NVarChar, tableName)
            .query(query);

        return result.recordset.map((row: any) => ({
            tableSchema: row.tableSchema,
            tableName: row.tableName,
            columnName: row.columnName,
            dataType: row.dataType,
            isNullable: row.isNullable === 'YES',
            defaultValue: row.defaultValue,
            maxLength: row.maxLength,
            precision: row.precision,
            scale: row.scale,
            position: row.position,
            isPrimaryKey: row.isPrimaryKey === 1,
            isIdentity: row.isIdentity === 1,
            isComputed: row.isComputed === 1,
            generatedAlwaysType: row.generatedAlwaysType
        }));
    }

    /**
     * Fetch indexes for a specific table
     */
    private async fetchIndexesForTable(pool: DBPool, schemaName: string, tableName: string): Promise<IndexInfo[]> {
        const query = `
            SELECT 
                SCHEMA_NAME(t.schema_id) AS tableSchema,
                t.name AS tableName,
                i.name AS indexName,
                i.type_desc AS indexType,
                i.is_unique as isUnique,
                i.is_primary_key as isPrimaryKey,
                COL_NAME(ic.object_id, ic.column_id) AS columnName,
                ic.key_ordinal
            FROM sys.indexes i
            INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            INNER JOIN sys.tables t ON i.object_id = t.object_id
            WHERE i.type > 0 
                AND SCHEMA_NAME(t.schema_id) = @schemaName
                AND t.name = @tableName
            ORDER BY i.name, ic.key_ordinal
        `;

        const result = await (pool.request() as any).input('schemaName', sql.NVarChar, schemaName)
            .input('tableName', sql.NVarChar, tableName)
            .query(query);

        const indexMap = new Map<string, IndexInfo>();

        for (const row of result.recordset) {
            const indexKey = row.indexName.toLowerCase();

            if (!indexMap.has(indexKey)) {
                indexMap.set(indexKey, {
                    tableSchema: row.tableSchema,
                    tableName: row.tableName,
                    indexName: row.indexName,
                    indexType: row.indexType,
                    isUnique: row.isUnique,
                    isPrimaryKey: row.isPrimaryKey,
                    columns: []
                });
            }

            indexMap.get(indexKey)!.columns.push(row.columnName);
        }

        return Array.from(indexMap.values());
    }

    /**
     * Fetch constraints for a specific table
     */
    private async fetchConstraintsForTable(pool: DBPool, schemaName: string, tableName: string): Promise<ConstraintInfo[]> {
        const query = `
            SELECT 
                tc.TABLE_SCHEMA as tableSchema,
                tc.TABLE_NAME as tableName,
                tc.CONSTRAINT_NAME as constraintName,
                tc.CONSTRAINT_TYPE as constraintType,
                kcu.COLUMN_NAME as columnName,
                ccu.TABLE_SCHEMA AS referencedTableSchema,
                ccu.TABLE_NAME AS referencedTableName,
                ccu.COLUMN_NAME AS referencedColumnName,
                cc.CHECK_CLAUSE as checkClause
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
                ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME 
                AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
            LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc 
                ON tc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
            LEFT JOIN INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu 
                ON rc.UNIQUE_CONSTRAINT_NAME = ccu.CONSTRAINT_NAME
            LEFT JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc 
                ON tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
            WHERE tc.TABLE_SCHEMA = @schemaName AND tc.TABLE_NAME = @tableName
            ORDER BY tc.CONSTRAINT_NAME
        `;

        const result = await (pool.request() as any).input('schemaName', sql.NVarChar, schemaName)
            .input('tableName', sql.NVarChar, tableName)
            .query(query);

        const constraintMap = new Map<string, ConstraintInfo>();

        for (const row of result.recordset) {
            const constraintKey = row.constraintName.toLowerCase();

            if (!constraintMap.has(constraintKey)) {
                constraintMap.set(constraintKey, {
                    tableSchema: row.tableSchema,
                    tableName: row.tableName,
                    constraintName: row.constraintName,
                    constraintType: row.constraintType,
                    columns: [],
                    referencedTableSchema: row.referencedTableSchema,
                    referencedTableName: row.referencedTableName,
                    referencedColumns: [],
                    checkClause: row.checkClause
                });
            }

            const constraint = constraintMap.get(constraintKey)!;
            if (row.columnName && !constraint.columns!.includes(row.columnName)) {
                constraint.columns!.push(row.columnName);
            }
            if (row.referencedColumnName && !constraint.referencedColumns!.includes(row.referencedColumnName)) {
                constraint.referencedColumns!.push(row.referencedColumnName);
            }
        }

        return Array.from(constraintMap.values());
    }

    /**
     * Refresh a specific view
     */
    private async refreshView(connection: ConnectionInfo, pool: DBPool, schemaName: string, viewName: string): Promise<void> {
        const cacheKey = this.getCacheKey(connection);
        const schema = this.caches.get(cacheKey);

        if (!schema) {
            return;
        }

        const key = `${schemaName}.${viewName}`.toLowerCase();

        const query = `
            SELECT 
                v.TABLE_SCHEMA as [schema],
                v.TABLE_NAME as name,
                o.modify_date as lastModified
            FROM INFORMATION_SCHEMA.VIEWS v
            INNER JOIN sys.views o ON v.TABLE_NAME = o.name 
                AND v.TABLE_SCHEMA = SCHEMA_NAME(o.schema_id)
            WHERE v.TABLE_SCHEMA = @schemaName AND v.TABLE_NAME = @viewName
        `;

        const result = await (pool.request() as any).input('schemaName', sql.NVarChar, schemaName)
            .input('viewName', sql.NVarChar, viewName)
            .query(query);

        if (result.recordset.length > 0) {
            const row = result.recordset[0];
            schema.views.set(key, {
                schema: row.schema,
                name: row.name,
                type: 'view',
                lastModified: row.lastModified
            });
        } else {
            schema.views.delete(key);
        }

        await this.saveToDisk(cacheKey, schema);
    }

    /**
     * Refresh a specific procedure
     */
    private async refreshProcedure(connection: ConnectionInfo, pool: DBPool, schemaName: string, procedureName: string): Promise<void> {
        const cacheKey = this.getCacheKey(connection);
        const schema = this.caches.get(cacheKey);

        if (!schema) {
            return;
        }

        const key = `${schemaName}.${procedureName}`.toLowerCase();

        const query = `
            SELECT 
                ROUTINE_SCHEMA as [schema],
                ROUTINE_NAME as name,
                o.modify_date as lastModified
            FROM INFORMATION_SCHEMA.ROUTINES r
            INNER JOIN sys.procedures o ON r.ROUTINE_NAME = o.name 
                AND r.ROUTINE_SCHEMA = SCHEMA_NAME(o.schema_id)
            WHERE ROUTINE_TYPE = 'PROCEDURE' 
                AND ROUTINE_SCHEMA = @schemaName
                AND ROUTINE_NAME = @procedureName
        `;

        const result = await (pool.request() as any).input('schemaName', sql.NVarChar, schemaName)
            .input('procedureName', sql.NVarChar, procedureName)
            .query(query);

        if (result.recordset.length > 0) {
            const row = result.recordset[0];
            schema.procedures.set(key, {
                schema: row.schema,
                name: row.name,
                type: 'procedure',
                lastModified: row.lastModified
            });
        } else {
            schema.procedures.delete(key);
        }

        await this.saveToDisk(cacheKey, schema);
    }

    /**
     * Refresh a specific function
     */
    private async refreshFunction(connection: ConnectionInfo, pool: DBPool, schemaName: string, functionName: string): Promise<void> {
        const cacheKey = this.getCacheKey(connection);
        const schema = this.caches.get(cacheKey);

        if (!schema) {
            return;
        }

        const key = `${schemaName}.${functionName}`.toLowerCase();

        const query = `
            SELECT 
                ROUTINE_SCHEMA as [schema],
                ROUTINE_NAME as name,
                o.type_desc as functionType,
                o.modify_date as lastModified
            FROM INFORMATION_SCHEMA.ROUTINES r
            INNER JOIN sys.objects o ON r.ROUTINE_NAME = o.name 
                AND r.ROUTINE_SCHEMA = SCHEMA_NAME(o.schema_id)
            WHERE ROUTINE_TYPE = 'FUNCTION' 
                AND ROUTINE_SCHEMA = @schemaName
                AND ROUTINE_NAME = @functionName
        `;

        const result = await (pool.request() as any).input('schemaName', sql.NVarChar, schemaName)
            .input('functionName', sql.NVarChar, functionName)
            .query(query);

        if (result.recordset.length > 0) {
            const row = result.recordset[0];
            schema.functions.set(key, {
                schema: row.schema,
                name: row.name,
                functionType: row.functionType,
                type: 'function',
                lastModified: row.lastModified
            });
        } else {
            schema.functions.delete(key);
        }

        await this.saveToDisk(cacheKey, schema);
    }

    /**
     * Refresh entire database schema
     */
    public async refreshAll(connection: ConnectionInfo, pool: DBPool): Promise<void> {
        const cacheKey = this.getCacheKey(connection);
        
        const newSchema = await this.fetchCompleteSchema(cacheKey, pool);
        this.caches.set(cacheKey, newSchema);
        await this.saveToDisk(cacheKey, newSchema);
    }

    /**
     * Clear all caches
     */
    public clearAll(): void {
        this.caches.clear();
    }

    /**
     * Clear cache for specific connection
     */
    public clear(connection: ConnectionInfo): void {
        const cacheKey = this.getCacheKey(connection);
        this.caches.delete(cacheKey);
    }
}



