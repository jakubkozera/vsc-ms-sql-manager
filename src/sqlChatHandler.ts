import * as vscode from 'vscode';
import { ConnectionProvider, ConnectionConfig } from './connectionProvider';
import { SchemaContextBuilder } from './schemaContextBuilder';
import { SqlExecutionService } from './sqlExecutionService';
import { DatabaseInstructionsManager } from './databaseInstructions';
import { QueryHistoryManager } from './queryHistory';

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

interface BatchSqlToolQuery {
    label?: string;
    sql: string;
}

export class SqlChatHandler {
    private conversationStates = new Map<string, ChatConversationState>();
    private schemaContextBuilder: SchemaContextBuilder;
    private sqlExecutionService: SqlExecutionService;
    private databaseInstructionsManager: DatabaseInstructionsManager;

    constructor(
        private context: vscode.ExtensionContext,
        private connectionProvider: ConnectionProvider,
        private outputChannel: vscode.OutputChannel,
        databaseInstructionsManager: DatabaseInstructionsManager,
        private historyManager: QueryHistoryManager
    ) {
        this.databaseInstructionsManager = databaseInstructionsManager;
        this.schemaContextBuilder = new SchemaContextBuilder(connectionProvider, outputChannel, context);
        this.sqlExecutionService = new SqlExecutionService(connectionProvider, outputChannel, historyManager, context);
        this.databaseInstructionsManager = databaseInstructionsManager;

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
        this.outputChannel.appendLine(`[SqlChatHandler] processUserQuery called with prompt: ${request.prompt}`);
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

        // Use agentic tool-calling approach for all general queries
        await this.handleAgenticRequest(request, context, conversationState, stream, token);
    }

