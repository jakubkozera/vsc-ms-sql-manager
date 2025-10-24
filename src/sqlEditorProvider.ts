import * as vscode from 'vscode';
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
        // Setup webview options
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        // Set initial HTML
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // Send initial document content to webview
        this.updateWebview(webviewPanel.webview, document);

        // Listen for changes to the document
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                this.updateWebview(webviewPanel.webview, document);
            }
        });

        // Listen for messages from webview
        webviewPanel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.type) {
                    case 'documentChanged':
                        this.updateTextDocument(document, message.content);
                        break;
                    case 'executeQuery':
                        await this.executeQuery(webviewPanel.webview, message.query);
                        break;
                    case 'ready':
                        // Webview is ready, send initial content
                        this.updateWebview(webviewPanel.webview, document);
                        break;
                }
            }
        );

        // Cleanup
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }

    private updateWebview(webview: vscode.Webview, document: vscode.TextDocument) {
        webview.postMessage({
            type: 'update',
            content: document.getText()
        });
    }

    private updateTextDocument(document: vscode.TextDocument, content: string) {
        const edit = new vscode.WorkspaceEdit();
        
        // Replace entire document
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            content
        );

        vscode.workspace.applyEdit(edit);
    }

    private async executeQuery(webview: vscode.Webview, queryText: string) {
        if (!this.connectionProvider.isConnected()) {
            webview.postMessage({
                type: 'error',
                error: 'Not connected to database. Please connect first.'
            });
            vscode.window.showWarningMessage('Not connected to database. Please connect first.');
            return;
        }

        if (!queryText.trim()) {
            webview.postMessage({
                type: 'error',
                error: 'No query text found to execute'
            });
            return;
        }

        try {
            webview.postMessage({ type: 'executing' });
            
            this.outputChannel.appendLine(`[SqlEditor] Executing query (${queryText.length} characters)`);
            
            const results = await this.queryExecutor.executeQuery(queryText);
            
            webview.postMessage({
                type: 'results',
                results: results.recordset,
                executionTime: results.executionTime,
                rowsAffected: results.rowsAffected
            });

            this.outputChannel.appendLine(`[SqlEditor] Query completed: ${results.recordset.length} rows returned`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            
            webview.postMessage({
                type: 'error',
                error: errorMessage
            });
            
            vscode.window.showErrorMessage(`Query execution failed: ${errorMessage}`);
            this.outputChannel.appendLine(`[SqlEditor] Query execution error: ${errorMessage}`);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        // Get Monaco Editor from CDN
        const monacoLoaderUri = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js';
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        script-src 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com;
        style-src 'unsafe-inline' https://cdnjs.cloudflare.com;
        font-src https://cdnjs.cloudflare.com;
        worker-src blob:;
    ">
    <title>SQL Editor</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            overflow: hidden;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        #container {
            display: flex;
            flex-direction: column;
            height: 100vh;
            width: 100%;
        }

        #editorContainer {
            width: 100%;
            height: 100%;
            position: relative;
        }

        #editor {
            width: 100%;
            height: 100%;
        }

        #toolbar {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            background-color: var(--vscode-editorGroupHeader-tabsBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            gap: 8px;
        }

        #executeButton {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 16px;
            cursor: pointer;
            border-radius: 2px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        #executeButton:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        #executeButton:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        #connectionStatus {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin-left: auto;
        }

        #resultsContainer {
            display: none;
            width: 100%;
            height: 0%;
            border-top: 2px solid var(--vscode-panel-border);
            background-color: var(--vscode-editor-background);
            overflow: auto;
            flex-direction: column;
        }

        #resultsContainer.visible {
            display: flex;
        }

        #resultsHeader {
            padding: 8px 12px;
            background-color: var(--vscode-editorGroupHeader-tabsBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        #resultsTitle {
            font-weight: 600;
            font-size: 13px;
        }

        #resultsStats {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        #resultsContent {
            flex: 1;
            overflow: auto;
            padding: 12px;
        }

        table {
            border-collapse: collapse;
            width: 100%;
            background-color: var(--vscode-editor-background);
            font-size: 13px;
        }

        th, td {
            border: 1px solid var(--vscode-panel-border);
            padding: 6px 10px;
            text-align: left;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 300px;
        }

        th {
            background-color: var(--vscode-editor-lineHighlightBackground);
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 10;
        }

        .null-value {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .number-value {
            text-align: right;
        }

        .error-message {
            color: var(--vscode-errorForeground);
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            padding: 12px;
            border-radius: 4px;
            margin: 12px;
            white-space: pre-wrap;
            font-family: var(--vscode-editor-font-family);
        }

        .no-results {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div id="container">
        <div id="toolbar">
            <button id="executeButton" title="Execute Query (F5 or Ctrl+Shift+E)">
                ▶ Execute
            </button>
            <span id="connectionStatus">Not Connected</span>
        </div>
        
        <div id="editorContainer">
            <div id="editor"></div>
        </div>
        
        <div id="resultsContainer">
            <div id="resultsHeader">
                <span id="resultsTitle">Results</span>
                <span id="resultsStats"></span>
            </div>
            <div id="resultsContent"></div>
        </div>
    </div>

    <script src="${monacoLoaderUri}"></script>
    <script>
        const vscode = acquireVsCodeApi();
        console.log('SQL Editor Webview loaded');
        let editor;
        let isUpdatingFromExtension = false;

        // Initialize Monaco Editor
        require.config({ 
            paths: { 
                vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' 
            }
        });

        require(['vs/editor/editor.main'], function () {
            // Detect VS Code theme
            const theme = document.body.classList.contains('vscode-dark') ? 'vs-dark' : 'vs';
            
            editor = monaco.editor.create(document.getElementById('editor'), {
                value: '',
                language: 'sql',
                theme: theme,
                automaticLayout: true,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                fontSize: 14,
                lineNumbers: 'on',
                renderWhitespace: 'selection',
                tabSize: 4,
                insertSpaces: true
            });

            // Listen for content changes
            editor.onDidChangeModelContent(() => {
                if (!isUpdatingFromExtension) {
                    vscode.postMessage({
                        type: 'documentChanged',
                        content: editor.getValue()
                    });
                }
            });

            // Add keyboard shortcuts
            editor.addCommand(monaco.KeyCode.F5, () => {
                executeQuery();
            });

            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE, () => {
                executeQuery();
            });

            // Notify extension that webview is ready
            vscode.postMessage({ type: 'ready' });
        });

        // Execute button
        document.getElementById('executeButton').addEventListener('click', () => {
            executeQuery();
        });

        function executeQuery() {
            if (!editor) return;

            const selection = editor.getSelection();
            let queryText;

            // If there's a selection, execute only the selected text
            if (selection && !selection.isEmpty()) {
                queryText = editor.getModel().getValueInRange(selection);
            } else {
                queryText = editor.getValue();
            }

            vscode.postMessage({
                type: 'executeQuery',
                query: queryText
            });
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'update':
                    if (editor && message.content !== editor.getValue()) {
                        isUpdatingFromExtension = true;
                        const position = editor.getPosition();
                        editor.setValue(message.content);
                        if (position) {
                            editor.setPosition(position);
                        }
                        isUpdatingFromExtension = false;
                    }
                    break;

                case 'executing':
                    showLoading();
                    break;

                case 'results':
                    showResults(message.results, message.executionTime, message.rowsAffected);
                    break;

                case 'error':
                    showError(message.error);
                    break;
            }
        });

        function showLoading() {
            const resultsContainer = document.getElementById('resultsContainer');
            const resultsContent = document.getElementById('resultsContent');
            const editorContainer = document.getElementById('editorContainer');
            
            resultsContent.innerHTML = '<div class="loading">Executing query...</div>';
            resultsContainer.classList.add('visible');
            
            // Split view: 60% editor, 40% results
            editorContainer.style.height = '60%';
            resultsContainer.style.height = '40%';
        }

        function showResults(results, executionTime, rowsAffected) {
            const resultsContainer = document.getElementById('resultsContainer');
            const resultsContent = document.getElementById('resultsContent');
            const resultsStats = document.getElementById('resultsStats');
            const editorContainer = document.getElementById('editorContainer');

            // Show results panel
            resultsContainer.classList.add('visible');
            
            // Split view: 60% editor, 40% results
            editorContainer.style.height = '60%';
            resultsContainer.style.height = '40%';

            if (!results || results.length === 0) {
                resultsContent.innerHTML = '<div class="no-results">No rows returned</div>';
                resultsStats.textContent = \`0 row(s) • \${executionTime}ms\`;
                return;
            }

            // Create table
            const columns = Object.keys(results[0]);
            let tableHtml = '<table><thead><tr>';
            
            columns.forEach(column => {
                tableHtml += \`<th>\${escapeHtml(column)}</th>\`;
            });
            
            tableHtml += '</tr></thead><tbody>';
            
            results.forEach(row => {
                tableHtml += '<tr>';
                columns.forEach(column => {
                    const value = row[column];
                    if (value === null || value === undefined) {
                        tableHtml += '<td class="null-value">NULL</td>';
                    } else if (typeof value === 'number') {
                        tableHtml += \`<td class="number-value">\${value}</td>\`;
                    } else {
                        tableHtml += \`<td title="\${escapeHtml(String(value))}">\${escapeHtml(String(value))}</td>\`;
                    }
                });
                tableHtml += '</tr>';
            });
            
            tableHtml += '</tbody></table>';
            
            resultsContent.innerHTML = tableHtml;
            resultsStats.textContent = \`\${results.length} row(s) • \${executionTime}ms\`;
        }

        function showError(error) {
            const resultsContainer = document.getElementById('resultsContainer');
            const resultsContent = document.getElementById('resultsContent');
            const editorContainer = document.getElementById('editorContainer');
            
            resultsContainer.classList.add('visible');
            
            // Split view: 60% editor, 40% results
            editorContainer.style.height = '60%';
            resultsContainer.style.height = '40%';
            
            resultsContent.innerHTML = \`<div class="error-message">\${escapeHtml(error)}</div>\`;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Update editor layout when window resizes
        window.addEventListener('resize', () => {
            if (editor) {
                editor.layout();
            }
        });
    </script>
</body>
</html>`;
    }
}
