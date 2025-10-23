import * as vscode from 'vscode';
import * as path from 'path';
import { ConnectionConfig } from './connectionProvider';

export class ConnectionWebview {
    private panel: vscode.WebviewPanel | undefined;
    private onConnectionCreated: (config: ConnectionConfig) => void;

    constructor(
        private context: vscode.ExtensionContext,
        onConnectionCreated: (config: ConnectionConfig) => void
    ) {
        this.onConnectionCreated = onConnectionCreated;
    }

    async show(existingConfig?: ConnectionConfig): Promise<void> {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            if (existingConfig) {
                this.panel.webview.postMessage({
                    command: 'loadConnection',
                    config: existingConfig
                });
            }
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'mssqlConnection',
            'MS SQL Server Connection',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'webview'))
                ]
            }
        );

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        }, null, this.context.subscriptions);

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'testConnection':
                        await this.handleTestConnection(message.config);
                        break;
                    case 'saveConnection':
                        await this.handleSaveConnection(message.config);
                        break;
                    case 'cancel':
                        this.panel?.dispose();
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );

        this.panel.webview.html = this.getWebviewContent();

        if (existingConfig) {
            // Wait a moment for the webview to load, then send the config
            setTimeout(() => {
                this.panel?.webview.postMessage({
                    command: 'loadConnection',
                    config: existingConfig
                });
            }, 100);
        }
    }

    private async handleTestConnection(config: any): Promise<void> {
        try {
            this.panel?.webview.postMessage({
                command: 'testProgress',
                message: 'Testing connection...'
            });

            // Import mssql dynamically to test connection
            const sql = await import('mssql');

            let sqlConfig: any;
            
            if (config.useConnectionString && config.connectionString) {
                // Use connection string directly
                sqlConfig = {
                    connectionString: config.connectionString
                };
            } else {
                // Build config from individual properties
                sqlConfig = {
                    server: config.server,
                    database: config.database || 'master',
                    options: {
                        encrypt: config.encrypt !== false,
                        trustServerCertificate: config.trustServerCertificate !== false
                    }
                };

                if (config.port) {
                    sqlConfig.port = parseInt(config.port);
                }

                if (config.authType === 'sql') {
                    sqlConfig.user = config.username;
                    sqlConfig.password = config.password;
                } else if (config.authType === 'windows') {
                    sqlConfig.options.trustedConnection = true;
                }
            }

            const pool = new sql.ConnectionPool(sqlConfig);
            await pool.connect();
            
            // Test with a simple query
            const request = pool.request();
            await request.query('SELECT 1 as test');
            
            await pool.close();

            this.panel?.webview.postMessage({
                command: 'testResult',
                success: true,
                message: 'Connection test successful!'
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            this.panel?.webview.postMessage({
                command: 'testResult',
                success: false,
                message: `Connection test failed: ${errorMessage}`
            });
        }
    }

    private async handleSaveConnection(config: any): Promise<void> {
        try {
            const connectionConfig: ConnectionConfig = {
                id: config.id || Date.now().toString(),
                name: config.name || (config.useConnectionString ? 'Connection String' : `${config.server}/${config.database || 'master'}`),
                server: config.server || '',
                database: config.database || 'master',
                authType: config.authType || 'sql',
                username: config.authType === 'sql' ? config.username : undefined,
                password: config.authType === 'sql' ? config.password : undefined,
                port: config.port ? parseInt(config.port) : undefined,
                encrypt: config.encrypt !== false,
                trustServerCertificate: config.trustServerCertificate !== false,
                connectionString: config.useConnectionString ? config.connectionString : undefined,
                useConnectionString: config.useConnectionString || false
            };

            this.onConnectionCreated(connectionConfig);
            
            this.panel?.webview.postMessage({
                command: 'saveResult',
                success: true,
                message: 'Connection saved successfully!'
            });

            // Close the panel after a short delay
            setTimeout(() => {
                this.panel?.dispose();
            }, 1000);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            this.panel?.webview.postMessage({
                command: 'saveResult',
                success: false,
                message: `Failed to save connection: ${errorMessage}`
            });
        }
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
    <title>SQL Server Connection</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
            line-height: 1.4;
        }

        .container {
            max-width: 600px;
            margin: 0 auto;
        }

        h1 {
            color: var(--vscode-foreground);
            margin-bottom: 30px;
            font-size: 1.5em;
            font-weight: 600;
        }

        .form-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
            color: var(--vscode-foreground);
        }

        input[type="text"],
        input[type="password"],
        input[type="number"],
        select {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: var(--vscode-font-size);
            box-sizing: border-box;
        }

        input:focus,
        select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            background-color: var(--vscode-input-background);
        }

        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 10px;
        }

        input[type="checkbox"] {
            width: auto;
            margin: 0;
        }

        .auth-fields {
            margin-top: 15px;
        }

        .hidden {
            display: none;
        }

        .button-group {
            display: flex;
            gap: 10px;
            margin-top: 30px;
            flex-wrap: wrap;
        }

        button {
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: var(--vscode-font-size);
            font-weight: 500;
            min-width: 100px;
        }

        .primary-button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .primary-button:hover:not(:disabled) {
            background-color: var(--vscode-button-hoverBackground);
        }

        .secondary-button {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .secondary-button:hover:not(:disabled) {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .test-button {
            background-color: var(--vscode-charts-green);
            color: var(--vscode-button-foreground);
        }

        .test-button:hover:not(:disabled) {
            opacity: 0.9;
        }

        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .message {
            padding: 12px;
            border-radius: 4px;
            margin-top: 15px;
            font-weight: 500;
            min-height: 20px;
        }

        .message.success {
            background-color: var(--vscode-testing-iconPassed);
            color: var(--vscode-button-foreground);
        }

        .message.error {
            background-color: var(--vscode-errorForeground);
            color: var(--vscode-button-foreground);
        }

        .message.info {
            background-color: var(--vscode-charts-blue);
            color: var(--vscode-button-foreground);
        }

        .message.hidden {
            display: none;
        }

        .spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid var(--vscode-progressBar-background);
            border-top: 2px solid var(--vscode-button-foreground);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 8px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .form-row {
            display: flex;
            gap: 15px;
        }

        .form-row .form-group {
            flex: 1;
        }

        .advanced-section {
            margin-top: 25px;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .section-header {
            font-weight: 600;
            margin-bottom: 15px;
            color: var(--vscode-foreground);
        }

        .help-text {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }

        .form-toggle {
            margin-bottom: 20px;
            padding: 15px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            background-color: var(--vscode-editor-lineHighlightBackground);
        }

        textarea {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: var(--vscode-font-size);
            font-family: var(--vscode-editor-font-family);
            box-sizing: border-box;
            resize: vertical;
            min-height: 80px;
        }

        textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            background-color: var(--vscode-input-background);
        }

        .parse-button {
            margin-top: 8px;
            padding: 6px 12px;
            font-size: 0.9em;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>SQL Server Connection</h1>
        
        <form id="connectionForm">
            <div class="form-group">
                <label for="connectionName">Connection Name</label>
                <input type="text" id="connectionName" placeholder="My SQL Server">
                <div class="help-text">Friendly name for this connection</div>
            </div>

            <div class="form-toggle">
                <div class="checkbox-group">
                    <input type="checkbox" id="useConnectionString">
                    <label for="useConnectionString">Use Connection String</label>
                </div>
                <div class="help-text">Toggle between connection string and individual fields</div>
            </div>

            <div id="connectionStringSection" class="hidden">
                <div class="form-group">
                    <label for="connectionString">Connection String *</label>
                    <textarea id="connectionString" rows="4" placeholder="Server=localhost;Database=master;Integrated Security=true;Encrypt=true;TrustServerCertificate=true;"></textarea>
                    <div class="help-text">Complete SQL Server connection string</div>
                    <button type="button" class="secondary-button parse-button" id="parseBtn">Parse to Fields</button>
                </div>
            </div>

            <div id="individualFieldsSection">
                <div class="form-group">
                    <label for="server">Server Name *</label>
                    <input type="text" id="server" placeholder="localhost or server.domain.com" required>
                    <div class="help-text">Server name or IP address</div>
                </div>

            <div class="form-row">
                <div class="form-group">
                    <label for="database">Database</label>
                    <input type="text" id="database" placeholder="master" value="master">
                    <div class="help-text">Initial database to connect to</div>
                </div>

                <div class="form-group">
                    <label for="port">Port</label>
                    <input type="number" id="port" placeholder="1433">
                    <div class="help-text">Leave empty for default (1433)</div>
                </div>
            </div>

            <div class="form-group">
                <label for="authType">Authentication Type *</label>
                <select id="authType" required>
                    <option value="sql">SQL Server Authentication</option>
                    <option value="windows">Windows Authentication</option>
                    <option value="azure">Azure Active Directory</option>
                </select>
            </div>

            <div id="sqlAuthFields" class="auth-fields">
                <div class="form-group">
                    <label for="username">Username *</label>
                    <input type="text" id="username" placeholder="sa">
                </div>

                <div class="form-group">
                    <label for="password">Password *</label>
                    <input type="password" id="password" placeholder="Password">
                </div>
            </div>

            <div class="advanced-section">
                <div class="section-header">Security Options</div>
                
                <div class="checkbox-group">
                    <input type="checkbox" id="encrypt" checked>
                    <label for="encrypt">Encrypt connection</label>
                </div>

                <div class="checkbox-group">
                    <input type="checkbox" id="trustServerCertificate" checked>
                    <label for="trustServerCertificate">Trust server certificate</label>
                </div>
            </div>

            <div class="message hidden" id="message"></div>

            <div class="button-group">
                <button type="button" class="test-button" id="testBtn">Test Connection</button>
                <button type="submit" class="primary-button" id="saveBtn">Save Connection</button>
                <button type="button" class="secondary-button" id="cancelBtn">Cancel</button>
            </div>
        </form>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // Form elements
        const form = document.getElementById('connectionForm');
        const authTypeSelect = document.getElementById('authType');
        const sqlAuthFields = document.getElementById('sqlAuthFields');
        const useConnectionStringCheckbox = document.getElementById('useConnectionString');
        const connectionStringSection = document.getElementById('connectionStringSection');
        const individualFieldsSection = document.getElementById('individualFieldsSection');
        const parseBtn = document.getElementById('parseBtn');
        const testBtn = document.getElementById('testBtn');
        const saveBtn = document.getElementById('saveBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const messageDiv = document.getElementById('message');

        // Toggle between connection string and individual fields
        useConnectionStringCheckbox.addEventListener('change', function() {
            if (this.checked) {
                connectionStringSection.classList.remove('hidden');
                individualFieldsSection.classList.add('hidden');
                document.getElementById('connectionString').required = true;
                document.getElementById('server').required = false;
            } else {
                connectionStringSection.classList.add('hidden');
                individualFieldsSection.classList.remove('hidden');
                document.getElementById('connectionString').required = false;
                document.getElementById('server').required = true;
            }
        });

        // Parse connection string to individual fields
        parseBtn.addEventListener('click', function() {
            const connectionString = document.getElementById('connectionString').value;
            if (!connectionString.trim()) {
                showMessage('error', 'Please enter a connection string to parse');
                return;
            }

            try {
                const parsed = parseConnectionString(connectionString);
                
                // Fill form fields with parsed values
                if (parsed.server) document.getElementById('server').value = parsed.server;
                if (parsed.database) document.getElementById('database').value = parsed.database;
                if (parsed.port) document.getElementById('port').value = parsed.port;
                if (parsed.username) document.getElementById('username').value = parsed.username;
                if (parsed.password) document.getElementById('password').value = parsed.password;
                if (parsed.authType) document.getElementById('authType').value = parsed.authType;
                if (parsed.encrypt !== undefined) document.getElementById('encrypt').checked = parsed.encrypt;
                if (parsed.trustServerCertificate !== undefined) document.getElementById('trustServerCertificate').checked = parsed.trustServerCertificate;
                
                // Switch to individual fields mode
                useConnectionStringCheckbox.checked = false;
                useConnectionStringCheckbox.dispatchEvent(new Event('change'));
                
                // Trigger auth type change to show/hide fields
                authTypeSelect.dispatchEvent(new Event('change'));
                
                showMessage('success', 'Connection string parsed successfully!');
            } catch (error) {
                showMessage('error', 'Error parsing connection string: ' + error.message);
            }
        });

        // Toggle authentication fields based on auth type
        authTypeSelect.addEventListener('change', function() {
            const authType = this.value;
            if (authType === 'sql') {
                sqlAuthFields.classList.remove('hidden');
                document.getElementById('username').required = true;
                document.getElementById('password').required = true;
            } else {
                sqlAuthFields.classList.add('hidden');
                document.getElementById('username').required = false;
                document.getElementById('password').required = false;
            }
        });

        // Test connection
        testBtn.addEventListener('click', function() {
            if (!validateForm(false)) {
                return;
            }

            const config = getFormData();
            showMessage('info', '<span class="spinner"></span>Testing connection...');
            
            testBtn.disabled = true;
            saveBtn.disabled = true;

            vscode.postMessage({
                command: 'testConnection',
                config: config
            });
        });

        // Save connection
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            
            if (!validateForm(true)) {
                return;
            }

            const config = getFormData();
            
            saveBtn.disabled = true;
            testBtn.disabled = true;

            vscode.postMessage({
                command: 'saveConnection',
                config: config
            });
        });

        // Cancel
        cancelBtn.addEventListener('click', function() {
            vscode.postMessage({ command: 'cancel' });
        });

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'loadConnection':
                    loadConnection(message.config);
                    break;
                case 'testProgress':
                    showMessage('info', '<span class="spinner"></span>' + message.message);
                    break;
                case 'testResult':
                    testBtn.disabled = false;
                    saveBtn.disabled = false;
                    if (message.success) {
                        showMessage('success', message.message);
                    } else {
                        showMessage('error', message.message);
                    }
                    break;
                case 'saveResult':
                    if (message.success) {
                        showMessage('success', message.message);
                    } else {
                        testBtn.disabled = false;
                        saveBtn.disabled = false;
                        showMessage('error', message.message);
                    }
                    break;
            }
        });

        function parseConnectionString(connectionString) {
            const config = {};
            
            // Split connection string by semicolons and parse key-value pairs
            const pairs = connectionString.split(';').filter(pair => pair.trim());
            
            for (const pair of pairs) {
                const [key, value] = pair.split('=').map(s => s.trim());
                if (!key || !value) continue;
                
                const lowerKey = key.toLowerCase();
                
                switch (lowerKey) {
                    case 'server':
                    case 'data source':
                        config.server = value;
                        break;
                    case 'database':
                    case 'initial catalog':
                        config.database = value;
                        break;
                    case 'user id':
                    case 'uid':
                        config.username = value;
                        config.authType = 'sql';
                        break;
                    case 'password':
                    case 'pwd':
                        config.password = value;
                        break;
                    case 'integrated security':
                        if (value.toLowerCase() === 'true' || value.toLowerCase() === 'sspi') {
                            config.authType = 'windows';
                        }
                        break;
                    case 'encrypt':
                        config.encrypt = value.toLowerCase() === 'true';
                        break;
                    case 'trustservercertificate':
                    case 'trust server certificate':
                        config.trustServerCertificate = value.toLowerCase() === 'true';
                        break;
                }
            }
            
            return config;
        }

        function validateForm(requireName) {
            const useConnectionString = document.getElementById('useConnectionString').checked;
            const connectionString = document.getElementById('connectionString').value.trim();
            const server = document.getElementById('server').value.trim();
            const authType = document.getElementById('authType').value;
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;
            const connectionName = document.getElementById('connectionName').value.trim();

            if (useConnectionString) {
                if (!connectionString) {
                    showMessage('error', 'Connection string is required');
                    return false;
                }
            } else {
                if (!server) {
                    showMessage('error', 'Server name is required');
                    return false;
                }

                if (authType === 'sql') {
                    if (!username) {
                        showMessage('error', 'Username is required for SQL authentication');
                        return false;
                    }
                    if (!password) {
                        showMessage('error', 'Password is required for SQL authentication');
                        return false;
                    }
                }
            }

            if (requireName && !connectionName) {
                showMessage('error', 'Connection name is required');
                return false;
            }

            return true;
        }

        function getFormData() {
            const useConnectionString = document.getElementById('useConnectionString').checked;
            
            return {
                id: form.dataset.connectionId,
                name: document.getElementById('connectionName').value.trim(),
                useConnectionString: useConnectionString,
                connectionString: useConnectionString ? document.getElementById('connectionString').value.trim() : null,
                server: document.getElementById('server').value.trim(),
                database: document.getElementById('database').value.trim() || 'master',
                port: document.getElementById('port').value || null,
                authType: document.getElementById('authType').value,
                username: document.getElementById('username').value.trim() || null,
                password: document.getElementById('password').value || null,
                encrypt: document.getElementById('encrypt').checked,
                trustServerCertificate: document.getElementById('trustServerCertificate').checked
            };
        }

        function loadConnection(config) {
            if (config) {
                form.dataset.connectionId = config.id;
                document.getElementById('connectionName').value = config.name || '';
                
                if (config.useConnectionString && config.connectionString) {
                    document.getElementById('useConnectionString').checked = true;
                    document.getElementById('connectionString').value = config.connectionString;
                } else {
                    document.getElementById('useConnectionString').checked = false;
                    document.getElementById('server').value = config.server || '';
                    document.getElementById('database').value = config.database || 'master';
                    document.getElementById('port').value = config.port || '';
                    document.getElementById('authType').value = config.authType || 'sql';
                    document.getElementById('username').value = config.username || '';
                    document.getElementById('password').value = config.password || '';
                    document.getElementById('encrypt').checked = config.encrypt !== false;
                    document.getElementById('trustServerCertificate').checked = config.trustServerCertificate !== false;
                }
                
                // Trigger events to update UI
                useConnectionStringCheckbox.dispatchEvent(new Event('change'));
                authTypeSelect.dispatchEvent(new Event('change'));
            }
        }

        function showMessage(type, text) {
            messageDiv.className = 'message ' + type;
            messageDiv.innerHTML = text;
        }

        // Initialize form
        authTypeSelect.dispatchEvent(new Event('change'));
        useConnectionStringCheckbox.dispatchEvent(new Event('change'));
    </script>
</body>
</html>`;
    }
}