import * as vscode from 'vscode';
import { ConnectionProvider } from './connectionProvider';
import { DBPool } from './dbClient';
import { QueryHistoryManager } from './queryHistory';

export interface ColumnMetadata {
    name: string;
    type: string;
    isNullable: boolean;
    sourceTable?: string;
    sourceSchema?: string;
    sourceColumn?: string;
    isPrimaryKey: boolean;
    isIdentity: boolean;
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
}

export class QueryExecutor {
    private currentRequest: any = null;
    
    constructor(
        private connectionProvider: ConnectionProvider,
        private outputChannel: vscode.OutputChannel,
        private historyManager?: QueryHistoryManager
    ) {}

    // Accept an optional `connectionPool` to execute the query against. When not
    // provided, fall back to the provider's active connection.
    async executeQuery(queryText: string, connectionPool?: DBPool): Promise<QueryResult> {
        // If a specific pool was provided, use it. Otherwise use the provider's active connection.
        const connection = connectionPool || this.connectionProvider.getConnection();
        if (!connection) {
            throw new Error('No active database connection. Please connect to a database first.');
        }

        const startTime = Date.now();
        this.outputChannel.appendLine(`Executing query: ${queryText.substring(0, 100)}${queryText.length > 100 ? '...' : ''})`);

        try {
            return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Executing SQL Query',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Running query...' });

                const request = connection.request();
                this.currentRequest = request;
                
                // Execute query as a single batch to handle multiple SELECT statements
                progress.report({ message: 'Running query...' });
                
                this.outputChannel.appendLine(`Executing query batch`);

                const result = await request.query(queryText);

                // Support both mssql.Result and our msnodesqlv8 normalized object
                const allRecordsets: any[][] = (result.recordsets || (result.recordsets === undefined && result.recordset ? [result.recordset] : result.recordsets)) as any[][] || (result.recordsets ? result.recordsets : (result.recordset ? [result.recordset] : []));
                const totalRowsAffected: number[] = result.rowsAffected || result.rowsAffected || (Array.isArray(result.rowsAffected) ? result.rowsAffected : (result.rowsAffected ? [result.rowsAffected] : []));

                this.outputChannel.appendLine(`Query completed. Result sets: ${allRecordsets.length}, Rows affected: ${totalRowsAffected.join(', ') || '0'}`);

                this.currentRequest = null;
                const executionTime = Date.now() - startTime;
                this.outputChannel.appendLine(`Total execution time: ${executionTime}ms`);

                const queryResult: QueryResult = {
                    recordsets: allRecordsets,
                    rowsAffected: totalRowsAffected,
                    executionTime,
                    query: queryText
                };

                // Extract metadata for SELECT queries to enable editing
                if (allRecordsets.length > 0 && this.isSelectQuery(queryText)) {
                    try {
                        this.outputChannel.appendLine(`[QueryExecutor] Extracting metadata for result sets...`);
                        queryResult.metadata = await this.extractResultMetadata(queryText, allRecordsets, connection);
                        this.outputChannel.appendLine(`[QueryExecutor] Metadata extracted: ${queryResult.metadata.map(m => `editable=${m.isEditable}, pks=${m.primaryKeyColumns.length}`).join(', ')}`);
                    } catch (error) {
                        this.outputChannel.appendLine(`[QueryExecutor] Failed to extract metadata: ${error}`);
                        // Continue without metadata - result set will be read-only
                    }
                }

                // Log results summary
                if (allRecordsets.length > 0) {
                    const totalRows = allRecordsets.reduce((sum, rs) => sum + rs.length, 0);
                    this.outputChannel.appendLine(`Query returned ${allRecordsets.length} result set(s) with ${totalRows} total row(s)`);
                } else if (totalRowsAffected.length > 0) {
                    this.outputChannel.appendLine(`Query affected ${totalRowsAffected.reduce((a, b) => a + b, 0)} row(s)`);
                } else {
                    this.outputChannel.appendLine(`Query completed successfully`);
                }

                // Add to query history
                if (this.historyManager) {
                    const activeConnectionInfo = this.connectionProvider.getActiveConnectionInfo();
                    console.log('[QueryExecutor] Adding query to history, activeConnection:', activeConnectionInfo?.name);
                    if (activeConnectionInfo) {
                        // Calculate row counts for each result set
                        const rowCounts = allRecordsets.map(recordset => recordset.length);
                        
                        // Strip SET commands from query for history
                        // Remove lines that start with SET (case-insensitive)
                        const cleanedQuery = queryText
                            .split('\n')
                            .filter(line => !line.trim().match(/^SET\s+/i))
                            .join('\n')
                            .trim();
                        
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
                } else {
                    console.log('[QueryExecutor] History manager not available');
                }

                return queryResult;
            });

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
    private async extractResultMetadata(query: string, recordsets: any[][], connection: DBPool): Promise<ResultSetMetadata[]> {
        const metadata: ResultSetMetadata[] = [];

        for (const recordset of recordsets) {
            if (!recordset || recordset.length === 0) {
                // Empty result set - not editable
                metadata.push({
                    columns: [],
                    isEditable: false,
                    primaryKeyColumns: [],
                    hasMultipleTables: false
                });
                continue;
            }

            const columnNames = Object.keys(recordset[0]);
            const columns: ColumnMetadata[] = [];
            
            // Try to detect source tables from the query
            const tableInfo = this.parseQueryForTables(query);
            
            // For each column, try to determine its source
            for (const colName of columnNames) {
                const colMetadata: ColumnMetadata = {
                    name: colName,
                    type: 'unknown',
                    isNullable: true,
                    isPrimaryKey: false,
                    isIdentity: false
                };

                // Try to detect column metadata by querying sys.columns if we have table information
                if (tableInfo.tables.length > 0) {
                    try {
                        const colInfo = await this.getColumnInfo(connection, tableInfo.tables, colName);
                        if (colInfo) {
                            Object.assign(colMetadata, colInfo);
                        }
                    } catch (error) {
                        this.outputChannel.appendLine(`[QueryExecutor] Failed to get column metadata for ${colName}: ${error}`);
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
        // Remove comments and check if it starts with SELECT
        const withoutComments = trimmed.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        return withoutComments.trim().startsWith('SELECT');
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
     * Get column information from sys.columns and sys.indexes
     */
    private async getColumnInfo(
        connection: DBPool, 
        tables: Array<{schema?: string, table: string, alias?: string}>,
        columnName: string
    ): Promise<Partial<ColumnMetadata> | null> {
        try {
            // Build a query to find this column across the specified tables
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
                return {
                    type: row.DataType,
                    isNullable: row.IsNullable,
                    sourceTable: row.TableName,
                    sourceSchema: row.SchemaName,
                    sourceColumn: row.ColumnName,
                    isPrimaryKey: row.IsPrimaryKey === 1,
                    isIdentity: row.IsIdentity
                };
            }
        } catch (error) {
            this.outputChannel.appendLine(`[QueryExecutor] Error getting column info: ${error}`);
        }
        
        return null;
    }
}