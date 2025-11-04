import * as vscode from 'vscode';
import { createDatabaseIcon, createServerGroupIcon } from './serverGroupIcon';
import * as sql from 'mssql';
import { createPoolForConfig, DBPool } from './dbClient';

export interface ServerGroup {
    id: string;
    name: string;
    description?: string;
    color?: string; // Optional when using custom icon
    iconType?: 'folder' | 'folder-heroicons' | 'vscode-folder' | 'custom';
    customIconId?: string; // Reference to saved custom icon
}

export interface CustomIcon {
    id: string;
    name: string;
    svgContent: string;
}

export interface TableFilter {
    name?: { operator: string; value: string };
    schema?: { operator: string; value: string };
    owner?: { operator: string; value: string };
}

export interface DatabaseFilter {
    name?: {
        operator: string;
        value: string;
    };
    state?: {
        operator: string;
        value: string;
    };
    collation?: {
        operator: string;
        value: string;
    };
}

export interface ConnectionConfig {
    id: string;
    name: string;
    server: string;
    database: string;
    authType: 'sql' | 'windows' | 'azure';
    connectionType: 'database' | 'server'; // New field: database = specific DB, server = master DB for server-level operations
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
    private activeConnections: Map<string, DBPool> = new Map();
    // Additional per-parent-connection per-database pools (keyed by `${connectionId}::${database}`)
    private dbPools: Map<string, DBPool> = new Map();
    private activeConfigs: Map<string, ConnectionConfig> = new Map();
    private currentActiveId: string | null = null;
    private onConnectionChangedCallbacks: Array<() => void> = [];
    private pendingConnections: Set<string> = new Set();
    // Preferred database for next editor (temporary, cleared after use)
    private nextEditorPreferredDatabase: { connectionId: string; database: string } | null = null;
    // Database filters per connection (keyed by connectionId)
    private databaseFilters: Map<string, DatabaseFilter> = new Map();
    // Table filters per database (keyed by `${connectionId}::${database}`)
    private tableFilters: Map<string, TableFilter> = new Map();

    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel,
    ) {
        // Load saved filters
        this.loadDatabaseFilters();
        this.loadTableFilters();
    }

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

    // Custom Icons management
    getCustomIcons(): CustomIcon[] {
        return this.context.globalState.get<CustomIcon[]>('mssqlManager.customIcons', []);
    }

    async saveCustomIcon(icon: CustomIcon): Promise<void> {
        const icons = this.getCustomIcons();
        const existingIndex = icons.findIndex(i => i.id === icon.id);
        
        if (existingIndex >= 0) {
            icons[existingIndex] = icon;
        } else {
            icons.push(icon);
        }
        
        await this.context.globalState.update('mssqlManager.customIcons', icons);
        this.outputChannel.appendLine(`Custom icon saved: ${icon.name}`);
    }

    async deleteCustomIcon(iconId: string): Promise<void> {
        const icons = this.getCustomIcons();
        const iconIndex = icons.findIndex(i => i.id === iconId);
        
        if (iconIndex === -1) {
            throw new Error('Custom icon not found');
        }
        
        // Check if any server group is using this icon
        const groups = this.getServerGroups();
        const groupsUsingIcon = groups.filter(g => g.customIconId === iconId);
        
        if (groupsUsingIcon.length > 0) {
            // Reset those groups to default icon
            for (const group of groupsUsingIcon) {
                group.iconType = 'folder';
                group.color = group.color || '#0078D4';
                delete group.customIconId;
                await this.saveServerGroup(group);
            }
        }
        
        // Remove the icon
        icons.splice(iconIndex, 1);
        await this.context.globalState.update('mssqlManager.customIcons', icons);
        
        this.outputChannel.appendLine(`Custom icon deleted: ${iconId} (${groupsUsingIcon.length} group(s) reset to default)`);
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
        
        // Get all connections in this group
        const connections = this.getSavedConnections();
        const connectionsInGroup = connections.filter(conn => conn.serverGroupId === groupId);
        
        // Disconnect any active connections in this group
        for (const conn of connectionsInGroup) {
            if (this.isConnectionActive(conn.id)) {
                await this.disconnect(conn.id);
            }
        }
        
        // Delete all connections in this group
        const remainingConnections = connections.filter(conn => conn.serverGroupId !== groupId);
        await this.context.globalState.update('mssqlManager.connections', remainingConnections);
        
        // Delete passwords from secure storage for deleted connections
        for (const conn of connectionsInGroup) {
            try {
                await this.context.secrets.delete(`mssqlManager.password.${conn.id}`);
            } catch (error) {
                // Ignore errors if password doesn't exist
                this.outputChannel.appendLine(`Could not delete password for connection ${conn.id}: ${error}`);
            }
        }
        
        // Remove the group
        groups.splice(groupIndex, 1);
        await this.context.globalState.update('mssqlManager.serverGroups', groups);
        
        this.outputChannel.appendLine(`Server group deleted: ${groupId} (${connectionsInGroup.length} connection(s) removed)`);
    }

    async connectWithWebview(): Promise<void> {
        // Use require here so webpack can resolve the TS module during bundling
        // and avoid runtime import extension issues with node16 resolution.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { ConnectionWebview } = require('./connectionWebview');
        const connectionWebview = new ConnectionWebview(this.context, (config: any) => {
            this.handleWebviewConnection(config);
        });
        
        await connectionWebview.show();
    }

    private async handleWebviewConnection(config: ConnectionConfig): Promise<void> {
        this.outputChannel.appendLine(`[ConnectionProvider] Handling webview connection: ${JSON.stringify({...config, password: '***'})}`);
        
        // Mark as pending and trigger UI update
        this.pendingConnections.add(config.id);
        this.notifyConnectionChanged();
        
        try {
            await this.establishConnection(config);
            await this.saveConnection(config);
        } finally {
            // Always remove from pending, whether success or failure
            this.pendingConnections.delete(config.id);
            this.notifyConnectionChanged();
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

        const serverGroups = this.getServerGroups();

        // Exclude connections that are already active — no need to show them in QuickPick
        const availableConnections = savedConnections.filter(conn => !this.isConnectionActive(conn.id));

        if (availableConnections.length === 0) {
            const choice = await vscode.window.showInformationMessage(
                'All saved connections are already connected. Would you like to create a new connection?',
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
            ...availableConnections.map(conn => {
                // Try to find server group color if available
                const group = conn.serverGroupId ? serverGroups.find(g => g.id === conn.serverGroupId) : undefined;
                const groupColor = group ? group.color || '#000000' : '#000000';

                const icon = conn.connectionType === 'server'
                    ? (this.isConnectionActive(conn.id)
                        ? new vscode.ThemeIcon('server-environment', new vscode.ThemeColor('charts.green'))
                        : new vscode.ThemeIcon('server-environment'))
                    : createDatabaseIcon(this.isConnectionActive(conn.id));

                return {
                    label: conn.name,
                    description: `${conn.server}/${conn.database}`,
                    detail: `Auth: ${conn.authType}`,
                    action: 'connect',
                    config: conn,
                    iconPath: icon
                } as any;
            })
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
        // Mark as pending and trigger UI update
        this.pendingConnections.add(config.id);
        this.notifyConnectionChanged();
        
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
                    this.pendingConnections.delete(config.id);
                    this.notifyConnectionChanged();
                    return;
                }
                completeConfig.password = password;
                // Update secure storage with new password
                await this.context.secrets.store(`mssqlManager.password.${config.id}`, password);
            }

            await this.establishConnection(completeConfig);
        } finally {
            // Always remove from pending, whether success or failure
            this.pendingConnections.delete(config.id);
            this.notifyConnectionChanged();
        }
    }

    private async establishConnection(config: ConnectionConfig): Promise<void> {
        this.outputChannel.appendLine(`Connecting to ${config.server}/${config.database}...`);
        
        // Show progress with detailed steps
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Connecting to ${config.name || config.server}`,
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ message: 'Preparing connection...' });

                // Close existing connection with same ID if any
                const existingConnection = this.activeConnections.get(config.id);
                if (existingConnection) {
                    await existingConnection.close();
                    this.activeConnections.delete(config.id);
                    this.activeConfigs.delete(config.id);
                }

                progress.report({ message: 'Configuring authentication...' });
                
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
                    database: config.connectionType === 'server' ? 'master' : config.database,
                    options: {
                        encrypt: config.encrypt || true,
                        trustServerCertificate: config.trustServerCertificate || true
                    }
                };                if (config.authType === 'sql') {
                        sqlConfig.user = config.username;
                        sqlConfig.password = config.password;
                    } else if (config.authType === 'windows') {
                        sqlConfig.options!.trustedConnection = true;
                    }

                    if (config.port) {
                        sqlConfig.port = config.port;
                    }
                }

                progress.report({ message: `Connecting to ${config.server}...` });
                
                // Create and test connection using dbClient strategy (mssql or msnodesqlv8 depending on auth)
                const newConnection = await createPoolForConfig({ ...sqlConfig, authType: config.authType, useConnectionString: config.useConnectionString, connectionString: config.connectionString, username: config.username, password: config.password, port: config.port, encrypt: config.encrypt, trustServerCertificate: config.trustServerCertificate });
                await newConnection.connect();

                progress.report({ message: 'Verifying connection...' });
                
                // Test with a simple query
                const request = newConnection.request();
                // normalize both clients to return result.recordsets when applicable
                await request.query('SELECT 1 as test');
                
                // Store the new connection
                this.activeConnections.set(config.id, newConnection);
                this.activeConfigs.set(config.id, config);
                this.currentActiveId = config.id;
                
                const displayDb = config.connectionType === 'server' ? 'server' : config.database;
                this.outputChannel.appendLine(`Successfully connected to ${config.server}/${displayDb}`);
                
                // Final progress update
                progress.report({ message: `Successfully connected!` });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                this.outputChannel.appendLine(`Connection failed: ${errorMessage}`);
                vscode.window.showErrorMessage(`Failed to connect to ${config.server}: ${errorMessage}`);
                throw error;
            }
        });
    }

    // Create or return an existing connection pool scoped to a specific database for a given connectionId
    async createDbPool(connectionId: string, database: string): Promise<DBPool> {
        const key = `${connectionId}::${database}`;
        const existing = this.dbPools.get(key);
        if (existing && existing.connected) {
            return existing;
        }

        // Get base connection config
        const baseConfig = this.activeConfigs.get(connectionId);
        if (!baseConfig) {
            throw new Error(`No base connection config found for ${connectionId}`);
        }

        // Build sqlConfig cloned from base but with requested database
        let sqlConfig: any;
        if (baseConfig.useConnectionString && baseConfig.connectionString) {
            // If using connection string, replace the Database/Initial Catalog value if present
            sqlConfig = { connectionString: baseConfig.connectionString.replace(/(Initial Catalog|Database)=[^;]+/i, `$1=${database}`), authType: baseConfig.authType, useConnectionString: true };
        } else {
            sqlConfig = {
                server: baseConfig.server,
                database: database,
                authType: baseConfig.authType,
                username: baseConfig.username,
                password: baseConfig.password,
                port: baseConfig.port,
                encrypt: baseConfig.encrypt,
                trustServerCertificate: baseConfig.trustServerCertificate
            };
        }

        const pool = await createPoolForConfig(sqlConfig);
        await pool.connect();

        // Test with a simple query
        await pool.request().query('SELECT 1 as test');

        this.dbPools.set(key, pool);
        this.outputChannel.appendLine(`[ConnectionProvider] Created DB pool for ${connectionId} -> ${database}`);
        return pool;
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

                    // Close any DB pools created for this connection
                    const keysToRemove: string[] = [];
                    for (const key of this.dbPools.keys()) {
                        if (key.startsWith(`${connectionId}::`)) {
                            const pool = this.dbPools.get(key);
                            if (pool) {
                                try {
                                    await pool.close();
                                } catch (err) {
                                    this.outputChannel.appendLine(`[ConnectionProvider] Error closing db pool ${key}: ${err}`);
                                }
                            }
                            keysToRemove.push(key);
                        }
                    }

                    for (const k of keysToRemove) {
                        this.dbPools.delete(k);
                    }
                    
                    if (this.currentActiveId === connectionId) {
                        // Find another active connection to make current
                        const remainingIds = Array.from(this.activeConnections.keys());
                        this.currentActiveId = remainingIds.length > 0 ? remainingIds[0] : null;
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
            
            this.outputChannel.appendLine('Disconnected from all SQL Server connections');
            vscode.window.showInformationMessage('Disconnected from all SQL Server connections');
        }
        
        // Notify listeners about connection change
        this.notifyConnectionChanged();
    }

    getConnection(connectionId?: string): DBPool | null {
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

    getAllActiveConnections(): { id: string; config: ConnectionConfig; connection: DBPool }[] {
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

            // Notify listeners about connection change
            this.notifyConnectionChanged();
            
            return true;
        }
        return false;
    }

    setNextEditorPreferredDatabase(connectionId: string, database: string): void {
        this.nextEditorPreferredDatabase = { connectionId, database };
    }

    getAndClearNextEditorPreferredDatabase(): { connectionId: string; database: string } | null {
        const result = this.nextEditorPreferredDatabase;
        this.nextEditorPreferredDatabase = null;
        return result;
    }

    isConnected(connectionId?: string): boolean {
        if (connectionId) {
            const connection = this.activeConnections.get(connectionId);
            return connection !== undefined && connection.connected;
        }
        
        // Check if any connection is active
        return this.activeConnections.size > 0;
    }


    private getSavedConnections(): ConnectionConfig[] {
        // Use extension context global state for persistence
        const connections = this.context.globalState.get<ConnectionConfig[]>('mssqlManager.connections', []);
        
        // Ensure all connections have connectionType field (backward compatibility)
        const updatedConnections = connections.map(conn => ({
            ...conn,
            connectionType: conn.connectionType || 'database' // Default to 'database' for existing connections
        }));
        
        this.outputChannel.appendLine(`[ConnectionProvider] Loaded ${updatedConnections.length} saved connections`);
        this.outputChannel.appendLine(`[ConnectionProvider] Connections with groups: ${JSON.stringify(updatedConnections.map(c => ({id: c.id, name: c.name, serverGroupId: c.serverGroupId, connectionType: c.connectionType})))}`);
        return updatedConnections;
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
            
            if (password) { completeConfig.password = password; }
            if (username) { completeConfig.username = username; }
            if (connectionString) { completeConfig.connectionString = connectionString; }
            
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
            if (!key || !value) { continue; }
            
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
        
        // Ensure connectionType is set. If database is empty, treat as server connection.
        if (!publicConfig.connectionType) {
            publicConfig.connectionType = (publicConfig.database && publicConfig.database.trim() !== '') ? 'database' : 'server';
        } else if (publicConfig.connectionType === 'database' && (!publicConfig.database || publicConfig.database.trim() === '')) {
            // If UI provided 'database' but database is empty, convert to server
            publicConfig.connectionType = 'server';
        }
        
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
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { ConnectionWebview } = require('./connectionWebview');
        const connectionWebview = new ConnectionWebview(this.context, (config: any) => {
            this.handleWebviewConnection(config);
        });
        
        await connectionWebview.show(completeConfig);
    }

    // One-time discovery for Windows users: try to connect to common local SQL Server instances
    // and register any that succeed in a server group named 'Local'. This should run only once
    // after the extension is installed/first activated.
    async discoverLocalServersOnce(): Promise<void> {
        try {
            const alreadyRun = this.context.globalState.get<boolean>('mssqlManager.localDiscoveryDone', false);
            // if (alreadyRun) {
            //     this.outputChannel.appendLine('[ConnectionProvider] Local discovery already executed, skipping');
            //     return;
            // }

            // Only run on Windows
            if (process.platform !== 'win32') {
                this.outputChannel.appendLine('[ConnectionProvider] Local discovery skipped: not Windows');
                await this.context.globalState.update('mssqlManager.localDiscoveryDone', true);
                return;
            }

            this.outputChannel.appendLine('[ConnectionProvider] Starting one-time local SQL Server discovery (Windows)');

            const candidates = [
                { server: '(localdb)\\MSSQLLocalDB', display: 'MSSQLLocalDB' },
                { server: 'localhost', display: 'Localhost' },
                { server: '.\\SQLEXPRESS', display: 'SQL Express' },
            ];

            const discovered: ConnectionConfig[] = [];

            // Run checks in parallel so discovery is fast. Each attempt is isolated with its own
            // handlers and timeout so a failing driver doesn't affect others.
            const attemptPromises = candidates.map(c => (async (): Promise<ConnectionConfig | null> => {
                const testId = `local-${c.server.replace(/[^a-z0-9]/gi, '_')}`;
                const cfg: ConnectionConfig = {
                    id: testId,
                    name: `${c.display}`,
                    server: c.server,
                    database: 'master',
                    authType: 'windows',
                    connectionType: 'server'
                };

                this.outputChannel.appendLine(`[ConnectionProvider] Testing local candidate (parallel): ${c.server}`);

                const onUncaught = (err: any) => {
                    this.outputChannel.appendLine(`[ConnectionProvider] Suppressed uncaught exception during discovery for ${c.server}: ${err}`);
                };
                const onRejection = (reason: any) => {
                    this.outputChannel.appendLine(`[ConnectionProvider] Suppressed unhandled rejection during discovery for ${c.server}: ${reason}`);
                };

                process.once('uncaughtException', onUncaught);
                process.once('unhandledRejection', onRejection);

                let pool: any = null;
                try {
                    const attempt = (async () => {
                        pool = await createPoolForConfig({ ...cfg, authType: 'windows', useConnectionString: true, connectionString: cfg.connectionString });
                        await pool.connect();
                        await pool.request().query('SELECT 1 as test');
                    })();

                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out')), 5000));
                    await Promise.race([attempt, timeoutPromise]);

                    this.outputChannel.appendLine(`[ConnectionProvider] Successfully connected to local candidate: ${c.server}`);
                    return cfg;
                } catch (err) {
                    this.outputChannel.appendLine(`[ConnectionProvider] Local candidate failed: ${c.server} -> ${err}`);
                    return null;
                } finally {
                    try { process.removeListener('uncaughtException', onUncaught); } catch (_) { }
                    try { process.removeListener('unhandledRejection', onRejection); } catch (_) { }

                    if (pool) {
                        try {
                            if (typeof pool.connected === 'boolean') {
                                if (pool.connected) {
                                    await pool.close();
                                } else {
                                    try { await pool.close(); } catch (_) { /* ignore */ }
                                }
                            } else {
                                await pool.close();
                            }
                        } catch (err: any) {
                            const msg = err && (err.message || err.toString()) || String(err);
                            if (!/Connection is not open/i.test(msg)) {
                                this.outputChannel.appendLine(`[ConnectionProvider] Warning closing pool for ${c.server}: ${err}`);
                            }
                        }
                    }
                }
            })());

            const results = await Promise.all(attemptPromises);
            for (const res of results) {
                if (res) discovered.push(res);
            }

            if (discovered.length > 0) {
                // Ensure Local server group exists
                let groups = this.getServerGroups();
                let localGroup = groups.find(g => g.name === 'Local');
                if (!localGroup) {
                    localGroup = { id: `group-local`, name: 'Local', color: '#0078D4' };
                    await this.saveServerGroup(localGroup);
                    groups = this.getServerGroups();
                }

                // Save discovered connections into global state (only public parts)
                const savedConnections = this.getSavedConnections();

                for (const d of discovered) {
                    // avoid duplicate by server string
                    const exists = savedConnections.find(s => s.server === d.server || s.connectionString === d.connectionString);
                    if (exists) {
                        // Don't move user's existing connection into Local. Instead create a new discovered entry
                        // with a distinct id (testId) so the user's Dev/other connection isn't modified.
                        const alreadyDiscovered = savedConnections.find(s => s.id === d.id);
                        if (!alreadyDiscovered) {
                            const publicConfig = { ...d } as any;
                            publicConfig.serverGroupId = localGroup.id;
                            // make it clear this was auto-discovered
                            publicConfig.name = `${d.name}`;
                            delete publicConfig.connectionString;
                            savedConnections.push(publicConfig as ConnectionConfig);
                            this.outputChannel.appendLine(`[ConnectionProvider] Added discovered connection into Local group: ${publicConfig.name}`);
                        } else {
                            this.outputChannel.appendLine(`[ConnectionProvider] Discovered connection already exists: ${d.server}`);
                        }
                        continue;
                    }

                    // Assign to Local group
                    d.serverGroupId = localGroup.id;

                    // Save public part; sensitive data isn't required for windows auth trusted connections
                    const publicConfig = { ...d } as any;
                    delete publicConfig.connectionString; // we keep using connectionString in secure storage if needed

                    // push and persist
                    savedConnections.push(publicConfig as ConnectionConfig);
                    // Note: we do not store connectionString in secrets for Trusted Connection because not necessary
                    this.outputChannel.appendLine(`[ConnectionProvider] Registered discovered local connection: ${d.name}`);
                }

                await this.context.globalState.update('mssqlManager.connections', savedConnections);
            }

            // Mark discovery done regardless of results to avoid repeating
            await this.context.globalState.update('mssqlManager.localDiscoveryDone', true);
            this.outputChannel.appendLine('[ConnectionProvider] Local discovery finished');

            // Notify UI if something changed
            if (discovered.length > 0) { this.notifyConnectionChanged(); }
        } catch (error) {
            this.outputChannel.appendLine(`[ConnectionProvider] Error during local discovery: ${error}`);
            // still mark as done to avoid repeated attempts
            await this.context.globalState.update('mssqlManager.localDiscoveryDone', true);
        }
    }

    async connectToSavedById(connectionId: string): Promise<void> {
        // Check if already connected or connecting
        if (this.isConnectionActive(connectionId)) {
            this.outputChannel.appendLine(`[ConnectionProvider] Already connected to ${connectionId}, skipping`);
            return;
        }
        
        if (this.isConnectionPending(connectionId)) {
            this.outputChannel.appendLine(`[ConnectionProvider] Connection to ${connectionId} already in progress, skipping`);
            return;
        }
        
        const savedConnections = this.getSavedConnections();
        const connection = savedConnections.find(conn => conn.id === connectionId);
        
        if (!connection) {
            throw new Error('Connection not found');
        }
        
        await this.connectToSaved(connection);
    }

    async moveConnectionToGroup(connectionId: string, targetServerGroupId: string | undefined): Promise<void> {
        const savedConnections = this.getSavedConnections();
        const connection = savedConnections.find(conn => conn.id === connectionId);
        
        if (!connection) {
            throw new Error('Connection not found');
        }

        // Update the connection's server group
        if (targetServerGroupId) {
            // Verify that the target group exists
            const groups = this.getServerGroups();
            const targetGroup = groups.find(g => g.id === targetServerGroupId);
            if (!targetGroup) {
                throw new Error('Target server group not found');
            }
            connection.serverGroupId = targetServerGroupId;
        } else {
            // Remove from group (move to root)
            delete connection.serverGroupId;
        }

        // Save the updated connections
        await this.context.globalState.update('mssqlManager.connections', savedConnections);
        
        this.outputChannel.appendLine(
            `[ConnectionProvider] Moved connection ${connection.name} to ${targetServerGroupId ? 'group ' + targetServerGroupId : 'root level'}`
        );
    }

    // Database filters management
    private loadDatabaseFilters(): void {
        const filters = this.context.globalState.get<Record<string, DatabaseFilter>>('mssqlManager.databaseFilters', {});
        this.databaseFilters = new Map(Object.entries(filters));
        this.outputChannel.appendLine(`[ConnectionProvider] Loaded ${this.databaseFilters.size} database filters`);
    }

    private async saveDatabaseFilters(): Promise<void> {
        const filtersObject = Object.fromEntries(this.databaseFilters);
        await this.context.globalState.update('mssqlManager.databaseFilters', filtersObject);
        this.outputChannel.appendLine(`[ConnectionProvider] Saved ${this.databaseFilters.size} database filters`);
    }

    getDatabaseFilter(connectionId: string): DatabaseFilter | undefined {
        return this.databaseFilters.get(connectionId);
    }

    async setDatabaseFilter(connectionId: string, filter: DatabaseFilter | null): Promise<void> {
        if (filter === null) {
            this.databaseFilters.delete(connectionId);
            this.outputChannel.appendLine(`[ConnectionProvider] Cleared database filter for connection ${connectionId}`);
        } else {
            this.databaseFilters.set(connectionId, filter);
            this.outputChannel.appendLine(`[ConnectionProvider] Set database filter for connection ${connectionId}`);
        }
        await this.saveDatabaseFilters();
        this.notifyConnectionChanged();
    }

    hasDatabaseFilter(connectionId: string): boolean {
        return this.databaseFilters.has(connectionId);
    }

    // Table filters management
    private loadTableFilters(): void {
        const filters = this.context.globalState.get<Record<string, TableFilter>>('mssqlManager.tableFilters', {});
        this.tableFilters = new Map(Object.entries(filters));
        this.outputChannel.appendLine(`[ConnectionProvider] Loaded ${this.tableFilters.size} table filters`);
    }

    private async saveTableFilters(): Promise<void> {
        const filtersObject = Object.fromEntries(this.tableFilters);
        await this.context.globalState.update('mssqlManager.tableFilters', filtersObject);
        this.outputChannel.appendLine(`[ConnectionProvider] Saved ${this.tableFilters.size} table filters`);
    }

    getTableFilter(connectionId: string, database: string): TableFilter | undefined {
        const key = `${connectionId}::${database}`;
        return this.tableFilters.get(key);
    }

    async setTableFilter(connectionId: string, database: string, filter: TableFilter | null): Promise<void> {
        const key = `${connectionId}::${database}`;
        if (filter === null) {
            this.tableFilters.delete(key);
            this.outputChannel.appendLine(`[ConnectionProvider] Cleared table filter for ${key}`);
        } else {
            this.tableFilters.set(key, filter);
            this.outputChannel.appendLine(`[ConnectionProvider] Set table filter for ${key}`);
        }
        await this.saveTableFilters();
        this.notifyConnectionChanged();
    }

    hasTableFilter(connectionId: string, database: string): boolean {
        const key = `${connectionId}::${database}`;
        return this.tableFilters.has(key);
    }

}