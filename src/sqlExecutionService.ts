import * as vscode from 'vscode';
import { ConnectionProvider } from './connectionProvider';
import { QueryExecutor, QueryResult } from './queryExecutor';
import { ChatConnectionContext } from './sqlChatHandler';
import type { SqlEditorProvider } from './sqlEditorProvider';

export interface SqlExecutionOptions {
    autoExecute?: boolean;
    showResults?: boolean;
    insertToEditor?: boolean;
}

export interface ExecutionResult {
    success: boolean;
    result?: QueryResult;
    error?: string;
    wasExecuted: boolean;
}

export class SqlExecutionService {
    constructor(
        private connectionProvider: ConnectionProvider,
        private outputChannel: vscode.OutputChannel,
        private sqlEditorProvider?: SqlEditorProvider
    ) {}

    /**
     * Execute SQL query with appropriate user confirmation based on query type
     */
    async executeSqlQuery(
        query: string,
        connectionContext: ChatConnectionContext,
        options: SqlExecutionOptions = {}
    ): Promise<ExecutionResult> {
        try {
            // Analyze the query to determine execution strategy
            const queryType = this.analyzeQueryType(query);
            
            // Auto-execute SELECT queries, prompt for others
            let shouldExecute = false;
            
            if (queryType === 'SELECT' && options.autoExecute !== false) {
                shouldExecute = true;
                this.outputChannel.appendLine(`[SqlExecutionService] Auto-executing SELECT query`);
            } else {
                // Prompt user for confirmation
                const action = await this.promptUserForExecution(query, queryType);
                shouldExecute = action === 'execute';
                
                if (action === 'insert') {
                    await this.insertQueryToEditor(query, connectionContext);
                    return {
                        success: true,
                        wasExecuted: false
                    };
                }
            }

            if (!shouldExecute) {
                return {
                    success: false,
                    error: 'Execution cancelled by user',
                    wasExecuted: false
                };
            }

            // Execute the query
            const result = await this.executeQuery(query, connectionContext);
            
            if (options.showResults !== false) {
                await this.showExecutionResults(result, query);
            }

            return {
                success: true,
                result,
                wasExecuted: true
            };

        } catch (error) {
            this.outputChannel.appendLine(`[SqlExecutionService] Execution error: ${error}`);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown execution error',
                wasExecuted: false
            };
        }
    }

    /**
     * Analyze query to determine its type (SELECT, INSERT, UPDATE, DELETE, DDL, etc.)
     */
    private analyzeQueryType(query: string): string {
        const trimmed = query.trim().toUpperCase();
        
        if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH')) {
            return 'SELECT';
        } else if (trimmed.startsWith('INSERT')) {
            return 'INSERT';
        } else if (trimmed.startsWith('UPDATE')) {
            return 'UPDATE';
        } else if (trimmed.startsWith('DELETE')) {
            return 'DELETE';
        } else if (trimmed.startsWith('CREATE') || trimmed.startsWith('ALTER') || trimmed.startsWith('DROP')) {
            return 'DDL';
        } else if (trimmed.startsWith('EXEC') || trimmed.startsWith('EXECUTE')) {
            return 'PROCEDURE';
        } else if (trimmed.startsWith('TRUNCATE')) {
            return 'TRUNCATE';
        } else {
            return 'OTHER';
        }
    }

    /**
     * Prompt user for execution confirmation
     */
    private async promptUserForExecution(query: string, queryType: string): Promise<'execute' | 'insert' | 'cancel'> {
        const queryPreview = query.length > 200 ? query.substring(0, 200) + '...' : query;
        
        let message: string;
        let isDestructive = false;
        
        switch (queryType) {
            case 'INSERT':
                message = 'This query will insert data into the database. Do you want to proceed?';
                break;
            case 'UPDATE':
                message = 'This query will modify existing data. Do you want to proceed?';
                isDestructive = true;
                break;
            case 'DELETE':
                message = 'This query will delete data from the database. Do you want to proceed?';
                isDestructive = true;
                break;
            case 'TRUNCATE':
                message = 'This query will delete ALL data from a table. Do you want to proceed?';
                isDestructive = true;
                break;
            case 'DDL':
                message = 'This query will modify the database structure. Do you want to proceed?';
                isDestructive = true;
                break;
            case 'PROCEDURE':
                message = 'This query will execute a stored procedure. Do you want to proceed?';
                break;
            default:
                message = 'Do you want to execute this SQL query?';
        }

        const options: string[] = ['Execute', 'Insert to Editor', 'Cancel'];
        
        if (isDestructive) {
            const choice = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                ...options
            );
            
            switch (choice) {
                case 'Execute': return 'execute';
                case 'Insert to Editor': return 'insert';
                default: return 'cancel';
            }
        } else {
            const choice = await vscode.window.showInformationMessage(
                message,
                ...options
            );
            
            switch (choice) {
                case 'Execute': return 'execute';
                case 'Insert to Editor': return 'insert';
                default: return 'cancel';
            }
        }
    }

    /**
     * Execute query using the appropriate connection
     */
    private async executeQuery(query: string, connectionContext: ChatConnectionContext): Promise<QueryResult> {
        let connection: any;
        
        if (connectionContext.database) {
            // Use database-specific pool
            connection = await this.connectionProvider.createDbPool(
                connectionContext.connectionId,
                connectionContext.database
            );
        } else {
            // Use base connection
            connection = this.connectionProvider.getConnection(connectionContext.connectionId);
        }

        if (!connection) {
            throw new Error(`Unable to establish connection to ${connectionContext.connectionId}`);
        }

        // Create QueryExecutor instance for this execution
        const queryExecutor = new QueryExecutor(this.connectionProvider, this.outputChannel);
        
        return await queryExecutor.executeQuery(query, connection);
    }

    /**
     * Show execution results in appropriate format
     */
    private async showExecutionResults(result: QueryResult, originalQuery: string): Promise<void> {
        if (result.recordsets && result.recordsets.length > 0 && result.recordsets[0].length > 0) {
            // Show results in a new SQL editor or dedicated results view
            await this.showResultsInWebview(result, originalQuery);
        } else {
            // Show summary message for non-SELECT queries
            const rowsAffected = result.rowsAffected?.reduce((sum, count) => sum + count, 0) || 0;
            const message = rowsAffected > 0 
                ? `Query executed successfully. ${rowsAffected} row(s) affected. Execution time: ${result.executionTime}ms`
                : `Query executed successfully. Execution time: ${result.executionTime}ms`;
                
            vscode.window.showInformationMessage(message);
        }
    }

    /**
     * Show results in webview (leveraging existing SQL editor infrastructure)
     */
    private async showResultsInWebview(result: QueryResult, originalQuery: string): Promise<void> {
        // Create a new untitled document for the results
        const doc = await vscode.workspace.openTextDocument({
            content: originalQuery,
            language: 'sql'
        });

        // Open the document in the SQL editor
        const editor = await vscode.window.showTextDocument(doc);

        // The SQL editor webview will handle displaying the results
        // We could enhance this by directly posting results to the webview
        vscode.window.showInformationMessage(
            `Query executed successfully. ${result.recordsets[0]?.length || 0} row(s) returned. ` +
            `Execution time: ${result.executionTime}ms`
        );
    }

    /**
     * Execute query in a new SQL editor window (opens editor and runs query)
     */
    async executeQueryInEditor(query: string, connectionContext: ChatConnectionContext): Promise<void> {
        // Get connection config
        const config = this.connectionProvider.getConnectionConfig(connectionContext.connectionId);
        
        if (!config) {
            throw new Error('Connection not found');
        }
        
        // Create connection item-like object
        const connectionItem = {
            connectionId: connectionContext.connectionId,
            database: connectionContext.database,
            name: config.name
        };
        
        // Open editor with query and auto-execute
        await vscode.commands.executeCommand('mssqlManager.newQuery', connectionItem, query, true);
        this.outputChannel.appendLine('[SqlExecutionService] Query opened in editor and executed');
    }

    /**
     * Insert query into the active editor or create a new SQL file
     * If no active editor, opens a new query file using the custom SQL editor with connection context
     */
    async insertQueryToEditor(query: string, connectionContext?: ChatConnectionContext): Promise<void> {
        const activeEditor = vscode.window.activeTextEditor;
        
        // Check if active editor is our custom SQL editor
        if (activeEditor?.document.uri.scheme === 'file' && activeEditor.document.fileName.endsWith('.sql')) {
            // Insert into active SQL editor
            const position = activeEditor.selection.active;
            await activeEditor.edit(editBuilder => {
                editBuilder.insert(position, query);
            });
            
            // Move cursor to end of inserted text
            const lines = query.split('\n');
            const lastLine = lines[lines.length - 1];
            const newPosition = position.translate(lines.length - 1, lines.length === 1 ? query.length : lastLine.length);
            activeEditor.selection = new vscode.Selection(newPosition, newPosition);
            
            vscode.window.showInformationMessage('SQL query inserted into active editor');
        } else {
            // Open new query file in custom SQL editor (like rightclick -> New Query)
            if (connectionContext) {
                // Get connection config
                const config = this.connectionProvider.getConnectionConfig(connectionContext.connectionId);
                
                if (config) {
                    // Create connection item-like object to pass to newQuery command
                    const connectionItem = {
                        connectionId: connectionContext.connectionId,
                        database: connectionContext.database,
                        name: config.name
                    };
                    
                    // Execute the new query command which will open our custom SQL editor with the query
                    // Pass false for autoExecute - we only want to insert, not execute
                    await vscode.commands.executeCommand('mssqlManager.newQuery', connectionItem, query, false);
                    vscode.window.showInformationMessage('SQL query opened in new query window');
                } else {
                    // Fallback: create new SQL document without connection
                    this.outputChannel.appendLine('[SqlExecutionService] WARNING: No connection config found, using fallback editor');
                    const doc = await vscode.workspace.openTextDocument({
                        content: query,
                        language: 'sql'
                    });
                    await vscode.window.showTextDocument(doc);
                    vscode.window.showInformationMessage('SQL query opened in new file (connection context not available)');
                }
            } else {
                // No connection context, just create a new SQL document
                this.outputChannel.appendLine('[SqlExecutionService] WARNING: No connection context provided, using fallback editor');
                const doc = await vscode.workspace.openTextDocument({
                    content: query,
                    language: 'sql'
                });
                await vscode.window.showTextDocument(doc);
                vscode.window.showInformationMessage('SQL query opened in new file');
            }
        }
    }

    /**
     * Validate SQL query syntax (basic validation)
     */
    validateSqlSyntax(query: string): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];
        const trimmed = query.trim();
        
        if (!trimmed) {
            errors.push('Query is empty');
            return { isValid: false, errors };
        }

        // Basic syntax checks
        const openParens = (trimmed.match(/\(/g) || []).length;
        const closeParens = (trimmed.match(/\)/g) || []).length;
        
        if (openParens !== closeParens) {
            errors.push('Unmatched parentheses');
        }

        const openBrackets = (trimmed.match(/\[/g) || []).length;
        const closeBrackets = (trimmed.match(/\]/g) || []).length;
        
        if (openBrackets !== closeBrackets) {
            errors.push('Unmatched square brackets');
        }

        // Check for common SQL keywords
        const sqlKeywordPattern = /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|EXEC|EXECUTE|WITH|DECLARE|SET|TRUNCATE)\s/i;
        
        if (!sqlKeywordPattern.test(trimmed)) {
            errors.push('Query does not start with a recognized SQL keyword');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Format SQL query for better readability
     */
    formatSqlQuery(query: string): string {
        // Basic SQL formatting
        return query
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/,\s*/g, ',\n    ') // Format column lists
            .replace(/\b(SELECT|FROM|WHERE|JOIN|INNER JOIN|LEFT JOIN|RIGHT JOIN|GROUP BY|ORDER BY|HAVING)\b/gi, '\n$1')
            .replace(/\b(AND|OR)\b/gi, '\n    $1')
            .trim();
    }

    /**
     * Extract table names from SQL query (basic extraction)
     */
    extractTableNames(query: string): string[] {
        const tables: string[] = [];
        const upperQuery = query.toUpperCase();
        
        // Simple regex to find table names after FROM and JOIN
        const fromMatches = query.match(/FROM\s+(\[?\w+\]?\.?\[?\w+\]?)/gi);
        const joinMatches = query.match(/JOIN\s+(\[?\w+\]?\.?\[?\w+\]?)/gi);
        
        if (fromMatches) {
            fromMatches.forEach(match => {
                const tableName = match.replace(/FROM\s+/i, '').trim();
                if (tableName && !tables.includes(tableName)) {
                    tables.push(tableName);
                }
            });
        }
        
        if (joinMatches) {
            joinMatches.forEach(match => {
                const tableName = match.replace(/JOIN\s+/i, '').trim();
                if (tableName && !tables.includes(tableName)) {
                    tables.push(tableName);
                }
            });
        }
        
        return tables;
    }
}