    /**
     * Handle a request using the agentic tool-calling loop.
     * The LLM can execute SQL queries via tools, analyze results, and iterate.
     */
    private async handleAgenticRequest(
        request: vscode.ChatRequest,
        chatContext: vscode.ChatContext,
        conversationState: ChatConversationState,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const systemPrompt = await this.buildSystemPrompt(conversationState);

        // Define available tools for the LLM
        const tools: vscode.LanguageModelChatTool[] = [
            {
                name: 'run_sql_batch',
                description: 'Execute multiple T-SQL queries in one batch against the connected Microsoft SQL Server database and return structured results for each query. Prefer this tool over single-query execution whenever you can prepare several independent exploratory, counting, validation, or summary queries up front. Use it to reduce agent iterations and gather all required facts before drawing conclusions.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        queries: {
                            type: 'array',
                            description: 'A list of queries to execute in one batch. Each item should contain a SQL statement and optionally a short label describing what the query is checking.',
                            items: {
                                type: 'object',
                                properties: {
                                    label: {
                                        type: 'string',
                                        description: 'Short label describing the purpose of this query'
                                    },
                                    sql: {
                                        type: 'string',
                                        description: 'The T-SQL query to execute'
                                    }
                                },
                                required: ['sql']
                            }
                        }
                    },
                    required: ['queries']
                }
            },
            {
                name: 'run_sql_query',
                description: 'Execute one T-SQL query against the connected Microsoft SQL Server database and return results. Use this only when a single follow-up query is truly needed after you already gathered most facts, or when the next query depends on previous results and cannot be planned up front. For independent exploratory work, prefer run_sql_batch.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sql: {
                            type: 'string',
                            description: 'The T-SQL query to execute against the connected database'
                        }
                    },
                    required: ['sql']
                }
            }
        ];

        // Build initial messages
        const messages: vscode.LanguageModelChatMessage[] = [
            vscode.LanguageModelChatMessage.User(systemPrompt)
        ];

        // Add conversation history
        for (const turn of chatContext.history) {
            if (turn instanceof vscode.ChatRequestTurn) {
                messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
            } else if (turn instanceof vscode.ChatResponseTurn) {
                const responseText = turn.response.map(part => {
                    if (part instanceof vscode.ChatResponseMarkdownPart) {
                        return typeof part.value === 'string' ? part.value : part.value.value;
                    }
                    return '';
                }).join('');
                if (responseText.trim()) {
                    messages.push(vscode.LanguageModelChatMessage.Assistant(responseText));
                }
            }
        }

        // Add current user prompt
        messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

        const model = request.model;
        const maxRounds = 15;
        let rounds = 0;

        const runWithTools = async (): Promise<void> => {
            if (rounds >= maxRounds) {
                stream.markdown('\n\n⚠️ Reached the maximum number of agent rounds. Try asking the next step as a follow-up if more analysis is needed.\n');
                return;
            }

            rounds++;

            const options: vscode.LanguageModelChatRequestOptions = {
                tools,
                justification: 'Analyzing database and executing SQL queries to answer your question'
            };

            const response = await model.sendRequest(messages, options, token);

            const toolCalls: vscode.LanguageModelToolCallPart[] = [];
            let responseText = '';

            for await (const part of response.stream) {
                if (token.isCancellationRequested) { break; }

                if (part instanceof vscode.LanguageModelTextPart) {
                    stream.markdown(part.value);
                    responseText += part.value;
                } else if (part instanceof vscode.LanguageModelToolCallPart) {
                    toolCalls.push(part);
                }
            }

            if (toolCalls.length && !token.isCancellationRequested) {
                // Add assistant message with tool calls to message history
                const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
                if (responseText) {
                    assistantParts.push(new vscode.LanguageModelTextPart(responseText));
                }
                assistantParts.push(...toolCalls);
                messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

                // Process each tool call
                for (const call of toolCalls) {
                    if (call.name === 'run_sql_batch') {
                        const input = call.input as { queries: BatchSqlToolQuery[] };

                        for (const [index, query] of (input.queries ?? []).entries()) {
                            const title = query.label?.trim() || `Query ${index + 1}`;
                            stream.markdown(`\n**${title}**\n\n`);
                            stream.markdown('```sql\n' + query.sql + '\n```\n');
                        }
                        stream.progress('Executing query batch...');

                        let resultText: string;
                        try {
                            resultText = await this.executeQueryBatchForTool(input.queries ?? [], conversationState, stream);
                            const summaryLine = resultText.split('\n')[0];
                            stream.markdown(summaryLine + '\n\n');
                        } catch (error) {
                            resultText = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
                            stream.markdown('❌ ' + resultText + '\n\n');
                        }

                        messages.push(vscode.LanguageModelChatMessage.User([
                            new vscode.LanguageModelToolResultPart(call.callId, [
                                new vscode.LanguageModelTextPart(resultText)
                            ])
                        ]));
                    } else if (call.name === 'run_sql_query') {
                        const input = call.input as { sql: string };

                        // Display SQL to user
                        stream.markdown('\n```sql\n' + input.sql + '\n```\n');
                        stream.progress('Executing query...');

                        let resultText: string;
                        try {
                            resultText = await this.executeQueryForTool(input.sql, conversationState);
                            // Show brief result summary to user
                            const summaryLine = resultText.split('\n')[0];
                            stream.markdown(summaryLine + '\n\n');

                            // Add execute/insert buttons
                            if (conversationState.connectionContext) {
                                stream.button({
                                    command: 'mssqlManager.executeChatGeneratedQuery',
                                    title: '▶️ Open in SQL Editor',
                                    arguments: [input.sql, conversationState.connectionContext]
                                });
                            }
                        } catch (error) {
                            resultText = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
                            stream.markdown('❌ ' + resultText + '\n\n');
                        }

                        // Add tool result to messages for LLM analysis
                        messages.push(vscode.LanguageModelChatMessage.User([
                            new vscode.LanguageModelToolResultPart(call.callId, [
                                new vscode.LanguageModelTextPart(resultText)
                            ])
                        ]));
                    } else {
                        // Unknown tool
                        messages.push(vscode.LanguageModelChatMessage.User([
                            new vscode.LanguageModelToolResultPart(call.callId, [
                                new vscode.LanguageModelTextPart(`Unknown tool: ${call.name}`)
                            ])
                        ]));
                    }
                }

                // Continue the agentic loop
                return runWithTools();
            }
        };

        await runWithTools();
    }

    /**
     * Execute multiple SQL queries for the tool and return aggregated results for LLM analysis.
     */
    private async executeQueryBatchForTool(
        queries: BatchSqlToolQuery[],
        conversationState: ChatConversationState,
        stream: vscode.ChatResponseStream
    ): Promise<string> {
        if (queries.length === 0) {
            throw new Error('Batch query list is empty. Provide at least one SQL query.');
        }

        const normalizedQueries = queries
            .map(query => ({
                label: query.label?.trim(),
                sql: query.sql?.trim()
            }))
            .filter(query => !!query.sql);

        if (normalizedQueries.length === 0) {
            throw new Error('Batch query list is empty after validation. Provide valid SQL queries.');
        }

        const startTime = Date.now();
        const results: string[] = [];

        for (let index = 0; index < normalizedQueries.length; index++) {
            const query = normalizedQueries[index];
            stream.progress(`Executing query ${index + 1} of ${normalizedQueries.length}...`);
            const result = await this.executeQueryForTool(query.sql!, conversationState, false);
            const title = query.label || `Query ${index + 1}`;
            results.push(`### ${title}\n${result}`);
        }

        const elapsed = Date.now() - startTime;
        return `✅ Batch executed successfully. ${normalizedQueries.length} query(s) finished in ${elapsed}ms\n\n${results.join('\n\n')}`;
    }

    /**
     * Execute a SQL query for the tool and return formatted results for LLM analysis
     */
    private async executeQueryForTool(
        sql: string,
        conversationState: ChatConversationState,
        includeExecutionHeader = true
    ): Promise<string> {
        const connectionContext = conversationState.connectionContext;

        if (!connectionContext) {
            throw new Error('No active database connection. Please reconnect.');
        }

        const pool = this.connectionProvider.getConnection(connectionContext.connectionId);

        if (!pool) {
            throw new Error('No active database connection. Please reconnect.');
        }

        const startTime = Date.now();

        // Add database context if needed
        let fullSql = sql;
        if (connectionContext.database) {
            fullSql = `USE [${connectionContext.database}];\n${sql}`;
        }

        const result = await pool.request().query(fullSql);
        const elapsed = Date.now() - startTime;

        let output = '';

        // Find the meaningful recordset (skip USE result if present)
        const recordsets = result.recordsets || [];
        const recordset = connectionContext.database && recordsets.length > 1
            ? recordsets[recordsets.length - 1]
            : recordsets[0];

        if (recordset && recordset.length > 0) {
            const rowCount = recordset.length;
            if (includeExecutionHeader) {
                output += `✅ ${rowCount} row(s) returned (${elapsed}ms)\n`;
            } else {
                output += `Rows: ${rowCount} (${elapsed}ms)\n`;
            }

            // Format as JSON for LLM analysis (limit rows)
            const maxRows = Math.min(100, rowCount);
            const data = recordset.slice(0, maxRows);
            const columns = Object.keys(data[0]);
            output += `Columns: ${columns.join(', ')}\n`;
            output += `Data (JSON):\n${JSON.stringify(data, null, 2)}`;

            if (rowCount > maxRows) {
                output += `\n\n(Showing first ${maxRows} of ${rowCount} total rows)`;
            }
        } else if (recordset && recordset.length === 0) {
            output += includeExecutionHeader
                ? `✅ Query executed successfully. 0 rows returned (${elapsed}ms)`
                : `Rows: 0 (${elapsed}ms)`;
        } else {
            const affected = result.rowsAffected?.reduce((a: number, b: number) => a + b, 0) || 0;
            output += includeExecutionHeader
                ? `✅ Query executed successfully. Rows affected: ${affected} (${elapsed}ms)`
                : `Rows affected: ${affected} (${elapsed}ms)`;
        }

        return output;
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
    private async buildSystemPrompt(conversationState: ChatConversationState): Promise<string> {
        const connection = conversationState.connectionContext;
        const config = connection ? this.connectionProvider.getConnectionConfig(connection.connectionId) : null;

        this.outputChannel.appendLine(`[SqlChatHandler] Building system prompt for connection: ${connection?.connectionId}, database: ${connection?.database}`);

        let prompt = `You are a SQL expert assistant for Microsoft SQL Server. You help users write SQL queries and understand database schemas.

Current Connection Context:
- Server: ${config?.server || 'Unknown'}
- Database: ${connection?.database || 'Not specified'}
- Connection Type: ${config?.connectionType || 'Unknown'}

Database Schema:
${conversationState.schemaContext || 'Schema information not available'}
`;

        // Add database-specific instructions if available
        if (connection) {
            try {
                // For server connections, database name is separate
                // For database connections, connectionId already includes the database
                const databaseParam = config?.connectionType === 'server' ? connection.database : undefined;

                this.outputChannel.appendLine(`[SqlChatHandler] Loading instructions for connection: ${connection.connectionId}, database: ${databaseParam}, connectionType: ${config?.connectionType}`);
                const instructions = await this.databaseInstructionsManager.loadInstructions(
                    connection.connectionId,
                    databaseParam
                );

                if (instructions) {
                    this.outputChannel.appendLine(`[SqlChatHandler] Loaded instructions (${instructions.length} chars)`);
                    prompt += `\nDatabase-Specific Instructions:
${instructions}
`;
                } else {
                    this.outputChannel.appendLine(`[SqlChatHandler] No instructions found for this connection`);
                }
            } catch (error) {
                this.outputChannel.appendLine(`[SqlChatHandler] Error loading instructions: ${error}`);
            }
        }

        prompt += `
IMPORTANT - Agentic SQL Execution:
- You have access to the 'run_sql_query' tool that executes T-SQL queries against the connected database
- You also have access to the 'run_sql_batch' tool that executes multiple queries in one invocation
- USE the tool proactively to gather data, verify assumptions, and analyze results
- You can call the tool MULTIPLE TIMES in a single conversation to iteratively investigate data
- Preferred strategy: first think through everything you need, then send one batched set of exploratory queries (counts, summaries, validations, breakdowns)
- Prefer 'run_sql_batch' whenever queries are independent and can be planned up front
- Only use 'run_sql_query' for a truly dependent follow-up that could not be known before the previous results
- Always analyze results thoroughly before providing your final answer
- For complex tasks, break them into multiple queries and analyze step by step
- When the user asks for data or analysis - EXECUTE queries with the tool, don't just show SQL
- For INSERT/UPDATE/DELETE/DDL operations, explain what will change and ask for confirmation before executing

Guidelines:
1. Generate valid T-SQL (Microsoft SQL Server) syntax
2. Use proper table and column names from the schema above
3. Prefer explicit column names over SELECT *
4. Add appropriate WHERE clauses for better performance
5. Use proper JOIN syntax when working with multiple tables
6. Use TOP clauses for initial data exploration to avoid overwhelming result sets
7. Use schema prefixes (e.g., dbo.TableName)
8. Avoid using STRING_AGG() - use STUFF(... FOR XML PATH('')) instead for SQL Server 2008+ compatibility
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
            explanation.push('• Uses GROUP BY to aggregate rows by specified columns');
        }
        if (upperSql.includes('ORDER BY')) {
            explanation.push('• Uses ORDER BY to sort results by specified columns');
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
        const normalizedQuery = query.toLowerCase();

        for (const line of lines) {
            if (line.trim().startsWith('CREATE TABLE')) {
                const tableName = line.match(/CREATE TABLE\s+(?:\[[^\]]+\]|\w+)\.(\[[^\]]+\]|\w+)/i)
                    || line.match(/CREATE TABLE\s+(\[[^\]]+\]|\w+)/i);
                const normalizedTableName = tableName?.[1]?.replace(/[\[\]]/g, '').toLowerCase();

                if (normalizedTableName?.includes(normalizedQuery)) {
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
     * Analyze user intent to determine if they want to see query results
     * Uses AI to understand the user's intent rather than relying on keywords
     */
    private async userWantsQueryResults(userPrompt: string, generatedSql: string): Promise<boolean> {
        try {
            // Quick heuristic checks first (performance optimization)
            const lowerPrompt = userPrompt.toLowerCase();

            // If user just wants to see/generate the query structure, don't execute
            const queryDesignKeywords = ['how to', 'syntax', 'example', 'structure', 'template', 'format'];
            if (queryDesignKeywords.some(keyword => lowerPrompt.includes(keyword))) {
                return false;
            }

            // If it's clearly a data modification query (not SELECT), user likely wants to review first
            const sqlUpper = generatedSql.trim().toUpperCase();
            if (sqlUpper.startsWith('INSERT') || sqlUpper.startsWith('UPDATE') ||
                sqlUpper.startsWith('DELETE') || sqlUpper.startsWith('DROP') ||
                sqlUpper.startsWith('ALTER') || sqlUpper.startsWith('CREATE')) {
                return false;
            }

            // Use AI to analyze intent for SELECT queries
            const models = await vscode.lm.selectChatModels();
            if (models.length === 0) {
                // Fallback: assume user wants results for SELECT queries
                return sqlUpper.startsWith('SELECT') || sqlUpper.startsWith('WITH');
            }

            const model = models[0];
            const intentPrompt = `Analyze the user's intent. Does the user want to EXECUTE the query and SEE THE RESULTS, or do they just want to see the query itself?

User's request: "${userPrompt}"

Generated SQL query:
\`\`\`sql
${generatedSql}
\`\`\`

Answer with ONLY "YES" if the user wants to execute and see results (wants data from database), or "NO" if they just want to see the query structure/syntax.

Examples:
- "wykonaj to zapytanie" → YES (execute this query)
- "show me all users" → YES (wants data)
- "find customers from Poland" → YES (wants data)
- "how do I select users?" → NO (wants to learn syntax)
- "what's the syntax for JOIN?" → NO (wants to learn)
- "give me a query that finds..." → NO (wants query, not results yet)

Answer:`;

            const response = await model.sendRequest(
                [vscode.LanguageModelChatMessage.User(intentPrompt)],
                {},
                new vscode.CancellationTokenSource().token
            );

            let answer = '';
            for await (const fragment of response.text) {
                answer += fragment;
            }

            // Parse the response
            const trimmedAnswer = answer.trim().toUpperCase();
            return trimmedAnswer.includes('YES') || trimmedAnswer.startsWith('YES');

        } catch (error) {
            this.outputChannel.appendLine(`[SqlChatHandler] Intent analysis error: ${error}`);
            // Fallback: execute SELECT queries by default
            const sqlUpper = generatedSql.trim().toUpperCase();
            return sqlUpper.startsWith('SELECT') || sqlUpper.startsWith('WITH');
        }
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
        this.outputChannel.appendLine(`[SqlChatHandler] generateSqlWithLanguageModel called`);
        try {
            // Check if language model is available
            this.outputChannel.appendLine(`[SqlChatHandler] Selecting chat models...`);
            const models = await vscode.lm.selectChatModels();
            this.outputChannel.appendLine(`[SqlChatHandler] Found ${models.length} models`);
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