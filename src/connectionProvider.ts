import * as vscode from 'vscode';
import * as sql from 'mssql';

export interface ConnectionConfig {
    id: string;
    name: string;
    server: string;
    database: string;
    authType: 'sql' | 'windows' | 'azure';
    username?: string;
    password?: string;
    port?: number;
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    connectionString?: string;
    useConnectionString?: boolean;
}

export class ConnectionProvider {
    private currentConnection: sql.ConnectionPool | null = null;
    private currentConfig: ConnectionConfig | null = null;
    private onConnectionChanged: (() => void) | null = null;

    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel,
        private statusBarItem: vscode.StatusBarItem
    ) {}

    setConnectionChangeCallback(callback: () => void): void {
        this.outputChannel.appendLine('[ConnectionProvider] Setting connection change callback');
        this.onConnectionChanged = callback;
    }

    async connectWithWebview(): Promise<void> {
        const { ConnectionWebview } = await import('./connectionWebview');
        const connectionWebview = new ConnectionWebview(this.context, (config) => {
            this.handleWebviewConnection(config);
        });
        
        await connectionWebview.show();
    }

    private async handleWebviewConnection(config: ConnectionConfig): Promise<void> {
        try {
            await this.establishConnection(config);
            await this.saveConnection(config);
            if (this.onConnectionChanged) {
                this.outputChannel.appendLine('[ConnectionProvider] Triggering connection change callback from connect');
                this.onConnectionChanged();
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            this.outputChannel.appendLine(`Connection failed: ${errorMessage}`);
            vscode.window.showErrorMessage(`Failed to connect: ${errorMessage}`);
        }
    }

    async connect(): Promise<void> {
        await this.connectWithWebview();
    }

    async manageConnections(): Promise<void> {
        const savedConnections = this.getSavedConnections();
        
        if (savedConnections.length === 0) {
            const choice = await vscode.window.showInformationMessage(
                'No saved connections found. Would you like to create a new connection?',
                'Create New Connection'
            );
            if (choice) {
                await this.connectWithWebview();
            }
            return;
        }

        const items = [
            {
                label: '$(plus) New Connection',
                description: 'Create a new connection',
                detail: 'Configure a new SQL Server connection',
                action: 'new'
            },
            ...savedConnections.map(conn => ({
                label: conn.name,
                description: `${conn.server}/${conn.database}`,
                detail: `Auth: ${conn.authType}`,
                action: 'connect',
                config: conn
            }))
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a connection to connect or create new one'
        });

        if (!selected) {
            return;
        }

        if (selected.action === 'new') {
            await this.connectWithWebview();
        } else if (selected.action === 'connect' && 'config' in selected) {
            await this.connectToSaved(selected.config);
        }
    }

    private async connectToSaved(config: ConnectionConfig): Promise<void> {
        try {
            // Get complete config with sensitive data from secure storage
            const completeConfig = await this.getCompleteConnectionConfig(config);
            
            // Re-prompt for password if SQL auth and not found in secure storage
            if (completeConfig.authType === 'sql' && !completeConfig.password) {
                const password = await vscode.window.showInputBox({
                    prompt: `Enter password for ${completeConfig.username}@${completeConfig.server}`,
                    password: true,
                    placeHolder: 'Password'
                });
                if (!password) {
                    return;
                }
                completeConfig.password = password;
                // Update secure storage with new password
                await this.context.secrets.store(`mssqlManager.password.${config.id}`, password);
            }

            await this.establishConnection(completeConfig);
            if (this.onConnectionChanged) {
                this.outputChannel.appendLine('[ConnectionProvider] Triggering connection change callback from manageConnections');
                this.onConnectionChanged();
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            this.outputChannel.appendLine(`Connection failed: ${errorMessage}`);
            vscode.window.showErrorMessage(`Failed to connect: ${errorMessage}`);
        }
    }

    private async establishConnection(config: ConnectionConfig): Promise<void> {
        this.outputChannel.appendLine(`Connecting to ${config.server}/${config.database}...`);
        
        // Show progress
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Connecting to SQL Server',
            cancellable: false
        }, async (progress) => {
            progress.report({ message: `Connecting to ${config.server}...` });

            // Close existing connection if any
            if (this.currentConnection) {
                await this.currentConnection.close();
            }

            // Build connection config for mssql
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
                    database: config.database,
                    options: {
                        encrypt: config.encrypt || true,
                        trustServerCertificate: config.trustServerCertificate || true
                    }
                };

                if (config.authType === 'sql') {
                    sqlConfig.user = config.username;
                    sqlConfig.password = config.password;
                } else if (config.authType === 'windows') {
                    sqlConfig.options!.trustedConnection = true;
                }

                if (config.port) {
                    sqlConfig.port = config.port;
                }
            }

            // Create and test connection
            this.currentConnection = new sql.ConnectionPool(sqlConfig);
            await this.currentConnection.connect();
            
            // Test with a simple query
            const request = this.currentConnection.request();
            await request.query('SELECT 1 as test');

            this.currentConfig = config;
            this.updateStatusBar(config);
            
            this.outputChannel.appendLine(`Successfully connected to ${config.server}/${config.database}`);
            vscode.window.showInformationMessage(`Connected to ${config.server}/${config.database}`);
        });
    }

    async disconnect(): Promise<void> {
        if (this.currentConnection) {
            try {
                await this.currentConnection.close();
                this.outputChannel.appendLine('Disconnected from SQL Server');
                vscode.window.showInformationMessage('Disconnected from SQL Server');
            } catch (error) {
                this.outputChannel.appendLine(`Error during disconnect: ${error}`);
            }
        }

        this.currentConnection = null;
        this.currentConfig = null;
        this.updateStatusBar(null);
    }

    getConnection(): sql.ConnectionPool | null {
        return this.currentConnection;
    }

    getCurrentConfig(): ConnectionConfig | null {
        return this.currentConfig;
    }

    isConnected(): boolean {
        return this.currentConnection !== null && this.currentConnection.connected;
    }

    private updateStatusBar(config: ConnectionConfig | null): void {
        if (config) {
            this.statusBarItem.text = `$(database) ${config.server}/${config.database}`;
            this.statusBarItem.tooltip = `Connected to ${config.server}/${config.database}`;
            this.statusBarItem.backgroundColor = undefined;
        } else {
            this.statusBarItem.text = "$(database) Not Connected";
            this.statusBarItem.tooltip = "MS SQL Manager - No active connection";
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
    }

    private getSavedConnections(): ConnectionConfig[] {
        // Use extension context global state for persistence
        const connections = this.context.globalState.get<ConnectionConfig[]>('mssqlManager.connections', []);
        this.outputChannel.appendLine(`[ConnectionProvider] Loaded ${connections.length} saved connections`);
        return connections;
    }

    async getSavedConnectionsList(): Promise<ConnectionConfig[]> {
        return this.getSavedConnections();
    }

    isCurrentConnection(config: ConnectionConfig): boolean {
        return this.currentConfig?.id === config.id;
    }

    async getCompleteConnectionConfig(config: ConnectionConfig): Promise<ConnectionConfig> {
        const completeConfig = { ...config };
        
        try {
            // Retrieve sensitive data from secure storage
            const password = await this.context.secrets.get(`mssqlManager.password.${config.id}`);
            const username = await this.context.secrets.get(`mssqlManager.username.${config.id}`);
            const connectionString = await this.context.secrets.get(`mssqlManager.connectionString.${config.id}`);
            
            if (password) completeConfig.password = password;
            if (username) completeConfig.username = username;
            if (connectionString) completeConfig.connectionString = connectionString;
            
        } catch (error) {
            this.outputChannel.appendLine(`[ConnectionProvider] Warning: Could not retrieve sensitive data for ${config.name}`);
        }
        
        return completeConfig;
    }

    private parseConnectionString(connectionString: string): Partial<ConnectionConfig> {
        const config: Partial<ConnectionConfig> = {};
        
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

    private async saveConnection(connection: ConnectionConfig): Promise<void> {
        const savedConnections = this.getSavedConnections();
        
        // Separate sensitive and non-sensitive data
        const publicConfig = { ...connection };
        delete publicConfig.password;
        delete publicConfig.username;
        delete publicConfig.connectionString;
        
        // Store sensitive data in secure storage
        if (connection.password) {
            await this.context.secrets.store(`mssqlManager.password.${connection.id}`, connection.password);
        }
        if (connection.username && connection.authType === 'sql') {
            await this.context.secrets.store(`mssqlManager.username.${connection.id}`, connection.username);
        }
        if (connection.connectionString) {
            await this.context.secrets.store(`mssqlManager.connectionString.${connection.id}`, connection.connectionString);
        }
        
        // Check if connection already exists (by id)
        const existingIndex = savedConnections.findIndex(conn => conn.id === connection.id);

        if (existingIndex >= 0) {
            savedConnections[existingIndex] = publicConfig;
        } else {
            savedConnections.push(publicConfig);
        }

        // Use extension context global state for persistence across VS Code restarts
        this.context.globalState.update('mssqlManager.connections', savedConnections);
        
        this.outputChannel.appendLine(`Connection saved: ${connection.name}`);
    }

    async deleteConnection(connectionId: string): Promise<void> {
        const savedConnections = this.getSavedConnections();
        const connectionIndex = savedConnections.findIndex(conn => conn.id === connectionId);
        
        if (connectionIndex === -1) {
            throw new Error('Connection not found');
        }
        
        const connection = savedConnections[connectionIndex];
        
        // Remove from saved connections
        savedConnections.splice(connectionIndex, 1);
        await this.context.globalState.update('mssqlManager.connections', savedConnections);
        
        // Remove sensitive data from secure storage
        try {
            await this.context.secrets.delete(`mssqlManager.password.${connectionId}`);
            await this.context.secrets.delete(`mssqlManager.username.${connectionId}`);
            await this.context.secrets.delete(`mssqlManager.connectionString.${connectionId}`);
        } catch (error) {
            this.outputChannel.appendLine(`[ConnectionProvider] Warning: Could not delete all sensitive data for ${connectionId}`);
        }
        
        // If this was the current connection, disconnect
        if (this.currentConfig?.id === connectionId) {
            await this.disconnect();
        }
        
        this.outputChannel.appendLine(`Connection deleted: ${connection.name}`);
    }

    async editConnection(connectionId: string): Promise<void> {
        const savedConnections = this.getSavedConnections();
        const connection = savedConnections.find(conn => conn.id === connectionId);
        
        if (!connection) {
            throw new Error('Connection not found');
        }
        
        // Get complete config with sensitive data
        const completeConfig = await this.getCompleteConnectionConfig(connection);
        
        // Open webview with existing config for editing
        const { ConnectionWebview } = await import('./connectionWebview');
        const connectionWebview = new ConnectionWebview(this.context, (config) => {
            this.handleWebviewConnection(config);
        });
        
        await connectionWebview.show(completeConfig);
    }

    async connectToSavedById(connectionId: string): Promise<void> {
        const savedConnections = this.getSavedConnections();
        const connection = savedConnections.find(conn => conn.id === connectionId);
        
        if (!connection) {
            throw new Error('Connection not found');
        }
        
        await this.connectToSaved(connection);
    }
}