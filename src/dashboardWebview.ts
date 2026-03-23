import * as vscode from 'vscode';
import { ConnectionProvider } from './connectionProvider';
import { QueryExecutor } from './queryExecutor';
import { DashboardStorage } from './utils/dashboardStorage';
import {
    DashboardIncomingMessage,
    DashboardOutgoingMessage,
} from './types/dashboard';

export class DashboardWebview {
    private readonly panels = new Map<string, vscode.WebviewPanel>();
    private readonly storage: DashboardStorage;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly connectionProvider: ConnectionProvider,
        private readonly queryExecutor: QueryExecutor,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.storage = new DashboardStorage(context.globalState);
    }

    public show(connectionId: string, serverName: string, defaultDatabase?: string): void {
        const existing = this.panels.get(connectionId);
        if (existing) {
            existing.reveal(vscode.ViewColumn.One);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'mssqlManager.dashboards',
            `Dashboards — ${serverName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'webview')
                ]
            }
        );

        panel.iconPath = {
            light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'database-light.svg'),
            dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'database-dark.svg')
        };

        panel.webview.html = this.getHtml(panel.webview);

        panel.webview.onDidReceiveMessage(async (message: DashboardIncomingMessage) => {
            await this.handleMessage(panel, connectionId, serverName, defaultDatabase ?? '', message);
        });

        panel.onDidDispose(() => {
            this.panels.delete(connectionId);
        });

        this.panels.set(connectionId, panel);
    }

    private async handleMessage(
        panel: vscode.WebviewPanel,
        connectionId: string,
        serverName: string,
        defaultDatabase: string,
        message: DashboardIncomingMessage
    ): Promise<void> {
        const post = (msg: DashboardOutgoingMessage) => {
            panel.webview.postMessage(msg);
        };

        switch (message.type) {
            case 'getDashboards': {
                const dashboards = this.storage.getDashboards(connectionId);
                post({
                    type: 'dashboardsLoaded',
                    dashboards,
                    connectionId,
                    serverName,
                    defaultDatabase,
                });
                break;
            }

            case 'createDashboard': {
                try {
                    const dashboard = await this.storage.createDashboard(connectionId, message.name);
                    post({ type: 'dashboardCreated', dashboard });
                } catch (err) {
                    this.outputChannel.appendLine(`[Dashboard] createDashboard error: ${err}`);
                }
                break;
            }

            case 'saveDashboard': {
                try {
                    await this.storage.saveDashboard(connectionId, message.dashboard);
                    post({ type: 'dashboardSaved', dashboard: message.dashboard });
                } catch (err) {
                    this.outputChannel.appendLine(`[Dashboard] saveDashboard error: ${err}`);
                }
                break;
            }

            case 'deleteDashboard': {
                try {
                    await this.storage.deleteDashboard(connectionId, message.dashboardId);
                    post({ type: 'dashboardDeleted', dashboardId: message.dashboardId });
                } catch (err) {
                    this.outputChannel.appendLine(`[Dashboard] deleteDashboard error: ${err}`);
                }
                break;
            }

            case 'renameDashboard': {
                try {
                    await this.storage.renameDashboard(connectionId, message.dashboardId, message.name);
                    post({ type: 'dashboardRenamed', dashboardId: message.dashboardId, name: message.name });
                } catch (err) {
                    this.outputChannel.appendLine(`[Dashboard] renameDashboard error: ${err}`);
                }
                break;
            }

            case 'executeWidgetQuery': {
                const pool = this.connectionProvider.getConnection(connectionId);
                if (!pool) {
                    post({ type: 'widgetQueryError', widgetId: message.widgetId, error: 'No active connection' });
                    break;
                }
                try {
                    const dbPool = message.database
                        ? await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, message.database)
                        : pool;
                    const result = await this.queryExecutor.executeQuery(message.sql, dbPool, undefined, true);
                    const columns = result.columnNames?.[0] ?? [];
                    const rows = result.recordsets[0] ?? [];
                    post({
                        type: 'widgetQueryResult',
                        widgetId: message.widgetId,
                        columns,
                        rows: rows as unknown[][],
                    });
                } catch (err) {
                    const error = err instanceof Error ? err.message : String(err);
                    post({ type: 'widgetQueryError', widgetId: message.widgetId, error });
                }
                break;
            }

            case 'previewQuery': {
                const pool = this.connectionProvider.getConnection(connectionId);
                if (!pool) {
                    post({ type: 'previewError', requestId: message.requestId, error: 'No active connection' });
                    break;
                }
                try {
                    const dbPool = message.database
                        ? await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, message.database)
                        : pool;
                    const result = await this.queryExecutor.executeQuery(message.sql, dbPool, undefined, true);
                    const columns = result.columnNames?.[0] ?? [];
                    const rows = result.recordsets[0] ?? [];
                    post({
                        type: 'previewResult',
                        requestId: message.requestId,
                        columns,
                        rows: rows as unknown[][],
                    });
                } catch (err) {
                    const error = err instanceof Error ? err.message : String(err);
                    post({ type: 'previewError', requestId: message.requestId, error });
                }
                break;
            }

            case 'getConnectionDatabases': {
                try {
                    const pool = this.connectionProvider.getConnection(connectionId);
                    if (!pool) {
                        post({ type: 'connectionDatabases', databases: [] });
                        break;
                    }
                    const result = await this.queryExecutor.executeQuery(
                        'SELECT name FROM sys.databases WHERE state_desc = \'ONLINE\' ORDER BY name',
                        pool,
                        undefined,
                        true
                    );
                    const databases = (result.recordsets[0] ?? []).map((row: any) => row[0] as string).filter(Boolean);
                    post({ type: 'connectionDatabases', databases });
                } catch (err) {
                    this.outputChannel.appendLine(`[Dashboard] getConnectionDatabases error: ${err}`);
                    post({ type: 'connectionDatabases', databases: [] });
                }
                break;
            }

            default:
                break;
        }
    }

    private getHtml(webview: vscode.Webview): string {
        const cacheBuster = Date.now();
        const reactDistPath = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'sqlEditor-react', 'dist');
        const scriptPath = vscode.Uri.joinPath(reactDistPath, 'dashboard.js');
        const stylePath = vscode.Uri.joinPath(reactDistPath, 'dashboard.css');
        const globalScriptPath = vscode.Uri.joinPath(reactDistPath, 'global.js');
        const globalStylePath = vscode.Uri.joinPath(reactDistPath, 'global.css');

        const scriptUri = webview.asWebviewUri(scriptPath).toString() + `?v=${cacheBuster}`;
        const styleUri = webview.asWebviewUri(stylePath).toString() + `?v=${cacheBuster}`;
        const globalScriptUri = webview.asWebviewUri(globalScriptPath).toString() + `?v=${cacheBuster}`;
        const globalStyleUri = webview.asWebviewUri(globalStylePath).toString() + `?v=${cacheBuster}`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none';
        style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net;
        font-src ${webview.cspSource} https://cdn.jsdelivr.net data:;
        script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net blob:;
        img-src ${webview.cspSource} data:;
        worker-src blob:;
        connect-src ${webview.cspSource} https://cdn.jsdelivr.net;">
    <title>SQL Dashboards</title>
    <link rel="stylesheet" href="${globalStyleUri}">
    <link rel="stylesheet" href="${styleUri}">
    <link rel="modulepreload" href="${globalScriptUri}">
    <style>
        html, body, #root {
            height: 100%;
            margin: 0;
            padding: 0;
            overflow: hidden;
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
