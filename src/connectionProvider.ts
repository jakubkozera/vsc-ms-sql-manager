import * as vscode from 'vscode';
import * as sql from 'mssql';

export interface ServerGroup {
    id: string;
    name: string;
    description?: string;
    color: string;
}

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
    serverGroupId?: string; // New field for server group
}

export class ConnectionProvider {
    private activeConnections: Map<string, sql.ConnectionPool> = new Map();
    private activeConfigs: Map<string, ConnectionConfig> = new Map();
    private currentActiveId: string | null = null;
    private onConnectionChangedCallbacks: Array<() => void> = [];
    private pendingConnections: Set<string> = new Set();

    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel,
        private statusBarItem: vscode.StatusBarItem
    ) {}

    addConnectionChangeCallback(callback: () => void): void {
        this.outputChannel.appendLine('[ConnectionProvider] Adding connection change callback');
        this.onConnectionChangedCallbacks.push(callback);
    }

    private notifyConnectionChanged(): void {
        this.outputChannel.appendLine(`[ConnectionProvider] Notifying ${this.onConnectionChangedCallbacks.length} connection change callbacks`);
        for (const callback of this.onConnectionChangedCallbacks) {
            try {
                callback();
            } catch (error) {
                this.outputChannel.appendLine(`[ConnectionProvider] Error in connection change callback: ${error}`);
            }
        }
    }

    // Server Groups management
    getServerGroups(): ServerGroup[] {
        return this.context.globalState.get<ServerGroup[]>('mssqlManager.serverGroups', []);
    }

    async saveServerGroup(group: ServerGroup): Promise<void> {
        const groups = this.getServerGroups();
        const existingIndex = groups.findIndex(g => g.id === group.id);
        
        if (existingIndex >= 0) {
            groups[existingIndex] = group;
        } else {
            groups.push(group);
        }
        
        await this.context.globalState.update('mssqlManager.serverGroups', groups);
        this.outputChannel.appendLine(`Server group saved: ${group.name}`);
    }

    async deleteServerGroup(groupId: string): Promise<void> {
        const groups = this.getServerGroups();
        const groupIndex = groups.findIndex(g => g.id === groupId);
        
        if (groupIndex === -1) {
            throw new Error('Server group not found');
        }
        
        // Check if any connections are using this group
        const connections = this.getSavedConnections();
        const connectionsInGroup = connections.filter(conn => conn.serverGroupId === groupId);
        
        if (connectionsInGroup.length > 0) {
            const move = await vscode.window.showWarningMessage(
                `This group contains ${connectionsInGroup.length} connection(s). What would you like to do?`,
                'Move to Default',
                'Cancel'
            );
            
            if (move === 'Cancel') {
                return;
            }
            
            if (move === 'Move to Default') {
                // Remove group assignment from connections
                for (const conn of connectionsInGroup) {
                    delete conn.serverGroupId;
                }
                await this.context.globalState.update('mssqlManager.connections', connections);
            }
        }
        
        // Remove the group
        groups.splice(groupIndex, 1);
        await this.context.globalState.update('mssqlManager.serverGroups', groups);
        
        this.outputChannel.appendLine(`Server group deleted: ${groupId}`);
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
            this.outputChannel.appendLine(`[ConnectionProvider] Handling webview connection: ${JSON.stringify({...config, password: '***'})}`);
            await this.establishConnection(config);
            await this.saveConnection(config);
            this.notifyConnectionChanged();
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
            // Mark as pending and trigger UI update
            this.pendingConnections.add(config.id);
            this.notifyConnectionChanged();
            
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
                    this.pendingConnections.delete(config.id);
                    this.notifyConnectionChanged();
                    return;
                }
                completeConfig.password = password;
                // Update secure storage with new password
                await this.context.secrets.store(`mssqlManager.password.${config.id}`, password);
            }

            await this.establishConnection(completeConfig);
            
            // Remove from pending
            this.pendingConnections.delete(config.id);
            
            this.notifyConnectionChanged();
        } catch (error) {
            // Remove from pending on error
            this.pendingConnections.delete(config.id);
            this.notifyConnectionChanged();
            
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

            // Close existing connection with same ID if any
            const existingConnection = this.activeConnections.get(config.id);
            if (existingConnection) {
                await existingConnection.close();
                this.activeConnections.delete(config.id);
                this.activeConfigs.delete(config.id);
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
            const newConnection = new sql.ConnectionPool(sqlConfig);
            await newConnection.connect();
            
            // Test with a simple query
            const request = newConnection.request();
            await request.query('SELECT 1 as test');

            // Store the new connection
            this.activeConnections.set(config.id, newConnection);
            this.activeConfigs.set(config.id, config);
            this.currentActiveId = config.id;
            this.updateStatusBar(config);
            
            this.outputChannel.appendLine(`Successfully connected to ${config.server}/${config.database}`);
            vscode.window.showInformationMessage(`Connected to ${config.server}/${config.database}`);
        });
    }

    async disconnect(connectionId?: string): Promise<void> {
        if (connectionId) {
            // Disconnect specific connection
            const connection = this.activeConnections.get(connectionId);
            if (connection) {
                try {
                    await connection.close();
                    this.activeConnections.delete(connectionId);
                    this.activeConfigs.delete(connectionId);
                    
                    if (this.currentActiveId === connectionId) {
                        // Find another active connection to make current
                        const remainingIds = Array.from(this.activeConnections.keys());
                        this.currentActiveId = remainingIds.length > 0 ? remainingIds[0] : null;
                        
                        if (this.currentActiveId) {
                            this.updateStatusBar(this.activeConfigs.get(this.currentActiveId)!);
                        } else {
                            this.updateStatusBar(null);
                        }
                    }
                    
                    this.outputChannel.appendLine(`Disconnected from connection: ${connectionId}`);
                } catch (error) {
                    this.outputChannel.appendLine(`Error during disconnect: ${error}`);
                }
            }
        } else {
            // Disconnect all connections
            for (const [id, connection] of this.activeConnections) {
                try {
                    await connection.close();
                } catch (error) {
                    this.outputChannel.appendLine(`Error disconnecting ${id}: ${error}`);
                }
            }
            
            this.activeConnections.clear();
            this.activeConfigs.clear();
            this.currentActiveId = null;
            this.updateStatusBar(null);
            
            this.outputChannel.appendLine('Disconnected from all SQL Server connections');
            vscode.window.showInformationMessage('Disconnected from all SQL Server connections');
        }
        
        // Notify listeners about connection change
        this.notifyConnectionChanged();
    }

    getConnection(connectionId?: string): sql.ConnectionPool | null {
        if (connectionId) {
            return this.activeConnections.get(connectionId) || null;
        }
        
        // Return current active connection
        if (this.currentActiveId) {
            return this.activeConnections.get(this.currentActiveId) || null;
        }
        
        return null;
    }

    getCurrentConfig(): ConnectionConfig | null {
        if (this.currentActiveId) {
            return this.activeConfigs.get(this.currentActiveId) || null;
        }
        return null;
    }

    getConnectionConfig(connectionId: string): ConnectionConfig | null {
        return this.activeConfigs.get(connectionId) || null;
    }

    getAllActiveConnections(): { id: string; config: ConnectionConfig; connection: sql.ConnectionPool }[] {
        const result = [];
        for (const [id, connection] of this.activeConnections) {
            const config = this.activeConfigs.get(id);
            if (config) {
                result.push({ id, config, connection });
            }
        }
        return result;
    }

    setActiveConnection(connectionId: string): boolean {
        if (this.activeConnections.has(connectionId)) {
            this.currentActiveId = connectionId;
            const config = this.activeConfigs.get(connectionId);
            if (config) {
                this.updateStatusBar(config);
            }
            
            // Notify listeners about connection change
            this.notifyConnectionChanged();
            
            return true;
        }
        return false;
    }

    isConnected(connectionId?: string): boolean {
        if (connectionId) {
            const connection = this.activeConnections.get(connectionId);
            return connection !== undefined && connection.connected;
        }
        
        // Check if any connection is active
        return this.activeConnections.size > 0;
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
        this.outputChannel.appendLine(`[ConnectionProvider] Connections with groups: ${JSON.stringify(connections.map(c => ({id: c.id, name: c.name, serverGroupId: c.serverGroupId})))}`);
        return connections;
    }

    async getSavedConnectionsList(): Promise<ConnectionConfig[]> {
        return this.getSavedConnections();
    }

    isCurrentConnection(config: ConnectionConfig): boolean {
        return this.currentActiveId === config.id;
    }

    isConnectionActive(connectionId: string): boolean {
        return this.activeConnections.has(connectionId);
    }

    isConnectionPending(connectionId: string): boolean {
        return this.pendingConnections.has(connectionId);
    }

    getActiveConnectionInfo(): ConnectionConfig | null {
        if (this.currentActiveId) {
            return this.activeConfigs.get(this.currentActiveId) || null;
        }
        return null;
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
        this.outputChannel.appendLine(`[ConnectionProvider] Saving connection: ${JSON.stringify({...connection, password: '***'})}`);
        
        const savedConnections = this.getSavedConnections();
        
        // Separate sensitive and non-sensitive data
        const publicConfig = { ...connection };
        delete publicConfig.password;
        delete publicConfig.username;
        delete publicConfig.connectionString;
        
        this.outputChannel.appendLine(`[ConnectionProvider] Public config to save: ${JSON.stringify(publicConfig)}`);
        
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
            this.outputChannel.appendLine(`[ConnectionProvider] Updating existing connection at index ${existingIndex}`);
            savedConnections[existingIndex] = publicConfig;
        } else {
            this.outputChannel.appendLine(`[ConnectionProvider] Adding new connection`);
            savedConnections.push(publicConfig);
        }

        // Use extension context global state for persistence across VS Code restarts
        await this.context.globalState.update('mssqlManager.connections', savedConnections);
        
        this.outputChannel.appendLine(`[ConnectionProvider] Connection saved: ${connection.name}. Total connections: ${savedConnections.length}`);
        this.outputChannel.appendLine(`[ConnectionProvider] All saved connections: ${JSON.stringify(savedConnections.map(c => ({id: c.id, name: c.name, serverGroupId: c.serverGroupId})))}`);
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
        
        // If this was an active connection, disconnect it
        if (this.isConnectionActive(connectionId)) {
            await this.disconnect(connectionId);
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