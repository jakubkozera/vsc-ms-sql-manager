import * as vscode from 'vscode';
import * as sql from 'mssql';
import { ConnectionProvider } from './connectionProvider';

export interface QueryResult {
    recordset: any[];
    rowsAffected: number[];
    executionTime: number;
    query: string;
}

export class QueryExecutor {
    private currentRequest: sql.Request | null = null;
    
    constructor(
        private connectionProvider: ConnectionProvider,
        private outputChannel: vscode.OutputChannel
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
                
                // Parse and execute the query
                const queries = this.parseQueries(queryText);
                let finalResult: any = null;
                let totalRowsAffected: number[] = [];

                for (let i = 0; i < queries.length; i++) {
                    const query = queries[i].trim();
                    if (!query) continue;

                    progress.report({ 
                        message: `Executing query ${i + 1} of ${queries.length}...` 
                    });

                    this.outputChannel.appendLine(`Query ${i + 1}: ${query}`);

                    try {
                        const result = await request.query(query);
                        
                        // Keep the last recordset for display
                        if (result.recordset && result.recordset.length > 0) {
                            finalResult = result;
                        }
                        
                        if (result.rowsAffected) {
                            totalRowsAffected.push(...result.rowsAffected);
                        }

                        this.outputChannel.appendLine(`Query ${i + 1} completed. Rows affected: ${result.rowsAffected?.join(', ') || '0'}`);

                    } catch (queryError) {
                        this.outputChannel.appendLine(`Query ${i + 1} failed: ${queryError}`);
                        throw queryError;
                    }
                }

                this.currentRequest = null;
                const executionTime = Date.now() - startTime;
                this.outputChannel.appendLine(`Total execution time: ${executionTime}ms`);

                const queryResult: QueryResult = {
                    recordset: finalResult?.recordset || [],
                    rowsAffected: totalRowsAffected,
                    executionTime,
                    query: queryText
                };

                // Log results summary
                if (queryResult.recordset.length > 0) {
                    this.outputChannel.appendLine(`Query returned ${queryResult.recordset.length} row(s)`);
                } else if (totalRowsAffected.length > 0) {
                    this.outputChannel.appendLine(`Query affected ${totalRowsAffected.reduce((a, b) => a + b, 0)} row(s)`);
                } else {
                    this.outputChannel.appendLine(`Query completed successfully`);
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
                    recordset: result.recordset || [],
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