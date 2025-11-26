import * as vscode from 'vscode';
import { ConnectionProvider, ConnectionConfig } from './connectionProvider';
import { SchemaContextBuilder } from './schemaContextBuilder';
import { SqlExecutionService } from './sqlExecutionService';

export interface ChatConnectionContext {
    connectionId: string;
    database?: string;
    timestamp: number;
}

export interface ChatConversationState {
    connectionContext?: ChatConnectionContext;
    schemaContext?: string;
    lastActivity: number;
}

export interface SqlChatResult extends vscode.ChatResult {
    metadata: {
        command?: string;
        connectionId?: string;
        database?: string;
    };
}

export class SqlChatHandler {
    private conversationStates = new Map<string, ChatConversationState>();
    private schemaContextBuilder: SchemaContextBuilder;
    private sqlExecutionService: SqlExecutionService;
    
    constructor(
        private context: vscode.ExtensionContext,
        private connectionProvider: ConnectionProvider,
        private outputChannel: vscode.OutputChannel
    ) {
        this.schemaContextBuilder = new SchemaContextBuilder(connectionProvider, outputChannel, context);
        this.sqlExecutionService = new SqlExecutionService(connectionProvider, outputChannel);
        
        // Load persisted conversation states
        this.loadConversationStates();
    }

    /**
     * Main chat request handler
     */
    async handleChatRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<SqlChatResult> {
        const conversationId = this.getConversationId(context);
        
        try {
            // Get or create conversation state
            let conversationState = this.conversationStates.get(conversationId);
            if (!conversationState) {
                conversationState = {
                    lastActivity: Date.now()
                };
                this.conversationStates.set(conversationId, conversationState);
            }

            // Update last activity
            conversationState.lastActivity = Date.now();

            // Handle connection context setup if not present
            if (!conversationState.connectionContext) {
                const connectionContext = await this.resolveConnectionContext();
                if (!connectionContext) {
                    stream.markdown('❌ No active database connections found.\n\n');
                    
                    // Offer to open connection manager
                    stream.button({
                        command: 'mssqlManager.manageConnections',
                        title: vscode.l10n.t('Manage Connections'),
                        arguments: []
                    });
                    
                    stream.markdown('\nPlease connect to a database using the button above or the MS SQL Manager extension.');
                    
                    return {
                        metadata: {
                            command: request.command
                        }
                    };
                }
                conversationState.connectionContext = connectionContext;
            }

            // Build or refresh schema context if needed
            if (!conversationState.schemaContext || this.shouldRefreshSchema(conversationState)) {
                stream.progress('Loading database schema...');
                conversationState.schemaContext = await this.schemaContextBuilder.buildSchemaContext(
                    conversationState.connectionContext.connectionId,
                    conversationState.connectionContext.database
                );
            }

            // Persist conversation state
            await this.saveConversationStates();

            // Process the user's query based on command
            await this.processUserQuery(request, context, conversationState, stream, token);
            
            return {
                metadata: {
                    command: request.command,
                    connectionId: conversationState.connectionContext.connectionId,
                    database: conversationState.connectionContext.database
                }
            };

        } catch (error) {
            this.outputChannel.appendLine(`[SqlChatHandler] Error handling chat request: ${error}`);
            stream.markdown(`❌ An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`);
            
            return {
                metadata: {
                    command: request.command
                }
            };
        }
    }

