import * as vscode from 'vscode';

export class McpConnectWebview implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly outputChannel: vscode.OutputChannel
    ) {}

    show(): void {
        if (this.panel) {
            this.panel.reveal();
            return;
        }

        const dist = vscode.Uri.joinPath(this.extensionUri, 'webview', 'sqlEditor-react', 'dist');
        const panel = vscode.window.createWebviewPanel(
            'mssqlManager.connectMcp',
            'Connect MCP',
            vscode.ViewColumn.One,
            { enableScripts: true, localResourceRoots: [dist] }
        );
        this.panel = panel;

        const { webview } = panel;
        const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'mcpConnect.js'));
        const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'mcpConnect.css'));
        const messages = webview.onDidReceiveMessage(async (message: { type?: string } | undefined) => {
            try {
                switch (message?.type) {
                    case 'copyMcpConfig':
                        await vscode.commands.executeCommand('mssqlManager.copyMcpConfig');
                        break;
                    case 'openMcpSettings':
                        await vscode.commands.executeCommand('workbench.action.openSettings', 'mssqlManager.mcp');
                        break;
                }
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                this.outputChannel.appendLine(`[MCP] ${message?.type} failed: ${detail}`);
                void vscode.window.showErrorMessage(`MS SQL Manager MCP: ${detail}`);
            }
        });
        panel.onDidDispose(() => {
            messages.dispose();
            this.panel = undefined;
        });
        webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource};">
    <title>Connect MCP</title>
    <link rel="stylesheet" href="${style}">
</head>
<body>
    <div id="root"></div>
    <script type="module" src="${script}"></script>
</body>
</html>`;
    }

    dispose(): void {
        this.panel?.dispose();
    }
}
