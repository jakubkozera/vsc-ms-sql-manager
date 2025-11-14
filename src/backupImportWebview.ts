import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConnectionProvider } from './connectionProvider';

export class BackupImportWebview {
    private panel: vscode.WebviewPanel | undefined;
    private connectionProvider: ConnectionProvider;
    private outputChannel: vscode.OutputChannel;
    private context: vscode.ExtensionContext;
    private onDatabaseImported?: () => void;

    constructor(
        connectionProvider: ConnectionProvider,
        outputChannel: vscode.OutputChannel,
        context: vscode.ExtensionContext,
        onDatabaseImported?: () => void
    ) {
        this.connectionProvider = connectionProvider;
        this.outputChannel = outputChannel;
        this.context = context;
        this.onDatabaseImported = onDatabaseImported;
    }

    async show(connectionId: string): Promise<void> {
        // Check if connection supports backup import (exclude Azure)
        const config = this.connectionProvider.getConnectionConfig(connectionId);
        if (!config) {
            throw new Error('Connection configuration not found');
        }

        if (config.authType === 'azure') {
            vscode.window.showWarningMessage(
                'Backup import is not supported for Azure SQL Database connections. This feature is only available for on-premises SQL Server instances.'
            );
            return;
        }

        this.outputChannel.appendLine(`[BackupImportWebview] Opening import webview for connection ${connectionId}`);

        if (this.panel) {
            this.panel.reveal();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'mssqlManagerBackupImport',
            `Import Database Backup`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.panel.iconPath = {
            light: vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'icons', 'import-light.svg')),
            dark: vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'icons', 'import-dark.svg'))
        };

        this.panel.webview.html = this.getWebviewContent();

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                try {
                    await this.handleWebviewMessage(message, connectionId);
                } catch (error: any) {
                    this.outputChannel.appendLine(`[BackupImportWebview] Error handling message: ${error.message}`);
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

    private async handleWebviewMessage(message: any, connectionId: string): Promise<void> {
        switch (message.type) {
            case 'selectBackupFile':
                await this.handleSelectBackupFile();
                break;
            case 'analyzeBackup':
                await this.handleAnalyzeBackup(message.backupPath, connectionId);
                break;
            case 'importBackup':
                await this.handleImportBackup(message.options, connectionId);
                break;
            case 'listDatabases':
                await this.handleListDatabases(connectionId);
                break;
            case 'checkDatabaseExists':
                await this.handleCheckDatabaseExists(message.databaseName, connectionId);
                break;
            case 'getDefaultDataPath':
                await this.handleGetDefaultDataPath(connectionId);
                break;
            case 'ready':
                // Webview is ready, send initial data
                await this.sendInitialData(connectionId);
                break;
            default:
                this.outputChannel.appendLine(`[BackupImportWebview] Unknown message type: ${message.type}`);
        }
    }

    private async handleAnalyzeBackup(backupPath: string, connectionId: string): Promise<void> {
        try {
            await this.getBackupInfo(connectionId, backupPath);
        } catch (error: any) {
            this.outputChannel.appendLine(`[BackupImportWebview] Error analyzing backup: ${error.message}`);
            await this.panel?.webview.postMessage({
                type: 'error',
                message: `Failed to analyze backup file: ${error.message}`
            });
        }
    }

    private async handleSelectBackupFile(): Promise<void> {
        const result = await vscode.window.showOpenDialog({
            filters: {
                'SQL Server Backup Files': ['bak'],
                'All Files': ['*']
            },
            canSelectMany: false,
            openLabel: 'Select Backup File'
        });

        if (result && result.length > 0) {
            await this.panel?.webview.postMessage({
                type: 'backupFileSelected',
                path: result[0].fsPath
            });
        }
    }

    private async handleListDatabases(connectionId: string): Promise<void> {
        try {
            // Ensure connection to master database for server-level operations
            const pool = await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, 'master');
            
            const request = pool.request();
            const result = await request.query(`
                SELECT name 
                FROM sys.databases 
                WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
                ORDER BY name
            `);

            const databases = result.recordset.map((row: any) => row.name);

            await this.panel?.webview.postMessage({
                type: 'databasesListed',
                databases: databases
            });
        } catch (error: any) {
            this.outputChannel.appendLine(`[BackupImportWebview] Error listing databases: ${error.message}`);
            await this.panel?.webview.postMessage({
                type: 'error',
                message: `Failed to list databases: ${error.message}`
            });
        }
    }

    private async handleCheckDatabaseExists(databaseName: string, connectionId: string): Promise<void> {
        try {
            const pool = await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, 'master');
            const exists = await this.databaseExists(pool, databaseName);
            
            await this.panel?.webview.postMessage({
                type: 'databaseExistsResult',
                databaseName: databaseName,
                exists: exists
            });
        } catch (error: any) {
            this.outputChannel.appendLine(`[BackupImportWebview] Error checking database existence: ${error.message}`);
        }
    }

    private async handleGetDefaultDataPath(connectionId: string): Promise<void> {
        try {
            const pool = await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, 'master');
            const request = pool.request();
            const result = await request.query(`
                SELECT 
                    SERVERPROPERTY('InstanceDefaultDataPath') as DefaultDataPath,
                    SERVERPROPERTY('InstanceDefaultLogPath') as DefaultLogPath
            `);

            let dataPath = result.recordset[0]?.DefaultDataPath;
            let logPath = result.recordset[0]?.DefaultLogPath;

            // Fallback for LocalDB if paths are null
            if (!dataPath || !logPath) {
                const localDbResult = await request.query(`
                    SELECT 
                        SUBSTRING(physical_name, 1, LEN(physical_name) - CHARINDEX('\\', REVERSE(physical_name))) + '\\' as DataPath
                    FROM sys.master_files 
                    WHERE database_id = DB_ID('master') AND type = 0
                `);
                const basePath = localDbResult.recordset[0]?.DataPath || 'C:\\Program Files\\Microsoft SQL Server\\MSSQL15.MSSQLLOCALDB\\MSSQL\\DATA\\';
                dataPath = basePath;
                logPath = basePath;
            }

            await this.panel?.webview.postMessage({
                type: 'defaultDataPath',
                dataPath: dataPath,
                logPath: logPath
            });
        } catch (error: any) {
            this.outputChannel.appendLine(`[BackupImportWebview] Error getting default data path: ${error.message}`);
            // Use default fallback
            await this.panel?.webview.postMessage({
                type: 'defaultDataPath',
                dataPath: 'C:\\Program Files\\Microsoft SQL Server\\MSSQL15.MSSQLLOCALDB\\MSSQL\\DATA\\',
                logPath: 'C:\\Program Files\\Microsoft SQL Server\\MSSQL15.MSSQLLOCALDB\\MSSQL\\DATA\\'
            });
        }
    }

    private async sendInitialData(connectionId: string): Promise<void> {
        const config = this.connectionProvider.getConnectionConfig(connectionId);
        if (!config) {
            throw new Error('Connection configuration not found');
        }

        await this.panel?.webview.postMessage({
            type: 'initialData',
            data: {
                connectionName: config.name,
                serverName: config.server
            }
        });
    }

    private async handleImportBackup(options: any, connectionId: string): Promise<void> {
        this.outputChannel.appendLine(`[BackupImportWebview] Starting backup import with options: ${JSON.stringify(options)}`);

        try {
            // Validate required fields
            if (!options.backupPath || options.backupPath.trim() === '') {
                throw new Error('Backup file path is required');
            }

            if (!options.targetDatabase || options.targetDatabase.trim() === '') {
                throw new Error('Target database name is required');
            }

            // Validate file exists
            if (!fs.existsSync(options.backupPath)) {
                throw new Error(`Backup file does not exist: ${options.backupPath}`);
            }

            // Validate file extension
            if (!options.backupPath.toLowerCase().endsWith('.bak')) {
                throw new Error('Backup file must have .bak extension');
            }

            // Send progress update
            await this.panel?.webview.postMessage({
                type: 'progress',
                message: 'Analyzing backup file...'
            });

            // Get backup information to suggest database name
            await this.getBackupInfo(connectionId, options.backupPath);

            // Send progress update
            await this.panel?.webview.postMessage({
                type: 'progress',
                message: 'Preparing restore command...'
            });

            // Ensure connection to master database
            await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, 'master');

            // Send progress update
            await this.panel?.webview.postMessage({
                type: 'progress',
                message: 'Restoring database backup...'
            });

            // Execute restore
            await this.executeRestore(connectionId, options);

            // Send success message
            await this.panel?.webview.postMessage({
                type: 'success',
                message: `Database successfully restored as: ${options.targetDatabase}`
            });

            // Show VS Code notification
            vscode.window.showInformationMessage(`Database backup imported successfully as '${options.targetDatabase}'`);

            // Refresh tree view to show new database
            if (this.onDatabaseImported) {
                this.onDatabaseImported();
            }

            // Close webview after 2 seconds
            setTimeout(() => {
                if (this.panel) {
                    this.panel.dispose();
                }
            }, 2000);

            this.outputChannel.appendLine(`[BackupImportWebview] Restore completed successfully: ${options.targetDatabase}`);

        } catch (error: any) {
            this.outputChannel.appendLine(`[BackupImportWebview] Restore failed: ${error.message}`);
            await this.panel?.webview.postMessage({
                type: 'error',
                message: `Restore failed: ${error.message}`
            });
        }
    }

    private async executeRestore(connectionId: string, options: any): Promise<void> {
        const pool = await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, 'master');

        // First check if target database exists and handle it
        if (!options.replace && await this.databaseExists(pool, options.targetDatabase)) {
            throw new Error(`Database '${options.targetDatabase}' already exists. Enable 'Replace existing database' option to overwrite it.`);
        }

        // If replacing existing database, we need to set it to single user mode first
        if (options.replace && await this.databaseExists(pool, options.targetDatabase)) {
            await this.prepareDatabaseForReplace(pool, options.targetDatabase);
        }

        // Build RESTORE DATABASE command
        const targetDbName = options.targetDatabase.replace(/'/g, "''"); // Escape single quotes
        const backupPath = options.backupPath.replace(/'/g, "''"); // Escape single quotes
        
        let restoreCommand = `RESTORE DATABASE [${targetDbName}] FROM DISK = N'${backupPath}'`;

        // Add optional parameters
        const restoreOptions: string[] = [];

        if (options.replace) {
            restoreOptions.push('REPLACE');
        }

        if (options.noRecovery) {
            restoreOptions.push('NORECOVERY');
        } else {
            restoreOptions.push('RECOVERY');
        }

        if (options.checksum) {
            restoreOptions.push('CHECKSUM');
        }

        if (options.continueAfterError) {
            restoreOptions.push('CONTINUE_AFTER_ERROR');
        }

        // Add file relocation if specified
        if (options.relocateData || options.relocateLog) {
            if (options.relocateData && options.relocateData.trim() !== '') {
                const logicalDataName = await this.getLogicalFileName(pool, options.backupPath, 'D');
                if (logicalDataName) {
                    restoreOptions.push(`MOVE N'${logicalDataName}' TO N'${options.relocateData}'`);
                }
            }

            if (options.relocateLog && options.relocateLog.trim() !== '') {
                const logicalLogName = await this.getLogicalFileName(pool, options.backupPath, 'L');
                if (logicalLogName) {
                    restoreOptions.push(`MOVE N'${logicalLogName}' TO N'${options.relocateLog}'`);
                }
            }
        }

        if (restoreOptions.length > 0) {
            restoreCommand += ` WITH ${restoreOptions.join(', ')}`;
        }

        this.outputChannel.appendLine(`[BackupImportWebview] Executing restore command: ${restoreCommand}`);

        // Execute the restore command
        const request = pool.request();
        
        // Set a longer timeout for restore operations
        if ('timeout' in request) {
            (request as any).timeout = options.timeout || 600000; // 10 minutes default
        }

        await request.query(restoreCommand);
    }

    private async getBackupInfo(connectionId: string, backupPath: string): Promise<void> {
        try {
            const pool = await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, 'master');
            const request = pool.request();
            const result = await request.query(`
                RESTORE HEADERONLY FROM DISK = N'${backupPath.replace(/'/g, "''")}'
            `);

            if (result.recordset && result.recordset.length > 0) {
                const backupInfo = result.recordset[0];
                const originalDbName = backupInfo.DatabaseName;
                
                await this.panel?.webview.postMessage({
                    type: 'backupInfo',
                    originalDatabaseName: originalDbName,
                    backupDate: backupInfo.BackupFinishDate,
                    backupSize: backupInfo.BackupSize
                });
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`[BackupImportWebview] Warning: Could not get backup info: ${error.message}`);
            // Don't throw - this is not critical
        }
    }

    private async databaseExists(pool: any, databaseName: string): Promise<boolean> {
        try {
            const request = pool.request();
            const result = await request.query(`
                SELECT COUNT(*) as count 
                FROM sys.databases 
                WHERE name = N'${databaseName.replace(/'/g, "''")}'
            `);
            return result.recordset[0].count > 0;
        } catch (error) {
            this.outputChannel.appendLine(`[BackupImportWebview] Error checking if database exists: ${error}`);
            return false;
        }
    }

    private async prepareDatabaseForReplace(pool: any, databaseName: string): Promise<void> {
        try {
            this.outputChannel.appendLine(`[BackupImportWebview] Preparing database ${databaseName} for replacement...`);
            
            // Set database to single user mode to kick out existing connections
            const request1 = pool.request();
            await request1.query(`ALTER DATABASE [${databaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`);
            
            // Wait a moment for connections to close
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Set back to multi user (the RESTORE will handle this, but just in case)
            const request2 = pool.request();
            await request2.query(`ALTER DATABASE [${databaseName}] SET MULTI_USER`);
            
        } catch (error) {
            this.outputChannel.appendLine(`[BackupImportWebview] Warning: Could not prepare database for replacement: ${error}`);
            // Don't throw here - let the RESTORE REPLACE try anyway
        }
    }

    private async getLogicalFileName(pool: any, backupPath: string, fileType: 'D' | 'L'): Promise<string | null> {
        try {
            const request = pool.request();
            const result = await request.query(`
                RESTORE FILELISTONLY FROM DISK = N'${backupPath.replace(/'/g, "''")}'
            `);

            // Find the logical file name for the specified type
            const fileInfo = result.recordset.find((row: any) => row.Type === fileType);
            return fileInfo ? fileInfo.LogicalName : null;
        } catch (error) {
            this.outputChannel.appendLine(`[BackupImportWebview] Warning: Could not get logical file name for type ${fileType}: ${error}`);
            return null;
        }
    }

    private getWebviewContent(): string {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Import Database Backup</title>
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
            max-width: 700px;
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
        select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .file-input-group {
            display: flex;
            gap: 10px;
        }

        .file-input-group input {
            flex: 1;
        }

        .file-input-group button {
            white-space: nowrap;
        }

        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
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

        .message.info {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-textLink-foreground);
            color: var(--vscode-foreground);
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

        .advanced-section {
            margin-top: 30px;
            border-top: 1px solid var(--vscode-input-border);
        }

        .collapsible-header {
            display: flex;
            align-items: center;
            cursor: pointer;
            padding: 15px 0;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            font-size: 16px;
            font-weight: 600;
            gap: 8px;
            width: 100%;
            text-align: left;
        }

        .collapsible-header:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .collapsible-icon {
            transition: transform 0.2s ease;
            width: 16px;
            height: 16px;
        }

        .collapsible-icon.expanded {
            transform: rotate(0deg);
        }

        .collapsible-icon.collapsed {
            transform: rotate(-90deg);
        }

        .collapsible-content {
            display: none;
            padding: 0 24px 20px 24px;
        }

        .collapsible-content.expanded {
            display: block;
        }

        .target-database-switch {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
        }

        .target-option {
            flex: 1;
            padding: 12px;
            border: 2px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            border-radius: 6px;
            cursor: pointer;
            text-align: center;
            font-weight: 500;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        
        .target-option svg {
            flex-shrink: 0;
            opacity: 0.8;
        }

        .target-option:hover {
            border-color: var(--vscode-focusBorder);
        }

        .target-option.active {
            border-color: var(--vscode-button-background);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .target-option.inactive {
            opacity: 0.6;
        }

        .warning {
            background: var(--vscode-inputValidation-warningBackground);
            border: 1px solid var(--vscode-inputValidation-warningBorder);
            color: var(--vscode-inputValidation-warningForeground);
            padding: 10px;
            border-radius: 3px;
            margin-top: 5px;
            font-size: 12px;
        }

        .section-header {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 15px;
            color: var(--vscode-foreground);
        }

        .backdrop {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 9999;
        }

        .backdrop.visible {
            display: flex;
        }

        .loader {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 40px;
            text-align: center;
            min-width: 300px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }

        .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid var(--vscode-input-border);
            border-top: 4px solid var(--vscode-textLink-foreground);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .loader-message {
            font-size: 14px;
            color: var(--vscode-foreground);
            margin-bottom: 10px;
            font-weight: 500;
        }

        .loader-detail {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Import Database Backup</h1>
        
        <div class="info-section">
            <strong>Connection:</strong> <span id="connectionName">Loading...</span><br>
            <strong>Server:</strong> <span id="serverName">Loading...</span>
        </div>

        <form id="importForm">
            <div class="form-group">
                <label for="backupPath">Backup File (.bak) *</label>
                <div class="file-input-group">
                    <input type="text" id="backupPath" required placeholder="C:\\backup\\database_backup.bak">
                    <button type="button" id="selectFileBtn">Browse...</button>
                    <button type="button" id="analyzeBtn" disabled>Analyze</button>
                </div>
                <div class="help-text">Select the .bak file to restore from</div>
                <div id="backupInfoSection" style="display: none;" class="info-section">
                    <strong>Backup Information:</strong><br>
                    <span id="backupInfo">No backup analyzed yet</span>
                </div>
            </div>

            <div class="form-group">
                <label>Target Database Selection</label>
                <div class="target-database-switch">
                    <div class="target-option active" id="newDatabaseOption" data-target="new">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M4 6c0 1.657 3.582 3 8 3s8 -1.343 8 -3s-3.582 -3 -8 -3s-8 1.343 -8 3" />
                            <path d="M4 6v6c0 1.657 3.582 3 8 3c1.075 0 2.1 -.08 3.037 -.224" />
                            <path d="M20 12v-6" />
                            <path d="M4 12v6c0 1.657 3.582 3 8 3c.166 0 .331 -.002 .495 -.006" />
                            <path d="M16 19h6" />
                            <path d="M19 16v6" />
                        </svg>
                        Create New Database
                    </div>
                    <div class="target-option" id="existingDatabaseOption" data-target="existing">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 3m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
                            <path d="M15 15m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
                            <path d="M21 11v-3a2 2 0 0 0 -2 -2h-6l3 3m0 -6l-3 3" />
                            <path d="M3 13v3a2 2 0 0 0 2 2h6l-3 -3m0 6l3 -3" />
                        </svg>
                        Replace Existing Database
                    </div>
                </div>
            </div>

            <div class="form-group" id="newDatabaseGroup">
                <label for="targetDatabase">Target Database Name *</label>
                <input type="text" id="targetDatabase" required placeholder="MyRestoredDatabase">
                <div class="help-text">Name of the database to create/restore to</div>
                <div id="databaseExistsWarning" class="warning" style="display: none;">
                    Database already exists! Switch to "Replace Existing Database" mode or choose a different name.
                </div>
                <div class="form-row" style="margin-top: 10px;">
                    <button type="button" id="suggestNewNameBtn" style="padding: 4px 8px; font-size: 12px;">Suggest New Name</button>
                    <button type="button" id="useOriginalNameBtn" style="padding: 4px 8px; font-size: 12px;" disabled>Use Original Name</button>
                </div>
            </div>

            <div class="form-group" id="existingDatabaseGroup" style="display: none;">
                <label for="existingDatabases">Select Database to Replace *</label>
                <select id="existingDatabases" required>
                    <option value="">-- Select existing database --</option>
                </select>
                <div class="help-text">Choose which existing database to replace with the backup</div>
            </div>

            <div class="advanced-section">
                <button type="button" class="collapsible-header" id="advancedToggle">
                    <svg class="collapsible-icon collapsed" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M6 9l6 6l6 -6" />
                    </svg>
                    Advanced Options
                </button>
                
                <div class="collapsible-content" id="advancedContent">
                    <div class="form-group">
                        <label>Restore Options</label>
                        <div class="checkbox-group">
                            <div class="checkbox-item">
                                <input type="checkbox" id="checksum">
                                <label for="checksum">Verify checksum</label>
                            </div>
                            <div class="checkbox-item">
                                <input type="checkbox" id="continueAfterError">
                                <label for="continueAfterError">Continue after error</label>
                            </div>
                            <div class="checkbox-item">
                                <input type="checkbox" id="noRecovery">
                                <label for="noRecovery">No recovery (for log shipping)</label>
                            </div>
                        </div>
                        <div class="help-text">
                            Checksum verifies backup integrity. No recovery leaves database in restoring state.
                        </div>
                    </div>

                    <div class="form-group">
                        <label>File Relocation (Optional)</label>
                        <div class="form-row">
                            <div>
                                <label for="relocateData">Data file path</label>
                                <input type="text" id="relocateData" placeholder="C:\\Data\\MyDatabase.mdf">
                            </div>
                            <div>
                                <label for="relocateLog">Log file path</label>
                                <input type="text" id="relocateLog" placeholder="C:\\Log\\MyDatabase.ldf">
                            </div>
                        </div>
                        <div class="help-text">Specify new locations for data and log files if needed</div>
                    </div>
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
                <button type="submit" class="primary" id="importBtn">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 6c0 1.657 3.582 3 8 3s8 -1.343 8 -3s-3.582 -3 -8 -3s-8 1.343 -8 3" />
                        <path d="M4 6v6c0 1.657 3.582 3 8 3c.856 0 1.68 -.05 2.454 -.144m5.546 -2.856v-6" />
                        <path d="M4 12v6c0 1.657 3.582 3 8 3c.171 0 .341 -.002 .51 -.006" />
                        <path d="M19 22v-6" />
                        <path d="M22 19l-3 -3l-3 3" />
                    </svg>
                    Import Backup
                </button>
            </div>
        </form>

        <!-- Backdrop loader -->
        <div id="backdrop" class="backdrop">
            <div class="loader">
                <div class="spinner"></div>
                <div class="loader-message" id="loaderMessage">Importing database backup...</div>
                <div class="loader-detail" id="loaderDetail">Please wait, this may take several minutes</div>
            </div>
        </div>
    </div>

    <script>
        // VS Code API
        const vscode = acquireVsCodeApi();

        // Global variables
        let originalDatabaseName = '';
        let backupAnalyzed = false;
        let defaultDataPath = '';
        let defaultLogPath = '';

        // DOM elements
        const form = document.getElementById('importForm');
        const selectFileBtn = document.getElementById('selectFileBtn');
        const analyzeBtn = document.getElementById('analyzeBtn');
        const importBtn = document.getElementById('importBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const progressSection = document.getElementById('progressSection');
        const progressMessage = document.getElementById('progressMessage');
        const messageSection = document.getElementById('messageSection');
        const messageText = document.getElementById('messageText');
        const existingDatabases = document.getElementById('existingDatabases');
        const targetDatabaseInput = document.getElementById('targetDatabase');
        const backupPathInput = document.getElementById('backupPath');
        const databaseExistsWarning = document.getElementById('databaseExistsWarning');
        const backupInfoSection = document.getElementById('backupInfoSection');
        const backupInfo = document.getElementById('backupInfo');
        const suggestNewNameBtn = document.getElementById('suggestNewNameBtn');
        const useOriginalNameBtn = document.getElementById('useOriginalNameBtn');
        const backdrop = document.getElementById('backdrop');
        const loaderMessage = document.getElementById('loaderMessage');
        const loaderDetail = document.getElementById('loaderDetail');
        
        // New elements for target database switch and collapsible sections
        const newDatabaseOption = document.getElementById('newDatabaseOption');
        const existingDatabaseOption = document.getElementById('existingDatabaseOption');
        const newDatabaseGroup = document.getElementById('newDatabaseGroup');
        const existingDatabaseGroup = document.getElementById('existingDatabaseGroup');
        const advancedToggle = document.getElementById('advancedToggle');
        const advancedContent = document.getElementById('advancedContent');
        const collapsibleIcon = advancedToggle.querySelector('.collapsible-icon');

        let currentTargetMode = 'new'; // 'new' or 'existing'

        // Event listeners
        form.addEventListener('submit', handleSubmit);
        selectFileBtn.addEventListener('click', handleSelectFile);
        analyzeBtn.addEventListener('click', handleAnalyzeBackup);
        cancelBtn.addEventListener('click', handleCancel);
        existingDatabases.addEventListener('change', handleDatabaseSelection);
        targetDatabaseInput.addEventListener('input', handleTargetDatabaseChange);
        backupPathInput.addEventListener('input', handleBackupPathChange);
        
        // New event listeners
        newDatabaseOption.addEventListener('click', () => switchTargetMode('new'));
        existingDatabaseOption.addEventListener('click', () => switchTargetMode('existing'));
        advancedToggle.addEventListener('click', toggleAdvancedOptions);
        
        suggestNewNameBtn.addEventListener('click', handleSuggestNewName);
        useOriginalNameBtn.addEventListener('click', handleUseOriginalName);

        function handleSubmit(e) {
            e.preventDefault();
            
            hideMessage();
            hideProgress();

            // Get target database based on current mode
            let targetDatabase = '';
            if (currentTargetMode === 'new') {
                targetDatabase = document.getElementById('targetDatabase').value.trim();
            } else {
                targetDatabase = document.getElementById('existingDatabases').value;
            }

            const options = {
                backupPath: document.getElementById('backupPath').value.trim(),
                targetDatabase: targetDatabase,
                replace: currentTargetMode === 'existing', // Always true for existing mode
                checksum: document.getElementById('checksum').checked,
                continueAfterError: document.getElementById('continueAfterError').checked,
                noRecovery: document.getElementById('noRecovery').checked,
                relocateData: document.getElementById('relocateData').value.trim(),
                relocateLog: document.getElementById('relocateLog').value.trim(),
                timeout: 600000 // 10 minutes
            };

            // Basic validation
            if (!options.backupPath) {
                showMessage('Backup file path is required', 'error');
                return;
            }

            if (!options.targetDatabase) {
                const fieldName = currentTargetMode === 'new' ? 'Target database name' : 'Existing database selection';
                showMessage(fieldName + ' is required', 'error');
                return;
            }

            if (!options.backupPath.toLowerCase().endsWith('.bak')) {
                showMessage('Backup file must have .bak extension', 'error');
                return;
            }

            // If creating a new database (not replacing), require file relocation
            if (currentTargetMode === 'new' && (!options.relocateData || !options.relocateLog)) {
                showMessage('File relocation paths are required when creating a new database. Please specify data and log file paths in Advanced Options.', 'error');
                return;
            }

            setImporting(true);
            showProgress('Preparing restore...');

            vscode.postMessage({
                type: 'importBackup',
                options: options
            });
        }

        function handleSelectFile() {
            vscode.postMessage({ type: 'selectBackupFile' });
        }

        function handleAnalyzeBackup() {
            const backupPath = backupPathInput.value.trim();
            if (!backupPath) {
                showMessage('Please select a backup file first', 'error');
                return;
            }

            if (!backupPath.toLowerCase().endsWith('.bak')) {
                showMessage('Backup file must have .bak extension', 'error');
                return;
            }

            hideMessage();
            showProgress('Analyzing backup file...');
            vscode.postMessage({
                type: 'analyzeBackup',
                backupPath: backupPath
            });
        }

        function handleBackupPathChange() {
            const hasPath = backupPathInput.value.trim().length > 0;
            analyzeBtn.disabled = !hasPath;
            
            if (!hasPath) {
                backupAnalyzed = false;
                backupInfoSection.style.display = 'none';
                useOriginalNameBtn.disabled = true;
                originalDatabaseName = '';
            }
        }

        function handleSuggestNewName() {
            const baseName = originalDatabaseName || 'MyDatabase';
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');
            const suggestedName = baseName + '_Restored_' + timestamp;
            targetDatabaseInput.value = suggestedName;
            replaceCheckbox.checked = false;
            
            // Auto-suggest file paths for new database
            autoSuggestFilePaths(suggestedName);
            
            handleTargetDatabaseChange();
        }

        function autoSuggestFilePaths(databaseName) {
            // Use real SQL Server paths if available, otherwise fallback
            const basePath = defaultDataPath || 'C:\\\\Program Files\\\\Microsoft SQL Server\\\\MSSQL15.MSSQLLOCALDB\\\\MSSQL\\\\DATA\\\\';
            const logBasePath = defaultLogPath || basePath;
            
            const dataPath = basePath + databaseName + '.mdf';
            const logPath = logBasePath + databaseName + '_log.ldf';
            
            document.getElementById('relocateData').value = dataPath;
            document.getElementById('relocateLog').value = logPath;
            
            // Show info about automatic file path generation
            showMessage('File paths automatically generated for new database. You can modify them in Advanced Options if needed.', 'info');
            setTimeout(() => hideMessage(), 5000);
        }

        function handleUseOriginalName() {
            if (originalDatabaseName) {
                targetDatabaseInput.value = originalDatabaseName;
                replaceCheckbox.checked = true;
                showDatabaseExistsWarning(false); // Will be checked again by handleTargetDatabaseChange
                handleTargetDatabaseChange();
            }
        }

        function handleCancel() {
            // Close the webview panel
            vscode.postMessage({ type: 'cancel' });
        }

        function switchTargetMode(mode) {
            currentTargetMode = mode;
            
            // Update button states
            if (mode === 'new') {
                newDatabaseOption.classList.add('active');
                newDatabaseOption.classList.remove('inactive');
                existingDatabaseOption.classList.remove('active');
                existingDatabaseOption.classList.add('inactive');
                
                // Show/hide relevant groups
                newDatabaseGroup.style.display = 'block';
                existingDatabaseGroup.style.display = 'none';
                
                // Update form requirements
                targetDatabaseInput.setAttribute('required', 'true');
                existingDatabases.removeAttribute('required');
                
                // Clear existing database selection
                existingDatabases.value = '';
                
            } else { // existing
                existingDatabaseOption.classList.add('active');
                existingDatabaseOption.classList.remove('inactive');
                newDatabaseOption.classList.remove('active');
                newDatabaseOption.classList.add('inactive');
                
                // Show/hide relevant groups
                newDatabaseGroup.style.display = 'none';
                existingDatabaseGroup.style.display = 'block';
                
                // Update form requirements
                existingDatabases.setAttribute('required', 'true');
                targetDatabaseInput.removeAttribute('required');
                
                // Clear new database name
                targetDatabaseInput.value = '';
                hideMessage();
            }
        }

        function toggleAdvancedOptions() {
            const isExpanded = advancedContent.classList.contains('expanded');
            
            if (isExpanded) {
                // Collapse
                advancedContent.classList.remove('expanded');
                collapsibleIcon.classList.remove('expanded');
                collapsibleIcon.classList.add('collapsed');
            } else {
                // Expand
                advancedContent.classList.add('expanded');
                collapsibleIcon.classList.remove('collapsed');
                collapsibleIcon.classList.add('expanded');
            }
        }

        function handleDatabaseSelection() {
            const selectedDb = existingDatabases.value;
            if (selectedDb && currentTargetMode === 'existing') {
                // In existing mode, this represents the target database to replace
                targetDatabaseInput.value = selectedDb;
                hideMessage();
            }
        }

        function handleTargetDatabaseChange() {
            const databaseName = targetDatabaseInput.value.trim();
            if (databaseName && currentTargetMode === 'new') {
                // Only check for existence when in new database mode
                clearTimeout(window.dbCheckTimeout);
                window.dbCheckTimeout = setTimeout(() => {
                    vscode.postMessage({
                        type: 'checkDatabaseExists',
                        databaseName: databaseName
                    });
                }, 500);
            } else {
                showDatabaseExistsWarning(false);
            }
        }

        function handleReplaceChange() {
            // Hide warning if replace is checked
            if (replaceCheckbox.checked) {
                showDatabaseExistsWarning(false);
            }
        }

        function showDatabaseExistsWarning(show) {
            if (show && !replaceCheckbox.checked) {
                databaseExistsWarning.style.display = 'block';
            } else {
                databaseExistsWarning.style.display = 'none';
            }
        }

        function setImporting(importing) {
            if (importing) {
                showBackdrop('Importing database backup...', 'Please wait, this may take several minutes');
            } else {
                hideBackdrop();
            }
            
            importBtn.disabled = importing;
            if (importing) {
                importBtn.textContent = 'Importing...';
            } else {
                importBtn.innerHTML = '📥 Import Backup';
            }
            
            // Disable form inputs during import
            const inputs = form.querySelectorAll('input, select, button');
            inputs.forEach(input => {
                if (input.id !== 'cancelBtn') {
                    input.disabled = importing;
                }
            });
        }

        function showBackdrop(message, detail) {
            loaderMessage.textContent = message;
            loaderDetail.textContent = detail || '';
            backdrop.classList.add('visible');
        }

        function hideBackdrop() {
            backdrop.classList.remove('visible');
        }

        function updateBackdropMessage(message, detail) {
            loaderMessage.textContent = message;
            if (detail) {
                loaderDetail.textContent = detail;
            }
        }

        function showProgress(message) {
            progressMessage.textContent = message;
            progressSection.classList.add('visible');
        }

        function hideProgress() {
            progressSection.classList.remove('visible');
        }

        function showMessage(message, type) {
            messageText.textContent = message;
            messageSection.className = 'message visible ' + type;
        }

        function hideMessage() {
            messageSection.classList.remove('visible');
        }

        function populateDatabases(databases) {
            existingDatabases.innerHTML = '<option value="">-- Select existing database --</option>';
            databases.forEach(db => {
                const option = document.createElement('option');
                option.value = db;
                option.textContent = db;
                existingDatabases.appendChild(option);
            });
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'initialData':
                    document.getElementById('connectionName').textContent = message.data.connectionName;
                    document.getElementById('serverName').textContent = message.data.serverName;
                    // Request list of existing databases and default paths
                    vscode.postMessage({ type: 'listDatabases' });
                    vscode.postMessage({ type: 'getDefaultDataPath' });
                    break;

                case 'defaultDataPath':
                    defaultDataPath = message.dataPath;
                    defaultLogPath = message.logPath;
                    break;
                    
                case 'backupFileSelected':
                    backupPathInput.value = message.path;
                    handleBackupPathChange();
                    break;

                case 'backupInfo':
                    originalDatabaseName = message.originalDatabaseName;
                    backupAnalyzed = true;
                    useOriginalNameBtn.disabled = false;
                    
                    let infoText = 'Original DB: ' + message.originalDatabaseName;
                    if (message.backupDate) {
                        infoText += '<br>Backup Date: ' + new Date(message.backupDate).toLocaleString();
                    }
                    if (message.backupSize) {
                        const sizeMB = Math.round(message.backupSize / 1024 / 1024 * 100) / 100;
                        infoText += '<br>Size: ' + sizeMB + ' MB';
                    }
                    
                    backupInfo.innerHTML = infoText;
                    backupInfoSection.style.display = 'block';
                    hideProgress();
                    
                    // Suggest a name if target is empty
                    if (!targetDatabaseInput.value.trim()) {
                        handleSuggestNewName();
                    }
                    break;

                case 'databasesListed':
                    populateDatabases(message.databases);
                    break;

                case 'databaseExistsResult':
                    if (message.exists && message.databaseName === targetDatabaseInput.value.trim()) {
                        showDatabaseExistsWarning(true);
                    } else {
                        showDatabaseExistsWarning(false);
                    }
                    break;
                    
                case 'progress':
                    updateBackdropMessage(message.message, 'Processing...');
                    break;
                    
                case 'success':
                    setImporting(false);
                    updateBackdropMessage('Import completed successfully!', 'Closing import window...');
                    showMessage(message.message, 'success');
                    // Window will close automatically after 2 seconds
                    break;
                    
                case 'error':
                    setImporting(false);
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