    /**
     * Process user's SQL-related query
     */
    private async processUserQuery(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        conversationState: ChatConversationState,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const prompt = request.prompt;
        
        // Add database context at the beginning of conversation
        if (!request.command && conversationState.schemaContext) {
            // Show schema summary to help Copilot understand the database structure
            const schema = conversationState.schemaContext;
            const tableCount = (schema.match(/CREATE TABLE/g) || []).length;
            const viewCount = (schema.match(/-- VIEWS \((\d+)\)/)?.[1]) || '0';
            const procCount = (schema.match(/-- STORED PROCEDURES \((\d+)\)/)?.[1]) || '0';
            
            stream.markdown(`📊 **Database:** ${conversationState.connectionContext?.database || 'Unknown'}\n`);
        }
        
        // Handle specific commands
        if (request.command) {
            switch (request.command) {
                case 'explain':
                    return this.handleExplainCommand(prompt, conversationState, stream);
                case 'optimize':
                    return this.handleOptimizeCommand(prompt, conversationState, stream);
                case 'schema':
                    return this.handleSchemaCommand(prompt, conversationState, stream);
            }
        }
        
        // Prepare context for the language model
        const systemPrompt = this.buildSystemPrompt(conversationState);
        
        // Check if this looks like a request for SQL generation
        const lowerPrompt = prompt.toLowerCase();
        const isSqlRequest = this.isSqlGenerationRequest(lowerPrompt);
        
        if (isSqlRequest) {
            stream.progress('Processing...');
            
            // Use VS Code's language model API to generate SQL
            const response = await this.generateSqlWithLanguageModel(systemPrompt, prompt, context, token);
            
            if (response) {
                // Extract SQL from response
                const sqlQueries = this.extractSqlQueries(response);
                
                if (sqlQueries.length > 0) {
                    // Check if user explicitly requested execution in editor
                    const executionKeywords = ['wykonaj', 'execute', 'run', 'uruchom', 'open'];
                    const requestsEditorExecution = executionKeywords.some(keyword => lowerPrompt.includes(keyword));
                    
                    stream.markdown(`Here's the SQL query for your request:\n\n`);
                    
                    for (const sql of sqlQueries) {
                        // Show the SQL with syntax highlighting
                        stream.markdown('```sql\n' + sql + '\n```\n');
                        
                        // Check if this is a SELECT query
                        const queryType = sql.trim().toUpperCase();
                        const isSelect = queryType.startsWith('SELECT') || queryType.startsWith('WITH');
                        
                        if (requestsEditorExecution && conversationState.connectionContext) {
                            // User explicitly requested execution - open in SQL editor, execute, and show results in chat
                            stream.progress('Opening query in SQL editor and executing...');
                            try {
                                // Execute in editor (opens SQL editor with query and runs it)
                                await this.executeQueryInEditorFromChat(sql, conversationState.connectionContext);
                                
                                // Also get results to display in chat for analysis
                                stream.progress('Retrieving results...');
                                const results = await this.executeChatGeneratedQuery(sql, conversationState.connectionContext);
                                
                                stream.markdown('\n✅ Query opened and executed in SQL editor\n');
                                stream.markdown('\n---\n\n');
                                stream.markdown(results);
                            } catch (error) {
                                stream.markdown(`\n\n❌ Failed to execute query: ${error instanceof Error ? error.message : 'Unknown error'}`);
                            }
                        } else if (isSelect && conversationState.connectionContext) {
                            // Auto-execute SELECT queries in chat
                            stream.progress('Executing query...');
                            
                            try {
                                // Execute the query automatically and show results in chat
                                const result = await this.executeChatGeneratedQuery(sql, conversationState.connectionContext);
                                
                                // Show results in chat
                                stream.markdown('\n---\n\n');
                                stream.markdown(result);
                            } catch (error) {
                                stream.markdown(`\n\n❌ Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                            }
                        }
                        
                        // Add action buttons
                        stream.button({
                            command: 'mssqlManager.executeChatGeneratedQuery',
                            title: isSelect ? 'Re-execute Query' : 'Execute Query',
                            arguments: [sql, conversationState.connectionContext, request, stream]
                        });
                        
                        stream.button({
                            command: 'mssqlManager.insertChatGeneratedQuery',
                            title: 'Insert to Editor',
                            arguments: [sql, conversationState.connectionContext]
                        });
                    }
                } else {
                    stream.markdown(response);
                }
            }
        } else {
            // General SQL assistance or explanation
            stream.progress('Analyzing your request...');
            const response = await this.generateSqlWithLanguageModel(systemPrompt, prompt, context, token);
            if (response) {
                stream.markdown(response);
            }
        }
    }

    /**
     * Resolve connection context by checking active connections
     */
    private async resolveConnectionContext(): Promise<ChatConnectionContext | null> {
        const activeConnections = this.connectionProvider.getActiveConnections();
        
        if (activeConnections.length === 0) {
            return null;
        }

        if (activeConnections.length === 1) {
            const connection = activeConnections[0];
            const config = this.connectionProvider.getConnectionConfig(connection.id);
            
            if (config?.connectionType === 'server') {
                // Server connection - need to ask for database
                const databases = await this.getDatabasesForConnection(connection.id);
                if (databases.length === 0) {
                    return { connectionId: connection.id, timestamp: Date.now() };
                }

                const selectedDb = await vscode.window.showQuickPick(
                    databases.map(db => ({ label: db, description: 'Database' })),
                    { 
                        placeHolder: 'Select a database for the chat session',
                        title: 'Database Selection for @sql Chat'
                    }
                );

                if (!selectedDb) {
                    return null;
                }

                return {
                    connectionId: connection.id,
                    database: selectedDb.label,
                    timestamp: Date.now()
                };
            } else {
                // Direct database connection
                return {
                    connectionId: connection.id,
                    database: config?.database,
                    timestamp: Date.now()
                };
            }
        } else {
            // Multiple connections - let user choose
            const connectionItems = activeConnections.map(conn => {
                const config = this.connectionProvider.getConnectionConfig(conn.id);
                return {
                    label: config?.name || conn.name,
                    description: config?.connectionType === 'server' ? 
                        `Server: ${config?.server || 'Unknown'}` : 
                        `Database: ${config?.database || 'Unknown'} on ${config?.server || 'Unknown'}`,
                    connectionId: conn.id,
                    config
                };
            });

            const selectedConnection = await vscode.window.showQuickPick(connectionItems, {
                placeHolder: 'Select a connection for the chat session',
                title: 'Connection Selection for @sql Chat'
            });

            if (!selectedConnection) {
                return null;
            }

            // If server connection, also ask for database
            if (selectedConnection.config?.connectionType === 'server') {
                const databases = await this.getDatabasesForConnection(selectedConnection.connectionId);
                if (databases.length === 0) {
                    return { 
                        connectionId: selectedConnection.connectionId, 
                        timestamp: Date.now() 
                    };
                }

                const selectedDb = await vscode.window.showQuickPick(
                    databases.map(db => ({ label: db, description: 'Database' })),
                    { 
                        placeHolder: 'Select a database for the chat session',
                        title: 'Database Selection for @sql Chat'
                    }
                );

                if (!selectedDb) {
                    return null;
                }

                return {
                    connectionId: selectedConnection.connectionId,
                    database: selectedDb.label,
                    timestamp: Date.now()
                };
            } else {
                return {
                    connectionId: selectedConnection.connectionId,
                    database: selectedConnection.config?.database,
                    timestamp: Date.now()
                };
            }
        }
    }

    /**
     * Get list of databases for a connection
     */
    private async getDatabasesForConnection(connectionId: string): Promise<string[]> {
        try {
            const pool = this.connectionProvider.getConnection(connectionId);
            if (!pool) {
                return [];
            }

            const result = await pool.request().query(`SELECT name FROM sys.databases WHERE state = 0 ORDER BY name`);
            return result.recordset.map((row: any) => row.name);
        } catch (error) {
            this.outputChannel.appendLine(`[SqlChatHandler] Error getting databases: ${error}`);
            return [];
        }
    }

    /**
     * Build system prompt with schema context
     */
    private buildSystemPrompt(conversationState: ChatConversationState): string {
        const connection = conversationState.connectionContext;
        const config = connection ? this.connectionProvider.getConnectionConfig(connection.connectionId) : null;
        
        let prompt = `You are a SQL expert assistant for Microsoft SQL Server. You help users write SQL queries and understand database schemas.

Current Connection Context:
- Server: ${config?.server || 'Unknown'}
- Database: ${connection?.database || 'Not specified'}
- Connection Type: ${config?.connectionType || 'Unknown'}

Database Schema:
${conversationState.schemaContext || 'Schema information not available'}

IMPORTANT - Query Execution:
- You HAVE direct access to execute SQL queries in the connected database
- When user asks to "execute", "run", "show results", or "get data" - ALWAYS generate the SQL query
- Users can click "Execute Query" button to run the query and see results
- ALWAYS wrap SQL queries in \`\`\`sql code blocks

Guidelines:
1. Generate valid T-SQL (Microsoft SQL Server) syntax
2. Use proper table and column names from the schema above
3. Prefer explicit column names over SELECT *
4. Add appropriate WHERE clauses for better performance
5. Use proper JOIN syntax when working with multiple tables
6. Consider adding appropriate indexes suggestions when relevant
7. For SELECT queries, provide them so user can execute with the button
8. For INSERT/UPDATE/DELETE/DDL operations, ask for user confirmation first

When generating SQL:
- Always use the exact table and column names from the schema
- Use proper schema prefixes (e.g., dbo.TableName)
- Consider query performance and add appropriate filters
- Explain complex queries and suggest optimizations when appropriate
- ALWAYS wrap SQL in \`\`\`sql code blocks so Execute Query button appears
`;

        return prompt;
    }

    /**
     * Handle the explain command
     */
    private async handleExplainCommand(
        prompt: string,
        conversationState: ChatConversationState,
        stream: vscode.ChatResponseStream
    ): Promise<void> {
        stream.markdown(`🔍 **Explaining SQL Query**\n\n`);
        
        const queries = this.extractSqlQueries(prompt);
        const sqlQuery = queries.length > 0 ? queries[0] : prompt;
        
        if (sqlQuery) {
            stream.markdown('```sql\n' + sqlQuery + '\n```\n');
            stream.markdown('**Query Explanation:**\n');
            
            // Basic SQL analysis
            const explanation = this.analyzeSqlQuery(sqlQuery);
            stream.markdown(explanation);
        } else {
            stream.markdown('Please provide a SQL query to explain.');
        }
    }

    /**
     * Handle the optimize command
     */
    private async handleOptimizeCommand(
        prompt: string,
        conversationState: ChatConversationState,
        stream: vscode.ChatResponseStream
    ): Promise<void> {
        stream.markdown(`⚡ **Optimizing SQL Query**\n\n`);
        
        const queries = this.extractSqlQueries(prompt);
        const sqlQuery = queries.length > 0 ? queries[0] : prompt;
        
        if (sqlQuery) {
            stream.markdown('**Original Query:**\n');
            stream.markdown('```sql\n' + sqlQuery + '\n```\n');
            
            stream.markdown('**Optimization Suggestions:**\n');
            const suggestions = this.getOptimizationSuggestions(sqlQuery);
            stream.markdown(suggestions);
        } else {
            stream.markdown('Please provide a SQL query to optimize.');
        }
    }

    /**
     * Handle the schema command
     */
    private async handleSchemaCommand(
        prompt: string,
        conversationState: ChatConversationState,
        stream: vscode.ChatResponseStream
    ): Promise<void> {
        stream.markdown(`📋 **Database Schema Information**\n\n`);
        stream.markdown(`**Database:** ${conversationState.connectionContext!.database}\n\n`);
        
        if (prompt.trim()) {
            // User is asking about specific tables/objects
            const tables = this.findTablesInSchema(prompt, conversationState.schemaContext!);
            if (tables.length > 0) {
                stream.markdown('**Matching Tables:**\n');
                stream.markdown('```sql\n' + tables.join('\n\n') + '\n```');
            } else {
                stream.markdown('No tables found matching your query.');
            }
        } else {
            // Show full schema
            stream.markdown('**Complete Schema:**\n');
            stream.markdown('```sql\n' + conversationState.schemaContext + '\n```');
        }
    }

    /**
     * Analyze a SQL query and provide explanation
     */
    private analyzeSqlQuery(sql: string): string {
        const explanation = [];
        const upperSql = sql.toUpperCase();
        
        if (upperSql.includes('SELECT')) {
            explanation.push('• This is a SELECT query that retrieves data from the database');
        }
        if (upperSql.includes('JOIN')) {
            explanation.push('• Uses JOIN operations to combine data from multiple tables');
        }
        if (upperSql.includes('WHERE')) {
            explanation.push('• Applies filtering conditions with WHERE clause');
        }
        if (upperSql.includes('GROUP BY')) {
            explanation.push('• Groups results by specified columns');
        }
        if (upperSql.includes('ORDER BY')) {
            explanation.push('• Sorts results by specified columns');
        }
        if (upperSql.includes('INSERT')) {
            explanation.push('• This is an INSERT query that adds new data to the database');
        }
        if (upperSql.includes('UPDATE')) {
            explanation.push('• This is an UPDATE query that modifies existing data');
        }
        if (upperSql.includes('DELETE')) {
            explanation.push('• This is a DELETE query that removes data from the database');
        }
        
        return explanation.length > 0 ? explanation.join('\n') : 'This appears to be a basic SQL query.';
    }

    /**
     * Provide optimization suggestions for a SQL query
     */
    private getOptimizationSuggestions(sql: string): string {
        const suggestions = [];
        const upperSql = sql.toUpperCase();
        
        if (upperSql.includes('SELECT *')) {
            suggestions.push('• Consider specifying explicit column names instead of SELECT *');
        }
        if (!upperSql.includes('WHERE') && upperSql.includes('SELECT')) {
            suggestions.push('• Consider adding WHERE clause to filter results and improve performance');
        }
        if (upperSql.includes('JOIN') && !upperSql.includes('ON')) {
            suggestions.push('• Ensure proper JOIN conditions are specified with ON clause');
        }
        if (!upperSql.includes('INDEX') && upperSql.includes('WHERE')) {
            suggestions.push('• Consider adding indexes on columns used in WHERE clauses');
        }
        
        return suggestions.length > 0 ? 
            suggestions.join('\n') : 
            'This query looks well-structured. Consider adding indexes on frequently queried columns for better performance.';
    }

    /**
     * Find tables in schema that match the query
     */
    private findTablesInSchema(query: string, schemaContext: string): string[] {
        const lines = schemaContext.split('\n');
        const matchingTables = [];
        let currentTable = '';
        let inTable = false;
        
        for (const line of lines) {
            if (line.trim().startsWith('CREATE TABLE')) {
                const tableName = line.match(/CREATE TABLE \[?(\w+)\]?/i);
                if (tableName && tableName[1].toLowerCase().includes(query.toLowerCase())) {
                    inTable = true;
                    currentTable = line;
                } else {
                    inTable = false;
                }
            } else if (inTable) {
                currentTable += '\n' + line;
                if (line.trim() === ');') {
                    matchingTables.push(currentTable);
                    inTable = false;
                    currentTable = '';
                }
            }
        }
        
        return matchingTables;
    }

    /**
     * Check if the prompt is requesting SQL generation
     */
    private isSqlGenerationRequest(prompt: string): boolean {
        const sqlKeywords = [
            'select', 'insert', 'update', 'delete', 'create', 'alter', 'drop',
            'query', 'find', 'show', 'get', 'list', 'count', 'sum', 'avg',
            'join', 'where', 'group by', 'order by', 'top', 'distinct',
            'execute', 'run', 'wykonaj', 'uruchom'
        ];

        const sqlPhrases = [
            'write a query', 'generate sql', 'create query', 'sql for',
            'how to select', 'how to find', 'show me', 'give me',
            'execute query', 'run query', 'wykonaj zapytanie', 'uruchom',
            'show results', 'get results', 'pokaż wyniki'
        ];

        return sqlKeywords.some(keyword => prompt.includes(keyword)) ||
               sqlPhrases.some(phrase => prompt.includes(phrase));
    }

    /**
     * Generate SQL using VS Code's language model
     */
    private async generateSqlWithLanguageModel(
        systemPrompt: string,
        userPrompt: string,
        context: vscode.ChatContext,
        token: vscode.CancellationToken
    ): Promise<string | null> {
        try {
            // Check if language model is available
            const models = await vscode.lm.selectChatModels();
            if (models.length === 0) {
                return 'No language models available. Please install GitHub Copilot or another compatible language model provider.';
            }

            const model = models[0];
            const messages: vscode.LanguageModelChatMessage[] = [
                vscode.LanguageModelChatMessage.User(systemPrompt)
            ];

            // Add conversation history for context continuity
            for (const turn of context.history) {
                if (turn instanceof vscode.ChatRequestTurn) {
                    messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
                } else if (turn instanceof vscode.ChatResponseTurn) {
                    // Extract text content from response
                    const responseText = turn.response.map(part => {
                        if (part instanceof vscode.ChatResponseMarkdownPart) {
                            return typeof part.value === 'string' ? part.value : part.value.value;
                        }
                        return '';
                    }).join('\n');
                    
                    if (responseText.trim()) {
                        messages.push(vscode.LanguageModelChatMessage.Assistant(responseText));
                    }
                }
            }

            // Add current user request
            messages.push(vscode.LanguageModelChatMessage.User('User Request: ' + userPrompt));

            const chatResponse = await model.sendRequest(messages, {}, token);
            
            let response = '';
            for await (const fragment of chatResponse.text) {
                if (token.isCancellationRequested) {
                    break;
                }
                response += fragment;
            }

            return response;
        } catch (error) {
            this.outputChannel.appendLine(`[SqlChatHandler] Language model error: ${error}`);
            return `Error generating response: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    /**
     * Extract SQL queries from response text
     */
    private extractSqlQueries(response: string): string[] {
        const sqlQueries: string[] = [];
        
        // Look for SQL code blocks
        const codeBlockRegex = /```sql\s*\n([\s\S]*?)\n```/gi;
        let match;
        
        while ((match = codeBlockRegex.exec(response)) !== null) {
            const sql = match[1].trim();
            if (sql) {
                sqlQueries.push(sql);
            }
        }

        // If no code blocks found, try to detect SQL statements
        if (sqlQueries.length === 0) {
            const lines = response.split('\n');
            let currentQuery = '';
            let inQuery = false;

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) {
                    continue;
                }

                // Check if this line starts a SQL statement
                const startsWithSql = /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|DECLARE|SET)\s/i.test(trimmedLine);
                
                if (startsWithSql) {
                    if (currentQuery) {
                        sqlQueries.push(currentQuery.trim());
                    }
                    currentQuery = line;
                    inQuery = true;
                } else if (inQuery && (trimmedLine.endsWith(';') || trimmedLine.toLowerCase() === 'go')) {
                    currentQuery += '\n' + line;
                    sqlQueries.push(currentQuery.trim());
                    currentQuery = '';
                    inQuery = false;
                } else if (inQuery) {
                    currentQuery += '\n' + line;
                }
            }

            if (currentQuery && inQuery) {
                sqlQueries.push(currentQuery.trim());
            }
        }

        return sqlQueries;
    }



    /**
     * Check if schema should be refreshed
     */
    private shouldRefreshSchema(conversationState: ChatConversationState): boolean {
        if (!conversationState.connectionContext) {
            return false;
        }
        
        // Refresh schema if it's older than 30 minutes
        const schemaAge = Date.now() - conversationState.connectionContext.timestamp;
        return schemaAge > 30 * 60 * 1000; // 30 minutes
    }

    /**
     * Get conversation ID from context
     */
    private getConversationId(context: vscode.ChatContext): string {
        // Use the conversation history to generate a unique ID
        return context.history.length > 0 ? 
            `conv_${Math.abs(JSON.stringify(context.history).split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0))}` :
            `conv_${Date.now()}`;
    }

    /**
     * Load persisted conversation states
     */
    private loadConversationStates(): void {
        const saved = this.context.globalState.get<Record<string, ChatConversationState>>('mssqlManager.chatConversations', {});
        
        // Clean up old conversations (older than 7 days)
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        
        for (const [id, state] of Object.entries(saved)) {
            if (state.lastActivity > weekAgo) {
                this.conversationStates.set(id, state);
            }
        }
    }

    /**
     * Save conversation states to persistent storage
     */
    private async saveConversationStates(): Promise<void> {
        const toSave: Record<string, ChatConversationState> = {};
        
        for (const [id, state] of this.conversationStates.entries()) {
            toSave[id] = state;
        }
        
        await this.context.globalState.update('mssqlManager.chatConversations', toSave);
    }

    /**
     * Clear conversation context (useful for testing or manual reset)
     */
    async clearConversationContext(conversationId?: string): Promise<void> {
        if (conversationId) {
            this.conversationStates.delete(conversationId);
        } else {
            this.conversationStates.clear();
        }
        await this.saveConversationStates();
    }

    /**
     * Set connection context for conversation (useful for tree view integration)
     */
    setConnectionContext(conversationId: string, connectionId: string, database?: string): void {
        let state = this.conversationStates.get(conversationId);
        if (!state) {
            state = { lastActivity: Date.now() };
            this.conversationStates.set(conversationId, state);
        }

        state.connectionContext = {
            connectionId,
            database,
            timestamp: Date.now()
        };

        // Clear schema context to force refresh with new connection
        state.schemaContext = undefined;

        this.saveConversationStates();
    }

    /**
     * Execute a chat-generated SQL query and return results for chat display
     */
    async executeChatGeneratedQuery(sql: string, connectionContext: ChatConnectionContext): Promise<string> {
        try {
            const result = await this.sqlExecutionService.executeSqlQuery(sql, connectionContext, {
                autoExecute: true,
                showResults: true
            });

            if (result.success && result.result) {
                // Format result summary for chat
                const summary = this.formatQueryResultsForChat(result.result);
                return summary;
            } else if (!result.wasExecuted) {
                return '❌ Query execution was cancelled by user.';
            } else {
                return `❌ Query execution failed: ${result.error}`;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.outputChannel.appendLine(`[SqlChatHandler] Query execution error: ${errorMessage}`);
            return `❌ Failed to execute query: ${errorMessage}`;
        }
    }

    /**
     * Execute query in SQL editor (opens editor with query and executes it)
     */
    async executeQueryInEditorFromChat(sql: string, connectionContext: ChatConnectionContext): Promise<void> {
        try {
            await this.sqlExecutionService.executeQueryInEditor(sql, connectionContext);
            vscode.window.showInformationMessage('Query opened and executed in SQL editor');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.outputChannel.appendLine(`[SqlChatHandler] Execute in editor error: ${errorMessage}`);
            vscode.window.showErrorMessage(`Failed to execute query in editor: ${errorMessage}`);
        }
    }

    /**
     * Format query results for display in chat
     */
    private formatQueryResultsForChat(result: any): string {
        let summary = '✅ **Query executed successfully!**\n\n';
        
        // Add execution time
        if (result.executionTime) {
            summary += `⏱️ Execution time: ${result.executionTime}ms\n\n`;
        }
        
        // Check for returned rows
        if (result.recordsets && result.recordsets.length > 0) {
            const recordset = result.recordsets[0];
            const rowCount = recordset.length;
            
            summary += `📊 **Results:** ${rowCount} row(s) returned\n\n`;
            
            if (rowCount > 0) {
                // Show column names
                const columns = Object.keys(recordset[0]);
                summary += `**Columns:** ${columns.join(', ')}\n\n`;
                
                // Show sample of first few rows
                const sampleSize = Math.min(5, rowCount);
                if (rowCount <= 5) {
                    summary += `**All ${rowCount} row(s):**\n`;
                } else {
                    summary += `**First ${sampleSize} rows (of ${rowCount} total):**\n`;
                }
                
                for (let i = 0; i < sampleSize; i++) {
                    const row = recordset[i];
                    summary += `\nRow ${i + 1}:\n`;
                    for (const col of columns) {
                        const value = row[col];
                        const displayValue = value === null ? 'NULL' : 
                                           value === undefined ? 'undefined' :
                                           typeof value === 'object' ? JSON.stringify(value) :
                                           String(value);
                        summary += `  • ${col}: ${displayValue}\n`;
                    }
                }
                
                if (rowCount > 5) {
                    summary += `\n... and ${rowCount - 5} more row(s)\n`;
                }
            }
        } else if (result.rowsAffected) {
            // For INSERT/UPDATE/DELETE queries
            const totalAffected = result.rowsAffected.reduce((sum: number, count: number) => sum + count, 0);
            summary += `✏️ **Rows affected:** ${totalAffected}\n`;
        } else {
            summary += '✅ Query completed successfully (no rows returned)\n';
        }
        
        return summary;
    }

    /**
     * Insert a chat-generated SQL query into the active editor
     */
    async insertChatGeneratedQuery(sql: string, connectionContext?: ChatConnectionContext): Promise<void> {
        await this.insertQueryToEditor(sql, connectionContext);
    }

    /**
     * Insert query into active editor
     */
    async insertQueryToEditor(sql: string, connectionContext?: ChatConnectionContext): Promise<void> {
        try {
            await this.sqlExecutionService.insertQueryToEditor(sql, connectionContext);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.outputChannel.appendLine(`[SqlChatHandler] Insert query error: ${errorMessage}`);
            throw error;
        }
    }
}