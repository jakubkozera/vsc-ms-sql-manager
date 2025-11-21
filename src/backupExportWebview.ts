import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import * as os from 'os';
import { ConnectionProvider } from './connectionProvider';

export class BackupExportWebview {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private connectionProvider: ConnectionProvider,
        private outputChannel: vscode.OutputChannel,
        private context: vscode.ExtensionContext
    ) {}

    private async findSqlPackage(): Promise<string> {
        const platform = os.platform();
        const isWindows = platform === 'win32';
        const sqlPackageName = isWindows ? 'sqlpackage.exe' : 'sqlpackage';
        
        // Common paths where SqlPackage might be installed
        const commonPaths = [
            // Windows paths
            'C:\\Program Files\\Microsoft SQL Server\\150\\DAC\\bin\\SqlPackage.exe',
            'C:\\Program Files\\Microsoft SQL Server\\160\\DAC\\bin\\SqlPackage.exe',
            'C:\\Program Files (x86)\\Microsoft SQL Server\\150\\DAC\\bin\\SqlPackage.exe',
            'C:\\Program Files (x86)\\Microsoft SQL Server\\160\\DAC\\bin\\SqlPackage.exe',
            'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\Common7\\IDE\\Extensions\\Microsoft\\SQLDB\\DAC\\SqlPackage.exe',
            'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\IDE\\Extensions\\Microsoft\\SQLDB\\DAC\\SqlPackage.exe',
            'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\Extensions\\Microsoft\\SQLDB\\DAC\\SqlPackage.exe',
            // macOS/Linux paths (when installed via .NET tool)
            '/usr/local/bin/sqlpackage',
            path.join(os.homedir(), '.dotnet/tools/sqlpackage')
        ];
        
        // First try PATH
        try {
            const result = child_process.execSync(isWindows ? 'where sqlpackage' : 'which sqlpackage', 
                { encoding: 'utf8', timeout: 5000 });
            const sqlPackagePath = result.trim().split('\n')[0];
            if (fs.existsSync(sqlPackagePath)) {
                return sqlPackagePath;
            }
        } catch (error) {
            // SqlPackage not found in PATH
        }
        
        // Try common installation paths
        for (const sqlPackagePath of commonPaths) {
            if (fs.existsSync(sqlPackagePath)) {
                return sqlPackagePath;
            }
        }
        
        // If not found, return the command name and let the OS handle it
        return sqlPackageName;
    }

    private async checkDotNetInstallation(): Promise<boolean> {
        try {
            child_process.execSync('dotnet --version', { encoding: 'utf8', timeout: 5000 });
            return true;
        } catch (error) {
            return false;
        }
    }

    private async autoInstallSqlPackage(): Promise<boolean> {
        try {
            this.outputChannel.appendLine('[BackupExportWebview] .NET detected. Attempting to install SqlPackage automatically...');
            
            // Show progress to user
            await this.panel?.webview.postMessage({
                type: 'progress',
                message: 'Installing SqlPackage tool...'
            });
            
            const result = child_process.execSync('dotnet tool install -g microsoft.sqlpackage', 
                { encoding: 'utf8', timeout: 60000 });
            
            this.outputChannel.appendLine(`[BackupExportWebview] SqlPackage installation result: ${result}`);
            
            // Verify installation
            const sqlPackagePath = await this.findSqlPackage();
            try {
                child_process.execSync(`"${sqlPackagePath}" /?`, { timeout: 5000 });
                this.outputChannel.appendLine('[BackupExportWebview] SqlPackage installed successfully!');
                
                await this.panel?.webview.postMessage({
                    type: 'progress',
                    message: 'SqlPackage installed successfully. Continuing with export...'
                });
                
                return true;
            } catch (verifyError) {
                this.outputChannel.appendLine(`[BackupExportWebview] SqlPackage verification failed: ${verifyError}`);
                return false;
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`[BackupExportWebview] SqlPackage installation failed: ${error.message}`);
            return false;
        }
    }

    async show(connectionId: string, database: string): Promise<void> {
        // Check if connection supports backup export (exclude Azure)
        const config = this.connectionProvider.getConnectionConfig(connectionId);
        if (!config) {
            throw new Error('Connection configuration not found');
        }

        if (config.authType === 'azure') {
            vscode.window.showWarningMessage(
                'Backup export is not supported for Azure SQL Database connections. This feature is only available for on-premises SQL Server instances.'
            );
            return;
        }

        this.outputChannel.appendLine(`[BackupExportWebview] Opening export webview for ${connectionId} -> ${database}`);

        if (this.panel) {
            this.panel.reveal();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'mssqlManagerBackupExport',
            `Export Database: ${database}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.panel.iconPath = {
            light: vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'icons', 'backup-light.svg')),
            dark: vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'icons', 'backup-dark.svg'))
        };

        this.panel.webview.html = this.getWebviewContent(connectionId, database);

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                try {
                    await this.handleWebviewMessage(message, connectionId, database);
                } catch (error: any) {
                    this.outputChannel.appendLine(`[BackupExportWebview] Error handling message: ${error.message}`);
                    await this.panel?.webview.postMessage({
                        type: 'error',
                        message: error.message
                    });
                }
            },
            undefined,
            this.context.subscriptions
        );

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        }, null, this.context.subscriptions);
    }

    private async handleWebviewMessage(message: any, connectionId: string, database: string): Promise<void> {
        switch (message.type) {
            case 'selectPath':
                await this.handleSelectPath();
                break;
            case 'exportBackup':
                await this.handleExportBackup(message.options, connectionId, database);
                break;
            case 'ready':
                // Webview is ready, send initial data
                await this.sendInitialData(connectionId, database);
                break;
            default:
                this.outputChannel.appendLine(`[BackupExportWebview] Unknown message type: ${message.type}`);
        }
    }

    private async handleSelectPath(): Promise<void> {
        const result = await vscode.window.showSaveDialog({
            filters: {
                'SQL Server Backup Files': ['bak'],
                'Data-tier Application Files': ['bacpac'],
                'All Files': ['*']
            },
            defaultUri: vscode.Uri.file(path.join(require('os').homedir(), 'database_backup.bak'))
        });

        if (result) {
            await this.panel?.webview.postMessage({
                type: 'pathSelected',
                path: result.fsPath
            });
        }
    }

    private async sendInitialData(connectionId: string, database: string): Promise<void> {
        const config = this.connectionProvider.getConnectionConfig(connectionId);
        if (!config) {
            throw new Error('Connection configuration not found');
        }

        // Get suggested backup path (default to .bak)
        const suggestedPath = path.join(
            require('os').homedir(),
            `${database}_${new Date().toISOString().slice(0, 10)}.bak`
        );

        await this.panel?.webview.postMessage({
            type: 'initialData',
            data: {
                connectionName: config.name,
                serverName: config.server,
                databaseName: database,
                suggestedPath: suggestedPath
            }
        });
    }

    private async handleExportBackup(options: any, connectionId: string, database: string): Promise<void> {
        this.outputChannel.appendLine(`[BackupExportWebview] Starting backup export with options: ${JSON.stringify(options)}`);

        try {
            // Validate required fields
            if (!options.backupPath || options.backupPath.trim() === '') {
                throw new Error('Backup file path is required');
            }

            // Validate file extension
            const fileFormat = options.fileFormat || 'bak';
            const expectedExt = fileFormat === 'bak' ? '.bak' : '.bacpac';
            
            if (!options.backupPath.toLowerCase().endsWith(expectedExt)) {
                throw new Error(`File must have ${expectedExt} extension for ${fileFormat.toUpperCase()} format`);
            }

            // Validate directory exists
            const backupDir = path.dirname(options.backupPath);
            if (!fs.existsSync(backupDir)) {
                throw new Error(`Directory does not exist: ${backupDir}`);
            }

            // Send progress update
            await this.panel?.webview.postMessage({
                type: 'progress',
                message: 'Preparing backup command...'
            });

            // Ensure connection is active
            await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, database);

            // Send progress update
            await this.panel?.webview.postMessage({
                type: 'progress',
                message: 'Creating database backup...'
            });

            // Execute backup/export
            if (fileFormat === 'bacpac') {
                await this.executeBacpacExport(connectionId, database, options);
            } else {
                await this.executeBackup(connectionId, database, options);
            }

            // Send success message
            await this.panel?.webview.postMessage({
                type: 'success',
                message: `Database backup successfully created: ${options.backupPath}`
            });

            this.outputChannel.appendLine(`[BackupExportWebview] Backup completed successfully: ${options.backupPath}`);

        } catch (error: any) {
            this.outputChannel.appendLine(`[BackupExportWebview] Backup failed: ${error.message}`);
            await this.panel?.webview.postMessage({
                type: 'error',
                message: `Backup failed: ${error.message}`
            });
        }
    }

    private async executeBackup(connectionId: string, database: string, options: any): Promise<void> {
        const pool = await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, database);

        // Build BACKUP DATABASE command
        let backupCommand = `BACKUP DATABASE [${database}] TO DISK = N'${options.backupPath}'`;

        // Add optional parameters
        const backupOptions: string[] = [];

        if (options.description && options.description.trim() !== '') {
            backupOptions.push(`DESCRIPTION = N'${options.description.replace(/'/g, "''")}'`);
        }

        if (options.name && options.name.trim() !== '') {
            backupOptions.push(`NAME = N'${options.name.replace(/'/g, "''")}'`);
        }

        if (options.compression) {
            backupOptions.push('COMPRESSION');
        }

        if (options.checksum) {
            backupOptions.push('CHECKSUM');
        }

        if (options.continueAfterError) {
            backupOptions.push('CONTINUE_AFTER_ERROR');
        }

        if (options.copyOnly) {
            backupOptions.push('COPY_ONLY');
        }

        if (backupOptions.length > 0) {
            backupCommand += ` WITH ${backupOptions.join(', ')}`;
        }

        this.outputChannel.appendLine(`[BackupExportWebview] Executing backup command: ${backupCommand}`);

        // Execute the backup command
        const request = pool.request();
        
        // Set a longer timeout for backup operations - this is specific to mssql package
        if ('timeout' in request) {
            (request as any).timeout = options.timeout || 300000; // 5 minutes default
        }

        await request.query(backupCommand);
    }

    private async executeBacpacExport(connectionId: string, database: string, options: any): Promise<void> {
        const config = this.connectionProvider.getConnectionConfig(connectionId);
        if (!config) {
            throw new Error('Connection configuration not found');
        }

        // Find SqlPackage executable
        let sqlPackagePath = await this.findSqlPackage();
        
        // Check if SqlPackage is available
        try {
            child_process.execSync(`"${sqlPackagePath}" /?`, { timeout: 5000 });
        } catch (error) {
            const platform = os.platform();
            
            if (platform === 'win32') {
                throw new Error('SqlPackage not found. Please install SQL Server Data Tools (SSDT) or SQL Server Management Studio (SSMS).');
            } else {
                // Check if .NET is installed
                const dotNetInstalled = await this.checkDotNetInstallation();
                if (!dotNetInstalled) {
                    throw new Error('SqlPackage requires .NET SDK. Please install .NET SDK from https://dotnet.microsoft.com/download, then restart VS Code.');
                }
                
                // Try to auto-install SqlPackage
                const installed = await this.autoInstallSqlPackage();
                if (!installed) {
                    throw new Error('Failed to automatically install SqlPackage. Please run manually: dotnet tool install -g microsoft.sqlpackage');
                }
                
                // Update sqlPackagePath after installation
                sqlPackagePath = await this.findSqlPackage();
                
                // Verify again
                try {
                    child_process.execSync(`"${sqlPackagePath}" /?`, { timeout: 5000 });
                } catch (verifyError) {
                    throw new Error('SqlPackage installation verification failed. Please ensure ~/.dotnet/tools is in your PATH and restart VS Code.');
                }
            }
        }

        // Build SqlPackage.exe command for BACPAC export
        const sqlPackageArgs = [
            '/Action:Export',
            `/TargetFile:${options.backupPath}`,
            `/SourceDatabaseName:${database}`,
            `/SourceServerName:${config.server}`
        ];

        // Add authentication
        if (config.authType === 'windows') {
            // Windows authentication is used by default when no credentials are specified
        } else {
            sqlPackageArgs.push(`/SourceUser:${config.username}`);
            if (config.password) {
                sqlPackageArgs.push(`/SourcePassword:${config.password}`);
            }
        }

        // Add port if specified
        if (config.port && config.port !== 1433) {
            sqlPackageArgs[3] = `/SourceServerName:${config.server},${config.port}`;
        }

        this.outputChannel.appendLine(`[BackupExportWebview] Executing SqlPackage at: ${sqlPackagePath}`);
        this.outputChannel.appendLine(`[BackupExportWebview] Args: ${sqlPackageArgs.join(' ')}`);

        try {
            
            await new Promise((resolve, reject) => {
                const sqlPackage = child_process.spawn(sqlPackagePath, sqlPackageArgs, {
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                let output = '';
                let errorOutput = '';

                sqlPackage.stdout?.on('data', (data) => {
                    output += data.toString();
                    this.outputChannel.append(data.toString());
                });

                sqlPackage.stderr?.on('data', (data) => {
                    errorOutput += data.toString();
                    this.outputChannel.append(data.toString());
                });

                sqlPackage.on('close', (code) => {
                    if (code === 0) {
                        this.outputChannel.appendLine(`[BackupExportWebview] BACPAC export completed successfully`);
                        resolve(void 0);
                    } else {
                        const errorMsg = `SqlPackage.exe failed with exit code ${code}. Error: ${errorOutput || output}`;
                        this.outputChannel.appendLine(`[BackupExportWebview] ${errorMsg}`);
                        reject(new Error(errorMsg));
                    }
                });

                sqlPackage.on('error', (error) => {
                    const platform = os.platform();
                    let installInstructions = '';
                    
                    if (platform === 'win32') {
                        installInstructions = '\n\nInstallation options for Windows:\n' +
                            '1. Install SQL Server Management Studio (SSMS)\n' +
                            '2. Install SQL Server Data Tools (SSDT)\n' +
                            '3. Install via dotnet tool: dotnet tool install -g microsoft.sqlpackage';
                    } else if (platform === 'darwin') {
                        installInstructions = '\n\nInstallation for macOS:\n' +
                            '1. Install .NET SDK from https://dotnet.microsoft.com/download\n' +
                            '2. Run: dotnet tool install -g microsoft.sqlpackage\n' +
                            '3. Ensure ~/.dotnet/tools is in your PATH';
                    } else {
                        installInstructions = '\n\nInstallation for Linux:\n' +
                            '1. Install .NET SDK from https://dotnet.microsoft.com/download\n' +
                            '2. Run: dotnet tool install -g microsoft.sqlpackage\n' +
                            '3. Ensure ~/.dotnet/tools is in your PATH';
                    }
                    
                    const errorMsg = `Failed to execute SqlPackage: ${error.message}${installInstructions}`;
                    this.outputChannel.appendLine(`[BackupExportWebview] ${errorMsg}`);
                    reject(new Error(errorMsg));
                });
            });
        } catch (error: any) {
            throw new Error(`BACPAC export failed: ${error.message}`);
        }
    }

    private getWebviewContent(connectionId: string, database: string): string {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Export Database Backup</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
        }

        .container {
            max-width: 600px;
            margin: 0 auto;
        }

        h1 {
            color: var(--vscode-foreground);
            margin-bottom: 20px;
            font-size: 24px;
        }

        .info-section {
            background: var(--vscode-editor-inactiveSelectionBackground);
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            border-left: 4px solid var(--vscode-textLink-foreground);
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
        textarea,
        select {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            border-radius: 3px;
            box-sizing: border-box;
        }

        input[type="text"]:focus,
        textarea:focus,
        select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .path-input-group {
            display: flex;
            gap: 10px;
        }

        .path-input-group input {
            flex: 1;
        }

        .path-input-group button {
            white-space: nowrap;
        }

        textarea {
            resize: vertical;
            min-height: 60px;
        }

        .checkbox-group {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 10px;
            margin-top: 10px;
        }

        .checkbox-item {
            display: flex;
            align-items: center;
        }

        .checkbox-item input[type="checkbox"] {
            width: auto;
            margin-right: 8px;
        }

        .checkbox-item label {
            margin-bottom: 0;
            font-weight: normal;
        }

        .buttons {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 30px;
        }

        button {
            padding: 8px 16px;
            border: 1px solid var(--vscode-button-border);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            border-radius: 3px;
            cursor: pointer;
            min-width: 80px;
        }

        button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        button.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        button.primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        button.secondary {
            background: transparent;
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-secondaryBorder, #cccccc);
        }

        button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground, #f3f3f3);
        }

        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .progress {
            margin: 20px 0;
            padding: 15px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
            display: none;
        }

        .progress.visible {
            display: block;
        }

        .message {
            margin: 20px 0;
            padding: 15px;
            border-radius: 6px;
            display: none;
        }

        .message.visible {
            display: block;
        }

        .message.error {
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-errorForeground);
        }

        .message.success {
            background: var(--vscode-terminal-ansiGreen);
            color: var(--vscode-terminal-ansiBlack);
        }

        .help-text {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Export Database Backup</h1>
        
        <div class="info-section">
            <strong>Connection:</strong> <span id="connectionName">Loading...</span><br>
            <strong>Server:</strong> <span id="serverName">Loading...</span><br>
            <strong>Database:</strong> <span id="databaseName">Loading...</span>
        </div>

        <form id="exportForm">
            <div class="form-group">
                <label for="fileFormat">File Format *</label>
                <select id="fileFormat" onchange="updateFormatOptions()">
                    <option value="bak">BAK - Database Backup (.bak)</option>
                    <option value="bacpac">BACPAC - Data-tier Application (.bacpac)</option>
                </select>
                <div class="help-text" id="formatHelp">Choose backup format: BAK for full backup or BACPAC for data export</div>
            </div>

            <div class="form-group">
                <label for="backupPath">Output File Path *</label>
                <div class="path-input-group">
                    <input type="text" id="backupPath" required placeholder="C:\\backup\\database_backup.bak">
                    <button type="button" id="selectPathBtn">Browse...</button>
                </div>
                <div class="help-text" id="pathHelp">Choose where to save the file (.bak or .bacpac extension)</div>
            </div>

            <div class="form-group">
                <label for="backupName">Backup Name</label>
                <input type="text" id="backupName" placeholder="Database Full Backup">
                <div class="help-text">Optional name for the backup set</div>
            </div>

            <div class="form-group">
                <label for="description">Description</label>
                <textarea id="description" placeholder="Full backup of the database"></textarea>
                <div class="help-text">Optional description of the backup</div>
            </div>

            <div class="form-group">
                <label>Advanced Options</label>
                <div class="checkbox-group">
                    <div class="checkbox-item">
                        <input type="checkbox" id="compression">
                        <label for="compression">Compression</label>
                    </div>
                    <div class="checkbox-item">
                        <input type="checkbox" id="checksum">
                        <label for="checksum">Verify Checksum</label>
                    </div>
                    <div class="checkbox-item">
                        <input type="checkbox" id="copyOnly">
                        <label for="copyOnly">Copy-only backup</label>
                    </div>
                    <div class="checkbox-item">
                        <input type="checkbox" id="continueAfterError">
                        <label for="continueAfterError">Continue after error</label>
                    </div>
                </div>
                <div class="help-text">
                    Compression reduces backup size. Checksum verifies backup integrity. 
                    Copy-only backup doesn't affect the regular backup sequence.
                </div>
            </div>

            <div class="progress" id="progressSection">
                <strong>Progress:</strong> <span id="progressMessage">Working...</span>
            </div>

            <div class="message" id="messageSection">
                <span id="messageText"></span>
            </div>

            <div class="buttons">
                <button type="button" class="secondary" id="cancelBtn">Cancel</button>
                <button type="submit" class="primary" id="exportBtn">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 6c0 1.657 3.582 3 8 3s8 -1.343 8 -3s-3.582 -3 -8 -3s-8 1.343 -8 3" />
                        <path d="M4 6v6c0 1.657 3.582 3 8 3c1.118 0 2.183 -.086 3.15 -.241" />
                        <path d="M20 12v-6" />
                        <path d="M4 12v6c0 1.657 3.582 3 8 3c.157 0 .312 -.002 .466 -.005" />
                        <path d="M16 19h6" />
                        <path d="M19 16l3 3l-3 3" />
                    </svg>
                    Export Backup
                </button>
            </div>
        </form>
    </div>

    <script>
        // VS Code API
        const vscode = acquireVsCodeApi();

        // DOM elements
        const form = document.getElementById('exportForm');
        const selectPathBtn = document.getElementById('selectPathBtn');
        const exportBtn = document.getElementById('exportBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const progressSection = document.getElementById('progressSection');
        const progressMessage = document.getElementById('progressMessage');
        const messageSection = document.getElementById('messageSection');
        const messageText = document.getElementById('messageText');

        // Event listeners
        form.addEventListener('submit', handleSubmit);
        selectPathBtn.addEventListener('click', handleSelectPath);
        cancelBtn.addEventListener('click', handleCancel);

        function handleSubmit(e) {
            e.preventDefault();
            
            hideMessage();
            hideProgress();

            const formData = new FormData(form);
            const options = {
                fileFormat: document.getElementById('fileFormat').value,
                backupPath: document.getElementById('backupPath').value.trim(),
                backupName: document.getElementById('backupName').value.trim(),
                description: document.getElementById('description').value.trim(),
                compression: document.getElementById('compression').checked,
                checksum: document.getElementById('checksum').checked,
                copyOnly: document.getElementById('copyOnly').checked,
                continueAfterError: document.getElementById('continueAfterError').checked,
                timeout: 300000 // 5 minutes
            };

            // Basic validation
            if (!options.backupPath) {
                showMessage('Backup file path is required', 'error');
                return;
            }

            const fileFormat = document.getElementById('fileFormat').value;
            const expectedExt = fileFormat === 'bak' ? '.bak' : '.bacpac';
            
            if (!options.backupPath.toLowerCase().endsWith(expectedExt)) {
                showMessage('File must have ' + expectedExt + ' extension for ' + fileFormat.toUpperCase() + ' format', 'error');
                return;
            }

            setExporting(true);
            showProgress('Preparing backup...');

            vscode.postMessage({
                type: 'exportBackup',
                options: options
            });
        }

        function handleSelectPath() {
            vscode.postMessage({ type: 'selectPath' });
        }

        function handleCancel() {
            // Close the webview panel
            vscode.postMessage({ type: 'cancel' });
        }

        function setExporting(exporting) {
            exportBtn.disabled = exporting;
            if (exporting) {
                exportBtn.textContent = 'Exporting...';
            } else {
                exportBtn.innerHTML = '📤 Export Backup';
            }
            
            // Disable form inputs during export
            const inputs = form.querySelectorAll('input, textarea, select, button');
            inputs.forEach(input => {
                if (input.id !== 'cancelBtn') {
                    input.disabled = exporting;
                }
            });
        }

        function showProgress(message) {
            progressMessage.textContent = message;
            progressSection.classList.add('visible');
        }

        function hideProgress() {
            progressSection.classList.remove('visible');
        }

        function updateFormatOptions() {
            const format = document.getElementById('fileFormat').value;
            const pathInput = document.getElementById('backupPath');
            const formatHelp = document.getElementById('formatHelp');
            const pathHelp = document.getElementById('pathHelp');
            
            // Update path extension if user hasn't manually modified it
            const currentPath = pathInput.value;
            if (currentPath) {
                const pathWithoutExt = currentPath.replace(/\.(bak|bacpac)$/i, '');
                const newExtension = format === 'bak' ? '.bak' : '.bacpac';
                pathInput.value = pathWithoutExt + newExtension;
            }
            
            if (format === 'bak') {
                pathInput.placeholder = 'C:\\backup\\database_backup.bak';
                formatHelp.textContent = 'BAK: Full database backup including schema, data, and transaction logs';
                pathHelp.textContent = 'Choose where to save the backup file (.bak extension)';
            } else {
                pathInput.placeholder = 'C:\\export\\database_export.bacpac';
                formatHelp.textContent = 'BACPAC: Logical export of database schema and data (portable format)';
                pathHelp.textContent = 'Choose where to save the export file (.bacpac extension)';
            }
        }

        function showMessage(message, type) {
            messageText.textContent = message;
            messageSection.className = 'message visible ' + type;
        }

        function hideMessage() {
            messageSection.classList.remove('visible');
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'initialData':
                    document.getElementById('connectionName').textContent = message.data.connectionName;
                    document.getElementById('serverName').textContent = message.data.serverName;
                    document.getElementById('databaseName').textContent = message.data.databaseName;
                    document.getElementById('backupPath').value = message.data.suggestedPath;
                    break;
                    
                case 'pathSelected':
                    document.getElementById('backupPath').value = message.path;
                    break;
                    
                case 'progress':
                    showProgress(message.message);
                    break;
                    
                case 'success':
                    setExporting(false);
                    hideProgress();
                    showMessage(message.message, 'success');
                    break;
                    
                case 'error':
                    setExporting(false);
                    hideProgress();
                    showMessage(message.message, 'error');
                    break;
            }
        });

        // Initialize
        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
    }
}