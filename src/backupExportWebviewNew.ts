import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as childProcess from 'child_process';
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
            const result = childProcess.execSync(isWindows ? 'where sqlpackage' : 'which sqlpackage', 
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
        
        throw new Error('SqlPackage.exe not found. Please install SQL Server Data-Tier Application Framework (DacFx) or add SqlPackage to PATH.');
    }

    private async checkDotNetInstallation(): Promise<boolean> {
        try {
            childProcess.execSync('dotnet --version', { encoding: 'utf8', timeout: 5000 });
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
            
            const result = childProcess.execSync('dotnet tool install -g microsoft.sqlpackage --allow-roll-forward', 
                { encoding: 'utf8', timeout: 60000 });
            
            this.outputChannel.appendLine(`[BackupExportWebview] SqlPackage installation result: ${result}`);
            
            // Verify installation
            const sqlPackagePath = await this.findSqlPackage();
            try {
                childProcess.execSync(`"${sqlPackagePath}" /?`, { timeout: 5000 });
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
        try {
            // Check if connection supports backup export (exclude Azure)
            const connectionConfig = this.connectionProvider.getConnectionConfig(connectionId);
            if (!connectionConfig) {
                throw new Error('Connection configuration not found');
            }

            if (connectionConfig.authType === 'azure') {
                vscode.window.showWarningMessage(
                    'Backup export is not supported for Azure SQL Database connections. This feature is only available for on-premises SQL Server instances.'
                );
                return;
            }

            const connectionName = connectionConfig.name || 'Unknown Connection';
            const serverName = connectionConfig.server || 'Unknown Server';
            
            // Suggest backup path
            const suggestedPath = await this.getSuggestedBackupPath(database, connectionId);

            if (this.panel) {
                this.panel.reveal();
                return;
            }

            this.panel = vscode.window.createWebviewPanel(
                'backupExport',
                `Export ${database} Backup`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [
                        vscode.Uri.file(path.join(this.context.extensionPath, 'webview'))
                    ]
                }
            );

            this.panel.webview.html = this.getWebviewContent(connectionId, database);

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });

            // Handle messages from webview
            this.panel.webview.onDidReceiveMessage(async (message) => {
                try {
                    switch (message.type) {
                        case 'ready':
                            // Send initial data when webview is ready
                            await this.panel?.webview.postMessage({
                                type: 'initialData',
                                data: {
                                    connectionName,
                                    serverName,
                                    databaseName: database,
                                    suggestedPath
                                }
                            });
                            break;

                        case 'selectPath':
                            await this.handleSelectPath();
                            break;

                        case 'exportBackup':
                            await this.handleExportBackup(connectionId, database, message.options);
                            break;

                        case 'cancel':
                            this.panel?.dispose();
                            break;
                    }
                } catch (error: any) {
                    await this.panel?.webview.postMessage({
                        type: 'error',
                        message: error.message
                    });
                }
            });

        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to show backup export: ${error.message}`);
        }
    }

    private async getSuggestedBackupPath(database: string, connectionId?: string): Promise<string> {
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `${database}_${timestamp}.bak`;
        
        // Try to get SQL Server's default backup directory first
        let sqlServerBackupDir: string | null = null;
        if (connectionId) {
            sqlServerBackupDir = await this.getSqlServerDefaultBackupPath(connectionId);
        }
        
        // Try different locations in order of preference for SQL Server Express
        const candidatePaths = [
            // SQL Server default backup directory (most likely to work)
            ...(sqlServerBackupDir ? [path.join(sqlServerBackupDir, filename)] : []),
            // Common SQL Server backup locations
            'C:\\Program Files\\Microsoft SQL Server\\MSSQL15.SQLEXPRESS\\MSSQL\\Backup\\' + filename,
            'C:\\Program Files\\Microsoft SQL Server\\MSSQL14.SQLEXPRESS\\MSSQL\\Backup\\' + filename,
            'C:\\Program Files\\Microsoft SQL Server\\MSSQL13.SQLEXPRESS\\MSSQL\\Backup\\' + filename,
            // Temp directory (always writable, will copy from here after backup)
            path.join(os.tmpdir(), filename),
            // User's Documents folder
            path.join(os.homedir(), 'Documents', 'SQL Server Backups', filename),
            // User's home directory
            path.join(os.homedir(), filename)
        ];
        
        for (const candidatePath of candidatePaths) {
            try {
                const dir = path.dirname(candidatePath);
                
                // Skip if directory doesn't exist and we can't create it
                if (!fs.existsSync(dir)) {
                    try {
                        fs.mkdirSync(dir, { recursive: true });
                    } catch (mkdirError) {
                        this.outputChannel.appendLine(`[BackupExportWebview] Cannot create directory: ${dir} - ${mkdirError}`);
                        continue;
                    }
                }
                
                // For SQL Server backup directories, just check if they exist (SQL Server service should have access)
                if (candidatePath.includes('Microsoft SQL Server') && candidatePath.includes('Backup')) {
                    if (fs.existsSync(dir)) {
                        this.outputChannel.appendLine(`[BackupExportWebview] Using SQL Server backup directory: ${candidatePath}`);
                        return candidatePath;
                    }
                    continue;
                }
                
                // Test if we can write to this location by creating a test file
                const testFile = path.join(dir, '.write_test_' + Date.now());
                fs.writeFileSync(testFile, 'test');
                fs.unlinkSync(testFile);
                
                this.outputChannel.appendLine(`[BackupExportWebview] Using backup path: ${candidatePath}`);
                return candidatePath;
            } catch (error) {
                this.outputChannel.appendLine(`[BackupExportWebview] Path not accessible: ${candidatePath} - ${error}`);
                continue;
            }
        }
        
        // Fallback to temp directory (should always work)
        const fallbackPath = path.join(os.tmpdir(), filename);
        this.outputChannel.appendLine(`[BackupExportWebview] Using fallback path: ${fallbackPath}`);
        return fallbackPath;
    }

    private async getSqlServerDefaultBackupPath(connectionId: string): Promise<string | null> {
        try {
            // Get SQL Server default backup directory
            const pool = await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, 'master');
            const result = await pool.request().query(`
                DECLARE @BackupDirectory NVARCHAR(4000)
                EXEC master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE',N'Software\\Microsoft\\MSSQLServer\\MSSQLServer',N'BackupDirectory', @BackupDirectory OUTPUT
                SELECT @BackupDirectory AS BackupDirectory
            `);
            
            if (result.recordset.length > 0 && result.recordset[0].BackupDirectory) {
                this.outputChannel.appendLine(`[BackupExportWebview] Found SQL Server default backup path: ${result.recordset[0].BackupDirectory}`);
                return result.recordset[0].BackupDirectory;
            }
        } catch (error) {
            this.outputChannel.appendLine(`[BackupExportWebview] Could not get SQL Server default backup path: ${error}`);
        }
        return null;
    }

    private async validateAndPrepareBackupPath(backupPath: string): Promise<string> {
        const backupDir = path.dirname(backupPath);
        const filename = path.basename(backupPath);
        
        // If user selected a location outside of SQL Server directories, 
        // we'll backup to temp and then copy to user location
        const isSqlServerPath = backupPath.includes('Microsoft SQL Server') && backupPath.includes('Backup');
        const tempPath = path.join(os.tmpdir(), filename);
        
        if (!isSqlServerPath) {
            try {
                // Ensure user directory exists
                if (!fs.existsSync(backupDir)) {
                    fs.mkdirSync(backupDir, { recursive: true });
                    this.outputChannel.appendLine(`[BackupExportWebview] Created directory: ${backupDir}`);
                }
                
                // Test write permissions by creating a temporary file
                const testFile = path.join(backupDir, '.backup_permission_test_' + Date.now());
                fs.writeFileSync(testFile, 'permission test');
                fs.unlinkSync(testFile);
                
                this.outputChannel.appendLine(`[BackupExportWebview] User path validated, will backup to temp and copy: ${backupPath}`);
                // Return temp path for SQL Server backup, we'll copy later
                return tempPath;
            } catch (error: any) {
                this.outputChannel.appendLine(`[BackupExportWebview] User path not writable, using temp: ${error.message}`);
                return tempPath;
            }
        }
        
        this.outputChannel.appendLine(`[BackupExportWebview] Using SQL Server backup path directly: ${backupPath}`);
        return backupPath;
    }

    private async copyBackupFileToUserLocation(tempPath: string, userPath: string): Promise<void> {
        try {
            if (fs.existsSync(tempPath) && tempPath !== userPath) {
                const userDir = path.dirname(userPath);
                if (!fs.existsSync(userDir)) {
                    fs.mkdirSync(userDir, { recursive: true });
                }
                
                // Copy file from temp to user location
                fs.copyFileSync(tempPath, userPath);
                
                // Remove temp file
                fs.unlinkSync(tempPath);
                
                this.outputChannel.appendLine(`[BackupExportWebview] Backup file copied to: ${userPath}`);
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`[BackupExportWebview] Warning: Could not copy backup to user location: ${error.message}`);
            throw new Error(`Backup completed but could not copy to your chosen location. ` +
                `Backup file is available at: ${tempPath}. You can manually copy it to: ${userPath}`);
        }
    }

    private async handleSelectPath(): Promise<void> {
        const options: vscode.SaveDialogOptions = {
            defaultUri: vscode.Uri.file('backup.bak'),
            filters: {
                'Backup Files': ['bak'],
                'BACPAC Files': ['bacpac'],
                'All Files': ['*']
            },
            saveLabel: 'Save Backup As'
        };

        const fileUri = await vscode.window.showSaveDialog(options);
        if (fileUri) {
            await this.panel?.webview.postMessage({
                type: 'pathSelected',
                path: fileUri.fsPath
            });
        }
    }

    private async handleExportBackup(connectionId: string, database: string, options: any): Promise<void> {
        try {
            // Show backdrop loader
            await this.panel?.webview.postMessage({
                type: 'showLoader',
                message: 'Starting backup export...',
                detail: 'Preparing backup operation...'
            });

            if (options.fileFormat === 'bak') {
                await this.exportBakBackup(connectionId, database, options);
            } else {
                await this.exportBacpacBackup(connectionId, database, options);
            }

        } catch (error: any) {
            this.outputChannel.appendLine(`Backup export error: ${error.message}`);
            
            await this.panel?.webview.postMessage({
                type: 'hideLoader'
            });
            
            await this.panel?.webview.postMessage({
                type: 'error',
                message: `Export failed: ${error.message}`
            });
        }
    }

    private async exportBakBackup(connectionId: string, database: string, options: any): Promise<void> {
        try {
            const connectionConfig = this.connectionProvider.getConnectionConfig(connectionId);
            if (!connectionConfig) {
                throw new Error('Connection configuration not found');
            }

            await this.panel?.webview.postMessage({
                type: 'updateLoader',
                message: 'Creating BAK backup...',
                detail: 'Executing backup command...'
            });

            const originalBackupPath = options.backupPath;
            const actualBackupPath = await this.validateAndPrepareBackupPath(originalBackupPath);
            const needsCopy = actualBackupPath !== originalBackupPath;

            this.outputChannel.appendLine(`[BackupExportWebview] Starting backup export with options: ${JSON.stringify(options)}`);
            if (needsCopy) {
                this.outputChannel.appendLine(`[BackupExportWebview] Will copy from ${actualBackupPath} to ${originalBackupPath} after backup`);
            }

            // Use SQLCMD for BAK backup with improved error handling
            await this.executeBackupWithSqlCmd(connectionConfig, database, actualBackupPath, options);

            // Copy from temp to user location if needed
            if (needsCopy) {
                await this.panel?.webview.postMessage({
                    type: 'updateLoader',
                    message: 'Copying backup file to your chosen location...',
                    detail: 'Moving file to final destination...'
                });
                
                await this.copyBackupFileToUserLocation(actualBackupPath, originalBackupPath);
            }

            this.outputChannel.appendLine(`[BackupExportWebview] Backup completed successfully: ${originalBackupPath}`);
            
            // Hide loader and show success message
            await this.panel?.webview.postMessage({
                type: 'hideLoader'
            });
            
            await this.panel?.webview.postMessage({
                type: 'success',
                message: `Backup export completed successfully to: ${originalBackupPath}`
            });
            
            // Close webview after successful export
            setTimeout(() => {
                this.panel?.dispose();
            }, 2000);

        } catch (error: any) {
            this.outputChannel.appendLine(`[BackupExportWebview] Backup failed: ${error.message}`);
            throw new Error(`BAK export failed: ${error.message}`);
        }
    }

    private async executeBackupWithSqlCmd(connectionConfig: any, database: string, backupPath: string, options: any): Promise<void> {
        return new Promise((resolve, reject) => {
            // Build BACKUP DATABASE command with options
            let backupSql = `BACKUP DATABASE [${database}] TO DISK = N'${backupPath}'`;
            
            const withOptions = [];
            if (options.compression) {
                withOptions.push('COMPRESSION');
            }
            if (options.checksum) {
                withOptions.push('CHECKSUM');
            }
            if (options.copyOnly) {
                withOptions.push('COPY_ONLY');
            }
            
            if (withOptions.length > 0) {
                backupSql += ` WITH ${withOptions.join(', ')}`;
            }
            
            // Build connection parameters
            const connectionParams = [
                '-S', connectionConfig.server + (connectionConfig.port ? `,${connectionConfig.port}` : ''),
                '-d', 'master', // Connect to master for backup operations
                '-Q', backupSql,
                '-b' // Exit batch on error
            ];

            // Add authentication
            if (connectionConfig.authType === 'sql') {
                connectionParams.push('-U', connectionConfig.username);
                connectionParams.push('-P', connectionConfig.password);
            } else {
                connectionParams.push('-E'); // Windows Authentication
            }

            // Add trust server certificate for SQL Server Express
            if (connectionConfig.server.toLowerCase().includes('sqlexpress') || 
                connectionConfig.server.toLowerCase().includes('localdb')) {
                connectionParams.push('-C'); // Trust server certificate
            }

            this.outputChannel.appendLine(`Executing: sqlcmd ${connectionParams.filter(p => p !== connectionConfig.password).join(' ')}`);

            const sqlCmd = childProcess.spawn('sqlcmd', connectionParams, {
                stdio: 'pipe'
            });

            let output = '';
            let errorOutput = '';

            sqlCmd.stdout?.on('data', (data) => {
                const text = data.toString();
                output += text;
                this.outputChannel.append(text);
            });

            sqlCmd.stderr?.on('data', (data) => {
                const text = data.toString();
                errorOutput += text;
                this.outputChannel.append(`ERROR: ${text}`);
            });

            sqlCmd.on('close', (code) => {
                if (code === 0) {
                    this.outputChannel.appendLine('BAK backup completed successfully');
                    resolve();
                } else {
                    const errorMessage = errorOutput || output || `sqlcmd exited with code ${code}`;
                    this.outputChannel.appendLine(`BAK backup failed: ${errorMessage}`);
                    
                    if (errorMessage.toLowerCase().includes('access is denied') || 
                        errorMessage.toLowerCase().includes('permission denied')) {
                        reject(new Error(`Permission denied. The SQL Server service account may not have write access to the backup location: ${backupPath}\n\nTry using a different backup location or ensure the SQL Server service has write permissions.`));
                    } else {
                        reject(new Error(errorMessage));
                    }
                }
            });

            sqlCmd.on('error', (error) => {
                reject(new Error(`Failed to start sqlcmd: ${error.message}. Please ensure SQL Server command line tools are installed.`));
            });
        });
    }

    private async exportBacpacBackup(connectionId: string, database: string, options: any): Promise<void> {
        try {
            const connectionConfig = this.connectionProvider.getConnectionConfig(connectionId);
            if (!connectionConfig) {
                throw new Error('Connection configuration not found');
            }

            await this.panel?.webview.postMessage({
                type: 'updateLoader',
                message: 'Finding SqlPackage.exe...',
                detail: 'Locating BACPAC export tools...'
            });

            // Find SqlPackage executable
            let sqlPackagePath = await this.findSqlPackage();
            
            // Check if SqlPackage is available
            try {
                childProcess.execSync(`"${sqlPackagePath}" /?`, { timeout: 5000 });
            } catch (error) {
                // Check if .NET is installed
                const dotNetInstalled = await this.checkDotNetInstallation();
                if (!dotNetInstalled) {
                    throw new Error('SqlPackage requires .NET SDK. Please install .NET SDK from https://dotnet.microsoft.com/download, then restart VS Code.');
                }
                
                // Try to auto-install SqlPackage
                const installed = await this.autoInstallSqlPackage();
                if (!installed) {
                    throw new Error('Failed to automatically install SqlPackage. Please run manually: dotnet tool install -g microsoft.sqlpackage --allow-roll-forward');
                }
                
                // Update sqlPackagePath after installation
                sqlPackagePath = await this.findSqlPackage();
                
                // Verify again
                try {
                    childProcess.execSync(`"${sqlPackagePath}" /?`, { timeout: 5000 });
                } catch (verifyError) {
                    throw new Error('SqlPackage installation verification failed. Please ensure ~/.dotnet/tools is in your PATH and restart VS Code.');
                }
            }

            await this.panel?.webview.postMessage({
                type: 'updateLoader',
                message: 'Creating BACPAC export...',
                detail: 'Executing SqlPackage export operation...'
            });

            // Build SqlPackage.exe command for BACPAC export
            const args = [
                '/Action:Export',
                `/TargetFile:${options.backupPath}`,
                `/SourceDatabaseName:${database}`,
                `/SourceServerName:${connectionConfig.server}`
            ];

            // Add authentication
            if (connectionConfig.authType === 'windows') {
                // Windows authentication is used by default when no credentials are specified
            } else if (connectionConfig.authType === 'sql') {
                args.push(`/SourceUser:${connectionConfig.username}`);
                if (connectionConfig.password) {
                    args.push(`/SourcePassword:${connectionConfig.password}`);
                }
            }

            // Add port if specified
            if (connectionConfig.port && connectionConfig.port !== 1433) {
                // Update the server name to include port
                const serverIndex = args.findIndex(arg => arg.startsWith('/SourceServerName:'));
                if (serverIndex !== -1) {
                    args[serverIndex] = `/SourceServerName:${connectionConfig.server},${connectionConfig.port}`;
                }
            }

            // Add SSL/TLS parameters for SQL Server Express compatibility
            args.push('/SourceEncryptConnection:False');
            args.push('/SourceTrustServerCertificate:True');
            
            // Add timeout for SqlPackage operations (30 minutes default)
            args.push('/SourceTimeout:1800');

            this.outputChannel.appendLine(`Executing SqlPackage: ${sqlPackagePath} ${args.filter(arg => !arg.includes('Password')).join(' ')}`);

            await new Promise<void>((resolve, reject) => {
                const sqlPackage = childProcess.spawn(sqlPackagePath, args, {
                    stdio: 'pipe'
                });

                let output = '';
                let errorOutput = '';

                sqlPackage.stdout?.on('data', (data) => {
                    const text = data.toString();
                    output += text;
                    this.outputChannel.append(text);
                });

                sqlPackage.stderr?.on('data', (data) => {
                    const text = data.toString();
                    errorOutput += text;
                    this.outputChannel.append(`ERROR: ${text}`);
                });

                sqlPackage.on('close', (code) => {
                    if (code === 0) {
                        this.outputChannel.appendLine('BACPAC export completed successfully');
                        resolve();
                    } else {
                        const errorMessage = errorOutput || output || `SqlPackage exited with code ${code}`;
                        this.outputChannel.appendLine(`BACPAC export failed: ${errorMessage}`);
                        reject(new Error(errorMessage));
                    }
                });

                sqlPackage.on('error', (error) => {
                    reject(new Error(`Failed to start SqlPackage: ${error.message}`));
                });
            });
            
            // Hide loader and show success message
            await this.panel?.webview.postMessage({
                type: 'hideLoader'
            });
            
            await this.panel?.webview.postMessage({
                type: 'success',
                message: `BACPAC export completed successfully to: ${options.backupPath}`
            });
            
            // Close webview after successful export
            setTimeout(() => {
                this.panel?.dispose();
            }, 2000);
            
        } catch (error: any) {
            throw new Error(`BACPAC export failed: ${error.message}`);
        }
    }

    private getWebviewContent(connectionId: string, database: string): string {
        // Get URIs for external resources
        const webviewPath = vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'backupExport'));
        const webviewUri = this.panel!.webview.asWebviewUri(webviewPath);
        
        const htmlUri = vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'backupExport', 'backupExport.html'));
        const htmlContent = fs.readFileSync(htmlUri.fsPath, 'utf8');
        
        // Replace placeholder URIs in the HTML content
        const cssUri = this.panel!.webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'backupExport', 'backupExport.css')));
        const jsUri = this.panel!.webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'backupExport', 'backupExport.js')));
        
        return htmlContent
            .replace('{{cssUri}}', cssUri.toString())
            .replace('{{jsUri}}', jsUri.toString());
    }
}