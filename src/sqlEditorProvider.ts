import * as vscode from 'vscode';
import * as fs from 'fs';
import { QueryExecutor } from './queryExecutor';
import { ConnectionProvider } from './connectionProvider';

export class SqlEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'mssqlManager.sqlEditor';
    private disposedWebviews: Set<vscode.Webview> = new Set();
    // Track the last selected connection id per webview so we can preserve selection
    private webviewSelectedConnection = new Map<vscode.Webview, string | null>();
    // Track webview to document URI mapping for connection updates
    private webviewToDocument = new Map<vscode.Webview, vscode.Uri>();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly queryExecutor: QueryExecutor,
        private readonly connectionProvider: ConnectionProvider,
        private readonly outputChannel: vscode.OutputChannel
    ) { }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Set up webview options
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'webview')
            ]
        };

        // Set initial HTML content
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // Track webview to document mapping
        this.webviewToDocument.set(webviewPanel.webview, document.uri);

        // Update webview content when document changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                webviewPanel.webview.postMessage({
                    type: 'update',
                    content: document.getText()
                });
            }
        });

        // Handle messages from webview
        webviewPanel.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'ready':
                    // Initialize webview with current document content
                    webviewPanel.webview.postMessage({
                        type: 'update',
                        content: document.getText()
                    });

                    // Check if there's a preferred database for this new editor
                    const preferredDb = this.connectionProvider.getAndClearNextEditorPreferredDatabase();
                    if (preferredDb) {
                        // Set the preferred connection+database for this webview
                        const compositeId = `${preferredDb.connectionId}::${preferredDb.database}`;
                        this.webviewSelectedConnection.set(webviewPanel.webview, compositeId);
                    }

                    // Send initial connections list
                    this.updateConnectionsList(webviewPanel.webview);
                    
                    // Auto-execute query if it's a SELECT statement and we have a database context
                    const content = document.getText().trim();
                    if (preferredDb && content && content.toLowerCase().startsWith('select')) {
                        // Small delay to ensure webview is fully initialized
                        setTimeout(() => {
                            webviewPanel.webview.postMessage({
                                type: 'autoExecuteQuery'
                            });
                        }, 50);
                    }
                    break;

                case 'documentChanged':
                    // Update the document when the webview content changes
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(
                        document.uri,
                        new vscode.Range(0, 0, document.lineCount, 0),
                        message.content
                    );
                    await vscode.workspace.applyEdit(edit);
                    break;

                case 'executeQuery':
                    await this.executeQuery(message.query, message.connectionId, webviewPanel.webview, message.includeActualPlan);
                    break;

                case 'executeEstimatedPlan':
                    await this.executeEstimatedPlan(message.query, message.connectionId, webviewPanel.webview);
                    break;

                case 'cancelQuery':
                    // Query cancellation is handled automatically by VS Code progress API
                    this.outputChannel.appendLine('Query cancellation requested');
                    break;

                case 'manageConnections':
                    await vscode.commands.executeCommand('mssqlManager.manageConnections');
                    break;

                case 'switchConnection':
                    // Set the active connection
                    this.connectionProvider.setActiveConnection(message.connectionId);
                    this.webviewSelectedConnection.set(webviewPanel.webview, message.connectionId);
                    this.outputChannel.appendLine(`[SqlEditorProvider] switchConnection -> selected ${message.connectionId}`);
                    await this.updateConnectionsList(webviewPanel.webview);
                    break;

                case 'switchDatabase':
                    // Switch to a specific database on the current server connection
                    const compositeId = `${message.connectionId}::${message.databaseName}`;
                    this.webviewSelectedConnection.set(webviewPanel.webview, compositeId);
                    this.outputChannel.appendLine(`[SqlEditorProvider] switchDatabase -> ${compositeId}`);
                    
                    // Update current database in connection provider for history tracking
                    this.connectionProvider.setCurrentDatabase(message.connectionId, message.databaseName);
                    
                    await this.sendSchemaUpdate(webviewPanel.webview, compositeId);
                    break;

                case 'getDatabases':
                    // Send list of databases for a server connection
                    await this.sendDatabasesList(webviewPanel.webview, message.connectionId, message.selectedDatabase);
                    break;

                case 'getSchema':
                    // remember request context if provided
                    if (message.connectionId) {
                        this.webviewSelectedConnection.set(webviewPanel.webview, message.connectionId);
                    }
                    await this.sendSchemaUpdate(webviewPanel.webview, message.connectionId);
                    break;

                case 'goToDefinition':
                    // Forward to a command that will reveal/expand the tree view to the requested object
                    // payload: { objectType, schema, table, column, connectionId, database }
                    try {
                        await vscode.commands.executeCommand('mssqlManager.revealInExplorer', {
                            objectType: message.objectType,
                            schema: message.schema,
                            table: message.table,
                            column: message.column,
                                connectionId: message.connectionId || this.webviewSelectedConnection.get(webviewPanel.webview) || null,
                                database: message.database || undefined
                        });
                    } catch (err) {
                        this.outputChannel.appendLine(`[SqlEditorProvider] goToDefinition forward failed: ${err}`);
                    }
                    break;

                case 'commitChanges':
                    await this.commitChanges(message.statements, message.connectionId, message.originalQuery, webviewPanel.webview);
                    break;

                case 'confirmAction':
                    // Handle confirmation dialogs (since confirm() is blocked in sandboxed webviews)
                    const result = await vscode.window.showWarningMessage(
                        message.message,
                        { modal: true },
                        'Yes',
                        'No'
                    );
                    
                    if (result === 'Yes') {
                        webviewPanel.webview.postMessage({
                            type: 'confirmActionResult',
                            action: message.action,
                            confirmed: true
                        });
                    }
                    break;

                case 'scriptTableCreate':
                    // Forward request to existing scriptTableCreate command. Build a lightweight tableNode
                    try {
                        // Resolve connectionId and database from message or preserved webview selection
                        let conn = message.connectionId || this.webviewSelectedConnection.get(webviewPanel.webview) || null;
                        let db = message.database || undefined;

                        if (conn && typeof conn === 'string' && conn.includes('::')) {
                            const parts = conn.split('::');
                            conn = parts[0];
                            if (!db && parts.length > 1) {
                                db = parts[1];
                            }
                        }

                        const label = message.schema ? `${message.schema}.${message.table}` : message.table;

                        const tableNode: any = {
                            connectionId: conn,
                            label: label,
                            database: db
                        };

                        await vscode.commands.executeCommand('mssqlManager.scriptTableCreate', tableNode);
                    } catch (err) {
                        this.outputChannel.appendLine(`[SqlEditorProvider] scriptTableCreate forward failed: ${err}`);
                    }
                    break;

                case 'openInNewEditor':
                    await this.openContentInNewEditor(message.content, message.language);
                    break;

                case 'saveFile':
                    await this.saveFileToDisk(message.content, message.defaultFileName, message.fileType, message.encoding);
                    break;
            }
        });

        // Clean up
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
            this.disposedWebviews.add(webviewPanel.webview);
            this.webviewToDocument.delete(webviewPanel.webview);
        });

        // Listen for connection changes
        this.connectionProvider.addConnectionChangeCallback(() => {
            // Only update if webview is not disposed
            if (!this.disposedWebviews.has(webviewPanel.webview)) {
                this.updateConnectionsList(webviewPanel.webview);
            }
        });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        // External resources (Monaco loader stays on CDN)
        const monacoLoaderUri = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js';

        // Build file paths
        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'sqlEditor', 'sqlEditor.html');
        const stylePath = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'sqlEditor', 'sqlEditor.css');
        const scriptPath = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'sqlEditor', 'sqlEditor.js');

        // Convert to webview URIs for proper loading
        // Add cache buster to force reload
        const cacheBuster = Date.now();
        const styleUri = webview.asWebviewUri(stylePath).toString() + `?v=${cacheBuster}`;
        const scriptUri = webview.asWebviewUri(scriptPath).toString() + `?v=${cacheBuster}`;

        // Read base HTML template
        let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

        // Replace placeholders defined in template
        html = html
            .replace(/{{styleUri}}/g, styleUri)
            .replace(/{{scriptUri}}/g, scriptUri)
            .replace(/{{monacoLoaderUri}}/g, monacoLoaderUri)
            .replace(/{{cspSource}}/g, webview.cspSource);

        return html;
    }

    public forceConnectionUpdate(fileUri: vscode.Uri, connectionId: string, databaseName?: string): void {
        this.outputChannel.appendLine(`[SqlEditorProvider] forceConnectionUpdate called for ${fileUri.fsPath} -> ${connectionId}::${databaseName || 'none'}`);
        this.outputChannel.appendLine(`[SqlEditorProvider] Active webviews: ${this.webviewToDocument.size}, disposed: ${this.disposedWebviews.size}`);
        
        // Find ALL webviews for this file and update their connections
        let webviewsFound = 0;
        const compositeId = databaseName ? `${connectionId}::${databaseName}` : connectionId;
        
        for (const [webview, uri] of this.webviewToDocument.entries()) {
            this.outputChannel.appendLine(`[SqlEditorProvider] Checking webview URI: ${uri.toString()} vs target: ${fileUri.toString()}`);
            if (uri.toString() === fileUri.toString() && !this.disposedWebviews.has(webview)) {
                webviewsFound++;
                
                // Set the preferred connection for this webview
                this.webviewSelectedConnection.set(webview, compositeId);
                
                this.outputChannel.appendLine(`[SqlEditorProvider] Found matching webview #${webviewsFound}, setting connection to: ${compositeId}`);
                
                // Update connections list to reflect the change
                this.updateConnectionsList(webview);
            }
        }
        
        if (webviewsFound > 0) {
            this.outputChannel.appendLine(`[SqlEditorProvider] Forced connection update for ${fileUri.fsPath} to ${compositeId} (updated ${webviewsFound} webviews)`);
        } else {
            this.outputChannel.appendLine(`[SqlEditorProvider] WARNING: No matching webviews found for ${fileUri.toString()}`);
            // List all active webviews for debugging
            for (const [webview, uri] of this.webviewToDocument.entries()) {
                this.outputChannel.appendLine(`[SqlEditorProvider] Available webview: ${uri.toString()} (disposed: ${this.disposedWebviews.has(webview)})`);
            }
        }
    }

    private async updateConnectionsList(webview: vscode.Webview) {
        // Don't send messages to disposed webviews
        if (this.disposedWebviews.has(webview)) {
            this.outputChannel.appendLine(`[SqlEditorProvider] Skipping disposed webview in updateConnectionsList`);
            return;
        }

        const activeConnections = this.connectionProvider.getAllActiveConnections();
        const activeConnectionId = this.connectionProvider.getCurrentConfig()?.id || null;

        // Build connections list with simplified structure
        const connections = activeConnections.map(conn => ({
            id: conn.id,
            name: conn.config.name,
            server: conn.config.server,
            database: conn.config.database,
            connectionType: conn.config.connectionType,
            authType: conn.config.authType
        }));

        // Prefer the webview's last selected connection
        const preserved = this.webviewSelectedConnection.get(webview);
        let currentConnectionIdToSend = activeConnectionId;
        let currentDatabase: string | null = null;

        this.outputChannel.appendLine(`[SqlEditorProvider] updateConnectionsList: preserved=${preserved}, activeConnectionId=${activeConnectionId}`);

        // Parse preserved selection if it's composite
        if (preserved && typeof preserved === 'string' && preserved.includes('::')) {
            const [baseId, dbName] = preserved.split('::');
            currentConnectionIdToSend = baseId;
            currentDatabase = dbName;
            this.outputChannel.appendLine(`[SqlEditorProvider] Using composite preserved connection: ${baseId} -> ${dbName}`);
        } else if (preserved) {
            currentConnectionIdToSend = preserved;
            this.outputChannel.appendLine(`[SqlEditorProvider] Using simple preserved connection: ${preserved}`);
        } else {
            this.outputChannel.appendLine(`[SqlEditorProvider] No preserved connection, using active: ${activeConnectionId}`);
        }

        this.outputChannel.appendLine(`[SqlEditorProvider] Sending connectionsUpdate: currentConnectionId=${currentConnectionIdToSend}, currentDatabase=${currentDatabase}`);

        webview.postMessage({
            type: 'connectionsUpdate',
            connections,
            currentConnectionId: currentConnectionIdToSend,
            currentDatabase: currentDatabase
        });

        // If current connection is a server type, send databases list
        const currentConn = activeConnections.find(c => c.id === currentConnectionIdToSend);
        this.outputChannel.appendLine(`[SqlEditorProvider] Found connection: ${currentConn ? `${currentConn.config.name} (${currentConn.config.connectionType})` : 'none'}`);
        
        if (currentConn && currentConn.config.connectionType === 'server' && currentConnectionIdToSend) {
            this.outputChannel.appendLine(`[SqlEditorProvider] Server connection detected, sending databases list with selectedDatabase=${currentDatabase}`);
            await this.sendDatabasesList(webview, currentConnectionIdToSend, currentDatabase);
        } else if (currentConnectionIdToSend) {
            // For direct database connections, send schema immediately
            this.outputChannel.appendLine(`[SqlEditorProvider] Database connection detected, sending schema directly`);
            const schemaConnectionId = currentDatabase ? `${currentConnectionIdToSend}::${currentDatabase}` : currentConnectionIdToSend;
            await this.sendSchemaUpdate(webview, schemaConnectionId);
        }
    }

    private async sendDatabasesList(webview: vscode.Webview, connectionId: string, selectedDatabase?: string | null) {
        // Don't send messages to disposed webviews
        if (this.disposedWebviews.has(webview)) {
            return;
        }

        this.outputChannel.appendLine(`[SqlEditorProvider] sendDatabasesList called with connectionId=${connectionId}, selectedDatabase=${selectedDatabase}`);

        try {
            const pool = this.connectionProvider.getConnection(connectionId);
            if (!pool) {
                this.outputChannel.appendLine(`[SqlEditorProvider] No pool found for connection ${connectionId}`);
                webview.postMessage({
                    type: 'databasesUpdate',
                    databases: [],
                    currentDatabase: null
                });
                return;
            }

            const dbsResult = await pool.request().query(`SELECT name FROM sys.databases WHERE state = 0 ORDER BY name`);
            const databases = dbsResult.recordset.map((row: any) => row.name);

            this.outputChannel.appendLine(`[SqlEditorProvider] Available databases on server: [${databases.join(', ')}]`);
            this.outputChannel.appendLine(`[SqlEditorProvider] Requested selectedDatabase: ${selectedDatabase}`);

            // Check if the requested database exists on server
            let currentDb = selectedDatabase;
            
            // If no specific database requested, check if we already have one set for this connection
            if (!currentDb) {
                currentDb = this.connectionProvider.getCurrentDatabase(connectionId) || 'master';
            }
            
            if (selectedDatabase && !databases.includes(selectedDatabase)) {
                this.outputChannel.appendLine(`[SqlEditorProvider] WARNING: Database '${selectedDatabase}' from history not found on server!`);
                this.outputChannel.appendLine(`[SqlEditorProvider] Available databases: [${databases.join(', ')}]`);
                // Still use the requested database name so UI shows what was requested
                // currentDb = 'master'; // Don't fallback to master, keep the requested name
            }

            this.outputChannel.appendLine(`[SqlEditorProvider] selectedDatabase=${selectedDatabase}, currentDb=${currentDb}`);
            this.outputChannel.appendLine(`[SqlEditorProvider] Sending ${databases.length} databases, selected: ${currentDb}`);

            // Update current database in connection provider for history tracking
            this.connectionProvider.setCurrentDatabase(connectionId, currentDb);

            webview.postMessage({
                type: 'databasesUpdate',
                databases,
                currentDatabase: currentDb
            });

            // Send schema for the selected database
            if (currentDb) {
                await this.sendSchemaUpdate(webview, `${connectionId}::${currentDb}`);
            }
        } catch (err) {
            this.outputChannel.appendLine(`[SqlEditorProvider] Failed to fetch databases for ${connectionId}: ${err}`);
            webview.postMessage({
                type: 'databasesUpdate',
                databases: ['master'],
                currentDatabase: 'master'
            });
        }
    }

    private async sendSchemaUpdate(webview: vscode.Webview, connectionId?: string) {
        // Don't send messages to disposed webviews
        if (this.disposedWebviews.has(webview)) {
            return;
        }
        
        console.log('[SCHEMA] sendSchemaUpdate called with connectionId:', connectionId);
        
        // connectionId might be composite: '<connId>::<database>'
        let config: any = null;
        let dbName: string | undefined = undefined;
        if (connectionId && typeof connectionId === 'string' && connectionId.includes('::')) {
            const [baseId, db] = connectionId.split('::');
            config = this.connectionProvider.getConnectionConfig(baseId);
            dbName = db;
        } else if (connectionId) {
            config = this.connectionProvider.getConnectionConfig(connectionId);
        } else {
            config = this.connectionProvider.getCurrentConfig();
        }

        console.log('[SCHEMA] Config:', config?.id || 'none', 'dbName:', dbName || '(none)');
        this.outputChannel.appendLine(`[SqlEditorProvider] sendSchemaUpdate called. config:${config?.id || 'none'} db:${dbName || '(none)'} webviewRequestId:${connectionId || 'none'}`);

        if (!config) {
            console.log('[SCHEMA] No config found, returning empty schema');
            return;
        }

        try {
            // Determine connection/pool to use. If a specific database was requested (dbName)
            // obtain a DB-scoped pool from ConnectionProvider. Otherwise use current connection.
            let connection: any = null;
            if (dbName && config) {
                try {
                    this.outputChannel.appendLine(`[SqlEditorProvider] Creating/obtaining DB pool for ${config.id} -> ${dbName}`);
                    connection = await this.connectionProvider.createDbPool(config.id, dbName);
                    this.outputChannel.appendLine(`[SqlEditorProvider] Using DB pool ${config.id}::${dbName} (connected=${connection?.connected})`);
                } catch (err) {
                    this.outputChannel.appendLine(`[SqlEditorProvider] Failed to create DB pool for schema update ${config.id} -> ${dbName}: ${err}`);
                    connection = this.connectionProvider.getConnection(config.id) || this.connectionProvider.getConnection();
                    this.outputChannel.appendLine(`[SqlEditorProvider] Falling back to base connection for schema: ${connection ? 'available' : 'none'}`);
                }
            } else {
                connection = this.connectionProvider.getConnection();
                this.outputChannel.appendLine(`[SqlEditorProvider] Using active/base connection for schema (id=${this.connectionProvider.getCurrentConfig()?.id || 'none'})`);
            }

            if (!connection) {
                console.log('[SCHEMA] No active connection, sending empty schema');
                webview.postMessage({
                    type: 'schemaUpdate',
                    schema: { tables: [], views: [], foreignKeys: [] }
                });
                return;
            }

            console.log('[SCHEMA] Fetching schema from database...');
            
            // Query to get all tables with their columns
            const tablesQuery = `
                SELECT 
                    t.TABLE_SCHEMA as [schema],
                    t.TABLE_NAME as [name],
                    c.COLUMN_NAME as columnName,
                    c.DATA_TYPE as dataType,
                    c.IS_NULLABLE as isNullable,
                    c.CHARACTER_MAXIMUM_LENGTH as maxLength
                FROM INFORMATION_SCHEMA.TABLES t
                INNER JOIN INFORMATION_SCHEMA.COLUMNS c 
                    ON t.TABLE_SCHEMA = c.TABLE_SCHEMA 
                    AND t.TABLE_NAME = c.TABLE_NAME
                WHERE t.TABLE_TYPE = 'BASE TABLE'
                ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME, c.ORDINAL_POSITION
            `;

            // Query to get foreign key relationships
            const foreignKeysQuery = `
                SELECT 
                    fk.name as constraintName,
                    OBJECT_SCHEMA_NAME(fk.parent_object_id) as fromSchema,
                    OBJECT_NAME(fk.parent_object_id) as fromTable,
                    COL_NAME(fkc.parent_object_id, fkc.parent_column_id) as fromColumn,
                    OBJECT_SCHEMA_NAME(fk.referenced_object_id) as toSchema,
                    OBJECT_NAME(fk.referenced_object_id) as toTable,
                    COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) as toColumn
                FROM sys.foreign_keys fk
                INNER JOIN sys.foreign_key_columns fkc 
                    ON fk.object_id = fkc.constraint_object_id
                ORDER BY fromSchema, fromTable, toSchema, toTable
            `;

            const [tablesResult, fkResult] = await Promise.all([
                connection.request().query(tablesQuery),
                connection.request().query(foreignKeysQuery)
            ]);
            
            console.log('[SCHEMA] Tables query returned:', tablesResult.recordset?.length || 0, 'rows');
            console.log('[SCHEMA] FK query returned:', fkResult.recordset?.length || 0, 'foreign keys');
            
            // Group columns by table
            const tablesMap = new Map<string, any>();
            
            for (const row of tablesResult.recordset) {
                const tableKey = `${row.schema}.${row.name}`;
                
                if (!tablesMap.has(tableKey)) {
                    tablesMap.set(tableKey, {
                        schema: row.schema,
                        name: row.name,
                        columns: []
                    });
                }
                
                const table = tablesMap.get(tableKey);
                table.columns.push({
                    name: row.columnName,
                    type: row.dataType,
                    nullable: row.isNullable === 'YES',
                    maxLength: row.maxLength
                });
            }
            
            const tables = Array.from(tablesMap.values());
            console.log('[SCHEMA] Parsed', tables.length, 'tables');
            
            // Parse foreign keys
            const foreignKeys = fkResult.recordset.map((row: any) => ({
                constraintName: row.constraintName,
                fromSchema: row.fromSchema,
                fromTable: row.fromTable,
                fromColumn: row.fromColumn,
                toSchema: row.toSchema,
                toTable: row.toTable,
                toColumn: row.toColumn
            }));
            
            console.log('[SCHEMA] Parsed', foreignKeys.length, 'foreign keys');
            if (foreignKeys.length > 0) {
                console.log('[SCHEMA] Sample FK:', foreignKeys[0]);
            }
            
            const schema = {
                tables: tables,
                views: [], // TODO: Implement views
                foreignKeys: foreignKeys
            };
            
            console.log('[SCHEMA] Sending schema update with', schema.tables.length, 'tables and', schema.foreignKeys.length, 'foreign keys');
            
            webview.postMessage({
                type: 'schemaUpdate',
                schema: schema
            });
        } catch (error) {
            console.error('[SCHEMA] Failed to get schema:', error);
            webview.postMessage({
                type: 'schemaUpdate',
                schema: { tables: [], views: [], foreignKeys: [] }
            });
        }
    }

    private async executeQuery(query: string, connectionId: string | null, webview: vscode.Webview, includeActualPlan: boolean = false) {
        if (!query || query.trim().length === 0) {
            webview.postMessage({
                type: 'error',
                error: 'Query is empty',
                messages: [{ type: 'error', text: 'Query is empty' }]
            });
            return;
        }

        // Resolve connection/config and (when needed) create a DB-scoped pool.
        let config: any = null;
        let poolToUse: any = null;

        if (connectionId && typeof connectionId === 'string' && connectionId.includes('::')) {
            const [baseId, dbName] = connectionId.split('::');
            config = this.connectionProvider.getConnectionConfig(baseId);
            try {
                poolToUse = await this.connectionProvider.createDbPool(baseId, dbName);
            } catch (err) {
                this.outputChannel.appendLine(`[SqlEditorProvider] Failed to create DB pool for execution ${baseId} -> ${dbName}: ${err}`);
                // Fallback to the base connection if possible
                poolToUse = this.connectionProvider.getConnection(baseId) || this.connectionProvider.getConnection();
            }
        } else if (connectionId) {
            config = this.connectionProvider.getConnectionConfig(connectionId);
            poolToUse = this.connectionProvider.getConnection(connectionId) || this.connectionProvider.getConnection();
        } else {
            config = this.connectionProvider.getCurrentConfig();
            poolToUse = this.connectionProvider.getConnection();
        }

        if (!config) {
            webview.postMessage({
                type: 'error',
                error: 'No active connection',
                messages: [{ type: 'error', text: 'Please connect to a database first' }]
            });
            return;
        }

        // Notify webview that query is executing
        webview.postMessage({
            type: 'executing'
        });

        try {
            const startTime = Date.now();
            this.outputChannel.appendLine(`[SqlEditorProvider] Executing query. config:${config?.id || 'none'} pool:${poolToUse ? (poolToUse?.connected ? 'connected' : 'not-connected') : 'none'} db:${connectionId?.includes('::') ? connectionId.split('::')[1] : (config?.database || 'unknown')}`);
            
            // If actual plan is requested, enable statistics XML
            let finalQuery = query;
            if (includeActualPlan) {
                finalQuery = `SET STATISTICS XML ON;\n${query}\nSET STATISTICS XML OFF;`;
            }
            
            const result = await this.queryExecutor.executeQuery(finalQuery, poolToUse);
            const executionTime = Date.now() - startTime;

            // Check if we have an execution plan in the result
            let planXml = null;
            let resultSets = result.recordsets || [];
            
            if (includeActualPlan && result.recordsets) {
                console.log('[SQL Editor] Checking for execution plan in', result.recordsets.length, 'result sets');
                // Look for the XML plan in the result sets
                for (let i = 0; i < result.recordsets.length; i++) {
                    const rs = result.recordsets[i];
                    console.log('[SQL Editor] Result set', i, 'columns:', rs.length > 0 ? Object.keys(rs[0]) : 'empty');
                    if (rs.length > 0 && rs[0]['Microsoft SQL Server 2005 XML Showplan']) {
                        planXml = rs[0]['Microsoft SQL Server 2005 XML Showplan'];
                        console.log('[SQL Editor] Found execution plan XML, length:', planXml.length);
                        // Remove plan result set from results
                        resultSets = result.recordsets.filter((_, index) => index !== i);
                        break;
                    }
                }
                console.log('[SQL Editor] Final planXml:', planXml ? 'present' : 'null');
            }

            // Build informational messages
            const messages = [];
            
            if (resultSets.length > 0) {
                const totalRows = resultSets.reduce((sum, rs) => sum + rs.length, 0);
                messages.push({
                    type: 'info',
                    text: `Query completed successfully. Returned ${resultSets.length} result set(s) with ${totalRows} total row(s).`
                });
                
                // Add details for each result set
                resultSets.forEach((rs, index) => {
                    messages.push({
                        type: 'info',
                        text: `Result Set ${index + 1}: ${rs.length} row(s)`
                    });
                });
            } else if (result.rowsAffected && result.rowsAffected.length > 0) {
                const totalAffected = result.rowsAffected.reduce((sum, count) => sum + count, 0);
                messages.push({
                    type: 'info',
                    text: `Query completed successfully. ${totalAffected} row(s) affected.`
                });
            } else {
                messages.push({
                    type: 'info',
                    text: 'Query completed successfully.'
                });
            }
            
            messages.push({
                type: 'info',
                text: `Execution time: ${executionTime}ms`
            });
            
            if (planXml) {
                messages.push({
                    type: 'info',
                    text: 'Execution plan included'
                });
            }
            
            // Always send as 'results' type, include planXml when present
            webview.postMessage({
                type: 'results',
                resultSets: resultSets,
                executionTime: executionTime,
                rowsAffected: result.rowsAffected?.[0] || 0,
                messages: messages,
                planXml: planXml,
                metadata: result.metadata || [], // Include metadata for editability
                originalQuery: query // Store original query for UPDATE generation
            });
        } catch (error: any) {
            webview.postMessage({
                type: 'error',
                error: error.message || 'Query execution failed',
                messages: [{ type: 'error', text: error.message || 'Query execution failed' }]
            });
        }
    }

    private async executeEstimatedPlan(query: string, connectionId: string | null, webview: vscode.Webview) {
        if (!query || query.trim().length === 0) {
            webview.postMessage({
                type: 'error',
                error: 'Query is empty',
                messages: [{ type: 'error', text: 'Query is empty' }]
            });
            return;
        }

        // Resolve connection/config and (when needed) create a DB-scoped pool.
        let config: any = null;
        let poolToUse: any = null;

        if (connectionId && typeof connectionId === 'string' && connectionId.includes('::')) {
            const [baseId, dbName] = connectionId.split('::');
            config = this.connectionProvider.getConnectionConfig(baseId);
            try {
                poolToUse = await this.connectionProvider.createDbPool(baseId, dbName);
            } catch (err) {
                this.outputChannel.appendLine(`[SqlEditorProvider] Failed to create DB pool for estimated plan ${baseId} -> ${dbName}: ${err}`);
                // Fallback to the base connection if possible
                poolToUse = this.connectionProvider.getConnection(baseId) || this.connectionProvider.getConnection();
            }
        } else if (connectionId) {
            config = this.connectionProvider.getConnectionConfig(connectionId);
            poolToUse = this.connectionProvider.getConnection(connectionId) || this.connectionProvider.getConnection();
        } else {
            config = this.connectionProvider.getCurrentConfig();
            poolToUse = this.connectionProvider.getConnection();
        }

        if (!config) {
            webview.postMessage({
                type: 'error',
                error: 'No active connection',
                messages: [{ type: 'error', text: 'Please connect to a database first' }]
            });
            return;
        }

        // Notify webview that query is executing
        webview.postMessage({
            type: 'executing'
        });

        try {
            const startTime = Date.now();
            
            // Enable SHOWPLAN_XML to get estimated plan without executing
            const planQuery = `SET SHOWPLAN_XML ON;\n${query}\nSET SHOWPLAN_XML OFF;`;
            
            const result = await this.queryExecutor.executeQuery(planQuery, poolToUse);
            const executionTime = Date.now() - startTime;

            // Extract the XML plan from result
            let planXml = null;
            if (result.recordsets && result.recordsets.length > 0) {
                const planResultSet = result.recordsets[0];
                if (planResultSet.length > 0 && planResultSet[0]['Microsoft SQL Server 2005 XML Showplan']) {
                    planXml = planResultSet[0]['Microsoft SQL Server 2005 XML Showplan'];
                }
            }
            
            if (planXml) {
                webview.postMessage({
                    type: 'queryPlan',
                    planXml: planXml,
                    executionTime: executionTime,
                    messages: [
                        { type: 'info', text: 'Estimated execution plan generated successfully.' },
                        { type: 'info', text: `Generation time: ${executionTime}ms` }
                    ]
                });
            } else {
                webview.postMessage({
                    type: 'error',
                    error: 'Failed to retrieve execution plan',
                    messages: [{ type: 'error', text: 'Failed to retrieve execution plan from server' }]
                });
            }
        } catch (error: any) {
            webview.postMessage({
                type: 'error',
                error: error.message || 'Plan generation failed',
                messages: [{ type: 'error', text: error.message || 'Plan generation failed' }]
            });
        }
    }

    private async openContentInNewEditor(content: string, language: string) {
        try {
            // Create a new untitled document with the specified language
            const doc = await vscode.workspace.openTextDocument({
                content: content,
                language: language
            });

            // Show the document in a new editor
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preview: false
            });
        } catch (error) {
            this.outputChannel.appendLine(`Failed to open content in new editor: ${error}`);
        }
    }

    private async saveFileToDisk(content: string, defaultFileName: string, fileType: string, encoding?: string) {
        try {
            // Get file extension from filename or determine from file type
            let fileExtension = '';
            if (defaultFileName.includes('.')) {
                fileExtension = defaultFileName.split('.').pop() || '';
            } else {
                // Determine extension from file type
                switch (fileType.toLowerCase()) {
                    case 'json': fileExtension = 'json'; break;
                    case 'csv': fileExtension = 'csv'; break;
                    case 'excel': fileExtension = 'xlsx'; break;
                    case 'markdown': fileExtension = 'md'; break;
                    case 'xml': fileExtension = 'xml'; break;
                    case 'html': fileExtension = 'html'; break;
                    default: fileExtension = 'txt';
                }
            }

            // Show save dialog
            const filters: { [name: string]: string[] } = {};
            switch (fileType.toLowerCase()) {
                case 'json':
                    filters['JSON Files'] = ['json'];
                    break;
                case 'csv':
                    filters['CSV Files'] = ['csv'];
                    break;
                case 'excel':
                    filters['Excel Files'] = ['xlsx', 'xls'];
                    filters['CSV Files (Excel Compatible)'] = ['csv'];
                    break;
                case 'markdown':
                    filters['Markdown Files'] = ['md'];
                    break;
                case 'xml':
                    filters['XML Files'] = ['xml'];
                    break;
                case 'html':
                    filters['HTML Files'] = ['html', 'htm'];
                    break;
            }
            filters['All Files'] = ['*'];

            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(defaultFileName),
                filters: filters
            });

            if (uri) {
                // Write the file with appropriate encoding
                const buffer = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
                await vscode.workspace.fs.writeFile(uri, buffer);
                
                // Show success message with Open action
                const action = await vscode.window.showInformationMessage(
                    `${fileType} file saved to ${uri.fsPath}`,
                    'Open'
                );
                
                if (action === 'Open') {
                    // Open the file in VS Code
                    await vscode.commands.executeCommand('vscode.open', uri);
                }
                
                this.outputChannel.appendLine(`[Export] ${fileType} file saved to: ${uri.fsPath}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to save ${fileType} file: ${errorMessage}`);
            this.outputChannel.appendLine(`[Export] Failed to save ${fileType} file: ${errorMessage}`);
        }
    }

    private async commitChanges(statements: string[], connectionId: string | null, originalQuery: string, webview: vscode.Webview) {
        this.outputChannel.appendLine(`[SqlEditorProvider] Committing ${statements.length} changes...`);

        // Resolve connection pool
        let poolToUse: any = null;
        if (connectionId && typeof connectionId === 'string' && connectionId.includes('::')) {
            const [baseId, dbName] = connectionId.split('::');
            try {
                poolToUse = await this.connectionProvider.createDbPool(baseId, dbName);
            } catch (err) {
                this.outputChannel.appendLine(`[SqlEditorProvider] Failed to create DB pool for commit: ${err}`);
                webview.postMessage({
                    type: 'error',
                    error: 'Failed to connect to database',
                    messages: [{ type: 'error', text: 'Failed to connect to database for committing changes' }]
                });
                return;
            }
        } else if (connectionId) {
            poolToUse = this.connectionProvider.getConnection(connectionId) || this.connectionProvider.getConnection();
        } else {
            poolToUse = this.connectionProvider.getConnection();
        }

        if (!poolToUse) {
            webview.postMessage({
                type: 'error',
                error: 'No active connection',
                messages: [{ type: 'error', text: 'Please connect to a database first' }]
            });
            return;
        }

        try {
            // Execute all UPDATE statements in a transaction
            const transactionSql = `
BEGIN TRANSACTION;

${statements.join('\n')}

COMMIT TRANSACTION;
            `.trim();

            this.outputChannel.appendLine(`[SqlEditorProvider] Executing transaction:\n${transactionSql}`);

            const result = await this.queryExecutor.executeQuery(transactionSql, poolToUse);
            
            this.outputChannel.appendLine(`[SqlEditorProvider] Transaction completed successfully`);

            // Send success message
            webview.postMessage({
                type: 'commitSuccess',
                message: `Successfully committed ${statements.length} change(s)`,
                messages: [
                    { type: 'info', text: `Successfully committed ${statements.length} change(s) to the database` }
                ]
            });

            // Auto-refresh by re-executing the original query
            if (originalQuery) {
                this.outputChannel.appendLine(`[SqlEditorProvider] Re-executing original query to refresh results`);
                await this.executeQuery(originalQuery, connectionId, webview, false);
            }

        } catch (error: any) {
            this.outputChannel.appendLine(`[SqlEditorProvider] Transaction failed: ${error}`);
            
            // Send error message
            webview.postMessage({
                type: 'error',
                error: `Failed to commit changes: ${error.message}`,
                messages: [
                    { type: 'error', text: `Transaction rolled back: ${error.message}` },
                    { type: 'info', text: 'No changes were saved to the database' }
                ]
            });
        }
    }
}
