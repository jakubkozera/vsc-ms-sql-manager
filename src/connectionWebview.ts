import * as vscode from 'vscode';
import * as path from 'path';
import { ConnectionConfig, ServerGroup } from './connectionProvider';

export class ConnectionWebview {
    private panel: vscode.WebviewPanel | undefined;
    private onConnectionCreated: (config: ConnectionConfig) => void;
    private serverGroups: ServerGroup[] = [];

    constructor(
        private context: vscode.ExtensionContext,
        onConnectionCreated: (config: ConnectionConfig) => void
    ) {
        this.onConnectionCreated = onConnectionCreated;
        // Load server groups from global state
        this.serverGroups = this.context.globalState.get<ServerGroup[]>('mssqlManager.serverGroups', []);
    }

    async show(existingConfig?: ConnectionConfig): Promise<void> {
        // Refresh server groups from global state every time
        this.serverGroups = this.context.globalState.get<ServerGroup[]>('mssqlManager.serverGroups', []);
        
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            
            // Always send server groups first
            setTimeout(() => {
                this.panel?.webview.postMessage({
                    command: 'loadServerGroups',
                    serverGroups: this.serverGroups
                });
                
                // Then load existing config if provided
                if (existingConfig) {
                    setTimeout(() => {
                        this.panel?.webview.postMessage({
                            command: 'loadConnection',
                            config: existingConfig
                        });
                    }, 50);
                }
            }, 100);
            return;
        }

        const iconsRoot = path.join(this.context.extensionPath, 'resources', 'icons');
        const iconPath = {
            light: vscode.Uri.file(path.join(iconsRoot, 'connection-light.svg')),
            dark: vscode.Uri.file(path.join(iconsRoot, 'connection-dark.svg'))
        };

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

        // Assign themed icon (light/dark) after panel creation to satisfy TS types
        this.panel.iconPath = iconPath;

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
        
        // Send server groups to webview
        setTimeout(() => {
            this.panel?.webview.postMessage({
                command: 'loadServerGroups',
                serverGroups: this.serverGroups
            });
            
            // If editing existing connection, load it after groups are loaded
            if (existingConfig) {
                setTimeout(() => {
                    this.panel?.webview.postMessage({
                        command: 'loadConnection',
                        config: existingConfig
                    });
                }, 50);
            }
        }, 100);

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

            // Use our dbClient abstraction which will choose msnodesqlv8 for windows auth
            const { createPoolForConfig } = await import('./dbClient');

            const cfg: any = {};
            if (config.useConnectionString && config.connectionString) {
                cfg.connectionString = config.connectionString;
                cfg.useConnectionString = true;
            } else {
                cfg.server = config.server;
                cfg.database = config.connectionType === 'server' ? 'master' : (config.database || 'master');
                cfg.port = config.port ? parseInt(config.port) : undefined;
                cfg.encrypt = config.encrypt !== false;
                cfg.trustServerCertificate = config.trustServerCertificate !== false;
            }
            cfg.authType = config.authType;
            cfg.username = config.username;
            cfg.password = config.password;

