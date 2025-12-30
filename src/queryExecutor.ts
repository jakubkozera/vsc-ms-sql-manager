import * as vscode from 'vscode';
import { ConnectionProvider } from './connectionProvider';
import { DBPool } from './dbClient';
import { QueryHistoryManager } from './queryHistory';
import { SchemaCache, SchemaObjectType } from './utils/schemaCache';

export interface ForeignKeyReference {
    schema: string;
    table: string;
    column: string;
    isComposite: boolean;
    compositeColumns: string[];
    constraintName: string;
}

export interface ColumnMetadata {
    name: string;
    type: string;
    isNullable: boolean;
    sourceTable?: string;
    sourceSchema?: string;
    sourceColumn?: string;
    isPrimaryKey: boolean;
    isIdentity: boolean;
    foreignKeyReferences?: ForeignKeyReference[];
}

export interface ResultSetMetadata {
    columns: ColumnMetadata[];
    isEditable: boolean;
    primaryKeyColumns: string[];
    sourceTable?: string;
    sourceSchema?: string;
    hasMultipleTables: boolean;
}

export interface QueryResult {
    recordsets: any[][]; // Changed from single recordset to array of recordsets
    rowsAffected: number[];
    executionTime: number;
    query: string;
    metadata?: ResultSetMetadata[]; // Metadata for each result set
    columnNames?: string[][]; // Column names for each result set
}

export class QueryExecutor {
    private currentRequest: any = null;
    
    constructor(
        private connectionProvider: ConnectionProvider,
        private outputChannel: vscode.OutputChannel,
        private historyManager: QueryHistoryManager,
        private context?: vscode.ExtensionContext
    ) {}

    public cancel() {
        if (this.currentRequest) {
            this.outputChannel.appendLine('[QueryExecutor] Cancelling current request...');
            try {
                this.currentRequest.cancel();
                this.outputChannel.appendLine('[QueryExecutor] Request cancelled.');
            } catch (error) {
                this.outputChannel.appendLine(`[QueryExecutor] Error cancelling request: ${error}`);
            }
        } else {
            this.outputChannel.appendLine('[QueryExecutor] No active request to cancel.');
        }
    }

