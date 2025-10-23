import * as vscode from 'vscode';

export class ResultWebview {
    private static currentPanel: vscode.WebviewPanel | undefined;
    private _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

        // If we already have a panel, show it
        if (ResultWebview.currentPanel) {
            ResultWebview.currentPanel.reveal(column);
            return ResultWebview.currentPanel.webview;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'mssqlResults',
            'SQL Results',
            column,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        ResultWebview.currentPanel = panel;
        const webview = new ResultWebview(panel, extensionUri);
        return panel.webview;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;

        // Set the webview's initial html content
        this._panel.webview.html = this.getWebviewContent();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public dispose() {
        ResultWebview.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private getWebviewContent(): string {
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
    <title>Query Results</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 10px;
        }

        .results-container {
            overflow: auto;
            max-height: calc(100vh - 20px);
        }

        table {
            border-collapse: collapse;
            width: 100%;
            background-color: var(--vscode-editor-background);
            font-size: 0.9em;
        }

        th, td {
            border: 1px solid var(--vscode-panel-border);
            padding: 6px 10px;
            text-align: left;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 300px;
            vertical-align: top;
        }

        th {
            background-color: var(--vscode-editor-lineHighlightBackground);
            font-weight: 600;
            position: sticky;
            top: 0;
            cursor: pointer;
            user-select: none;
            z-index: 10;
        }

        th:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .no-data {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .error {
            color: var(--vscode-errorForeground);
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            padding: 15px;
            border-radius: 4px;
            margin: 10px 0;
            font-family: var(--vscode-editor-font-family);
            white-space: pre-wrap;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .stats {
            margin-top: 15px;
            padding-top: 10px;
            border-top: 1px solid var(--vscode-panel-border);
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            text-align: right;
        }

        .null-value {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .number-value {
            text-align: right;
        }
    </style>
</head>
<body>
    <div class="results-container">
        <div class="loading" id="loading" style="display: none;">
            Executing query...
        </div>
        
        <div class="error" id="error" style="display: none;"></div>
        
        <table id="resultsTable" style="display: none;">
            <thead>
                <tr id="header"></tr>
            </thead>
            <tbody id="body"></tbody>
        </table>
        
        <div class="no-data" id="noData" style="display: none;">
            <p>No rows returned</p>
        </div>
    </div>
    
    <div class="stats" id="stats" style="display: none;"></div>

    <script>
        let currentData = [];

        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'showLoading':
                    showLoading();
                    break;
                case 'showResults':
                    showResults(message.results, message.executionTime);
                    break;
                case 'showError':
                    showError(message.error);
                    break;
            }
        });

        function showLoading() {
            hideAll();
            document.getElementById('loading').style.display = 'block';
        }

        function showResults(results, executionTime) {
            hideAll();

            if (!results || results.length === 0) {
                document.getElementById('noData').style.display = 'block';
                showStats(0, executionTime);
                return;
            }

            currentData = results;
            const table = document.getElementById('resultsTable');
            const header = document.getElementById('header');
            const body = document.getElementById('body');
            
            // Clear previous results
            header.innerHTML = '';
            body.innerHTML = '';
            
            // Create headers
            const columns = Object.keys(results[0]);
            columns.forEach((column, index) => {
                const th = document.createElement('th');
                th.textContent = column;
                header.appendChild(th);
            });
            
            // Create rows
            renderTableBody(results);
            
            // Show table and stats
            table.style.display = 'table';
            showStats(results.length, executionTime);
        }

        function renderTableBody(data) {
            const body = document.getElementById('body');
            body.innerHTML = '';
            
            data.forEach(row => {
                const tr = document.createElement('tr');
                Object.values(row).forEach(value => {
                    const td = document.createElement('td');
                    
                    if (value === null || value === undefined) {
                        td.textContent = 'NULL';
                        td.className = 'null-value';
                    } else if (typeof value === 'number') {
                        td.textContent = value.toString();
                        td.className = 'number-value';
                    } else {
                        td.textContent = String(value);
                    }
                    
                    td.title = td.textContent;
                    tr.appendChild(td);
                });
                body.appendChild(tr);
            });
        }

        function showError(error) {
            hideAll();
            const errorDiv = document.getElementById('error');
            errorDiv.textContent = error;
            errorDiv.style.display = 'block';
        }

        function showStats(rowCount, executionTime) {
            const stats = document.getElementById('stats');
            
            let statsText = rowCount + ' row(s)';
            if (executionTime) {
                statsText += ' • ' + executionTime + 'ms';
            }
            
            stats.textContent = statsText;
            stats.style.display = 'block';
        }

        function hideAll() {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('error').style.display = 'none';
            document.getElementById('resultsTable').style.display = 'none';
            document.getElementById('noData').style.display = 'none';
            document.getElementById('stats').style.display = 'none';
        }

        // Initial state
        hideAll();
    </script>
</body>
</html>`;
        return html;
    }
}

export class ResultWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mssqlManager.results';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        
        // Make the view visible
        webviewView.show?.(true);
    }

    public showResults(results: any[], executionTime?: number) {
        console.log('[ResultWebviewProvider] showResults called with', results?.length, 'rows');
        if (this._view) {
            this._view.show?.(true); // `show` is not always available
            this._view.webview.postMessage({
                command: 'showResults',
                results: results,
                executionTime: executionTime
            });
            console.log('[ResultWebviewProvider] Message sent to webview');
        } else {
            console.log('[ResultWebviewProvider] No view available');
        }
    }

    public showError(error: string) {
        console.log('[ResultWebviewProvider] showError called with:', error);
        if (this._view) {
            this._view.show?.(true);
            this._view.webview.postMessage({
                command: 'showError',
                error: error
            });
        } else {
            console.log('[ResultWebviewProvider] No view available for error');
        }
    }

    public showLoading() {
        console.log('[ResultWebviewProvider] showLoading called');
        if (this._view) {
            this._view.show?.(true);
            this._view.webview.postMessage({
                command: 'showLoading'
            });
        } else {
            console.log('[ResultWebviewProvider] No view available for loading');
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
    <title>Query Results</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 10px;
        }

        .results-container {
            overflow: auto;
            max-height: calc(100vh - 20px);
        }

        table {
            border-collapse: collapse;
            width: 100%;
            background-color: var(--vscode-editor-background);
            font-size: 0.9em;
        }

        th, td {
            border: 1px solid var(--vscode-panel-border);
            padding: 6px 10px;
            text-align: left;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 300px;
            vertical-align: top;
        }

        th {
            background-color: var(--vscode-editor-lineHighlightBackground);
            font-weight: 600;
            position: sticky;
            top: 0;
            cursor: pointer;
            user-select: none;
            z-index: 10;
        }

        th:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .no-data {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .error {
            color: var(--vscode-errorForeground);
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            padding: 15px;
            border-radius: 4px;
            margin: 10px 0;
            font-family: var(--vscode-editor-font-family);
            white-space: pre-wrap;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .stats {
            margin-top: 15px;
            padding-top: 10px;
            border-top: 1px solid var(--vscode-panel-border);
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            text-align: right;
        }

        .null-value {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .number-value {
            text-align: right;
        }
    </style>
</head>
<body>
    <div class="results-container">
        <div class="loading" id="loading" style="display: none;">
            Executing query...
        </div>
        
        <div class="error" id="error" style="display: none;"></div>
        
        <table id="resultsTable" style="display: none;">
            <thead>
                <tr id="header"></tr>
            </thead>
            <tbody id="body"></tbody>
        </table>
        
        <div class="no-data" id="noData" style="display: none;">
            <p>No rows returned</p>
        </div>
    </div>
    
    <div class="stats" id="stats" style="display: none;"></div>

    <script>
        let currentData = [];

        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'showLoading':
                    showLoading();
                    break;
                case 'showResults':
                    showResults(message.results, message.executionTime);
                    break;
                case 'showError':
                    showError(message.error);
                    break;
            }
        });

        function showLoading() {
            hideAll();
            document.getElementById('loading').style.display = 'block';
        }

        function showResults(results, executionTime) {
            hideAll();

            if (!results || results.length === 0) {
                document.getElementById('noData').style.display = 'block';
                showStats(0, executionTime);
                return;
            }

            currentData = results;
            const table = document.getElementById('resultsTable');
            const header = document.getElementById('header');
            const body = document.getElementById('body');
            
            // Clear previous results
            header.innerHTML = '';
            body.innerHTML = '';
            
            // Create headers
            const columns = Object.keys(results[0]);
            columns.forEach((column, index) => {
                const th = document.createElement('th');
                th.textContent = column;
                header.appendChild(th);
            });
            
            // Create rows
            renderTableBody(results);
            
            // Show table and stats
            table.style.display = 'table';
            showStats(results.length, executionTime);
        }

        function renderTableBody(data) {
            const body = document.getElementById('body');
            body.innerHTML = '';
            
            data.forEach(row => {
                const tr = document.createElement('tr');
                Object.values(row).forEach(value => {
                    const td = document.createElement('td');
                    
                    if (value === null || value === undefined) {
                        td.textContent = 'NULL';
                        td.className = 'null-value';
                    } else if (typeof value === 'number') {
                        td.textContent = value.toString();
                        td.className = 'number-value';
                    } else {
                        td.textContent = String(value);
                    }
                    
                    td.title = td.textContent;
                    tr.appendChild(td);
                });
                body.appendChild(tr);
            });
        }

        function showError(error) {
            hideAll();
            const errorDiv = document.getElementById('error');
            errorDiv.textContent = error;
            errorDiv.style.display = 'block';
        }

        function showStats(rowCount, executionTime) {
            const stats = document.getElementById('stats');
            
            let statsText = rowCount + ' row(s)';
            if (executionTime) {
                statsText += ' • ' + executionTime + 'ms';
            }
            
            stats.textContent = statsText;
            stats.style.display = 'block';
        }

        function hideAll() {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('error').style.display = 'none';
            document.getElementById('resultsTable').style.display = 'none';
            document.getElementById('noData').style.display = 'none';
            document.getElementById('stats').style.display = 'none';
        }

        // Initial state
        hideAll();
    </script>
</body>
</html>`;
    }
}