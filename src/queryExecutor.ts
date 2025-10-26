import * as vscode from 'vscode';
import * as sql from 'mssql';
import { ConnectionProvider } from './connectionProvider';
import { QueryHistoryManager } from './queryHistory';

export interface QueryResult {
    recordsets: any[][]; // Changed from single recordset to array of recordsets
    rowsAffected: number[];
    executionTime: number;
    query: string;
}

export class QueryExecutor {
    private currentRequest: sql.Request | null = null;
    
    constructor(
        private connectionProvider: ConnectionProvider,
        private outputChannel: vscode.OutputChannel,
        private historyManager?: QueryHistoryManager
    ) {}

    async executeQuery(queryText: string): Promise<QueryResult> {
        if (!this.connectionProvider.isConnected()) {
            throw new Error('No active database connection. Please connect to a server first.');
        }

        const connection = this.connectionProvider.getConnection();
        if (!connection) {
            throw new Error('Database connection is not available.');
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
                
                // mssql library returns all recordsets in result.recordsets array
                const allRecordsets: any[][] = (result.recordsets || []) as any[][];
                const totalRowsAffected: number[] = result.rowsAffected || [];

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
                        
                        this.historyManager.addEntry({
                            query: queryText,
                            connectionId: activeConnectionInfo.id,
                            connectionName: activeConnectionInfo.name,
                            database: activeConnectionInfo.database,
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
                
                // Add parameters
                for (const [key, value] of Object.entries(parameters)) {
                    request.input(key, value);
                    this.outputChannel.appendLine(`Parameter @${key} = ${value}`);
                }

                const result = await request.execute(procedureName);
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
}