    // Accept an optional `connectionPool` to execute the query against. When not
    // provided, fall back to the provider's active connection.
    // originalQuery is used for metadata extraction when queryText includes SET statements
    // skipHistory - when true, query will not be added to query history (e.g., for relation expansions)
    async executeQuery(queryText: string, connectionPool?: DBPool, originalQuery?: string, skipHistory?: boolean, token?: vscode.CancellationToken): Promise<QueryResult> {
        // If a specific pool was provided, use it. Otherwise use the provider's active connection.
        const connection = connectionPool || this.connectionProvider.getConnection();
        if (!connection) {
            throw new Error('No active database connection. Please connect to a database first.');
        }

        const startTime = Date.now();
        this.outputChannel.appendLine(`Executing query: ${queryText.substring(0, 100)}${queryText.length > 100 ? '...' : ''}`);

        try {
            // Split query by GO statements (SQL Server batch separator)
            const batches = this.splitByGO(queryText);
            this.outputChannel.appendLine(`[QueryExecutor] Split query into ${batches.length} batch(es)`);

            const allRecordsets: any[][] = [];
            const allRowsAffected: number[] = [];
            const allColumnNames: string[][] = [];

            // Execute each batch separately
            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                
                if (token && token.isCancellationRequested) {
                    throw new Error('Query cancelled');
                }

                this.outputChannel.appendLine(`[QueryExecutor] Executing batch ${i + 1}/${batches.length}: ${batch.substring(0, 100)}${batch.length > 100 ? '...' : ''}`);

                    const request = connection.request();
                    this.currentRequest = request;
                    
                    if (token) {
                        token.onCancellationRequested(() => {
                            this.outputChannel.appendLine('[QueryExecutor] Cancellation requested via token');
                            if (this.currentRequest) {
                                try {
                                    this.currentRequest.cancel();
                                } catch (e) {
                                    // Ignore cancel errors
                                }
                            }
                        });
                    }

                    // Enable array row mode to handle duplicate column names
                    if (request.setArrayRowMode) {
                        request.setArrayRowMode(true);
                    }

                    const result = await request.query(batch);

                    // Support both mssql.Result and our msnodesqlv8 normalized object
                    const rawRecordsets: any[][] = (result.recordsets || (result.recordsets === undefined && result.recordset ? [result.recordset] : result.recordsets)) as any[][] || (result.recordsets ? result.recordsets : (result.recordset ? [result.recordset] : []));
                    const batchRowsAffected: number[] = result.rowsAffected || result.rowsAffected || (Array.isArray(result.rowsAffected) ? result.rowsAffected : (result.rowsAffected ? [result.rowsAffected] : []));

                    // Extract column names and normalize recordsets to array of arrays
                    for (const rs of rawRecordsets) {
                        let columns: string[] = [];
                        let rows: any[] = [];

                        // Try to get columns from metadata
                        if ((rs as any).columns) {
                            if (Array.isArray((rs as any).columns)) {
                                columns = (rs as any).columns.map((c: any) => c.name);
                            } else {
                                // Object map (mssql object mode)
                                // Note: keys might be unique-ified by mssql if duplicates exist in object mode
                                columns = Object.keys((rs as any).columns);
                            }
                        }

                        if (rs.length > 0) {
                            // Check if rows are arrays (arrayRowMode) or objects
                            if (Array.isArray(rs[0])) {
                                // Array row mode
                                rows = rs;
                                // If columns weren't found in metadata (unlikely for mssql), we can't infer them easily from array
                            } else {
                                // Object mode (fallback)
                                if (columns.length === 0) {
                                    columns = Object.keys(rs[0]);
                                }
                                rows = rs.map((r: any) => {
                                    // Map object values to array based on columns order if possible, or just values
                                    // If we have columns from metadata, use them to map
                                    if (columns.length > 0) {
                                        return columns.map(col => r[col]);
                                    }
                                    return Object.values(r);
                                });
                            }
                        }
                        
                        allColumnNames.push(columns);
                        allRecordsets.push(rows);
                    }

                    // Accumulate rows affected
                    allRowsAffected.push(...batchRowsAffected);

                    this.outputChannel.appendLine(`[QueryExecutor] Batch ${i + 1} completed. Result sets: ${rawRecordsets.length}, Rows affected: ${batchRowsAffected.join(', ') || '0'}`);
                }

                this.currentRequest = null;
                const executionTime = Date.now() - startTime;
                this.outputChannel.appendLine(`Total execution time: ${executionTime}ms`);

                const queryResult: QueryResult = {
                    recordsets: allRecordsets,
                    rowsAffected: allRowsAffected,
                    executionTime,
                    query: queryText,
                    columnNames: allColumnNames
                };

                // Detect and invalidate cache for DDL operations
                if (this.context) {
                    await this.detectAndInvalidateCache(queryText, connection);
                }

                // Extract metadata for SELECT queries to enable editing
                // Use originalQuery if provided (when queryText has SET statements)
                const queryForMetadata = originalQuery || queryText;
                
                if (allRecordsets.length > 0 && this.isSelectQuery(queryForMetadata)) {
                    try {
                        queryResult.metadata = await this.extractResultMetadata(queryForMetadata, allRecordsets, connection, allColumnNames, token);
                    } catch (error) {
                        if (token && token.isCancellationRequested) {
                            throw new Error('Query cancelled');
                        }
                        this.outputChannel.appendLine(`[QueryExecutor] Failed to extract metadata: ${error}`);
                        // Continue without metadata - result set will be read-only
                    }
                }

                if (token && token.isCancellationRequested) {
                    throw new Error('Query cancelled');
                }

                // Log results summary
                if (allRecordsets.length > 0) {
                    const totalRows = allRecordsets.reduce((sum, rs) => sum + rs.length, 0);
                    this.outputChannel.appendLine(`Query returned ${allRecordsets.length} result set(s) with ${totalRows} total row(s)`);
                } else if (allRowsAffected.length > 0) {
                    this.outputChannel.appendLine(`Query affected ${allRowsAffected.reduce((a, b) => a + b, 0)} row(s)`);
                } else {
                    this.outputChannel.appendLine(`Query completed successfully`);
                }

                // Add to query history (unless skipHistory is true)
                if (this.historyManager && !skipHistory) {
                    const activeConnectionInfo = this.connectionProvider.getActiveConnectionInfo();
                    console.log('[QueryExecutor] Adding query to history, activeConnection:', activeConnectionInfo?.name);
                    if (activeConnectionInfo) {
                        // Calculate row counts for each result set
                        const rowCounts = allRecordsets.map(recordset => recordset.length);
                        
                        // Strip SET commands and execution summary comments from query for history
                        const cleanedQuery = this.cleanQueryForHistory(queryText);
                        
                        // Get current database from the connection that was used
                        let currentDatabase: string | undefined = activeConnectionInfo.database;
                        
                        // For server connections, get the actual current database from the connection provider
                        if (!currentDatabase) {
                            currentDatabase = this.connectionProvider.getCurrentDatabase(activeConnectionInfo.id);
                            console.log('[QueryExecutor] Got current database from connection provider:', currentDatabase);
                        }
                        
                        console.log('[QueryExecutor] Saving to history - database:', currentDatabase);
                        
                        const finalDatabase = currentDatabase || '';
                        
                        this.historyManager.addEntry({
                            query: cleanedQuery,
                            connectionId: activeConnectionInfo.id,
                            connectionName: activeConnectionInfo.name,
                            database: finalDatabase,
                            server: activeConnectionInfo.server,
                            resultSetCount: allRecordsets.length,
                            rowCounts: rowCounts,
                            duration: executionTime
                        });
                        console.log('[QueryExecutor] Query added to history successfully');
                    } else {
                        console.log('[QueryExecutor] No active connection info, skipping history');
                    }
                } else if (skipHistory) {
                    console.log('[QueryExecutor] Skipping history (skipHistory=true)');
                } else {
                    console.log('[QueryExecutor] History manager not available');
                }

                return queryResult;

        } catch (error) {
            this.currentRequest = null;
            const executionTime = Date.now() - startTime;
            this.outputChannel.appendLine(`Query failed after ${executionTime}ms: ${error}`);
            
            if (error instanceof Error) {
                // Handle common SQL errors with user-friendly messages
                if (error.message.includes('timeout')) {
                    throw new Error('Query timeout exceeded. Consider optimizing the query or increasing the timeout setting.');
                } else if (error.message.includes('Invalid object name')) {
                    throw new Error('Table or view not found. Please check the object name and schema.');
                } else if (error.message.includes('permission')) {
                    throw new Error('Insufficient permissions to execute this query.');
                } else if (error.message.includes('syntax')) {
                    throw new Error(`SQL syntax error: ${error.message}`);
                } else {
                    throw new Error(`SQL execution error: ${error.message}`);
                }
            }
            
            throw error;
        }
    }

    cancelCurrentQuery(): void {
        if (this.currentRequest) {
            try {
                this.currentRequest.cancel();
                this.outputChannel.appendLine('Query cancellation requested');
            } catch (error) {
                this.outputChannel.appendLine(`Failed to cancel query: ${error}`);
            }
        }
    }

    /**
     * Split query text by GO statements (SQL Server batch separator)
     * GO must be on its own line and is case-insensitive
     * Returns array of batches, with empty/whitespace-only batches filtered out
     */
    private splitByGO(queryText: string): string[] {
        this.outputChannel.appendLine(`[QueryExecutor] splitByGO input length: ${queryText.length}`);
        
        // Split by GO on its own line (case-insensitive)
        // GO must be separated from other statements (preceded and followed by newline or string boundaries)
        const goRegex = /(?:^|[\r\n]+)\s*GO\s*(?:--[^\r\n]*)?(?=[\r\n]+|$)/gmi;
        
        // Test if GO exists
        const hasGo = goRegex.test(queryText);
        goRegex.lastIndex = 0; // Reset regex state
        
        const batches = queryText.split(goRegex);
        
        this.outputChannel.appendLine(`[QueryExecutor] splitByGO found ${batches.length} batch(es) after split`);
        
        // Log each batch for debugging
        batches.forEach((batch, index) => {
            this.outputChannel.appendLine(`[QueryExecutor] Batch ${index} length: ${batch.length}, starts with: ${batch.substring(0, 50).replace(/\n/g, '\\n')}`);
        });
        
        // Filter out empty batches and trim each batch
        const filteredBatches = batches
            .map(batch => batch.trim())
            .filter(batch => batch.length > 0);
        
        this.outputChannel.appendLine(`[QueryExecutor] After filtering: ${filteredBatches.length} non-empty batch(es)`);
        
        // If no GO statements found, return the whole query as a single batch
        if (filteredBatches.length === 0 && queryText.trim().length > 0) {
            this.outputChannel.appendLine(`[QueryExecutor] No batches found, returning original query as single batch`);
            return [queryText.trim()];
        }
        
        return filteredBatches;
    }

    private parseQueries(queryText: string): string[] {
        // Split queries by GO statement (common SQL Server batch separator)
        const batches = queryText.split(/^\s*GO\s*$/gmi);
        
        const queries: string[] = [];
        
        for (const batch of batches) {
            const trimmedBatch = batch.trim();
            if (trimmedBatch) {
                // Further split by semicolon for individual statements
                const statements = trimmedBatch.split(';').map(s => s.trim()).filter(s => s);
                queries.push(...statements);
            }
        }
        
        // If no semicolons or GO statements, treat as single query
        if (queries.length === 0) {
            const trimmed = queryText.trim();
            if (trimmed) {
                queries.push(trimmed);
            }
        }
        
        return queries;
    }

    async executeStoredProcedure(procedureName: string, parameters: { [key: string]: any } = {}): Promise<QueryResult> {
        if (!this.connectionProvider.isConnected()) {
            throw new Error('No active database connection. Please connect to a server first.');
        }

        const connection = this.connectionProvider.getConnection();
        if (!connection) {
            throw new Error('Database connection is not available.');
        }

        const startTime = Date.now();
        this.outputChannel.appendLine(`Executing stored procedure: ${procedureName}`);

        try {
            return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Executing Stored Procedure',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: `Executing ${procedureName}...` });

                const request = connection.request();
                
                // Add parameters (if supported by the underlying request)
                if (request.input && typeof request.input === 'function') {
                    for (const [key, value] of Object.entries(parameters)) {
                        request.input(key, value);
                        this.outputChannel.appendLine(`Parameter @${key} = ${value}`);
                    }
                } else {
                    // If input is not supported, parameters will be ignored and we will fallback to EXEC
                    this.outputChannel.appendLine('[QueryExecutor] Warning: request.input not supported by this driver; parameters will be ignored');
                }

                let result: any;
                if (request.execute && typeof request.execute === 'function') {
                    result = await request.execute(procedureName);
                } else {
                    // Fallback for drivers without execute() (msnodesqlv8) — run EXEC proc
                    result = await request.query(`EXEC ${procedureName}`);
                }
                const executionTime = Date.now() - startTime;
                
                this.outputChannel.appendLine(`Stored procedure completed in ${executionTime}ms`);

                return {
                    recordsets: result.recordset ? [result.recordset] : [],
                    rowsAffected: result.rowsAffected || [],
                    executionTime,
                    query: `EXEC ${procedureName}`
                };
            });

        } catch (error) {
            const executionTime = Date.now() - startTime;
            this.outputChannel.appendLine(`Stored procedure failed after ${executionTime}ms: ${error}`);
            throw error;
        }
    }

    async explainQuery(queryText: string): Promise<QueryResult> {
        const explainQuery = `SET SHOWPLAN_ALL ON;\n${queryText}\nSET SHOWPLAN_ALL OFF;`;
        return this.executeQuery(explainQuery);
    }

    /**
     * Extract metadata for result sets to determine editability
     * This analyzes the query and result columns to detect source tables and primary keys
     */
    private async extractResultMetadata(query: string, recordsets: any[][], connection: DBPool, columnNamesList?: string[][], token?: vscode.CancellationToken): Promise<ResultSetMetadata[]> {
        const metadata: ResultSetMetadata[] = [];

        for (let i = 0; i < recordsets.length; i++) {
            if (token && token.isCancellationRequested) {
                throw new Error('Operation cancelled');
            }
            const recordset = recordsets[i];
            const providedColumnNames = columnNamesList ? columnNamesList[i] : undefined;

            if (!recordset || (recordset.length === 0 && !providedColumnNames)) {
                // Empty result set - not editable
                metadata.push({
                    columns: [],
                    isEditable: false,
                    primaryKeyColumns: [],
                    hasMultipleTables: false
                });
                continue;
            }

            let columnNames: string[] = [];
            if (providedColumnNames) {
                columnNames = providedColumnNames;
            } else if (recordset.length > 0 && !Array.isArray(recordset[0])) {
                columnNames = Object.keys(recordset[0]);
            }
            
            const columns: ColumnMetadata[] = [];
            
            // Try to detect source tables from the query
            const tableInfo = this.parseQueryForTables(query);
            
            // Get cached schema once for all columns (if available)
            let cachedSchema: any = null;
            try {
                const activeConnection = this.connectionProvider.getActiveConnectionInfo();
                
                if (activeConnection?.server && tableInfo.tables.length > 0) {
                    // Get current database - either from connection info or from provider for server connections
                    let currentDatabase = activeConnection.database;
                    if (!currentDatabase) {
                        currentDatabase = this.connectionProvider.getCurrentDatabase(activeConnection.id)!;
                        this.outputChannel.appendLine(`[QueryExecutor] Got current database from connection provider for metadata: ${currentDatabase}`);
                    }
                    
                    if (currentDatabase) {
                        const schemaCache = SchemaCache.getInstance(this.context);
                        cachedSchema = await schemaCache.getSchema({ 
                            server: activeConnection.server, 
                            database: currentDatabase 
                        }, connection);
                        this.outputChannel.appendLine(`[QueryExecutor] Retrieved cached schema for ${activeConnection.server}.${currentDatabase}`);
                    }
                }
            } catch (error) {
                this.outputChannel.appendLine(`[QueryExecutor] Error getting cached schema: ${error}`);
                // Silently continue without cache
            }
            
            // For each column, try to determine its source
            for (const colName of columnNames) {
                if (token && token.isCancellationRequested) {
                    throw new Error('Operation cancelled');
                }
                const colMetadata: ColumnMetadata = {
                    name: colName,
                    type: 'unknown',
                    isNullable: true,
                    isPrimaryKey: false,
                    isIdentity: false
                };

                // Try to detect column metadata from cache if we have table information
                if (tableInfo.tables.length > 0) {
                    try {
                        let colInfo: Partial<ColumnMetadata> | null = null;
                        
                        // Try cache first
                        if (cachedSchema) {
                            colInfo = this.getColumnInfoFromCache(cachedSchema, tableInfo.tables, colName);
                        }
                        
                        // Fallback to direct query if cache didn't provide info
                        if (!colInfo) {
                            colInfo = await this.getColumnInfoDirect(connection, tableInfo.tables, colName);
                        }
                        
                        if (colInfo) {
                            Object.assign(colMetadata, colInfo);
                        }
                    } catch (error) {
                        // Silently continue without metadata for this column
                    }
                }

                columns.push(colMetadata);
            }

            // Determine if result set is editable
            const primaryKeyColumns = columns.filter(c => c.isPrimaryKey).map(c => c.name);
            const sourceTables = [...new Set(columns.map(c => c.sourceTable).filter(t => t))];
            const hasMultipleTables = sourceTables.length > 1;
            
            // Editable if:
            // 1. Has at least one primary key column
            // 2. All columns can be traced to source tables
            const allColumnsHaveSource = columns.every(c => c.sourceTable);
            const isEditable = primaryKeyColumns.length > 0 && allColumnsHaveSource;

            metadata.push({
                columns,
                isEditable,
                primaryKeyColumns,
                sourceTable: sourceTables.length === 1 ? sourceTables[0] : undefined,
                sourceSchema: columns[0]?.sourceSchema,
                hasMultipleTables
            });
        }

        return metadata;
    }

    /**
     * Check if query is a SELECT statement
     */
    private isSelectQuery(query: string): boolean {
        const trimmed = query.trim().toUpperCase();
        // Remove comments
        const withoutComments = trimmed.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        // Check if it starts with SELECT or contains SELECT after SET statements
        const normalized = withoutComments.trim();
        if (normalized.startsWith('SELECT')) {
            return true;
        }
        // Handle queries with SET statements before SELECT
        if (normalized.startsWith('SET')) {
            return normalized.includes('SELECT');
        }
        return false;
    }

    /**
     * Parse SQL query to extract table names (basic implementation)
     */
    private parseQueryForTables(query: string): { tables: Array<{schema?: string, table: string, alias?: string}> } {
        const tables: Array<{schema?: string, table: string, alias?: string}> = [];
        
        // Simple regex to find table references in FROM and JOIN clauses
        // This is a basic implementation - may not handle all edge cases
        const fromRegex = /FROM\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?(?:\s+(?:AS\s+)?(\w+))?/gi;
        const joinRegex = /JOIN\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?(?:\s+(?:AS\s+)?(\w+))?/gi;
        
        let match;
        while ((match = fromRegex.exec(query)) !== null) {
            tables.push({
                schema: match[1],
                table: match[2],
                alias: match[3]
            });
        }
        
        while ((match = joinRegex.exec(query)) !== null) {
            tables.push({
                schema: match[1],
                table: match[2],
                alias: match[3]
            });
        }
        
        return { tables };
    }

    /**
     * Get column information from SchemaCache (in-memory only, no DB queries)
     */
    private getColumnInfoFromCache(
        cachedSchema: any,
        tables: Array<{schema?: string, table: string, alias?: string}>,
        columnName: string
    ): Partial<ColumnMetadata> | null {
        this.outputChannel.appendLine(`[QueryExecutor] getColumnInfoFromCache called for column: ${columnName}, tables: ${tables.map(t => `${t.schema || 'dbo'}.${t.table}`).join(', ')}`);
        try {
            // Search for column in specified tables
            for (const t of tables) {
                const schema = t.schema || 'dbo';
                const tableKey = `${schema}.${t.table}`.toLowerCase();
                this.outputChannel.appendLine(`[QueryExecutor] Checking table ${tableKey} in cache...`);
                const columns = cachedSchema.columns.get(tableKey);
                
                if (columns) {
                    this.outputChannel.appendLine(`[QueryExecutor] Found ${columns.length} columns for table ${tableKey}`);
                    const column = columns.find((c: any) => c.columnName.toLowerCase() === columnName.toLowerCase());
                    if (column) {
                        this.outputChannel.appendLine(`[QueryExecutor] ✓ Found column ${columnName} in cache (table: ${tableKey}, isPK: ${column.isPrimaryKey})`);
                        // Build metadata from cache
                        const metadata: Partial<ColumnMetadata> = {
                            type: column.dataType,
                            isNullable: column.isNullable,
                            sourceTable: column.tableName,
                            sourceSchema: column.tableSchema,
                            sourceColumn: column.columnName,
                            isPrimaryKey: column.isPrimaryKey,
                            isIdentity: column.isIdentity
                        };

                        // Get FK relationships from cache (no DB queries)
                        metadata.foreignKeyReferences = this.getForeignKeyReferencesFromCache(
                            cachedSchema,
                            schema,
                            t.table,
                            columnName
                        );

                        return metadata;
                    } else {
                        this.outputChannel.appendLine(`[QueryExecutor] Column ${columnName} not found in table ${tableKey}`);
                    }
                } else {
                    this.outputChannel.appendLine(`[QueryExecutor] Table ${tableKey} not found in cached columns`);
                }
            }
            this.outputChannel.appendLine(`[QueryExecutor] Column ${columnName} not found in any cached tables`);
        } catch (error) {
            this.outputChannel.appendLine(`[QueryExecutor] Error getting column info from cache: ${error}`);
        }
        
        return null;
    }

    /**
     * Fallback: Get column info directly from database (original implementation)
     * Note: Does not include FK relationships to avoid extra queries. Use cache for FK info.
     */
    private async getColumnInfoDirect(
        connection: DBPool, 
        tables: Array<{schema?: string, table: string, alias?: string}>,
        columnName: string
    ): Promise<Partial<ColumnMetadata> | null> {
        this.outputChannel.appendLine(`[QueryExecutor] ⚠ getColumnInfoDirect called (DB QUERY) for column: ${columnName}`);
        try {
            const tableConditions = tables.map(t => {
                const schema = t.schema || 'dbo';
                return `(s.name = '${schema}' AND t.name = '${t.table}')`;
            }).join(' OR ');

            const query = `
                SELECT TOP 1
                    c.name AS ColumnName,
                    TYPE_NAME(c.user_type_id) AS DataType,
                    c.is_nullable AS IsNullable,
                    c.is_identity AS IsIdentity,
                    s.name AS SchemaName,
                    t.name AS TableName,
                    CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS IsPrimaryKey
                FROM sys.columns c
                INNER JOIN sys.tables t ON c.object_id = t.object_id
                INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
                LEFT JOIN (
                    SELECT ic.object_id, ic.column_id
                    FROM sys.index_columns ic
                    INNER JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                    WHERE i.is_primary_key = 1
                ) pk ON c.object_id = pk.object_id AND c.column_id = pk.column_id
                WHERE c.name = '${columnName}'
                AND (${tableConditions})
            `;

            const result = await connection.request().query(query);
            
            if (result.recordset && result.recordset.length > 0) {
                const row = result.recordset[0];
                const metadata: Partial<ColumnMetadata> = {
                    type: row.DataType,
                    isNullable: row.IsNullable,
                    sourceTable: row.TableName,
                    sourceSchema: row.SchemaName,
                    sourceColumn: row.ColumnName,
                    isPrimaryKey: row.IsPrimaryKey === 1,
                    isIdentity: row.IsIdentity
                };

                // Get FK relationships as fallback (only when cache not available)
                try {
                    metadata.foreignKeyReferences = await this.getForeignKeyReferencesDirect(
                        connection,
                        row.SchemaName,
                        row.TableName,
                        row.ColumnName
                    );
                } catch (error) {
                    this.outputChannel.appendLine(`[QueryExecutor] Error getting FK references: ${error}`);
                    metadata.foreignKeyReferences = [];
                }

                return metadata;
            }
        } catch (error) {
            this.outputChannel.appendLine(`[QueryExecutor] Error in direct column query: ${error}`);
        }
        
        return null;
    }

    /**
     * Get FK relationships directly from database (fallback when cache not available)
     */
    private async getForeignKeyReferencesDirect(
        connection: DBPool,
        schema: string,
        table: string,
        column: string
    ): Promise<ForeignKeyReference[]> {
        const references: ForeignKeyReference[] = [];

        try {
            // Query for outgoing FKs (this column references another table)
            const outgoingQuery = `
                SELECT 
                    fk.name AS ConstraintName,
                    OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS ReferencedSchema,
                    OBJECT_NAME(fk.referenced_object_id) AS ReferencedTable,
                    COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS ReferencedColumn,
                    COUNT(*) OVER (PARTITION BY fk.object_id) AS ColumnCount
                FROM sys.foreign_keys fk
                INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
                WHERE fk.parent_object_id = OBJECT_ID('${schema}.${table}')
                AND fkc.parent_column_id = COLUMNPROPERTY(OBJECT_ID('${schema}.${table}'), '${column}', 'ColumnId')
            `;

            const outgoingResult = await connection.request().query(outgoingQuery);
            
            if (outgoingResult.recordset && outgoingResult.recordset.length > 0) {
                for (const row of outgoingResult.recordset) {
                    const isComposite = row.ColumnCount > 1;
                    references.push({
                        schema: row.ReferencedSchema,
                        table: row.ReferencedTable,
                        column: row.ReferencedColumn,
                        isComposite,
                        compositeColumns: [],
                        constraintName: row.ConstraintName
                    });
                }
            }

            // Query for incoming FKs (other tables reference this column as PK)
            const incomingQuery = `
                SELECT 
                    fk.name AS ConstraintName,
                    OBJECT_SCHEMA_NAME(fk.parent_object_id) AS ReferencingSchema,
                    OBJECT_NAME(fk.parent_object_id) AS ReferencingTable,
                    COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS ReferencingColumn,
                    COUNT(*) OVER (PARTITION BY fk.object_id) AS ColumnCount
                FROM sys.foreign_keys fk
                INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
                WHERE fk.referenced_object_id = OBJECT_ID('${schema}.${table}')
                AND fkc.referenced_column_id = COLUMNPROPERTY(OBJECT_ID('${schema}.${table}'), '${column}', 'ColumnId')
            `;

            const incomingResult = await connection.request().query(incomingQuery);
            
            if (incomingResult.recordset && incomingResult.recordset.length > 0) {
                for (const row of incomingResult.recordset) {
                    const isComposite = row.ColumnCount > 1;
                    references.push({
                        schema: row.ReferencingSchema,
                        table: row.ReferencingTable,
                        column: row.ReferencingColumn,
                        isComposite,
                        compositeColumns: [],
                        constraintName: row.ConstraintName
                    });
                }
            }

        } catch (error) {
            this.outputChannel.appendLine(`[QueryExecutor] Error in getForeignKeyReferencesDirect: ${error}`);
        }

        return references;
    }

    /**
     * Get FK relationships from cache instead of querying database
     */
    private getForeignKeyReferencesFromCache(
        cachedSchema: any,
        schema: string,
        table: string,
        columnName: string
    ): ForeignKeyReference[] {
        const references: ForeignKeyReference[] = [];
        const tableKey = `${schema}.${table}`.toLowerCase();
        const constraints = cachedSchema.constraints.get(tableKey);

        if (!constraints) {
            return references;
        }

        // Find FK constraints that include this column
        for (const constraint of constraints) {
            if (constraint.constraintType === 'FOREIGN KEY' && constraint.columns?.includes(columnName)) {
                const isComposite = (constraint.columns?.length || 0) > 1;
                
                references.push({
                    schema: constraint.referencedTableSchema || schema,
                    table: constraint.referencedTableName || '',
                    column: constraint.referencedColumns?.[constraint.columns.indexOf(columnName)] || '',
                    isComposite,
                    compositeColumns: constraint.columns || [],
                    constraintName: constraint.constraintName
                });
            }
        }

        // Also check if other tables reference this column
        for (const [otherTableKey, otherConstraints] of cachedSchema.constraints.entries()) {
            for (const constraint of otherConstraints) {
                if (constraint.constraintType === 'FOREIGN KEY' && 
                    constraint.referencedTableSchema?.toLowerCase() === schema.toLowerCase() &&
                    constraint.referencedTableName?.toLowerCase() === table.toLowerCase() &&
                    constraint.referencedColumns?.some((col: string) => col.toLowerCase() === columnName.toLowerCase())) {
                    
                    const refColIndex = constraint.referencedColumns.findIndex((col: string) => col.toLowerCase() === columnName.toLowerCase());
                    const isComposite = (constraint.columns?.length || 0) > 1;
                    
                    references.push({
                        schema: constraint.tableSchema,
                        table: constraint.tableName,
                        column: constraint.columns?.[refColIndex] || '',
                        isComposite,
                        compositeColumns: constraint.columns || [],
                        constraintName: constraint.constraintName
                    });
                }
            }
        }

        return references;
    }

    /**
     * Cleans a query for storage in history by removing SET commands and execution summary comments
     */
    private cleanQueryForHistory(queryText: string): string {
        const lines = queryText.split('\n');
        const resultLines: string[] = [];
        let skipComments = false;
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            // Skip SET commands (case-insensitive)
            if (trimmedLine.match(/^SET\s+/i)) {
                continue;
            }
            
            // Check if this line starts an execution summary comment block
            if (trimmedLine.startsWith('-- Query from history')) {
                skipComments = true;
                continue;
            }
            
            // If we're in a comment block, skip lines that look like execution metadata
            if (skipComments) {
                if (trimmedLine.startsWith('-- Executed:') || 
                    trimmedLine.startsWith('-- Connection:') || 
                    trimmedLine.startsWith('-- Result Sets:') ||
                    trimmedLine === '') { // Also skip empty lines that are part of the comment block
                    continue;
                } else {
                    // Found a non-comment line, stop skipping
                    skipComments = false;
                }
            }
            
            // If we're not skipping, add the line
            if (!skipComments) {
                resultLines.push(line);
            }
        }
        
        // Join the lines back together and trim any trailing whitespace
        return resultLines.join('\n').trim();
    }

    /**
     * Detect DDL operations and invalidate affected cache entries
     */
    private async detectAndInvalidateCache(queryText: string, pool: DBPool): Promise<void> {
        try {
            const schemaCache = SchemaCache.getInstance(this.context);
            const activeConnection = this.connectionProvider.getActiveConnectionInfo();
            
            if (!activeConnection || !schemaCache) {
                return;
            }

            // Remove comments and normalize whitespace
            const cleanedQuery = queryText
                .replace(/--.*$/gm, '') // Remove single-line comments
                .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
                .replace(/\s+/g, ' ') // Normalize whitespace
                .trim();

            // DDL patterns for different object types
            const ddlPatterns = [
                // Tables
                {
                    pattern: /\b(?:CREATE|ALTER|DROP)\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:\[?([^\].\s]+)\]?\.)?\[?([^\].\s]+)\]?/gi,
                    type: SchemaObjectType.Table
                },
                // Views
                {
                    pattern: /\b(?:CREATE|ALTER|DROP)\s+VIEW\s+(?:\[?([^\].\s]+)\]?\.)?\[?([^\].\s]+)\]?/gi,
                    type: SchemaObjectType.View
                },
                // Stored Procedures
                {
                    pattern: /\b(?:CREATE|ALTER|DROP)\s+(?:PROCEDURE|PROC)\s+(?:\[?([^\].\s(]+)\]?\.)?\[?([^\].\s(]+)\]?/gi,
                    type: SchemaObjectType.Procedure
                },
                // Functions
                {
                    pattern: /\b(?:CREATE|ALTER|DROP)\s+FUNCTION\s+(?:\[?([^\].\s(]+)\]?\.)?\[?([^\].\s(]+)\]?/gi,
                    type: SchemaObjectType.Function
                },
                // Triggers
                {
                    pattern: /\b(?:CREATE|ALTER|DROP)\s+TRIGGER\s+(?:\[?([^\].\s]+)\]?\.)?\[?([^\].\s]+)\]?/gi,
                    type: SchemaObjectType.Trigger
                },
                // Indexes
                {
                    pattern: /\b(?:CREATE|DROP)\s+(?:UNIQUE\s+)?(?:CLUSTERED\s+)?(?:NONCLUSTERED\s+)?INDEX\s+\[?([^\].\s(]+)\]?\s+ON\s+(?:\[?([^\].\s(]+)\]?\.)?\[?([^\].\s(]+)\]?/gi,
                    type: SchemaObjectType.Index
                }
            ];

            const invalidations: Array<{ type: SchemaObjectType; schema: string; name: string }> = [];

            for (const { pattern, type } of ddlPatterns) {
                let match;
                // Reset lastIndex for global regex
                pattern.lastIndex = 0;
                
                while ((match = pattern.exec(cleanedQuery)) !== null) {
                    let schema: string;
                    let objectName: string;

                    if (type === SchemaObjectType.Index) {
                        // Index pattern: CREATE INDEX indexName ON [schema.]table
                        schema = match[2] || 'dbo';
                        objectName = match[3]; // Table name (indexes are invalidated per table)
                    } else {
                        // Standard pattern: CREATE/ALTER/DROP objectType [schema.]name
                        schema = match[1] || 'dbo';
                        objectName = match[2];
                    }

                    if (objectName) {
                        invalidations.push({
                            type,
                            schema: schema.replace(/[\[\]]/g, ''),
                            name: objectName.replace(/[\[\]]/g, '')
                        });
                    }
                }
            }

            // Execute invalidations
            if (invalidations.length > 0) {
                this.outputChannel.appendLine(`[SchemaCache] Detected ${invalidations.length} DDL operation(s), invalidating cache...`);
                
                for (const { type, schema, name } of invalidations) {
                    this.outputChannel.appendLine(`[SchemaCache] Invalidating ${type}: ${schema}.${name}`);
                    await schemaCache.invalidateObject(activeConnection, pool, type, schema, name);
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`[SchemaCache] Error detecting/invalidating cache: ${error}`);
            // Don't throw - cache invalidation failure shouldn't break query execution
        }
    }
}
