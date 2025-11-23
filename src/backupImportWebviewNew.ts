import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import * as os from 'os';
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
            await childProcess.execSync('dotnet --version', { timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    private async autoInstallSqlPackage(): Promise<boolean> {
        try {
            const hasDotNet = await this.checkDotNetInstallation();
            if (!hasDotNet) {
                this.outputChannel.appendLine('.NET Core/5+ not found. Please install .NET to auto-install SqlPackage.');
                return false;
            }

            this.outputChannel.appendLine('Installing SqlPackage via .NET tool...');
            await childProcess.execSync('dotnet tool install -g Microsoft.SqlPackage', { timeout: 60000 });
            this.outputChannel.appendLine('SqlPackage installed successfully');
            return true;
        } catch (error: any) {
            this.outputChannel.appendLine(`Failed to auto-install SqlPackage: ${error.message}`);
            return false;
        }
    }

    async show(connectionId: string): Promise<void> {
        try {
            // Validate connection config exists
            const connectionConfig = this.connectionProvider.getConnectionConfig(connectionId);
            if (!connectionConfig) {
                throw new Error('Connection configuration not found');
            }

            if (this.panel) {
                this.panel.reveal();
                return;
            }

            this.panel = vscode.window.createWebviewPanel(
                'backupImport',
                'Import Database Backup',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [
                        vscode.Uri.file(path.join(this.context.extensionPath, 'webview'))
                    ]
                }
            );

            this.panel.iconPath = {
                light: vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'icons', 'import-light.svg')),
                dark: vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'icons', 'import-dark.svg'))
            };

            this.panel.webview.html = this.getWebviewContent();

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });

            // Handle messages from webview
            this.panel.webview.onDidReceiveMessage(async (message) => {
                await this.handleWebviewMessage(message, connectionId);
            });

        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to show backup import: ${error.message}`);
        }
    }

    private async handleWebviewMessage(message: any, connectionId: string): Promise<void> {
        try {
            switch (message.type) {
                case 'ready':
                    await this.sendInitialData(connectionId);
                    break;

                case 'analyzeBackup':
                    await this.handleAnalyzeBackup(message.backupPath, connectionId);
                    break;

                case 'selectBackupFile':
                    await this.handleSelectBackupFile(message.fileFormat);
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

                case 'autoGenerateFilePaths':
                    await this.handleAutoGenerateFilePaths(message.databaseName, connectionId);
                    break;

                case 'importBackup':
                    await this.handleImportBackup(message.options, connectionId);
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
    }

    private async handleAnalyzeBackup(backupPath: string, connectionId: string): Promise<void> {
        try {
            const format = path.extname(backupPath).toLowerCase();
            
            if (format === '.bak') {
                await this.getBackupInfo(connectionId, backupPath);
            } else if (format === '.bacpac') {
                // For BACPAC files, we can't easily analyze without importing
                // Just provide basic file info
                const stats = fs.statSync(backupPath);
                const filename = path.basename(backupPath, '.bacpac');
                
                await this.panel?.webview.postMessage({
                    type: 'backupInfo',
                    originalDatabaseName: filename,
                    backupDate: stats.mtime,
                    backupSize: stats.size
                });
            }
        } catch (error: any) {
            await this.panel?.webview.postMessage({
                type: 'error',
                message: `Failed to analyze backup: ${error.message}`
            });
        }
    }

    private async handleSelectBackupFile(fileFormat?: string): Promise<void> {
        const filters: { [name: string]: string[] } = {
            'All Backup Files': ['bak', 'bacpac']
        };

        if (fileFormat === 'bak') {
            filters['BAK Files'] = ['bak'];
        } else if (fileFormat === 'bacpac') {
            filters['BACPAC Files'] = ['bacpac'];
        } else {
            filters['BAK Files'] = ['bak'];
            filters['BACPAC Files'] = ['bacpac'];
        }

        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Select Backup File',
            filters: filters
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        if (fileUri && fileUri[0]) {
            await this.panel?.webview.postMessage({
                type: 'backupFileSelected',
                path: fileUri[0].fsPath
            });
        }
    }

    private async handleListDatabases(connectionId: string): Promise<void> {
        try {
            const pool = await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, 'master');
            const result = await pool.request().query(`
                SELECT name 
                FROM sys.databases 
                WHERE name NOT IN ('master', 'model', 'msdb', 'tempdb')
                ORDER BY name
            `);
            
            const databases = result.recordset.map((row: any) => row.name);
            
            await this.panel?.webview.postMessage({
                type: 'databasesListed',
                databases: databases
            });
        } catch (error: any) {
            this.outputChannel.appendLine(`Failed to list databases: ${error.message}`);
            await this.panel?.webview.postMessage({
                type: 'databasesListed',
                databases: []
            });
        }
    }

    private async handleCheckDatabaseExists(databaseName: string, connectionId: string): Promise<void> {
        try {
            const pool = await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, 'master');
            const result = await pool.request().query(`
                SELECT COUNT(*) as count 
                FROM sys.databases 
                WHERE name = '${databaseName.replace(/'/g, "''")}'
            `);
            
            const exists = result.recordset[0].count > 0;
            
            await this.panel?.webview.postMessage({
                type: 'databaseExistsResult',
                exists: exists,
                databaseName: databaseName
            });
        } catch (error: any) {
            // If we can't check, assume it doesn't exist
            await this.panel?.webview.postMessage({
                type: 'databaseExistsResult',
                exists: false,
                databaseName: databaseName
            });
        }
    }

    private async handleGetDefaultDataPath(connectionId: string): Promise<void> {
        try {
            this.outputChannel.appendLine(`[BackupImportWebview] Getting default data path for UI...`);
            
            // Use our enhanced SQL Server data directory detection
            const sqlServerDataDir = await this.getSqlServerDataDirectory(connectionId);
            this.outputChannel.appendLine(`[BackupImportWebview] UI will use data directory: ${sqlServerDataDir}`);
            
            // Try to get specific default paths from SQL Server, but use our detected directory as fallback
            let dataPath = sqlServerDataDir;
            let logPath = sqlServerDataDir;
            
            try {
                const pool = await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, 'master');
                
                // Get default data and log file locations
                const result = await pool.request().query(`
                    DECLARE @DefaultData NVARCHAR(512), @DefaultLog NVARCHAR(512)
                    
                    EXEC master.dbo.xp_instance_regread 
                        N'HKEY_LOCAL_MACHINE', 
                        N'Software\\Microsoft\\MSSQLServer\\MSSQLServer', 
                        N'DefaultData', 
                        @DefaultData OUTPUT
                    
                    EXEC master.dbo.xp_instance_regread 
                        N'HKEY_LOCAL_MACHINE', 
                        N'Software\\Microsoft\\MSSQLServer\\MSSQLServer', 
                        N'DefaultLog', 
                        @DefaultLog OUTPUT
                    
                    SELECT 
                        ISNULL(@DefaultData, SUBSTRING(physical_name, 1, LEN(physical_name) - LEN(REVERSE(SUBSTRING(REVERSE(physical_name), 1, CHARINDEX('\\', REVERSE(physical_name)) - 1))))) AS DefaultDataPath,
                        ISNULL(@DefaultLog, SUBSTRING(physical_name, 1, LEN(physical_name) - LEN(REVERSE(SUBSTRING(REVERSE(physical_name), 1, CHARINDEX('\\', REVERSE(physical_name)) - 1))))) AS DefaultLogPath
                    FROM sys.master_files 
                    WHERE database_id = 1 AND type = 0
                `);
                
                if (result.recordset[0]?.DefaultDataPath) {
                    dataPath = result.recordset[0].DefaultDataPath;
                    this.outputChannel.appendLine(`[BackupImportWebview] Registry data path: ${dataPath}`);
                }
                
                if (result.recordset[0]?.DefaultLogPath) {
                    logPath = result.recordset[0].DefaultLogPath;
                    this.outputChannel.appendLine(`[BackupImportWebview] Registry log path: ${logPath}`);
                }
            } catch (registryError: any) {
                this.outputChannel.appendLine(`[BackupImportWebview] Registry query failed, using detected directory: ${registryError.message}`);
            }
            
            await this.panel?.webview.postMessage({
                type: 'defaultDataPath',
                dataPath: dataPath,
                logPath: logPath
            });
        } catch (error: any) {
            // Fallback to common default paths
            await this.panel?.webview.postMessage({
                type: 'defaultDataPath',
                dataPath: 'C:\\Program Files\\Microsoft SQL Server\\MSSQL15.MSSQLLOCALDB\\MSSQL\\DATA\\',
                logPath: 'C:\\Program Files\\Microsoft SQL Server\\MSSQL15.MSSQLLOCALDB\\MSSQL\\DATA\\'
            });
        }
    }

    private async handleAutoGenerateFilePaths(databaseName: string, connectionId: string): Promise<void> {
        try {
            const pool = await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, 'master');
            
            // Get default data and log file locations
            const result = await pool.request().query(`
                DECLARE @DefaultData NVARCHAR(512), @DefaultLog NVARCHAR(512)
                
                EXEC master.dbo.xp_instance_regread 
                    N'HKEY_LOCAL_MACHINE', 
                    N'Software\\Microsoft\\MSSQLServer\\MSSQLServer', 
                    N'DefaultData', 
                    @DefaultData OUTPUT
                
                EXEC master.dbo.xp_instance_regread 
                    N'HKEY_LOCAL_MACHINE', 
                    N'Software\\Microsoft\\MSSQLServer\\MSSQLServer', 
                    N'DefaultLog', 
                    @DefaultLog OUTPUT
                
                SELECT 
                    ISNULL(@DefaultData, SUBSTRING(physical_name, 1, LEN(physical_name) - LEN(REVERSE(SUBSTRING(REVERSE(physical_name), 1, CHARINDEX('\\', REVERSE(physical_name)) - 1))))) AS DefaultDataPath,
                    ISNULL(@DefaultLog, SUBSTRING(physical_name, 1, LEN(physical_name) - LEN(REVERSE(SUBSTRING(REVERSE(physical_name), 1, CHARINDEX('\\', REVERSE(physical_name)) - 1))))) AS DefaultLogPath
                FROM sys.master_files 
                WHERE database_id = 1 AND type = 0
            `);
            
            let dataPath = result.recordset[0]?.DefaultDataPath || 'C:\\Program Files\\Microsoft SQL Server\\MSSQL15.MSSQLLOCALDB\\MSSQL\\DATA\\';
            let logPath = result.recordset[0]?.DefaultLogPath || dataPath;
            
            // Ensure paths end with backslash
            if (!dataPath.endsWith('\\')) {
                dataPath += '\\';
            }
            if (!logPath.endsWith('\\')) {
                logPath += '\\';
            }
            
            const dataFile = dataPath + databaseName + '.mdf';
            const logFile = logPath + databaseName + '_log.ldf';
            
            await this.panel?.webview.postMessage({
                type: 'filePathsGenerated',
                dataPath: dataFile,
                logPath: logFile
            });
        } catch (error: any) {
            // Fallback to common default paths
            const fallbackDataPath = 'C:\\Program Files\\Microsoft SQL Server\\MSSQL15.MSSQLLOCALDB\\MSSQL\\DATA\\';
            const dataFile = fallbackDataPath + databaseName + '.mdf';
            const logFile = fallbackDataPath + databaseName + '_log.ldf';
            
            await this.panel?.webview.postMessage({
                type: 'filePathsGenerated',
                dataPath: dataFile,
                logPath: logFile
            });
        }
    }

    private async sendInitialData(connectionId: string): Promise<void> {
        try {
            const connectionConfig = this.connectionProvider.getConnectionConfig(connectionId);
            const connectionName = connectionConfig?.name || 'Unknown Connection';
            const serverName = connectionConfig?.server || 'Unknown Server';
            
            await this.panel?.webview.postMessage({
                type: 'initialData',
                data: {
                    connectionName,
                    serverName
                }
            });
        } catch (error: any) {
            this.outputChannel.appendLine(`Failed to send initial data: ${error.message}`);
        }
    }

    private async handleImportBackup(options: any, connectionId: string): Promise<void> {
        try {
            await this.panel?.webview.postMessage({
                type: 'progress',
                message: 'Starting backup import...'
            });

            const fileFormat = path.extname(options.backupPath).toLowerCase();
            
            if (fileFormat === '.bak') {
                await this.executeRestore(connectionId, options);
            } else if (fileFormat === '.bacpac') {
                await this.executeBacpacImport(connectionId, options);
            } else {
                throw new Error(`Unsupported file format: ${fileFormat}`);
            }

            await this.panel?.webview.postMessage({
                type: 'success',
                message: `Database import completed successfully!`
            });

            // Notify parent that database was imported
            if (this.onDatabaseImported) {
                this.onDatabaseImported();
            }

            // Auto-close after success
            setTimeout(() => {
                this.panel?.dispose();
            }, 2000);

        } catch (error: any) {
            this.outputChannel.appendLine(`Import failed: ${error.message}`);
            await this.panel?.webview.postMessage({
                type: 'error',
                message: `Import failed: ${error.message}`
            });
        }
    }

    private async executeBacpacImport(connectionId: string, options: any): Promise<void> {
        try {
            const connectionConfig = this.connectionProvider.getConnectionConfig(connectionId);
            if (!connectionConfig) {
                throw new Error('Connection configuration not found');
            }

            await this.panel?.webview.postMessage({
                type: 'progress',
                message: 'Finding SqlPackage.exe...'
            });

            // Find SqlPackage executable
            let sqlPackagePath = await this.findSqlPackage();
            
            // Check if SqlPackage is available
            try {
                childProcess.execSync(`"${sqlPackagePath}" /?`, { timeout: 5000 });
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
            }

            await this.panel?.webview.postMessage({
                type: 'progress',
                message: 'Importing BACPAC file...'
            });

            // For BACPAC import, we need to create/replace the target database
            const targetDbName = options.targetDatabase.trim();

            // Build SqlPackage.exe command for BACPAC import
            const args = [
                '/Action:Import',
                `/SourceFile:${options.backupPath}`,
                `/TargetDatabaseName:${targetDbName}`,
                `/TargetServerName:${connectionConfig.server}`
            ];

            // Add authentication
            if (connectionConfig.authType === 'windows') {
                // Windows authentication is used by default when no credentials are specified
            } else if (connectionConfig.authType === 'sql') {
                args.push(`/TargetUser:${connectionConfig.username}`);
                if (connectionConfig.password) {
                    args.push(`/TargetPassword:${connectionConfig.password}`);
                }
            }

            // Add port if specified
            if (connectionConfig.port && connectionConfig.port !== 1433) {
                // Update the server name to include port
                const serverIndex = args.findIndex(arg => arg.startsWith('/TargetServerName:'));
                if (serverIndex !== -1) {
                    args[serverIndex] = `/TargetServerName:${connectionConfig.server},${connectionConfig.port}`;
                }
            }

            // Add SSL/TLS parameters for SQL Server Express compatibility
            args.push('/TargetEncryptConnection:False');
            args.push('/TargetTrustServerCertificate:True');

            // Add timeout
            if (options.timeout) {
                args.push(`/TargetTimeout:${Math.floor(options.timeout / 1000)}`);
            } else {
                // Default timeout for import operations (30 minutes)
                args.push('/TargetTimeout:1800');
            }

            this.outputChannel.appendLine(`[BackupImportWebview] Executing SqlPackage at: ${sqlPackagePath}`);
            this.outputChannel.appendLine(`[BackupImportWebview] Args: ${args.filter(arg => !arg.includes('Password')).join(' ')}`);

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
                    
                    // Send progress updates
                    if (text.includes('Importing') || text.includes('Creating') || text.includes('Updating')) {
                        this.panel?.webview.postMessage({
                            type: 'progress',
                            message: text.trim()
                        });
                    }
                });

                sqlPackage.stderr?.on('data', (data) => {
                    const text = data.toString();
                    errorOutput += text;
                    this.outputChannel.append(`ERROR: ${text}`);
                });

                sqlPackage.on('close', (code) => {
                    if (code === 0) {
                        this.outputChannel.appendLine('BACPAC import completed successfully');
                        resolve();
                    } else {
                        const errorMessage = errorOutput || output || `SqlPackage exited with code ${code}`;
                        this.outputChannel.appendLine(`BACPAC import failed: ${errorMessage}`);
                        reject(new Error(errorMessage));
                    }
                });

                sqlPackage.on('error', (error) => {
                    reject(new Error(`Failed to start SqlPackage: ${error.message}`));
                });
            });
        } catch (error: any) {
            throw new Error(`BACPAC import failed: ${error.message}`);
        }
    }

    private async getSqlServerDataDirectory(connectionId: string): Promise<string> {
        this.outputChannel.appendLine(`[BackupImportWebview] ========== GETTING SQL SERVER DATA DIRECTORY ==========`);
        this.outputChannel.appendLine(`[BackupImportWebview] Connection ID: ${connectionId}`);
        
        try {
            const pool = await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, 'master');
            this.outputChannel.appendLine(`[BackupImportWebview] Connected to SQL Server successfully`);
            
            // First, let's see what server we're actually connected to
            const serverInfoResult = await pool.request().query(`
                SELECT 
                    SERVERPROPERTY('ServerName') as ServerName,
                    SERVERPROPERTY('InstanceName') as InstanceName,
                    SERVERPROPERTY('Edition') as Edition,
                    SERVERPROPERTY('ProductVersion') as ProductVersion
            `);
            
            const serverInfo = serverInfoResult.recordset[0];
            this.outputChannel.appendLine(`[BackupImportWebview] Server: ${serverInfo.ServerName}, Instance: ${serverInfo.InstanceName}, Edition: ${serverInfo.Edition}`);
            
            // Try multiple queries to get the data directory
            const queries = [
                "SELECT SERVERPROPERTY('InstanceDefaultDataPath') as DataPath",
                "SELECT SUBSTRING(physical_name, 1, CHARINDEX(N'master.mdf', LOWER(physical_name)) - 1) as DataPath FROM master.sys.master_files WHERE database_id = 1 AND file_id = 1"
            ];
            
            for (let i = 0; i < queries.length; i++) {
                const query = queries[i];
                try {
                    this.outputChannel.appendLine(`[BackupImportWebview] Trying query ${i + 1}: ${query}`);
                    const result = await pool.request().query(query);
                    let dataPath = result.recordset[0]?.DataPath;
                    
                    this.outputChannel.appendLine(`[BackupImportWebview] Query ${i + 1} result: ${dataPath}`);
                    
                    if (dataPath && dataPath.trim()) {
                        // Remove trailing backslash if present
                        dataPath = dataPath.replace(/\\$/, '');
                        this.outputChannel.appendLine(`[BackupImportWebview] Cleaned path: ${dataPath}`);
                        
                        // Verify the path exists
                        if (fs.existsSync(dataPath)) {
                            this.outputChannel.appendLine(`[BackupImportWebview] ✓ PATH VERIFIED AND FOUND: ${dataPath}`);
                            return dataPath;
                        } else {
                            this.outputChannel.appendLine(`[BackupImportWebview] ✗ Path does not exist: ${dataPath}`);
                        }
                    } else {
                        this.outputChannel.appendLine(`[BackupImportWebview] Query ${i + 1} returned null or empty`);
                    }
                } catch (queryError: any) {
                    this.outputChannel.appendLine(`[BackupImportWebview] Query ${i + 1} failed: ${queryError.message}`);
                }
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`[BackupImportWebview] Connection or query error: ${error.message}`);
        }
        
        this.outputChannel.appendLine(`[BackupImportWebview] ========== USING FALLBACK PATHS ==========`);
        
        // Fallback to common SQL Server Express paths
        const commonPaths = [
            'C:\\Program Files\\Microsoft SQL Server\\MSSQL15.SQLEXPRESS\\MSSQL\\DATA',
            'C:\\Program Files\\Microsoft SQL Server\\MSSQL14.SQLEXPRESS\\MSSQL\\DATA', 
            'C:\\Program Files\\Microsoft SQL Server\\MSSQL13.SQLEXPRESS\\MSSQL\\DATA',
            'C:\\Program Files\\Microsoft SQL Server\\MSSQL12.SQLEXPRESS\\MSSQL\\DATA',
            'C:\\Program Files (x86)\\Microsoft SQL Server\\MSSQL15.SQLEXPRESS\\MSSQL\\DATA',
            'C:\\Program Files (x86)\\Microsoft SQL Server\\MSSQL14.SQLEXPRESS\\MSSQL\\DATA'
        ];
        
        for (let i = 0; i < commonPaths.length; i++) {
            const testPath = commonPaths[i];
            this.outputChannel.appendLine(`[BackupImportWebview] [${i + 1}/${commonPaths.length}] Checking: ${testPath}`);
            try {
                if (fs.existsSync(testPath)) {
                    this.outputChannel.appendLine(`[BackupImportWebview] ✓ FOUND FALLBACK PATH: ${testPath}`);
                    // Also verify we can create a test file in this directory
                    const testFile = path.join(testPath, 'test_write.tmp');
                    try {
                        fs.writeFileSync(testFile, 'test');
                        fs.unlinkSync(testFile);
                        this.outputChannel.appendLine(`[BackupImportWebview] ✓ Directory is writable`);
                        return testPath;
                    } catch (writeError: any) {
                        this.outputChannel.appendLine(`[BackupImportWebview] ✗ Directory exists but not writable: ${writeError.message}`);
                    }
                } else {
                    this.outputChannel.appendLine(`[BackupImportWebview] ✗ Does not exist`);
                }
            } catch (checkError: any) {
                this.outputChannel.appendLine(`[BackupImportWebview] ✗ Error checking path: ${checkError.message}`);
            }
        }
        
        // Use C:\Temp directory that SQL Server Express can definitely access
        const tempPath = 'C:\\Temp\\sql-restore-files';
        this.outputChannel.appendLine(`[BackupImportWebview] ========== USING SQL SERVER ACCESSIBLE PATH ==========`);
        this.outputChannel.appendLine(`[BackupImportWebview] SQL Server accessible path: ${tempPath}`);
        
        if (!fs.existsSync(tempPath)) {
            fs.mkdirSync(tempPath, { recursive: true });
            this.outputChannel.appendLine(`[BackupImportWebview] Created SQL Server accessible directory`);
        }
        
        // Set permissions for SQL Server access
        try {
            const { execSync } = require('child_process');
            execSync(`icacls "${tempPath}" /grant Everyone:F /T`, { stdio: 'pipe' });
            this.outputChannel.appendLine(`[BackupImportWebview] ✓ Set full permissions for SQL Server access`);
        } catch (permError: any) {
            this.outputChannel.appendLine(`[BackupImportWebview] ⚠ Could not set permissions: ${permError.message}`);
        }
        
        // Verify SQL Server can access this location by testing write permissions
        try {
            const testFile = path.join(tempPath, `test_${Date.now()}.tmp`);
            fs.writeFileSync(testFile, 'SQL Server access test');
            fs.unlinkSync(testFile);
            this.outputChannel.appendLine(`[BackupImportWebview] ✓ Verified write access to directory`);
        } catch (writeTest: any) {
            this.outputChannel.appendLine(`[BackupImportWebview] ⚠ Could not verify write access: ${writeTest.message}`);
        }
        
        this.outputChannel.appendLine(`[BackupImportWebview] ✓ FINAL SQL SERVER ACCESSIBLE PATH: ${tempPath}`);
        return tempPath;
    }

    private async validateAndPrepareBackupFile(backupPath: string): Promise<{ actualPath: string; needsCleanup: boolean }> {
        // Check if backup file is in a location that SQL Server can access
        const isSqlServerAccessible = backupPath.includes('Microsoft SQL Server') || 
                                      backupPath.startsWith('C:\\Program Files\\') ||
                                      backupPath.startsWith('C:\\Backup\\') ||
                                      path.dirname(backupPath).toLowerCase().includes('backup');
        
        if (isSqlServerAccessible) {
            this.outputChannel.appendLine(`[BackupImportWebview] Using backup file directly: ${backupPath}`);
            return { actualPath: backupPath, needsCleanup: false };
        }
        
        // For user locations, copy to temp directory that SQL Server can access
        const tempDir = path.join(os.tmpdir(), 'sql-backup-restore');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const filename = path.basename(backupPath);
        const tempPath = path.join(tempDir, `restore_${Date.now()}_${filename}`);
        
        try {
            await this.panel?.webview.postMessage({
                type: 'progress',
                message: 'Copying backup file to accessible location...'
            });
            
            fs.copyFileSync(backupPath, tempPath);
            this.outputChannel.appendLine(`[BackupImportWebview] Backup file copied to temp location: ${tempPath}`);
            return { actualPath: tempPath, needsCleanup: true };
        } catch (error: any) {
            throw new Error(`Failed to copy backup file to accessible location: ${error.message}. ` +
                          `SQL Server may not have access to the backup file location. ` +
                          `Try placing the backup file in C:\\Backup\\ or the SQL Server backup directory.`);
        }
    }

    private async executeRestore(connectionId: string, options: any): Promise<void> {
        let tempBackupPath: string | null = null;
        
        try {
            const connectionConfig = this.connectionProvider.getConnectionConfig(connectionId);
            if (!connectionConfig) {
                throw new Error('Connection configuration not found');
            }

            await this.panel?.webview.postMessage({
                type: 'progress',
                message: 'Preparing database restore...'
            });

            // Validate and prepare backup file for SQL Server access
            const backupResult = await this.validateAndPrepareBackupFile(options.backupPath);
            const actualBackupPath = backupResult.actualPath;
            if (backupResult.needsCleanup) {
                tempBackupPath = actualBackupPath;
            }

            // Build RESTORE DATABASE command
            let restoreSql = `RESTORE DATABASE [${options.targetDatabase}] FROM DISK = N'${actualBackupPath}'`;
            
            const withOptions = [];
            
            // Handle file relocation - always relocate for proper SQL Server compatibility
            const pool = await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, 'master');
            
            // Get logical file names from backup
            const fileListSql = `RESTORE FILELISTONLY FROM DISK = N'${actualBackupPath}'`;
            const fileListResult = await pool.request().query(fileListSql);
            
            const dataFile = fileListResult.recordset.find((f: any) => f.Type === 'D');
            const logFile = fileListResult.recordset.find((f: any) => f.Type === 'L');
            
            // Always relocate files to ensure SQL Server compatibility
            this.outputChannel.appendLine(`[BackupImportWebview] Files found in backup - Data: ${dataFile ? 'Yes' : 'No'}, Log: ${logFile ? 'Yes' : 'No'}`);
            
            if (dataFile || logFile) {
                // Use C:\Temp directory that SQL Server Express can definitely access
                this.outputChannel.appendLine(`[BackupImportWebview] Setting up SQL Server accessible database file locations...`);
                
                const tempDbDir = 'C:\\Temp\\sql-restore-files';
                if (!fs.existsSync(tempDbDir)) {
                    fs.mkdirSync(tempDbDir, { recursive: true });
                    this.outputChannel.appendLine(`[BackupImportWebview] Created directory: ${tempDbDir}`);
                }
                
                // Set permissions for SQL Server access (everyone full control for this temp folder)
                try {
                    const { execSync } = require('child_process');
                    execSync(`icacls "${tempDbDir}" /grant Everyone:F /T`, { stdio: 'pipe' });
                    this.outputChannel.appendLine(`[BackupImportWebview] Set permissions for SQL Server access`);
                } catch (permError: any) {
                    this.outputChannel.appendLine(`[BackupImportWebview] Warning: Could not set permissions: ${permError.message}`);
                }
                
                this.outputChannel.appendLine(`[BackupImportWebview] Using SQL Server accessible directory: ${tempDbDir}`);
                const timestamp = new Date().toISOString().replace(/[:.]/g, '').substring(0, 15);
                
                if (dataFile) {
                    // Always use accessible temp directory, ignore UI paths that may point to protected locations
                    const dataPath = path.join(tempDbDir, `${options.targetDatabase}_${timestamp}.mdf`);
                    withOptions.push(`MOVE N'${dataFile.LogicalName}' TO N'${dataPath}'`);
                    this.outputChannel.appendLine(`[BackupImportWebview] Relocating data file '${dataFile.LogicalName}' to accessible location: ${dataPath}`);
                    
                    if (options.relocateData) {
                        this.outputChannel.appendLine(`[BackupImportWebview] Note: Ignoring UI path '${options.relocateData}' for accessibility`);
                    }
                }
                
                if (logFile) {
                    // Always use accessible temp directory, ignore UI paths that may point to protected locations
                    const logPath = path.join(tempDbDir, `${options.targetDatabase}_${timestamp}_log.ldf`);
                    withOptions.push(`MOVE N'${logFile.LogicalName}' TO N'${logPath}'`);
                    this.outputChannel.appendLine(`[BackupImportWebview] Relocating log file '${logFile.LogicalName}' to accessible location: ${logPath}`);
                    
                    if (options.relocateLog) {
                        this.outputChannel.appendLine(`[BackupImportWebview] Note: Ignoring UI path '${options.relocateLog}' for accessibility`);
                    }
                }
            } else {
                this.outputChannel.appendLine(`[BackupImportWebview] Warning: No data or log files found in backup!`);
            }
            
            // Add other restore options
            if (options.replace) {
                withOptions.push('REPLACE');
            }
            if (options.checksum) {
                withOptions.push('CHECKSUM');
            }
            if (options.continueAfterError) {
                withOptions.push('CONTINUE_AFTER_ERROR');
            }
            if (options.noRecovery) {
                withOptions.push('NORECOVERY');
            } else {
                withOptions.push('RECOVERY');
            }
            
            if (withOptions.length > 0) {
                restoreSql += ` WITH ${withOptions.join(', ')}`;
            }

            await this.panel?.webview.postMessage({
                type: 'progress',
                message: 'Executing database restore...'
            });

            // Execute restore using SQLCMD for better handling of long operations
            await this.executeRestoreWithSqlCmd(connectionConfig, restoreSql);

        } catch (error: any) {
            // Clean up temp backup file if created
            if (tempBackupPath && fs.existsSync(tempBackupPath)) {
                try {
                    fs.unlinkSync(tempBackupPath);
                    this.outputChannel.appendLine(`[BackupImportWebview] Cleaned up temp backup file: ${tempBackupPath}`);
                } catch (cleanupError) {
                    this.outputChannel.appendLine(`[BackupImportWebview] Warning: Could not clean up temp file: ${cleanupError}`);
                }
            }
            throw new Error(`BAK restore failed: ${error.message}`);
        } finally {
            // Clean up temp backup file if created and restore was successful
            if (tempBackupPath && fs.existsSync(tempBackupPath)) {
                try {
                    fs.unlinkSync(tempBackupPath);
                    this.outputChannel.appendLine(`[BackupImportWebview] Cleaned up temp backup file: ${tempBackupPath}`);
                } catch (cleanupError) {
                    this.outputChannel.appendLine(`[BackupImportWebview] Warning: Could not clean up temp file: ${cleanupError}`);
                }
            }
        }
    }

    private async executeRestoreWithSqlCmd(connectionConfig: any, restoreSql: string): Promise<void> {
        return new Promise((resolve, reject) => {
            // Build connection parameters
            const connectionParams = [
                '-S', connectionConfig.server + (connectionConfig.port ? `,${connectionConfig.port}` : ''),
                '-d', 'master', // Connect to master for restore operations
                '-Q', restoreSql,
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
                
                // Send progress updates for restore progress
                if (text.includes('percent processed') || text.includes('Processed')) {
                    this.panel?.webview.postMessage({
                        type: 'progress',
                        message: text.trim()
                    });
                }
            });

            sqlCmd.stderr?.on('data', (data) => {
                const text = data.toString();
                errorOutput += text;
                this.outputChannel.append(`ERROR: ${text}`);
            });

            sqlCmd.on('close', (code) => {
                if (code === 0) {
                    this.outputChannel.appendLine('Database restore completed successfully');
                    resolve();
                } else {
                    const errorMessage = errorOutput || output || `sqlcmd exited with code ${code}`;
                    this.outputChannel.appendLine(`Database restore failed: ${errorMessage}`);
                    reject(new Error(errorMessage));
                }
            });

            sqlCmd.on('error', (error) => {
                reject(new Error(`Failed to start sqlcmd: ${error.message}. Please ensure SQL Server command line tools are installed.`));
            });
        });
    }

    private async getBackupInfo(connectionId: string, backupPath: string): Promise<void> {
        try {
            const pool = await this.connectionProvider.ensureConnectionAndGetDbPool(connectionId, 'master');
            
            // Get backup header information
            const headerSql = `RESTORE HEADERONLY FROM DISK = N'${backupPath}'`;
            const headerResult = await pool.request().query(headerSql);
            
            if (headerResult.recordset.length > 0) {
                const backupInfo = headerResult.recordset[0];
                
                await this.panel?.webview.postMessage({
                    type: 'backupInfo',
                    originalDatabaseName: backupInfo.DatabaseName,
                    backupDate: backupInfo.BackupFinishDate,
                    backupSize: backupInfo.BackupSize || 0
                });
            } else {
                throw new Error('Unable to read backup file header');
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`Failed to analyze backup: ${error.message}`);
            throw error;
        }
    }

    private getWebviewContent(): string {
        // Get URIs for external resources
        const webviewPath = vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'backupImport'));
        const webviewUri = this.panel!.webview.asWebviewUri(webviewPath);
        
        const htmlUri = vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'backupImport', 'backupImport.html'));
        const htmlContent = fs.readFileSync(htmlUri.fsPath, 'utf8');
        
        // Replace placeholder URIs in the HTML content
        const cssUri = this.panel!.webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'backupImport', 'backupImport.css')));
        const jsUri = this.panel!.webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'backupImport', 'backupImport.js')));
        
        return htmlContent
            .replace('{{cssUri}}', cssUri.toString())
            .replace('{{jsUri}}', jsUri.toString());
    }
}