            const pool = await createPoolForConfig(cfg);
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
                connectionType: config.connectionType || 'database',
                username: config.authType === 'sql' ? config.username : undefined,
                password: config.authType === 'sql' ? config.password : undefined,
                port: config.port ? parseInt(config.port) : undefined,
                encrypt: config.encrypt !== false,
                trustServerCertificate: config.trustServerCertificate !== false,
                connectionString: config.useConnectionString ? config.connectionString : undefined,
                useConnectionString: config.useConnectionString || false,
                serverGroupId: config.serverGroupId // Add this line!
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
            margin: 0;
            font-size: 1.5em;
            font-weight: 600;
        }

        .header-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 18px;
            gap: 12px;
        }

        .icon-button {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            border-radius: 6px;
            border: 1px solid transparent;
            background: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 0.95em;
        }

        .icon-button svg {
            width: 20px;
            height: 20px;
        }

        .icon-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .icon-button.active {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
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
            gap: 12px;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-input-border);
            flex-wrap: wrap;
            justify-content: flex-end;
        }

        button {
            padding: 10px 24px;
            border: 1px solid transparent;
            border-radius: 4px;
            cursor: pointer;
            font-size: var(--vscode-font-size);
            font-weight: 500;
            min-width: 110px;
            transition: all 0.2s ease;
        }

        .primary-button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        }

        .primary-button:hover:not(:disabled) {
            background-color: var(--vscode-button-hoverBackground);
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
            transform: translateY(-1px);
        }

        .secondary-button {
            background-color: transparent;
            color: var(--vscode-button-secondaryForeground);
            border-color: var(--vscode-button-secondaryBackground);
        }

        .secondary-button:hover:not(:disabled) {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .test-button {
            background-color: transparent;
            color: var(--vscode-foreground);
            border-color: var(--vscode-input-border);
            order: -1;
        }

        .test-button:hover:not(:disabled) {
            background-color: var(--vscode-button-secondaryHoverBackground);
            border-color: var(--vscode-focusBorder);
        }

        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .message {
            padding: 14px 16px;
            border-radius: 6px;
            margin-top: 20px;
            font-weight: 400;
            min-height: 20px;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            border-left: 4px solid transparent;
            animation: slideIn 0.3s ease-out;
            line-height: 1.5;
        }

        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .message::before {
            content: '';
            display: inline-block;
            width: 20px;
            height: 20px;
            flex-shrink: 0;
            background-size: contain;
            background-repeat: no-repeat;
        }

        .message.success {
            background-color: rgba(22, 163, 74, 0.15);
            color: var(--vscode-foreground);
            border-left-color: #16a34a;
        }

        .message.success::before {
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2316a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>');
        }

        .message.error {
            background-color: rgba(239, 68, 68, 0.15);
            color: var(--vscode-foreground);
            border-left-color: #ef4444;
        }

        .message.error::before {
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>');
        }

        .message.info {
            background-color: rgba(59, 130, 246, 0.15);
            color: var(--vscode-foreground);
            border-left-color: #3b82f6;
        }

        .message.info::before {
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%233b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>');
        }

        .message.hidden {
            display: none;
        }

        .spinner {
            display: inline-block;
            width: 18px;
            height: 18px;
            border: 2.5px solid rgba(59, 130, 246, 0.3);
            border-top-color: #3b82f6;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            flex-shrink: 0;
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

        .password-wrapper {
            position: relative;
        }

        .password-toggle {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--vscode-foreground);
            opacity: 0.7;
            transition: opacity 0.2s;
        }

        .password-toggle:hover {
            opacity: 1;
        }

        .password-wrapper input[type="password"],
        .password-wrapper input[type="text"] {
            padding-right: 45px;
        }
    </style>
</head>
<body>
        <div class="container">
                <div class="header-row">
                        <h1>SQL Server Connection</h1>
                        <button type="button" id="useConnectionStringBtn" class="icon-button" title="Use Connection String">
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="45"
                                    height="45"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.5"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                >
                                    <path d="M9.785 6l8.215 8.215l-2.054 2.054a5.81 5.81 0 1 1 -8.215 -8.215l2.054 -2.054z" />
                                    <path d="M4 20l3.5 -3.5" />
                                    <path d="M15 4l-3.5 3.5" />
                                    <path d="M20 9l-3.5 3.5" />
                                </svg>
                                <span>Use Connection String</span>
                        </button>
                </div>
        
        <form id="connectionForm">
            <div class="form-group">
                <label for="connectionName">Connection Name</label>
                <input type="text" id="connectionName" placeholder="My SQL Server">
                <div class="help-text">Friendly name for this connection</div>
            </div>

            <div class="form-group">
                <label for="serverGroup">Server Group</label>
                <select id="serverGroup">
                    <option value="">No Group (Default)</option>
                </select>
                <div class="help-text">Optional: Organize connections into groups</div>
            </div>

            <div class="form-group hidden" id="connectionTypeGroup">
                <label for="connectionType">Connection Type *</label>
                <select id="connectionType" required>
                    <option value="database">Database Connection</option>
                    <option value="server">Server Connection</option>
                </select>
                <div class="help-text">Database: Connect to specific database. Server: Connect to server for database management</div>
            </div>
            <input type="checkbox" id="useConnectionString" class="hidden" aria-hidden="true">


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
                    <div class="password-wrapper">
                        <input type="password" id="password" placeholder="Password">
                        <button type="button" class="password-toggle" id="passwordToggle" title="Show password">
                            <svg id="eyeIcon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
                                <path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" />
                            </svg>
                            <svg id="eyeOffIcon" class="hidden" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M10.585 10.587a2 2 0 0 0 2.829 2.828" />
                                <path d="M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87" />
                                <path d="M3 3l18 18" />
                            </svg>
                        </button>
                    </div>
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
                <button type="button" class="secondary-button" id="cancelBtn">Cancel</button>
                <button type="button" class="test-button" id="testBtn">Test Connection</button>
                <button type="submit" class="primary-button" id="saveBtn">Save Connection</button>
            </div>
        </form>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // Form elements
        const form = document.getElementById('connectionForm');
        const authTypeSelect = document.getElementById('authType');
        const connectionTypeSelect = document.getElementById('connectionType');
        const connectionTypeGroup = document.getElementById('connectionTypeGroup');
        const sqlAuthFields = document.getElementById('sqlAuthFields');
        const useConnectionStringCheckbox = document.getElementById('useConnectionString');
        const useConnectionStringBtn = document.getElementById('useConnectionStringBtn');
        const connectionStringSection = document.getElementById('connectionStringSection');
        const individualFieldsSection = document.getElementById('individualFieldsSection');
        const parseBtn = document.getElementById('parseBtn');
        const testBtn = document.getElementById('testBtn');
        const saveBtn = document.getElementById('saveBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const messageDiv = document.getElementById('message');
        const passwordInput = document.getElementById('password');
        const passwordToggle = document.getElementById('passwordToggle');
        const eyeIcon = document.getElementById('eyeIcon');
        const eyeOffIcon = document.getElementById('eyeOffIcon');
        const databaseField = document.getElementById('database');

        // Toggle password visibility
        passwordToggle.addEventListener('click', function() {
            const isPassword = passwordInput.type === 'password';
            passwordInput.type = isPassword ? 'text' : 'password';
            eyeIcon.classList.toggle('hidden', isPassword);
            eyeOffIcon.classList.toggle('hidden', !isPassword);
            passwordToggle.title = isPassword ? 'Hide password' : 'Show password';
        });

        // Toggle between connection string and individual fields
        useConnectionStringCheckbox.addEventListener('change', function() {
            const checked = this.checked;
            if (checked) {
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

            // Update header button visual state
            if (useConnectionStringBtn) {
                useConnectionStringBtn.classList.toggle('active', checked);
            }
        });

        // Header button toggles the same checkbox state
        if (useConnectionStringBtn) {
            useConnectionStringBtn.addEventListener('click', function() {
                const isChecked = useConnectionStringCheckbox.checked;
                useConnectionStringCheckbox.checked = !isChecked;
                useConnectionStringCheckbox.dispatchEvent(new Event('change'));
            });
        }

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

        // Connection type is now hidden in the UI. We treat an empty database field
        // as indicating a server-level connection. If a database is provided, it's a database connection.
        // Keep the old event handler behavior in case the field is programmatically set.
        connectionTypeSelect.addEventListener('change', function() {
            const connectionType = this.value;
            if (connectionType === 'server') {
                databaseField.value = 'master';
                databaseField.placeholder = 'master (recommended for server connections)';
                databaseField.parentElement.querySelector('.help-text').textContent = 'Initial database (master recommended for server management)';
            } else {
                databaseField.placeholder = 'master';
                databaseField.parentElement.querySelector('.help-text').textContent = 'Initial database to connect to';
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
                case 'loadServerGroups':
                    loadServerGroups(message.serverGroups);
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
                        // Handle tcp: prefix and port in data source
                        let serverValue = value;
                        
                        // Remove tcp: prefix if present
                        if (serverValue.toLowerCase().startsWith('tcp:')) {
                            serverValue = serverValue.substring(4);
                        }
                        
                        // Check if port is included in server string (e.g., server,1433)
                        if (serverValue.includes(',')) {
                            const [server, port] = serverValue.split(',');
                            config.server = server.trim();
                            config.port = port.trim();
                        } else {
                            config.server = serverValue;
                        }
                        break;
                    case 'database':
                    case 'initial catalog':
                        config.database = value;
                        break;
                    case 'user id':
                    case 'uid':
                        // Strip @servername suffix if present (e.g., username@server -> username)
                        let username = value;
                        if (username.includes('@')) {
                            username = username.split('@')[0];
                        }
                        config.username = username;
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
            const serverGroupValue = document.getElementById('serverGroup').value;
            
            console.log('[ConnectionWebview] Form data - serverGroup value:', serverGroupValue);
            
            // If database field is empty, interpret that as a server connection
            const rawDatabase = document.getElementById('database').value.trim();
            const inferredConnectionType = rawDatabase === '' ? 'server' : 'database';

            const formData = {
                id: form.dataset.connectionId,
                name: document.getElementById('connectionName').value.trim(),
                serverGroupId: serverGroupValue || undefined,
                connectionType: inferredConnectionType,
                useConnectionString: useConnectionString,
                connectionString: useConnectionString ? document.getElementById('connectionString').value.trim() : null,
                server: document.getElementById('server').value.trim(),
                database: rawDatabase || (inferredConnectionType === 'server' ? 'master' : 'master'),
                port: document.getElementById('port').value || null,
                authType: document.getElementById('authType').value,
                username: document.getElementById('username').value.trim() || null,
                password: document.getElementById('password').value || null,
                encrypt: document.getElementById('encrypt').checked,
                trustServerCertificate: document.getElementById('trustServerCertificate').checked
            };
            
            console.log('[ConnectionWebview] Complete form data:', formData);
            return formData;
        }

        function loadConnection(config) {
            console.log('[ConnectionWebview] Loading connection config:', config);
            if (config) {
                form.dataset.connectionId = config.id;
                document.getElementById('connectionName').value = config.name || '';
                document.getElementById('serverGroup').value = config.serverGroupId || '';
                // Keep connectionType hidden, but set its value for backward compatibility
                document.getElementById('connectionType').value = config.connectionType || (config.database ? 'database' : 'server');
                
                console.log('[ConnectionWebview] Set serverGroup value to:', config.serverGroupId);
                
                if (config.useConnectionString && config.connectionString) {
                    document.getElementById('useConnectionString').checked = true;
                    document.getElementById('connectionString').value = config.connectionString;
                } else {
                    document.getElementById('useConnectionString').checked = false;
                    document.getElementById('server').value = config.server || '';
                        // If the saved connection has an empty database it represents a server connection
                        document.getElementById('database').value = config.database || (config.connectionType === 'server' ? '' : 'master');
                    document.getElementById('port').value = config.port || '';
                    document.getElementById('authType').value = config.authType || 'sql';
                    document.getElementById('username').value = config.username || '';
                    document.getElementById('password').value = config.password || '';
                    document.getElementById('encrypt').checked = config.encrypt !== false;
                    document.getElementById('trustServerCertificate').checked = config.trustServerCertificate !== false;
                }
                
                // Trigger events to update UI
                useConnectionStringCheckbox.dispatchEvent(new Event('change'));
                // Ensure header button state is synced as well
                if (useConnectionStringBtn) {
                    useConnectionStringBtn.classList.toggle('active', useConnectionStringCheckbox.checked);
                }
                authTypeSelect.dispatchEvent(new Event('change'));
                connectionTypeSelect.dispatchEvent(new Event('change'));
            }
        }

        function loadServerGroups(serverGroups) {
            console.log('[ConnectionWebview] Loading server groups:', serverGroups);
            const serverGroupSelect = document.getElementById('serverGroup');
            
            // Clear existing options except the default one
            while (serverGroupSelect.children.length > 1) {
                serverGroupSelect.removeChild(serverGroupSelect.lastChild);
            }
            
            // Add server groups as options
            if (serverGroups && serverGroups.length > 0) {
                serverGroups.forEach(group => {
                    const option = document.createElement('option');
                    option.value = group.id;
                    option.textContent = group.name;
                    serverGroupSelect.appendChild(option);
                    console.log('[ConnectionWebview] Added group option:', group.name, 'with value:', group.id);
                });
            }
            
            console.log('[ConnectionWebview] Total options in dropdown:', serverGroupSelect.children.length);
        }

        function showMessage(type, text) {
            messageDiv.className = 'message ' + type;
            
            // Check if text includes spinner
            if (text.includes('<span class="spinner"></span>')) {
                // For loading messages, use custom HTML structure
                const textContent = text.replace('<span class="spinner"></span>', '').trim();
                messageDiv.innerHTML = \`<span class="spinner"></span><span>\${textContent}</span>\`;
            } else {
                messageDiv.innerHTML = \`<span>\${text}</span>\`;
            }
        }

        // Initialize form
        authTypeSelect.dispatchEvent(new Event('change'));
        useConnectionStringCheckbox.dispatchEvent(new Event('change'));
        connectionTypeSelect.dispatchEvent(new Event('change'));

        // Initial sync for header button
        if (useConnectionStringBtn) {
            useConnectionStringBtn.classList.toggle('active', useConnectionStringCheckbox.checked);
        }
    </script>
</body>
</html>`;
    }
}