import * as vscode from 'vscode';
import * as fs from 'fs';
import { QueryExecutor } from './queryExecutor';
import { ConnectionProvider } from './connectionProvider';

export class SqlEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'mssqlManager.sqlEditor';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly queryExecutor: QueryExecutor,
        private readonly connectionProvider: ConnectionProvider,
        private readonly outputChannel: vscode.OutputChannel
    ) { }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Set up webview options
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'webview')
            ]
        };

        // Set initial HTML content
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // Update webview content when document changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                webviewPanel.webview.postMessage({
                    type: 'update',
                    content: document.getText()
                });
            }
        });

        // Handle messages from webview
        webviewPanel.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'ready':
                    // Initialize webview with current document content
                    webviewPanel.webview.postMessage({
                        type: 'update',
                        content: document.getText()
                    });

                    // Send initial connections list
                    this.updateConnectionsList(webviewPanel.webview);
                    break;

                case 'documentChanged':
                    // Update the document when the webview content changes
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(
                        document.uri,
                        new vscode.Range(0, 0, document.lineCount, 0),
                        message.content
                    );
                    await vscode.workspace.applyEdit(edit);
                    break;

                case 'executeQuery':
                    await this.executeQuery(message.query, message.connectionId, webviewPanel.webview);
                    break;

                case 'cancelQuery':
                    // Query cancellation is handled automatically by VS Code progress API
                    this.outputChannel.appendLine('Query cancellation requested');
                    break;

                case 'manageConnections':
                    await vscode.commands.executeCommand('mssqlManager.manageConnections');
                    break;

                case 'switchConnection':
                    this.connectionProvider.setActiveConnection(message.connectionId);
                    this.updateConnectionsList(webviewPanel.webview);
                    break;

                case 'getSchema':
                    await this.sendSchemaUpdate(webviewPanel.webview, message.connectionId);
                    break;
            }
        });

        // Clean up
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });

        // Listen for connection changes
        this.connectionProvider.setConnectionChangeCallback(() => {
            this.updateConnectionsList(webviewPanel.webview);
        });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        // External resources (Monaco loader stays on CDN)
        const monacoLoaderUri = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js';

        // Build file paths
        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'sqlEditor', 'sqlEditor.html');
        const stylePath = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'sqlEditor', 'sqlEditor.css');
        const scriptPath = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'sqlEditor', 'sqlEditor.js');

        // Convert to webview URIs for proper loading
        const styleUri = webview.asWebviewUri(stylePath).toString();
        const scriptUri = webview.asWebviewUri(scriptPath).toString();

        // Read base HTML template
        let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

        // Replace placeholders defined in template
        html = html
            .replace(/{{styleUri}}/g, styleUri)
            .replace(/{{scriptUri}}/g, scriptUri)
            .replace(/{{monacoLoaderUri}}/g, monacoLoaderUri)
            .replace(/{{cspSource}}/g, webview.cspSource);

        return html;
    }

    private updateConnectionsList(webview: vscode.Webview) {
        const connections = this.connectionProvider.getAllActiveConnections();
        const activeConnectionId = this.connectionProvider.getCurrentConfig()?.id || null;

        webview.postMessage({
            type: 'connectionsUpdate',
            connections: connections.map(conn => ({
                id: conn.id,
                server: conn.config.server,
                database: conn.config.database
            })),
            currentConnectionId: activeConnectionId
        });

        // Send schema update for active connection
        if (activeConnectionId) {
            this.sendSchemaUpdate(webview, activeConnectionId);
        }
    }

    private async sendSchemaUpdate(webview: vscode.Webview, connectionId?: string) {
        console.log('[SCHEMA] sendSchemaUpdate called with connectionId:', connectionId);
        
        const config = connectionId 
            ? this.connectionProvider.getConnectionConfig(connectionId)
            : this.connectionProvider.getCurrentConfig();
        
        console.log('[SCHEMA] Config:', config?.id || 'none');
        
        if (!config) {
            console.log('[SCHEMA] No config found, returning empty schema');
            return;
        }

        try {
            // TODO: Implement proper schema retrieval from database
            // For now, retrieve basic table information
            const connection = this.connectionProvider.getConnection();
            
            if (!connection) {
                console.log('[SCHEMA] No active connection, sending empty schema');
                webview.postMessage({
                    type: 'schemaUpdate',
                    schema: { tables: [], views: [], foreignKeys: [] }
                });
                return;
            }

            console.log('[SCHEMA] Fetching schema from database...');
            
            // Query to get all tables with their columns
            const tablesQuery = `
                SELECT 
                    t.TABLE_SCHEMA as [schema],
                    t.TABLE_NAME as [name],
                    c.COLUMN_NAME as columnName,
                    c.DATA_TYPE as dataType,
                    c.IS_NULLABLE as isNullable,
                    c.CHARACTER_MAXIMUM_LENGTH as maxLength
                FROM INFORMATION_SCHEMA.TABLES t
                INNER JOIN INFORMATION_SCHEMA.COLUMNS c 
                    ON t.TABLE_SCHEMA = c.TABLE_SCHEMA 
                    AND t.TABLE_NAME = c.TABLE_NAME
                WHERE t.TABLE_TYPE = 'BASE TABLE'
                ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME, c.ORDINAL_POSITION
            `;

            // Query to get foreign key relationships
            const foreignKeysQuery = `
                SELECT 
                    fk.name as constraintName,
                    OBJECT_SCHEMA_NAME(fk.parent_object_id) as fromSchema,
                    OBJECT_NAME(fk.parent_object_id) as fromTable,
                    COL_NAME(fkc.parent_object_id, fkc.parent_column_id) as fromColumn,
                    OBJECT_SCHEMA_NAME(fk.referenced_object_id) as toSchema,
                    OBJECT_NAME(fk.referenced_object_id) as toTable,
                    COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) as toColumn
                FROM sys.foreign_keys fk
                INNER JOIN sys.foreign_key_columns fkc 
                    ON fk.object_id = fkc.constraint_object_id
                ORDER BY fromSchema, fromTable, toSchema, toTable
            `;

            const [tablesResult, fkResult] = await Promise.all([
                connection.request().query(tablesQuery),
                connection.request().query(foreignKeysQuery)
            ]);
            
            console.log('[SCHEMA] Tables query returned:', tablesResult.recordset?.length || 0, 'rows');
            console.log('[SCHEMA] FK query returned:', fkResult.recordset?.length || 0, 'foreign keys');
            
            // Group columns by table
            const tablesMap = new Map<string, any>();
            
            for (const row of tablesResult.recordset) {
                const tableKey = `${row.schema}.${row.name}`;
                
                if (!tablesMap.has(tableKey)) {
                    tablesMap.set(tableKey, {
                        schema: row.schema,
                        name: row.name,
                        columns: []
                    });
                }
                
                const table = tablesMap.get(tableKey);
                table.columns.push({
                    name: row.columnName,
                    type: row.dataType,
                    nullable: row.isNullable === 'YES',
                    maxLength: row.maxLength
                });
            }
            
            const tables = Array.from(tablesMap.values());
            console.log('[SCHEMA] Parsed', tables.length, 'tables');
            
            // Parse foreign keys
            const foreignKeys = fkResult.recordset.map((row: any) => ({
                constraintName: row.constraintName,
                fromSchema: row.fromSchema,
                fromTable: row.fromTable,
                fromColumn: row.fromColumn,
                toSchema: row.toSchema,
                toTable: row.toTable,
                toColumn: row.toColumn
            }));
            
            console.log('[SCHEMA] Parsed', foreignKeys.length, 'foreign keys');
            if (foreignKeys.length > 0) {
                console.log('[SCHEMA] Sample FK:', foreignKeys[0]);
            }
            
            const schema = {
                tables: tables,
                views: [], // TODO: Implement views
                foreignKeys: foreignKeys
            };
            
            console.log('[SCHEMA] Sending schema update with', schema.tables.length, 'tables and', schema.foreignKeys.length, 'foreign keys');
            
            webview.postMessage({
                type: 'schemaUpdate',
                schema: schema
            });
        } catch (error) {
            console.error('[SCHEMA] Failed to get schema:', error);
            webview.postMessage({
                type: 'schemaUpdate',
                schema: { tables: [], views: [], foreignKeys: [] }
            });
        }
    }

    private async executeQuery(query: string, connectionId: string | null, webview: vscode.Webview) {
        if (!query || query.trim().length === 0) {
            webview.postMessage({
                type: 'error',
                error: 'Query is empty',
                messages: [{ type: 'error', text: 'Query is empty' }]
            });
            return;
        }

        // Use provided connection or active connection
        const config = connectionId
            ? this.connectionProvider.getConnectionConfig(connectionId)
            : this.connectionProvider.getCurrentConfig();
        
        if (!config) {
            webview.postMessage({
                type: 'error',
                error: 'No active connection',
                messages: [{ type: 'error', text: 'Please connect to a database first' }]
            });
            return;
        }

        // Notify webview that query is executing
        webview.postMessage({
            type: 'executing'
        });

        try {
            const startTime = Date.now();
            const result = await this.queryExecutor.executeQuery(query);
            const executionTime = Date.now() - startTime;

            // Build informational messages
            const messages = [];
            
            if (result.recordsets && result.recordsets.length > 0) {
                const totalRows = result.recordsets.reduce((sum, rs) => sum + rs.length, 0);
                messages.push({
                    type: 'info',
                    text: `Query completed successfully. Returned ${result.recordsets.length} result set(s) with ${totalRows} total row(s).`
                });
                
                // Add details for each result set
                result.recordsets.forEach((rs, index) => {
                    messages.push({
                        type: 'info',
                        text: `Result Set ${index + 1}: ${rs.length} row(s)`
                    });
                });
            } else if (result.rowsAffected && result.rowsAffected.length > 0) {
                const totalAffected = result.rowsAffected.reduce((sum, count) => sum + count, 0);
                messages.push({
                    type: 'info',
                    text: `Query completed successfully. ${totalAffected} row(s) affected.`
                });
            } else {
                messages.push({
                    type: 'info',
                    text: 'Query completed successfully.'
                });
            }
            
            messages.push({
                type: 'info',
                text: `Execution time: ${executionTime}ms`
            });

            webview.postMessage({
                type: 'results',
                resultSets: result.recordsets || [],
                executionTime: executionTime,
                rowsAffected: result.rowsAffected?.[0] || 0,
                messages: messages
            });
        } catch (error: any) {
            webview.postMessage({
                type: 'error',
                error: error.message || 'Query execution failed',
                messages: [{ type: 'error', text: error.message || 'Query execution failed' }]
            });
        }
    }
}
