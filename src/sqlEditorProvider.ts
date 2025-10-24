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
                        // Refresh the tree view to show the new connection
                        vscode.commands.executeCommand('mssqlManager.refresh');
                        break;
                    case 'switchConnection':
                        this.connectionProvider.setActiveConnection(message.connectionId);
                        this.sendActiveConnections(webviewPanel.webview);
                        break;
                    case 'getSchema':
                        await this.sendSchemaToWebview(webviewPanel.webview);
                        break;
                    case 'ready':
                        // Webview is ready, send initial content
                        this.updateWebview(webviewPanel.webview, document);
                        this.sendActiveConnections(webviewPanel.webview);
                        await this.sendSchemaToWebview(webviewPanel.webview);
                        break;
                }
            }
        );

        // Cleanup
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
            // Note: We don't need to manually remove the callback as the connectionProvider
            // will automatically filter out disposed callbacks when they throw errors
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

    private async sendSchemaToWebview(webview: vscode.Webview): Promise<void> {
        if (!this.connectionProvider.isConnected()) {
            webview.postMessage({ type: 'schemaUpdate', schema: { tables: [], views: [] } });
            return;
        }

        try {
            const connection = this.connectionProvider.getConnection();
            if (!connection) {
                return;
            }

            // Fetch tables and their columns
            const tablesQuery = `
                SELECT 
                    t.TABLE_SCHEMA,
                    t.TABLE_NAME,
                    c.COLUMN_NAME,
                    c.DATA_TYPE,
                    c.IS_NULLABLE
                FROM INFORMATION_SCHEMA.TABLES t
                LEFT JOIN INFORMATION_SCHEMA.COLUMNS c 
                    ON t.TABLE_SCHEMA = c.TABLE_SCHEMA 
                    AND t.TABLE_NAME = c.TABLE_NAME
                WHERE t.TABLE_TYPE = 'BASE TABLE'
                ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME, c.ORDINAL_POSITION
            `;

            const request = connection.request();
            const result = await request.query(tablesQuery);
            
            // Group by table
            const tablesMap = new Map<string, any>();
            
            result.recordset.forEach((row: any) => {
                const tableKey = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
                if (!tablesMap.has(tableKey)) {
                    tablesMap.set(tableKey, {
                        schema: row.TABLE_SCHEMA,
                        name: row.TABLE_NAME,
                        columns: []
                    });
                }
                
                if (row.COLUMN_NAME) {
                    tablesMap.get(tableKey)!.columns.push({
                        name: row.COLUMN_NAME,
                        type: row.DATA_TYPE,
                        nullable: row.IS_NULLABLE === 'YES'
                    });
                }
            });

            // Fetch views
            const viewsQuery = `
                SELECT 
                    TABLE_SCHEMA,
                    TABLE_NAME,
                    COLUMN_NAME,
                    DATA_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME IN (
                    SELECT TABLE_NAME 
                    FROM INFORMATION_SCHEMA.VIEWS
                )
                ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
            `;

            const viewsRequest = connection.request();
            const viewsResult = await viewsRequest.query(viewsQuery);
            
            const viewsMap = new Map<string, any>();
            
            viewsResult.recordset.forEach((row: any) => {
                const viewKey = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
                if (!viewsMap.has(viewKey)) {
                    viewsMap.set(viewKey, {
                        schema: row.TABLE_SCHEMA,
                        name: row.TABLE_NAME,
                        columns: []
                    });
                }
                
                if (row.COLUMN_NAME) {
                    viewsMap.get(viewKey)!.columns.push({
                        name: row.COLUMN_NAME,
                        type: row.DATA_TYPE
                    });
                }
            });

            // Fetch foreign key relationships
            const foreignKeysQuery = `
                SELECT 
                    fk.name AS constraint_name,
                    tp.name AS from_table,
                    SCHEMA_NAME(tp.schema_id) AS from_schema,
                    cp.name AS from_column,
                    tr.name AS to_table,
                    SCHEMA_NAME(tr.schema_id) AS to_schema,
                    cr.name AS to_column
                FROM sys.foreign_keys fk
                INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id
                INNER JOIN sys.tables tr ON fk.referenced_object_id = tr.object_id
                INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
                INNER JOIN sys.columns cp ON fkc.parent_column_id = cp.column_id AND fkc.parent_object_id = cp.object_id
                INNER JOIN sys.columns cr ON fkc.referenced_column_id = cr.column_id AND fkc.referenced_object_id = cr.object_id
                ORDER BY tp.name, fk.name
            `;

            const fkRequest = connection.request();
            const fkResult = await fkRequest.query(foreignKeysQuery);
            
            const foreignKeys = fkResult.recordset.map((row: any) => ({
                constraintName: row.constraint_name,
                fromTable: row.from_table,
                fromSchema: row.from_schema,
                fromColumn: row.from_column,
                toTable: row.to_table,
                toSchema: row.to_schema,
                toColumn: row.to_column
            }));

            webview.postMessage({
                type: 'schemaUpdate',
                schema: {
                    tables: Array.from(tablesMap.values()),
                    views: Array.from(viewsMap.values()),
                    foreignKeys: foreignKeys
                }
            });

        } catch (error) {
            this.outputChannel.appendLine(`Failed to fetch schema: ${error}`);
            webview.postMessage({ type: 'schemaUpdate', schema: { tables: [], views: [], foreignKeys: [] } });
        }
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
            border-bottom: 2px solid var(--vscode-focusBorder);
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
                Connect
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
        let dbSchema = { tables: [], views: [], foreignKeys: [] };

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

            // Register SQL completion provider
            monaco.languages.registerCompletionItemProvider('sql', {
                provideCompletionItems: (model, position) => {
                    return provideSqlCompletions(model, position);
                }
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

        // SQL Completion Provider Function
        function provideSqlCompletions(model, position) {
            const textUntilPosition = model.getValueInRange({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: position.lineNumber,
                endColumn: position.column
            });

            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn
            };

            // Check if we're after a dot (for column suggestions)
            const lineUntilPosition = model.getValueInRange({
                startLineNumber: position.lineNumber,
                startColumn: 1,
                endLineNumber: position.lineNumber,
                endColumn: position.column
            });

            const dotMatch = lineUntilPosition.match(/(\\w+)\\\.\\w*$/);
            
            if (dotMatch) {
                // User is typing after a dot, suggest columns
                const prefix = dotMatch[1].toLowerCase();
                
                // Find table/alias in the query
                const tableAlias = findTableForAlias(textUntilPosition, prefix);
                
                if (tableAlias) {
                    const columns = getColumnsForTable(tableAlias.schema, tableAlias.table);
                    return {
                        suggestions: columns.map(col => ({
                            label: col.name,
                            kind: monaco.languages.CompletionItemKind.Field,
                            detail: \`\${col.type}\${col.nullable ? ' (nullable)' : ''}\`,
                            insertText: col.name,
                            range: range
                        }))
                    };
                }
            }

            // Check if we're in SELECT or WHERE clause - suggest columns
            const lowerText = textUntilPosition.toLowerCase();
            
            // Check if we're in JOIN clause (after JOIN keyword, before ON)
            const joinMatch = /\\b((?:inner|left|right|full|cross)\\s+)?join\\s*$/i.exec(lineUntilPosition);
            if (joinMatch) {
                // Suggest tables that have foreign key relationships with tables already in the query
                // Use text until current position (excluding the JOIN keyword we're typing after)
                console.log('Text until position for JOIN analysis:', textUntilPosition);
                const tablesInQuery = extractTablesFromQuery(textUntilPosition);
                
                if (tablesInQuery.length > 0) {
                    const relatedTables = getRelatedTables(tablesInQuery);
                    console.log('Related tables for JOIN:', relatedTables.map(t => ({ name: t.name, hasFKInfo: !!t.foreignKeyInfo })));
                    console.log('Tables in query:', JSON.stringify(tablesInQuery, null, 2));
                    
                    return {
                        suggestions: relatedTables.map(table => {
                            const fullName = table.schema === 'dbo' ? table.name : \`\${table.schema}.\${table.name}\`;
                            
                            // Generate alias (first letter of table name or full name if short)
                            const tableAlias = table.name.length <= 3 ? table.name.toLowerCase() : table.name.charAt(0).toLowerCase();
                            
                            // Build the ON clause with FK relationship
                            let insertText = \`\${fullName} \${tableAlias}\`;
                            let detailText = \`Table (\${table.columns?.length || 0} columns)\`;
                            
                            if (table.foreignKeyInfo) {
                                const fkInfo = table.foreignKeyInfo;
                                const toAlias = tableAlias;
                                
                                // Use the alias from the query (which is the table name if no explicit alias)
                                const fromAlias = fkInfo.fromAlias;
                                
                                console.log('FK Info:', { direction: fkInfo.direction, fromTable: fkInfo.fromTable, fromAlias, hasExplicitAlias: fkInfo.fromHasExplicitAlias });
                                
                                if (fkInfo.direction === 'to') {
                                    insertText = \`\${fullName} \${toAlias} ON \${fromAlias}.\${fkInfo.fromColumn} = \${toAlias}.\${fkInfo.toColumn}\`;
                                    detailText = \`Join on \${fromAlias}.\${fkInfo.fromColumn} = \${toAlias}.\${fkInfo.toColumn}\`;
                                } else {
                                    insertText = \`\${fullName} \${toAlias} ON \${toAlias}.\${fkInfo.fromColumn} = \${fromAlias}.\${fkInfo.toColumn}\`;
                                    detailText = \`Join on \${toAlias}.\${fkInfo.fromColumn} = \${fromAlias}.\${fkInfo.toColumn}\`;
                                }
                                
                                console.log('Generated insertText:', insertText);
                            }
                            
                            return {
                                label: fullName,
                                kind: monaco.languages.CompletionItemKind.Class,
                                detail: detailText,
                                insertText: insertText,
                                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                                range: range,
                                sortText: \`0_\${fullName}\`
                            };
                        })
                    };
                }
            }
            
            // Check if we're in SELECT clause (between SELECT and FROM, or after SELECT with no FROM yet)
            const selectMatch = /\\bselect\\b(.*?)(?:\\bfrom\\b|$)/is.exec(lowerText);
            const fromMatch = /\\bfrom\\b/i.exec(lowerText);
            const whereMatch = /\\bwhere\\b/i.exec(lowerText);
            
            let inSelectClause = false;
            let inWhereClause = false;
            
            if (selectMatch && fromMatch) {
                // Check if cursor is between SELECT and FROM
                const selectPos = lowerText.indexOf('select');
                const fromPos = lowerText.indexOf('from');
                inSelectClause = fromPos > selectPos && textUntilPosition.length <= lowerText.lastIndexOf('from') + 4;
            } else if (selectMatch && !fromMatch) {
                inSelectClause = true;
            }
            
            if (whereMatch) {
                inWhereClause = true;
            }
            
            if (inSelectClause || inWhereClause) {
                // Get all tables/aliases from the FULL query (not just textUntilPosition)
                const fullText = model.getValue();
                const tablesInQuery = extractTablesFromQuery(fullText);
                
                if (tablesInQuery.length > 0) {
                    const suggestions = [];
                    
                    // Add columns from all tables in the query
                    tablesInQuery.forEach(tableInfo => {
                        const columns = getColumnsForTable(tableInfo.schema, tableInfo.table);
                        columns.forEach(col => {
                            const prefix = tableInfo.alias || tableInfo.table;
                            suggestions.push({
                                label: col.name,
                                kind: monaco.languages.CompletionItemKind.Field,
                                detail: \`\${prefix}.\${col.name} (\${col.type})\`,
                                insertText: col.name,
                                range: range,
                                sortText: \`0_\${col.name}\` // Prioritize columns
                            });
                            
                            // Also suggest with table prefix
                            suggestions.push({
                                label: \`\${prefix}.\${col.name}\`,
                                kind: monaco.languages.CompletionItemKind.Field,
                                detail: \`\${col.type}\${col.nullable ? ' (nullable)' : ''}\`,
                                insertText: \`\${prefix}.\${col.name}\`,
                                range: range,
                                sortText: \`1_\${col.name}\`
                            });
                        });
                    });
                    
                    // Add SQL keywords too
                    const keywords = ['AS', 'AND', 'OR', 'DISTINCT', 'TOP', 'ORDER BY', 'GROUP BY'];
                    keywords.forEach(keyword => {
                        suggestions.push({
                            label: keyword,
                            kind: monaco.languages.CompletionItemKind.Keyword,
                            insertText: keyword,
                            range: range,
                            sortText: \`9_\${keyword}\` // Lower priority
                        });
                    });
                    
                    return { suggestions };
                }
            }

            // Default: suggest tables and views
            const suggestions = [];

            // Add tables
            dbSchema.tables.forEach(table => {
                const fullName = table.schema === 'dbo' ? table.name : \`\${table.schema}.\${table.name}\`;
                suggestions.push({
                    label: fullName,
                    kind: monaco.languages.CompletionItemKind.Class,
                    detail: \`Table (\${table.columns.length} columns)\`,
                    insertText: fullName,
                    range: range
                });
            });

            // Add views
            dbSchema.views.forEach(view => {
                const fullName = view.schema === 'dbo' ? view.name : \`\${view.schema}.\${view.name}\`;
                suggestions.push({
                    label: fullName,
                    kind: monaco.languages.CompletionItemKind.Interface,
                    detail: \`View (\${view.columns.length} columns)\`,
                    insertText: fullName,
                    range: range
                });
            });

            // Add SQL keywords
            const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 
                            'ON', 'AND', 'OR', 'ORDER BY', 'GROUP BY', 'HAVING', 'INSERT', 'UPDATE', 
                            'DELETE', 'CREATE', 'ALTER', 'DROP', 'AS', 'DISTINCT', 'TOP', 'LIMIT'];
            
            keywords.forEach(keyword => {
                suggestions.push({
                    label: keyword,
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: keyword,
                    range: range
                });
            });

            return { suggestions };
        }

        function extractTablesFromQuery(query) {
            const tables = [];
            const lowerQuery = query.toLowerCase();
            
            // SQL keywords that should not be considered as aliases
            const sqlKeywords = ['select', 'from', 'where', 'join', 'inner', 'left', 'right', 'full', 'cross', 'on', 'and', 'or', 'order', 'group', 'by', 'having'];
            
            // Match FROM and JOIN clauses with optional aliases
            // Patterns: FROM schema.table alias, FROM table alias, JOIN schema.table alias, etc.
            const patterns = [
                /\\b(?:from|join)\\s+(?:(\\w+)\\.)?(\\w+)(?:\\s+(?:as\\s+)?(\\w+))?/gi
            ];
            
            patterns.forEach(pattern => {
                let match;
                while ((match = pattern.exec(query)) !== null) {
                    const schema = match[1] || 'dbo';
                    const table = match[2];
                    let alias = match[3];
                    
                    // Skip if the captured alias is actually a SQL keyword
                    if (alias && sqlKeywords.includes(alias.toLowerCase())) {
                        alias = undefined;
                    }
                    
                    // Verify this is a valid table in our schema
                    const tableInfo = findTable(table.toLowerCase());
                    if (tableInfo) {
                        const hasExplicitAlias = !!alias;
                        
                        // If no explicit alias, use the table name as the alias
                        if (!alias) {
                            alias = tableInfo.table;
                        }
                        
                        tables.push({
                            schema: tableInfo.schema,
                            table: tableInfo.table,
                            alias: alias,
                            hasExplicitAlias: hasExplicitAlias
                        });
                    }
                }
            });
            
            return tables;
        }

        function findTableForAlias(query, alias) {
            const lowerQuery = query.toLowerCase();
            const lowerAlias = alias.toLowerCase();

            // Pattern: FROM tableName alias or JOIN tableName alias
            const patterns = [
                new RegExp(\`from\\\\s+(?:(\\\\w+)\\\\.)?(\\\\w+)\\\\s+(?:as\\\\s+)?\${lowerAlias}(?:\\\\s|,|\\$)\`, 'i'),
                new RegExp(\`join\\\\s+(?:(\\\\w+)\\\\.)?(\\\\w+)\\\\s+(?:as\\\\s+)?\${lowerAlias}(?:\\\\s|,|\\$)\`, 'i')
            ];

            for (const pattern of patterns) {
                const match = query.match(pattern);
                if (match) {
                    return {
                        schema: match[1] || 'dbo',
                        table: match[2]
                    };
                }
            }

            // Check if alias is actually the table name itself
            const directTable = findTable(lowerAlias);
            if (directTable) {
                return directTable;
            }

            return null;
        }

        function findTable(tableName) {
            const lowerName = tableName.toLowerCase();
            
            for (const table of dbSchema.tables) {
                if (table.name.toLowerCase() === lowerName) {
                    return { schema: table.schema, table: table.name };
                }
            }
            
            for (const view of dbSchema.views) {
                if (view.name.toLowerCase() === lowerName) {
                    return { schema: view.schema, table: view.name };
                }
            }
            
            return null;
        }

        function getColumnsForTable(schema, tableName) {
            const lowerName = tableName.toLowerCase();
            
            for (const table of dbSchema.tables) {
                if (table.name.toLowerCase() === lowerName && table.schema === schema) {
                    return table.columns;
                }
            }
            
            for (const view of dbSchema.views) {
                if (view.name.toLowerCase() === lowerName && view.schema === schema) {
                    return view.columns;
                }
            }
            
            return [];
        }

        function getRelatedTables(tablesInQuery) {
            const relatedTables = [];
            const existingTableNames = tablesInQuery.map(t => t.table.toLowerCase());
            
            // Get all tables with foreign keys
            if (dbSchema.foreignKeys) {
                tablesInQuery.forEach(tableInfo => {
                    const tableName = tableInfo.table.toLowerCase();
                    
                    // Find foreign keys FROM this table (this table references other tables)
                    dbSchema.foreignKeys.forEach(fk => {
                        if (fk.fromTable.toLowerCase() === tableName && 
                            !existingTableNames.includes(fk.toTable.toLowerCase())) {
                            
                            const table = dbSchema.tables.find(t => 
                                t.name.toLowerCase() === fk.toTable.toLowerCase() && 
                                t.schema === fk.toSchema
                            );
                            
                            if (table && !relatedTables.find(rt => 
                                rt.name.toLowerCase() === table.name.toLowerCase() && 
                                rt.schema === table.schema
                            )) {
                                relatedTables.push({
                                    ...table,
                                    foreignKeyInfo: {
                                        direction: 'to',
                                        fromTable: fk.fromTable,
                                        fromAlias: tableInfo.alias,
                                        fromHasExplicitAlias: tableInfo.hasExplicitAlias,
                                        fromColumn: fk.fromColumn,
                                        toTable: fk.toTable,
                                        toColumn: fk.toColumn
                                    }
                                });
                            }
                        }
                        
                        // Find foreign keys TO this table (other tables reference this table)
                        if (fk.toTable.toLowerCase() === tableName && 
                            !existingTableNames.includes(fk.fromTable.toLowerCase())) {
                            
                            const table = dbSchema.tables.find(t => 
                                t.name.toLowerCase() === fk.fromTable.toLowerCase() && 
                                t.schema === fk.fromSchema
                            );
                            
                            if (table && !relatedTables.find(rt => 
                                rt.name.toLowerCase() === table.name.toLowerCase() && 
                                rt.schema === table.schema
                            )) {
                                relatedTables.push({
                                    ...table,
                                    foreignKeyInfo: {
                                        direction: 'from',
                                        fromTable: fk.fromTable,
                                        fromAlias: tableInfo.alias,
                                        fromHasExplicitAlias: tableInfo.hasExplicitAlias,
                                        fromColumn: fk.fromColumn,
                                        toTable: fk.toTable,
                                        toColumn: fk.toColumn
                                    }
                                });
                            }
                        }
                    });
                });
            }
            
            // If no related tables found or no FK info, return all tables except those already in query
            if (relatedTables.length === 0) {
                return dbSchema.tables.filter(table => 
                    !existingTableNames.includes(table.name.toLowerCase())
                );
            }
            
            return relatedTables;
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
                    // Request schema update when connection changes
                    vscode.postMessage({ type: 'getSchema' });
                    break;

                case 'schemaUpdate':
                    dbSchema = message.schema || { tables: [], views: [], foreignKeys: [] };
                    console.log('Schema updated:', dbSchema.tables.length, 'tables', dbSchema.views.length, 'views', dbSchema.foreignKeys.length, 'foreign keys');
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
            console.log('[SQL EDITOR] displayResults called with AG-Grid table - NEW VERSION', results.length, 'rows');
            const resultsContent = document.getElementById('resultsContent');

            if (!results || results.length === 0) {
                resultsContent.innerHTML = '<div class="no-results">No rows returned</div>';
                return;
            }

            // Initialize AG-Grid-like table
            initAgGridTable(results, resultsContent);
        }

        function initAgGridTable(rowData, container) {
            // Detect column types and create columnDefs
            const columns = Object.keys(rowData[0]);
            const columnDefs = columns.map(col => {
                const sampleValue = rowData[0][col];
                let type = 'string';
                
                if (typeof sampleValue === 'number') {
                    type = 'number';
                } else if (typeof sampleValue === 'boolean') {
                    type = 'boolean';
                } else if (sampleValue instanceof Date || (typeof sampleValue === 'string' && !isNaN(Date.parse(sampleValue)) && sampleValue.match(/\\d{4}-\\d{2}-\\d{2}/))) {
                    type = 'date';
                }
                
                return {
                    field: col,
                    headerName: col,
                    type: type,
                    width: 150,
                    pinned: false
                };
            });

            let filteredData = [...rowData];
            let activeFilters = {};
            let currentFilterPopup = null;
            let sortConfig = { field: null, direction: null };

            // Build the table HTML structure
            const tableHtml = \`
                <div class="ag-grid-container" style="width: 100%; height: 100%; overflow: auto; position: relative;">
                    <table class="ag-grid-table" style="border-collapse: collapse; table-layout: auto; min-width: 100%;">
                        <thead id="agGridHead"></thead>
                        <tbody id="agGridBody"></tbody>
                    </table>
                </div>
            \`;
            
            container.innerHTML = tableHtml;

            renderAgGridHeaders(columnDefs, sortConfig, activeFilters);
            renderAgGridRows(columnDefs, filteredData);

            function renderAgGridHeaders(colDefs, sortCfg, filters) {
                const thead = document.getElementById('agGridHead');
                if (!thead) return;
                
                const tr = document.createElement('tr');
                
                // Add row number header
                const rowNumTh = document.createElement('th');
                rowNumTh.className = 'ag-grid-row-number-header';
                rowNumTh.textContent = '#';
                rowNumTh.style.cssText = \`
                    width: 50px;
                    min-width: 50px;
                    max-width: 50px;
                    position: sticky;
                    left: 0;
                    background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
                    border-right: 2px solid var(--vscode-panel-border, #3c3c3c);
                    text-align: center;
                    font-weight: 600;
                    user-select: none;
                    z-index: 20;
                    top: 0;
                    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
                    padding: 8px;
                \`;
                tr.appendChild(rowNumTh);
                
                const totalWidth = colDefs.reduce((sum, col) => sum + col.width, 0) + 50;
                const table = container.querySelector('.ag-grid-table');
                table.style.width = totalWidth + 'px';
                table.style.minWidth = totalWidth + 'px';

                colDefs.forEach((col, index) => {
                    const th = document.createElement('th');
                    th.style.cssText = \`
                        width: \${col.width}px;
                        min-width: \${col.width}px;
                        max-width: \${col.width}px;
                        background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
                        border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
                        border-right: 1px solid var(--vscode-panel-border, #3c3c3c);
                        padding: 8px;
                        text-align: left;
                        font-weight: 600;
                        position: sticky;
                        top: 0;
                        z-index: \${col.pinned ? 19 : 10};
                        user-select: none;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    \`;
                    
                    if (col.pinned) {
                        const leftOffset = calculatePinnedOffset(colDefs, index);
                        th.style.left = leftOffset + 'px';
                        th.classList.add('ag-grid-pinned-header');
                    }
                    
                    th.dataset.field = col.field;

                    const headerContent = document.createElement('div');
                    headerContent.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px;';

                    const headerTitle = document.createElement('span');
                    headerTitle.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 4px; cursor: pointer;';
                    
                    const titleText = document.createElement('span');
                    titleText.textContent = col.headerName;
                    headerTitle.appendChild(titleText);

                    headerTitle.onclick = (e) => {
                        e.stopPropagation();
                        highlightColumn(index, colDefs);
                    };

                    const sortIcon = document.createElement('span');
                    const isSorted = sortCfg.field === col.field;
                    sortIcon.style.cssText = \`display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 2px 4px; border-radius: 2px; opacity: \${isSorted ? 1 : 0.6}; transition: opacity 0.2s, background-color 0.2s;\`;
                    
                    if (isSorted) {
                        // Show chevron when sorted
                        sortIcon.innerHTML = \`
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--vscode-button-background, #0e639c)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="\${sortCfg.direction === 'desc' ? 'transform: rotate(180deg);' : ''}">
                                <path d="M6 15l6 -6l6 6" />
                            </svg>
                        \`;
                    } else {
                        // Show sort icon when not sorted
                        sortIcon.innerHTML = \`
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 9l4 -4l4 4m-4 -4v14" />
                                <path d="M21 15l-4 4l-4 -4m4 4v-14" />
                            </svg>
                        \`;
                    }
                    
                    sortIcon.onmouseover = () => sortIcon.style.opacity = '1';
                    sortIcon.onmouseout = () => sortIcon.style.opacity = isSorted ? '1' : '0.6';
                    sortIcon.onclick = (e) => {
                        e.stopPropagation();
                        handleSort(col, colDefs, sortCfg, filters);
                    };

                    const pinIcon = document.createElement('span');
                    pinIcon.style.cssText = \`display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 2px 4px; border-radius: 2px; opacity: \${col.pinned ? 1 : 0.6}; transition: opacity 0.2s, background-color 0.2s;\`;
                    pinIcon.innerHTML = \`
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="\${col.pinned ? 'var(--vscode-button-background, #0e639c)' : 'currentColor'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4" />
                            <path d="M9 15l-4.5 4.5" />
                            <path d="M14.5 4l5.5 5.5" />
                        </svg>
                    \`;
                    pinIcon.onmouseover = () => pinIcon.style.opacity = '1';
                    pinIcon.onmouseout = () => pinIcon.style.opacity = col.pinned ? '1' : '0.6';
                    pinIcon.onclick = (e) => {
                        e.stopPropagation();
                        col.pinned = !col.pinned;
                        renderAgGridHeaders(colDefs, sortCfg, filters);
                        renderAgGridRows(colDefs, filteredData);
                    };

                    const filterIcon = document.createElement('span');
                    const isFiltered = !!filters[col.field];
                    filterIcon.style.cssText = \`display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 2px 4px; border-radius: 2px; opacity: \${isFiltered ? 1 : 0.6}; transition: opacity 0.2s, background-color 0.2s;\`;
                    filterIcon.innerHTML = \`
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="\${isFiltered ? 'var(--vscode-button-background, #0e639c)' : 'currentColor'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227z" />
                        </svg>
                    \`;
                    filterIcon.onmouseover = () => filterIcon.style.opacity = '1';
                    filterIcon.onmouseout = () => filterIcon.style.opacity = isFiltered ? '1' : '0.6';
                    filterIcon.onclick = (e) => showAgGridFilter(e, col, th, colDefs, sortCfg, filters);

                    // Add resize handle
                    const resizeHandle = document.createElement('div');
                    resizeHandle.style.cssText = \`
                        position: absolute;
                        right: 0;
                        top: 0;
                        width: 4px;
                        height: 100%;
                        cursor: col-resize;
                        background-color: transparent;
                        transition: background-color 0.2s;
                        z-index: 25;
                    \`;
                    resizeHandle.onmouseover = () => resizeHandle.style.backgroundColor = 'var(--vscode-button-background, #0e639c)';
                    resizeHandle.onmouseout = () => resizeHandle.style.backgroundColor = 'transparent';
                    resizeHandle.onmousedown = (e) => startResize(e, th, index, colDefs, sortCfg, filters);

                    th.style.position = 'relative';
                    headerContent.appendChild(headerTitle);
                    headerContent.appendChild(sortIcon);
                    headerContent.appendChild(pinIcon);
                    headerContent.appendChild(filterIcon);
                    th.appendChild(headerContent);
                    th.appendChild(resizeHandle);
                    tr.appendChild(th);
                });

                thead.innerHTML = '';
                thead.appendChild(tr);
            }

            // Column highlighting functionality
            function highlightColumn(colIndex, colDefs) {
                const table = container.querySelector('.ag-grid-table');
                const allCells = table.querySelectorAll('th, td');
                
                // Remove previous column highlights
                allCells.forEach(cell => {
                    cell.style.backgroundColor = '';
                });
                
                // Remove row selection
                const allRows = table.querySelectorAll('tbody tr');
                allRows.forEach(row => {
                    row.classList.remove('selected');
                });
                
                // Highlight the selected column (colIndex + 2 because row number is column 1)
                const columnCells = table.querySelectorAll(\`th:nth-child(\${colIndex + 2}), td:nth-child(\${colIndex + 2})\`);
                columnCells.forEach(cell => {
                    if (cell.classList.contains('ag-grid-pinned-cell') || cell.classList.contains('ag-grid-pinned-header')) {
                        cell.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
                    } else {
                        cell.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
                    }
                });
            }

            // Column resizing functionality
            let resizingColumn = null;
            let startX = 0;
            let startWidth = 0;

            function startResize(e, th, colIndex, colDefs, sortCfg, filters) {
                resizingColumn = { th, colIndex };
                startX = e.clientX;
                startWidth = th.offsetWidth;

                document.addEventListener('mousemove', doResize);
                document.addEventListener('mouseup', stopResize);
                e.preventDefault();
                e.stopPropagation();
            }

            function doResize(e) {
                if (!resizingColumn) return;

                const diff = e.clientX - startX;
                const newWidth = Math.max(50, startWidth + diff);
                
                resizingColumn.th.style.width = newWidth + 'px';
                resizingColumn.th.style.minWidth = newWidth + 'px';
                resizingColumn.th.style.maxWidth = newWidth + 'px';
                columnDefs[resizingColumn.colIndex].width = newWidth;
                
                // Update total table width
                const totalWidth = columnDefs.reduce((sum, col) => sum + col.width, 0) + 50;
                const table = container.querySelector('.ag-grid-table');
                table.style.width = totalWidth + 'px';
                table.style.minWidth = totalWidth + 'px';
                
                // Update all cells in this column (+2 because row number is first column)
                const cells = table.querySelectorAll(\`td:nth-child(\${resizingColumn.colIndex + 2})\`);
                cells.forEach(cell => {
                    cell.style.width = newWidth + 'px';
                    cell.style.minWidth = newWidth + 'px';
                    cell.style.maxWidth = newWidth + 'px';
                });
            }

            function stopResize() {
                resizingColumn = null;
                document.removeEventListener('mousemove', doResize);
                document.removeEventListener('mouseup', stopResize);
            }

            function renderAgGridRows(colDefs, data) {
                const tbody = document.getElementById('agGridBody');
                if (!tbody) return;
                
                tbody.innerHTML = '';

                data.forEach((row, rowIndex) => {
                    const tr = document.createElement('tr');
                    tr.dataset.rowIndex = rowIndex;
                    tr.style.cssText = 'border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);';
                    tr.onmouseenter = () => tr.style.backgroundColor = 'var(--vscode-list-hoverBackground, #2a2d2e)';
                    tr.onmouseleave = () => {
                        if (!tr.classList.contains('selected')) {
                            tr.style.backgroundColor = '';
                        }
                    };

                    // Add row number cell
                    const rowNumTd = document.createElement('td');
                    rowNumTd.className = 'ag-grid-row-number-cell';
                    rowNumTd.textContent = rowIndex + 1;
                    rowNumTd.style.cssText = \`
                        width: 50px;
                        min-width: 50px;
                        max-width: 50px;
                        position: sticky;
                        left: 0;
                        background-color: var(--vscode-editor-background, #1e1e1e);
                        border-right: 2px solid var(--vscode-panel-border, #3c3c3c);
                        text-align: center;
                        font-weight: 600;
                        user-select: none;
                        z-index: 6;
                        cursor: pointer;
                        padding: 6px 8px;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    \`;
                    rowNumTd.onmouseenter = () => rowNumTd.style.backgroundColor = 'var(--vscode-list-hoverBackground, #2a2d2e)';
                    rowNumTd.onmouseleave = () => {
                        if (!tr.classList.contains('selected')) {
                            rowNumTd.style.backgroundColor = 'var(--vscode-editor-background, #1e1e1e)';
                        }
                    };
                    rowNumTd.onclick = () => {
                        const table = container.querySelector('.ag-grid-table');
                        
                        // Remove column highlights
                        const allCells = table.querySelectorAll('th, td');
                        allCells.forEach(cell => {
                            if (!cell.classList.contains('ag-grid-row-number-cell') && !cell.classList.contains('ag-grid-row-number-header')) {
                                cell.style.backgroundColor = '';
                            }
                        });
                        
                        // Remove previous row selection
                        const allRows = tbody.querySelectorAll('tr');
                        allRows.forEach(r => {
                            r.classList.remove('selected');
                            r.style.backgroundColor = '';
                            const numCell = r.querySelector('.ag-grid-row-number-cell');
                            if (numCell) numCell.style.backgroundColor = 'var(--vscode-editor-background, #1e1e1e)';
                        });
                        
                        // Highlight selected row
                        tr.classList.add('selected');
                        tr.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
                        rowNumTd.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
                    };
                    tr.appendChild(rowNumTd);

                    colDefs.forEach((col, colIndex) => {
                        const td = document.createElement('td');
                        td.style.cssText = \`
                            width: \${col.width}px;
                            min-width: \${col.width}px;
                            max-width: \${col.width}px;
                            border-right: 1px solid var(--vscode-panel-border, #3c3c3c);
                            padding: 6px 8px;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                        \`;
                        
                        if (col.pinned) {
                            const leftOffset = calculatePinnedOffset(colDefs, colIndex);
                            td.style.position = 'sticky';
                            td.style.left = leftOffset + 'px';
                            td.style.backgroundColor = 'var(--vscode-editor-background, #1e1e1e)';
                            td.style.zIndex = '5';
                            td.classList.add('ag-grid-pinned-cell');
                        }
                        
                        const value = row[col.field];
                        
                        if (value === null || value === undefined) {
                            td.textContent = 'NULL';
                            td.style.color = 'var(--vscode-descriptionForeground)';
                            td.style.fontStyle = 'italic';
                        } else if (col.type === 'boolean') {
                            td.textContent = value ? '✓' : '✗';
                        } else if (col.type === 'number') {
                            td.textContent = typeof value === 'number' ? value.toLocaleString() : value;
                            td.style.textAlign = 'right';
                        } else {
                            td.textContent = String(value);
                        }

                        tr.appendChild(td);
                    });

                    tbody.appendChild(tr);
                });
            }

            function calculatePinnedOffset(colDefs, colIndex) {
                let offset = 50; // Start after row number column
                for (let i = 0; i < colIndex; i++) {
                    if (colDefs[i].pinned) {
                        offset += colDefs[i].width;
                    }
                }
                return offset;
            }

            function handleSort(col, colDefs, sortCfg, filters) {
                if (sortCfg.field === col.field) {
                    if (sortCfg.direction === 'asc') {
                        sortCfg.direction = 'desc';
                    } else if (sortCfg.direction === 'desc') {
                        sortCfg.field = null;
                        sortCfg.direction = null;
                    }
                } else {
                    sortCfg.field = col.field;
                    sortCfg.direction = 'asc';
                }
                
                updateFilteredData(colDefs, sortCfg, filters);
                renderAgGridHeaders(colDefs, sortCfg, filters);
            }

            function showAgGridFilter(e, col, th, colDefs, sortCfg, filters) {
                e.stopPropagation();

                if (currentFilterPopup) {
                    currentFilterPopup.remove();
                    currentFilterPopup = null;
                }

                const popup = document.createElement('div');
                popup.style.cssText = \`
                    position: absolute;
                    background-color: var(--vscode-dropdown-background, #3c3c3c);
                    border: 1px solid var(--vscode-dropdown-border, #454545);
                    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
                    padding: 12px;
                    z-index: 1000;
                    min-width: 200px;
                    max-width: 300px;
                    border-radius: 3px;
                \`;

                const rect = th.getBoundingClientRect();
                popup.style.left = rect.left + 'px';
                popup.style.top = (rect.bottom + 5) + 'px';

                let html = \`<h4 style="margin-bottom: 8px; font-size: 12px;">Filter: \${col.headerName}</h4>\`;

                // Simple value selection for now
                const uniqueValues = [...new Set(rowData.map(row => row[col.field]))].sort();
                const currentFilter = filters[col.field];
                const selectedValues = currentFilter?.values || uniqueValues;

                html += '<input type="text" id="agFilterSearch" placeholder="Search..." style="width: 100%; padding: 4px 6px; margin-bottom: 8px; background-color: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); border: 1px solid var(--vscode-input-border, #3c3c3c); border-radius: 2px; font-size: 12px;">';
                html += '<div style="font-size: 11px; color: var(--vscode-descriptionForeground, #999999); margin-bottom: 4px;">' + selectedValues.length + ' Selected</div>';
                html += '<div style="margin-bottom: 8px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);">';
                html += '<label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" id="agSelectAll" ' + (selectedValues.length === uniqueValues.length ? 'checked' : '') + ' style="cursor: pointer; accent-color: var(--vscode-button-background, #0e639c);"><span style="font-size: 12px;">(Select All)</span></label>';
                html += '</div>';
                html += '<div id="agFilterValuesList" style="max-height: 200px; overflow-y: auto; margin-bottom: 8px;">';

                uniqueValues.forEach((value, idx) => {
                    const displayValue = col.type === 'boolean' ? (value ? 'True' : 'False') : 
                                       value === null || value === undefined ? 'NULL' : String(value);
                    const checked = selectedValues.includes(value) ? 'checked' : '';
                    html += \`
                        <label style="display: flex; align-items: center; gap: 6px; padding: 4px 0; cursor: pointer;" data-value="\${displayValue.toString().toLowerCase()}">
                            <input type="checkbox" value="\${value}" \${checked} class="ag-value-checkbox" style="cursor: pointer; accent-color: var(--vscode-button-background, #0e639c);">
                            <span style="flex: 1; font-size: 12px;">\${displayValue}</span>
                        </label>
                    \`;
                });

                html += '</div>';
                html += \`
                    <div style="display: flex; gap: 8px; justify-content: flex-end;">
                        <button id="agFilterClear" style="padding: 4px 12px; background-color: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #cccccc); border: none; border-radius: 2px; cursor: pointer; font-size: 11px;">Clear</button>
                        <button id="agFilterApply" style="padding: 4px 12px; background-color: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #ffffff); border: none; border-radius: 2px; cursor: pointer; font-size: 11px;">Apply</button>
                    </div>
                \`;

                popup.innerHTML = html;
                document.body.appendChild(popup);
                currentFilterPopup = popup;

                // Setup event listeners
                const searchInput = popup.querySelector('#agFilterSearch');
                searchInput.oninput = () => {
                    const searchTerm = searchInput.value.toLowerCase();
                    const items = popup.querySelectorAll('#agFilterValuesList label');
                    items.forEach(item => {
                        const value = item.dataset.value;
                        item.style.display = value.includes(searchTerm) ? 'flex' : 'none';
                    });
                };

                const selectAllCheckbox = popup.querySelector('#agSelectAll');
                const valueCheckboxes = popup.querySelectorAll('.ag-value-checkbox');
                
                selectAllCheckbox.onchange = () => {
                    valueCheckboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
                };

                popup.querySelector('#agFilterClear').onclick = () => {
                    delete filters[col.field];
                    updateFilteredData(colDefs, sortCfg, filters);
                    renderAgGridHeaders(colDefs, sortCfg, filters);
                    popup.remove();
                    currentFilterPopup = null;
                };

                popup.querySelector('#agFilterApply').onclick = () => {
                    const checkboxes = popup.querySelectorAll('.ag-value-checkbox:checked');
                    const values = [...checkboxes].map(cb => {
                        const val = cb.value;
                        if (col.type === 'number') return parseFloat(val);
                        if (col.type === 'boolean') return val === 'true';
                        return val;
                    });
                    filters[col.field] = { values };
                    updateFilteredData(colDefs, sortCfg, filters);
                    renderAgGridHeaders(colDefs, sortCfg, filters);
                    popup.remove();
                    currentFilterPopup = null;
                };

                setTimeout(() => {
                    document.addEventListener('click', closeFilterPopup);
                }, 0);

                function closeFilterPopup(e) {
                    if (currentFilterPopup && !currentFilterPopup.contains(e.target)) {
                        currentFilterPopup.remove();
                        currentFilterPopup = null;
                        document.removeEventListener('click', closeFilterPopup);
                    }
                }
            }

            function updateFilteredData(colDefs, sortCfg, filters) {
                filteredData = rowData.filter(row => {
                    return Object.entries(filters).every(([field, filter]) => {
                        const value = row[field];
                        return filter.values && filter.values.includes(value);
                    });
                });

                if (sortCfg.field) {
                    filteredData.sort((a, b) => {
                        const aVal = a[sortCfg.field];
                        const bVal = b[sortCfg.field];
                        
                        let comparison = 0;
                        if (aVal < bVal) comparison = -1;
                        if (aVal > bVal) comparison = 1;
                        
                        return sortCfg.direction === 'asc' ? comparison : -comparison;
                    });
                }

                renderAgGridRows(colDefs, filteredData);
            }
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
