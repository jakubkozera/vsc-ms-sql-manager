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

            const result = await connection.request().query(tablesQuery);
            console.log('[SCHEMA] Query returned:', result.recordset?.length || 0, 'rows');
            
            // Group columns by table
            const tablesMap = new Map<string, any>();
            
            for (const row of result.recordset) {
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
            console.log('[SCHEMA] Table names:', tables.map(t => `${t.schema}.${t.name}`).join(', '));
            
            const schema = {
                tables: tables,
                views: [], // TODO: Implement views
                foreignKeys: [] // TODO: Implement foreign keys
            };
            
            console.log('[SCHEMA] Sending schema update with', schema.tables.length, 'tables');
            
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

            webview.postMessage({
                type: 'results',
                resultSets: result.recordsets || [],
                executionTime: executionTime,
                rowsAffected: result.rowsAffected?.[0] || 0,
                messages: []
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
