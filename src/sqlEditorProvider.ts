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

        // Send active connections to webview
        this.sendActiveConnections(webviewPanel.webview);

        // Listen for connection changes
        const updateConnections = () => {
            this.sendActiveConnections(webviewPanel.webview);
        };
        this.connectionProvider.setConnectionChangeCallback(updateConnections);

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
                        await this.executeQuery(webviewPanel.webview, message.query, message.connectionId);
                        break;
                    case 'cancelQuery':
                        this.queryExecutor.cancelCurrentQuery();
                        break;
                    case 'manageConnections':
                        await this.connectionProvider.manageConnections();
                        break;
                    case 'switchConnection':
                        this.connectionProvider.setActiveConnection(message.connectionId);
                        this.sendActiveConnections(webviewPanel.webview);
                        break;
                    case 'ready':
                        // Webview is ready, send initial content
                        this.updateWebview(webviewPanel.webview, document);
                        this.sendActiveConnections(webviewPanel.webview);
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

    private sendActiveConnections(webview: vscode.Webview) {
        const activeConnections = this.connectionProvider.getAllActiveConnections();
        const currentConfig = this.connectionProvider.getCurrentConfig();
        
        webview.postMessage({
            type: 'connectionsUpdate',
            connections: activeConnections.map(conn => ({
                id: conn.id,
                name: conn.config.name,
                server: conn.config.server,
                database: conn.config.database
            })),
            currentConnectionId: currentConfig?.id || null
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

    private async executeQuery(webview: vscode.Webview, queryText: string, connectionId?: string) {
        // Switch to specified connection if provided
        if (connectionId) {
            this.connectionProvider.setActiveConnection(connectionId);
        }

        if (!this.connectionProvider.isConnected()) {
            webview.postMessage({
                type: 'error',
                error: 'Not connected to database. Please connect first.',
                messages: [
                    { type: 'error', text: 'Not connected to database. Please connect first.' }
                ]
            });
            vscode.window.showWarningMessage('Not connected to database. Please connect first.');
            return;
        }

        if (!queryText.trim()) {
            webview.postMessage({
                type: 'error',
                error: 'No query text found to execute',
                messages: [
                    { type: 'error', text: 'No query text found to execute' }
                ]
            });
            return;
        }

        try {
            const currentConfig = this.connectionProvider.getCurrentConfig();
            webview.postMessage({ type: 'executing' });
            
            this.outputChannel.appendLine(`[SqlEditor] Executing query (${queryText.length} characters)`);
            
            const startTime = new Date();
            const results = await this.queryExecutor.executeQuery(queryText);
            const endTime = new Date();
            
            const messages = [
                { type: 'info', text: `Query executed successfully on ${currentConfig?.server}/${currentConfig?.database}` }
            ];

            // Add rows returned/affected info
            const rowsReturned = results.recordset.length;
            let totalAffected = 0;
            if (results.rowsAffected && results.rowsAffected.length > 0) {
                totalAffected = results.rowsAffected.reduce((a, b) => a + b, 0);
            }

            // Only show one message if returned and affected are the same, otherwise show both
            if (rowsReturned > 0 && totalAffected > 0 && rowsReturned === totalAffected) {
                messages.push({ type: 'info', text: `${rowsReturned} row(s) returned` });
            } else {
                if (rowsReturned > 0) {
                    messages.push({ type: 'info', text: `${rowsReturned} row(s) returned` });
                }
                if (totalAffected > 0) {
                    messages.push({ type: 'info', text: `${totalAffected} row(s) affected` });
                }
            }

            messages.push({ type: 'info', text: `Execution time: ${results.executionTime}ms` });
            messages.push({ type: 'info', text: `Completed at: ${endTime.toLocaleTimeString()}` });
            
            webview.postMessage({
                type: 'results',
                results: results.recordset,
                executionTime: results.executionTime,
                rowsAffected: results.rowsAffected,
                messages: messages
            });

            this.outputChannel.appendLine(`[SqlEditor] Query completed: ${results.recordset.length} rows returned`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            const isCancelled = errorMessage.includes('cancel');
            
            const messages = [
                { 
                    type: isCancelled ? 'warning' : 'error', 
                    text: errorMessage 
                }
            ];

            if (!isCancelled) {
                messages.push({ type: 'info', text: `Error occurred at: ${new Date().toLocaleTimeString()}` });
            }
            
            webview.postMessage({
                type: 'error',
                error: errorMessage,
                messages: messages
            });
            
            if (!isCancelled) {
                vscode.window.showErrorMessage(`Query execution failed: ${errorMessage}`);
            }
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
            position: relative;
        }

        #editorContainer {
            width: 100%;
            flex: 1;
            position: relative;
            min-height: 100px;
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
            flex-shrink: 0;
        }

        .toolbar-button {
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

        .toolbar-button:hover:not(:disabled) {
            background-color: var(--vscode-button-hoverBackground);
        }

        .toolbar-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .toolbar-button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .toolbar-button.secondary:hover:not(:disabled) {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .toolbar-separator {
            width: 1px;
            height: 24px;
            background-color: var(--vscode-panel-border);
            margin: 0 4px;
        }

        .database-selector {
            background-color: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            padding: 4px 8px;
            border-radius: 2px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            cursor: pointer;
            min-width: 200px;
        }

        .database-selector:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        #statusLabel {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin-left: auto;
        }

        .resizer {
            height: 4px;
            background-color: var(--vscode-panel-border);
            cursor: ns-resize;
            flex-shrink: 0;
            display: none;
            position: relative;
        }

        .resizer:hover,
        .resizer.active {
            background-color: var(--vscode-focusBorder);
        }

        .resizer.visible {
            display: block;
        }

        #resultsContainer {
            display: none;
            flex-direction: column;
            background-color: var(--vscode-editorGroupHeader-tabsBackground);
            overflow: hidden;
            min-height: 100px;
        }

        #resultsContainer.visible {
            display: flex;
        }

        .results-tabs {
            background-color: var(--vscode-editorGroupHeader-tabsBackground);
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding: 0 8px;
            flex-shrink: 0;
        }

        .results-tab {
            padding: 8px 16px;
            cursor: pointer;
            font-size: 13px;
            border-bottom: 2px solid transparent;
            color: var(--vscode-tab-inactiveForeground);
            background: transparent;
            border: none;
            font-family: var(--vscode-font-family);
        }

        .results-tab:hover {
            color: var(--vscode-tab-activeForeground);
        }

        .results-tab.active {
            color: var(--vscode-tab-activeForeground);
            border-bottom-color: var(--vscode-focusBorder);
        }

        #resultsContent {
            flex: 1;
            overflow: auto;
            padding: 12px;
        }

        #executionStats {
            margin-left: auto;
            padding: 8px 16px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
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

        .message {
            padding: 8px 12px;
            margin-bottom: 8px;
            border-left: 3px solid var(--vscode-focusBorder);
            background-color: var(--vscode-editor-lineHighlightBackground);
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
        }

        .message.error {
            border-left-color: var(--vscode-errorForeground);
            color: var(--vscode-errorForeground);
        }

        .message.warning {
            border-left-color: var(--vscode-editorWarning-foreground);
            color: var(--vscode-editorWarning-foreground);
        }

        .message.info {
            border-left-color: var(--vscode-focusBorder);
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
            <button class="toolbar-button" id="executeButton" title="Execute Query (F5 or Ctrl+Shift+E)">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16l13 -8z" /></svg>
                Run
            </button>
            <button class="toolbar-button secondary" id="cancelButton" disabled title="Cancel Query">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z" /></svg>
                Cancel
            </button>
            <div class="toolbar-separator"></div>
            <label style="font-size: 13px;">Database:</label>
            <select class="database-selector" id="databaseSelector">
                <option value="">Not Connected</option>
            </select>
            <button class="toolbar-button secondary" id="connectButton" title="Manage Connections">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5z" /><path d="M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5z" /><path d="M3 21l2.5 -2.5" /><path d="M18.5 5.5l2.5 -2.5" /><path d="M10 11l-2 2" /><path d="M13 14l-2 2" /></svg>
            </button>
            <div class="toolbar-separator"></div>
            <span id="statusLabel">Ready</span>
        </div>
        
        <div id="editorContainer">
            <div id="editor"></div>
        </div>

        <div class="resizer" id="resizer"></div>
        
        <div id="resultsContainer">
            <div class="results-tabs">
                <button class="results-tab active" data-tab="results">Results</button>
                <button class="results-tab" data-tab="messages">Messages</button>
                <span id="executionStats"></span>
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
        let currentTab = 'results';
        let lastResults = null;
        let lastMessages = [];
        let isResizing = false;
        let activeConnections = [];
        let currentConnectionId = null;

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

        // Toolbar buttons
        document.getElementById('executeButton').addEventListener('click', () => {
            executeQuery();
        });

        document.getElementById('cancelButton').addEventListener('click', () => {
            vscode.postMessage({ type: 'cancelQuery' });
        });

        document.getElementById('connectButton').addEventListener('click', () => {
            vscode.postMessage({ type: 'manageConnections' });
        });

        // Database selector
        document.getElementById('databaseSelector').addEventListener('change', (e) => {
            const connectionId = e.target.value;
            if (connectionId) {
                vscode.postMessage({
                    type: 'switchConnection',
                    connectionId: connectionId
                });
            }
        });

        // Tab switching
        document.querySelectorAll('.results-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentTab = tab.dataset.tab;

                if (currentTab === 'results' && lastResults) {
                    displayResults(lastResults);
                } else if (currentTab === 'messages') {
                    displayMessages(lastMessages);
                }
            });
        });

        // Resizer functionality
        const resizer = document.getElementById('resizer');
        const resultsContainer = document.getElementById('resultsContainer');
        const editorContainer = document.getElementById('editorContainer');
        const container = document.getElementById('container');

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizer.classList.add('active');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const containerRect = container.getBoundingClientRect();
            const newResultsHeight = containerRect.bottom - e.clientY;
            const minHeight = 100;
            const maxResultsHeight = containerRect.height - minHeight - 40; // 40 for toolbar

            if (newResultsHeight >= minHeight && newResultsHeight <= maxResultsHeight) {
                resultsContainer.style.flex = \`0 0 \${newResultsHeight}px\`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('active');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
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

            const databaseSelector = document.getElementById('databaseSelector');
            const connectionId = databaseSelector.value || null;

            vscode.postMessage({
                type: 'executeQuery',
                query: queryText,
                connectionId: connectionId
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

                case 'connectionsUpdate':
                    updateConnectionsList(message.connections, message.currentConnectionId);
                    break;

                case 'executing':
                    showLoading();
                    break;

                case 'results':
                    showResults(message.results, message.executionTime, message.rowsAffected, message.messages);
                    break;

                case 'error':
                    showError(message.error, message.messages);
                    break;
            }
        });

        function updateConnectionsList(connections, currentId) {
            activeConnections = connections;
            currentConnectionId = currentId;
            
            const databaseSelector = document.getElementById('databaseSelector');
            databaseSelector.innerHTML = '';
            
            if (connections.length === 0) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'Not Connected';
                databaseSelector.appendChild(option);
                databaseSelector.disabled = true;
            } else {
                databaseSelector.disabled = false;
                connections.forEach(conn => {
                    const option = document.createElement('option');
                    option.value = conn.id;
                    option.textContent = conn.database;
                    option.title = \`\${conn.server}/\${conn.database}\`;
                    if (conn.id === currentId) {
                        option.selected = true;
                    }
                    databaseSelector.appendChild(option);
                });
            }
        }

        function showLoading() {
            const resultsContent = document.getElementById('resultsContent');
            const statusLabel = document.getElementById('statusLabel');
            const executeButton = document.getElementById('executeButton');
            const cancelButton = document.getElementById('cancelButton');
            const resizer = document.getElementById('resizer');
            
            resultsContent.innerHTML = '<div class="loading">Executing query...</div>';
            resultsContainer.classList.add('visible');
            resizer.classList.add('visible');
            
            executeButton.disabled = true;
            cancelButton.disabled = false;
            statusLabel.textContent = 'Executing query...';

            // Show results panel with initial height if not already set
            if (!resultsContainer.style.flex) {
                resultsContainer.style.flex = '0 0 300px';
            }

            // Switch to results tab
            document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
            document.querySelector('.results-tab[data-tab="results"]').classList.add('active');
            currentTab = 'results';
        }

        function showResults(results, executionTime, rowsAffected, messages) {
            const executeButton = document.getElementById('executeButton');
            const cancelButton = document.getElementById('cancelButton');
            const statusLabel = document.getElementById('statusLabel');
            const executionStatsEl = document.getElementById('executionStats');
            
            lastResults = results;
            lastMessages = messages || [];
            
            executeButton.disabled = false;
            cancelButton.disabled = true;
            statusLabel.textContent = \`Query completed (\${results.length} rows)\`;

            // Update execution stats in compact format
            executionStatsEl.textContent = \`\${results.length} rows | \${executionTime}ms\`;

            if (currentTab === 'results') {
                displayResults(results);
            } else if (currentTab === 'messages') {
                displayMessages(messages);
            }
        }

        function displayResults(results) {
            const resultsContent = document.getElementById('resultsContent');

            if (!results || results.length === 0) {
                resultsContent.innerHTML = '<div class="no-results">No rows returned</div>';
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
        }

        function displayMessages(messages) {
            const resultsContent = document.getElementById('resultsContent');
            
            if (!messages || messages.length === 0) {
                resultsContent.innerHTML = '<div class="message info">No messages</div>';
                return;
            }

            let messagesHtml = '';
            messages.forEach(msg => {
                const msgClass = msg.type || 'info';
                messagesHtml += \`<div class="message \${msgClass}">\${escapeHtml(msg.text)}</div>\`;
            });
            
            resultsContent.innerHTML = messagesHtml;
        }

        function showError(error, messages) {
            const executeButton = document.getElementById('executeButton');
            const cancelButton = document.getElementById('cancelButton');
            const statusLabel = document.getElementById('statusLabel');
            const executionStatsEl = document.getElementById('executionStats');
            const resizer = document.getElementById('resizer');
            
            lastResults = [];
            lastMessages = messages || [{ type: 'error', text: error }];
            
            executeButton.disabled = false;
            cancelButton.disabled = true;
            
            const isCancelled = error.includes('cancel');
            statusLabel.textContent = isCancelled ? 'Query cancelled' : 'Query failed';
            executionStatsEl.textContent = '';

            resultsContainer.classList.add('visible');
            resizer.classList.add('visible');

            // Show results panel with initial height if not already set
            if (!resultsContainer.style.flex) {
                resultsContainer.style.flex = '0 0 300px';
            }

            // Switch to messages tab to show error
            document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
            document.querySelector('.results-tab[data-tab="messages"]').classList.add('active');
            currentTab = 'messages';

            displayMessages(lastMessages);
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
