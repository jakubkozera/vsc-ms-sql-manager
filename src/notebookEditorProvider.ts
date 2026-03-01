import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConnectionProvider } from './connectionProvider';
import { QueryExecutor } from './queryExecutor';

export class NotebookEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'mssqlManager.notebookEditor';

    /** Track selected connection per webview (may be composite "connId::database") */
    private readonly webviewConnections = new Map<vscode.Webview, string>();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly queryExecutor: QueryExecutor,
        private readonly connectionProvider: ConnectionProvider,
        private readonly outputChannel: vscode.OutputChannel
    ) {}

    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const webview = webviewPanel.webview;

        // Allow scripts and local resources from the webview dist folder
        const distUri = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'sqlNotebook', 'dist');
        webview.options = {
            enableScripts: true,
            localResourceRoots: [distUri]
        };

        // Load and patch the HTML
        webview.html = this.getHtmlForWebview(webview, distUri);

        // Handle messages from webview
        const messageDisposable = webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'ready':
                    this.sendNotebook(webview, document);
                    await this.sendConnections(webview);
                    break;

                case 'executeCell':
                    await this.handleExecuteCell(webview, msg);
                    break;

                case 'switchConnection':
                    this.webviewConnections.set(webview, msg.connectionId);
                    this.outputChannel.appendLine(`[NotebookEditor] switchConnection -> ${msg.connectionId}`);
                    // Check if this is a server connection and send databases
                    await this.maybeSendDatabases(webview, msg.connectionId);
                    break;

                case 'switchDatabase':
                    // Store composite id "connId::database"
                    const compositeId = `${msg.connectionId}::${msg.database}`;
                    this.webviewConnections.set(webview, compositeId);
                    this.connectionProvider.setCurrentDatabase(msg.connectionId, msg.database);
                    this.outputChannel.appendLine(`[NotebookEditor] switchDatabase -> ${compositeId}`);
                    break;

                case 'refreshConnections':
                    await this.sendConnections(webview);
                    break;

                case 'manageConnections':
                    await vscode.commands.executeCommand('mssqlManager.manageConnections');
                    break;
            }
        });

        // Refresh connections when they change
        let disposed = false;
        this.connectionProvider.addConnectionChangeCallback(() => {
            if (!disposed) {
                this.sendConnections(webview);
            }
        });

        webviewPanel.onDidDispose(() => {
            disposed = true;
            messageDisposable.dispose();
            this.webviewConnections.delete(webview);
        });
    }

    private getHtmlForWebview(webview: vscode.Webview, distUri: vscode.Uri): string {
        const htmlPath = path.join(distUri.fsPath, 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'assets', 'index.js'));
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'assets', 'index.css'));
        const cspSource = webview.cspSource;

        // Rewrite asset paths to webview URIs (handles both ./assets/ and /assets/ forms)
        html = html.replace(/["'](?:\.\/|\/)?assets\/index\.js["']/g, `"${jsUri}"`);
        html = html.replace(/["'](?:\.\/|\/)?assets\/index\.css["']/g, `"${cssUri}"`);

        // Inject CSP meta tag
        html = html.replace(
            '<head>',
            `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline' https://cdn.jsdelivr.net; script-src ${cspSource} https://cdn.jsdelivr.net; font-src ${cspSource} https://cdn.jsdelivr.net; worker-src blob:; connect-src https://cdn.jsdelivr.net;">`
        );

        return html;
    }

    private sendNotebook(webview: vscode.Webview, document: vscode.TextDocument): void {
        try {
            const notebook = JSON.parse(document.getText());
            webview.postMessage({ type: 'loadNotebook', notebook });
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            this.outputChannel.appendLine(`[NotebookEditor] Failed to parse notebook: ${errorMsg}`);
            webview.postMessage({ type: 'error', message: `Failed to parse notebook: ${errorMsg}` });
        }
    }

    private async sendConnections(webview: vscode.Webview): Promise<void> {
        const activeConnections = this.connectionProvider.getAllActiveConnections();
        const connections = activeConnections.map(conn => ({
            id: conn.id,
            name: conn.config.name,
            server: conn.config.server,
            database: conn.config.database,
            connectionType: conn.config.connectionType
        }));
        webview.postMessage({ type: 'connections', connections });

        // If there's a preserved connection, check if it's server-type and send databases
        const preserved = this.webviewConnections.get(webview);
        if (preserved) {
            const baseId = preserved.includes('::') ? preserved.split('::')[0] : preserved;
            await this.maybeSendDatabases(webview, baseId);
        }
    }

    private async maybeSendDatabases(webview: vscode.Webview, connectionId: string): Promise<void> {
        const activeConnections = this.connectionProvider.getAllActiveConnections();
        const conn = activeConnections.find(c => c.id === connectionId);
        if (conn && conn.config.connectionType === 'server') {
            await this.sendDatabasesList(webview, connectionId);
        } else {
            // Not a server connection - hide database selector
            webview.postMessage({ type: 'noDatabases' });
        }
    }

    private async sendDatabasesList(webview: vscode.Webview, connectionId: string): Promise<void> {
        try {
            const pool = this.connectionProvider.getConnection(connectionId);
            if (!pool) {
                webview.postMessage({ type: 'noDatabases' });
                return;
            }

            const dbsResult = await pool.request().query('SELECT name FROM sys.databases WHERE state = 0 ORDER BY name');
            const databases: string[] = dbsResult.recordset.map((row: any) => row.name);

            // Determine selected database
            const preserved = this.webviewConnections.get(webview);
            let selectedDatabase: string | undefined;
            if (preserved && preserved.includes('::')) {
                selectedDatabase = preserved.split('::')[1];
            }
            if (!selectedDatabase) {
                selectedDatabase = this.connectionProvider.getCurrentDatabase(connectionId) || 'master';
            }

            this.outputChannel.appendLine(`[NotebookEditor] Sending ${databases.length} databases for ${connectionId}, selected: ${selectedDatabase}`);

            webview.postMessage({
                type: 'databasesList',
                databases,
                selectedDatabase
            });
        } catch (err) {
            this.outputChannel.appendLine(`[NotebookEditor] Failed to fetch databases: ${err}`);
            webview.postMessage({
                type: 'databasesList',
                databases: ['master'],
                selectedDatabase: 'master'
            });
        }
    }

    private async handleExecuteCell(webview: vscode.Webview, msg: { cellIndex: number; source: string; connectionId: string; database?: string }): Promise<void> {
        const { cellIndex, source, connectionId, database } = msg;

        if (!connectionId) {
            webview.postMessage({ type: 'cellResult', cellIndex, error: 'No connection selected.' });
            return;
        }

        try {
            // Get the connection pool for this connection
            const config = this.connectionProvider.getConnectionConfig(connectionId);
            if (!config) {
                webview.postMessage({ type: 'cellResult', cellIndex, error: 'Connection not found.' });
                return;
            }

            const pool = await this.connectionProvider.ensureConnectionAndGetDbPool(
                connectionId,
                database || config.database
            );

            const result = await this.queryExecutor.executeQuery(source, pool, undefined, true);

            webview.postMessage({
                type: 'cellResult',
                cellIndex,
                result: {
                    recordsets: result.recordsets,
                    rowsAffected: result.rowsAffected,
                    executionTime: result.executionTime,
                    columnNames: result.columnNames
                }
            });
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            this.outputChannel.appendLine(`[NotebookEditor] Cell ${cellIndex} error: ${errorMsg}`);
            webview.postMessage({ type: 'cellResult', cellIndex, error: errorMsg });
        }
    }
}
