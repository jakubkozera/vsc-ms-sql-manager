import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { QueryExecutor } from './queryExecutor';
import { ConnectionProvider } from './connectionProvider';

export class SqlEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'mssqlManager.sqlEditor';
    private disposedWebviews: Set<vscode.Webview> = new Set();
    // Track the last selected connection id per webview so we can preserve selection
    private webviewSelectedConnection = new Map<vscode.Webview, string | null>();
    // Track webview to document URI mapping for connection updates
    private webviewToDocument = new Map<vscode.Webview, vscode.Uri>();
    // SQL snippets cache
    private sqlSnippets: any[] = [];

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly queryExecutor: QueryExecutor,
        private readonly connectionProvider: ConnectionProvider,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.loadSqlSnippets();
        this.setupSnippetsWatcher();
    }

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
                    
                    // Note: Auto-execute is now controlled by the newQuery command via triggerAutoExecute()
                    // to give explicit control over when queries execute
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

                case 'getSnippets':
                    webviewPanel.webview.postMessage({
                        type: 'snippetsUpdate',
                        snippets: this.sqlSnippets
                    });
                    break;

                case 'createSnippet':
                    await this.createSnippetFromSelection(message.name, message.prefix, message.body, message.description);
                    break;
                    
                case 'requestSnippetInput':
                    await this.handleSnippetInputRequest(webviewPanel.webview, message.selectedText);
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
    private loadSqlSnippets(): void {
        try {
            const snippetsPaths = this.getSnippetsPaths();
            this.sqlSnippets = [];

            this.outputChannel.appendLine(`[SqlEditorProvider] Searching for SQL snippets in ${snippetsPaths.length} paths:`);
            snippetsPaths.forEach(path => this.outputChannel.appendLine(`  - ${path}`));

            for (const snippetsPath of snippetsPaths) {
                if (fs.existsSync(snippetsPath)) {
                    try {
                        this.outputChannel.appendLine(`[SqlEditorProvider] Reading snippets file: ${snippetsPath}`);
                        const content = fs.readFileSync(snippetsPath, 'utf8');
                        
                        if (!content.trim()) {
                            this.outputChannel.appendLine(`[SqlEditorProvider] Snippets file is empty: ${snippetsPath}`);
                            continue;
                        }
                        
                        // Remove comments from JSON (VS Code snippets can have comments)
                        const cleanContent = this.removeJsonComments(content);
                        const snippetsData = JSON.parse(cleanContent);
                        
                        let loadedCount = 0;
                        
                        // Convert VS Code snippets format to our format
                        for (const [name, snippet] of Object.entries(snippetsData as any)) {
                            if (snippet && typeof snippet === 'object') {
                                const snippetObj = {
                                    name: name,
                                    prefix: (snippet as any).prefix || name,
                                    body: Array.isArray((snippet as any).body) ? 
                                        (snippet as any).body.join('\n') : 
                                        (snippet as any).body || '',
                                    description: (snippet as any).description || name
                                };
                                
                                this.sqlSnippets.push(snippetObj);
                                loadedCount++;
                                
                                // Log first few snippets for debugging
                                if (loadedCount <= 3) {
                                    this.outputChannel.appendLine(`[SqlEditorProvider] Loaded snippet: "${snippetObj.prefix}" -> "${snippetObj.name}"`);
                                }
                            }
                        }
                        
                        this.outputChannel.appendLine(`[SqlEditorProvider] Loaded ${loadedCount} snippets from ${snippetsPath}`);
                    } catch (parseError) {
                        this.outputChannel.appendLine(`[SqlEditorProvider] Failed to parse snippets from ${snippetsPath}: ${parseError}`);
                    }
                } else {
                    this.outputChannel.appendLine(`[SqlEditorProvider] Snippets file not found: ${snippetsPath}`);
                }
            }

            this.outputChannel.appendLine(`[SqlEditorProvider] Total SQL snippets loaded: ${this.sqlSnippets.length}`);
            if (this.sqlSnippets.length > 0) {
                this.outputChannel.appendLine(`[SqlEditorProvider] Sample snippets loaded: ${this.sqlSnippets.slice(0, 5).map(s => s.prefix).join(', ')}`);
            }
        } catch (error) {
            this.outputChannel.appendLine(`[SqlEditorProvider] Error loading SQL snippets: ${error}`);
        }
    }

    private getSnippetsPaths(): string[] {
        const paths: string[] = [];
        
        // User snippets path
        const userDataPath = process.env.APPDATA || process.env.HOME;
        if (userDataPath) {
            // VS Code
            paths.push(path.join(userDataPath, 'Code', 'User', 'snippets', 'sql.json'));
            // VS Code Insiders
            paths.push(path.join(userDataPath, 'Code - Insiders', 'User', 'snippets', 'sql.json'));
        }

        // Workspace snippets - prioritize extension's own workspace
        const extensionPath = this.context.extensionUri.fsPath;
        paths.push(path.join(extensionPath, '.vscode', 'sql.json'));

        // Also check other workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                const workspacePath = path.join(folder.uri.fsPath, '.vscode', 'sql.json');
                // Avoid duplicates
                if (!paths.includes(workspacePath)) {
                    paths.push(workspacePath);
                }
            }
        }

        return paths;
    }

    private removeJsonComments(content: string): string {
        // Remove single line comments (//)
        content = content.replace(/\/\/.*$/gm, '');
        // Remove multi-line comments (/* */)
        content = content.replace(/\/\*[\s\S]*?\*\//g, '');
        return content;
    }

    private setupSnippetsWatcher(): void {
        try {
            const paths = this.getSnippetsPaths();
            
            paths.forEach(snippetsPath => {
                if (fs.existsSync(snippetsPath)) {
                    // Watch for changes to snippets files
                    const watcher = fs.watch(snippetsPath, (eventType) => {
                        if (eventType === 'change') {
                            this.outputChannel.appendLine(`[SqlEditorProvider] Snippets file changed: ${snippetsPath}`);
                            this.refreshSnippets();
                        }
                    });
                    
                    // Clean up watcher on extension deactivation
                    this.context.subscriptions.push({
                        dispose: () => watcher.close()
                    });
                }
            });
        } catch (error) {
            this.outputChannel.appendLine(`[SqlEditorProvider] Failed to setup snippets watcher: ${error}`);
        }
    }

    public refreshSnippets(): void {
        this.outputChannel.appendLine(`[SqlEditorProvider] Refreshing SQL snippets...`);
        this.loadSqlSnippets();
        
        // Notify all active webviews about updated snippets
        for (const [webview, _] of this.webviewToDocument) {
            if (!this.disposedWebviews.has(webview)) {
                webview.postMessage({
                    type: 'snippetsUpdate',
                    snippets: this.sqlSnippets
                });
            }
        }
    }

    private async createSnippetFromSelection(name: string, prefix: string, body: string, description?: string): Promise<void> {
        try {
            this.outputChannel.appendLine(`[SqlEditorProvider] Creating snippet: ${name} (${prefix})`);
            
            // Determine the best snippets file to use (prefer user snippets)
            let targetPath: string;
            const userDataPath = process.env.APPDATA || process.env.HOME;
            
            if (userDataPath) {
                // Check if VS Code Insiders is running
                const isInsiders = vscode.env.appName.includes('Insiders');
                targetPath = path.join(
                    userDataPath,
                    isInsiders ? 'Code - Insiders' : 'Code',
                    'User',
                    'snippets',
                    'sql.json'
                );
            } else {
                // Fallback to workspace snippets
                targetPath = path.join(this.context.extensionUri.fsPath, '.vscode', 'sql.json');
            }

            this.outputChannel.appendLine(`[SqlEditorProvider] Target snippets file: ${targetPath}`);

            // Ensure directory exists
            const dir = path.dirname(targetPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                this.outputChannel.appendLine(`[SqlEditorProvider] Created directory: ${dir}`);
            }

            // Read existing snippets or create empty object
            let snippets: any = {};
            if (fs.existsSync(targetPath)) {
                try {
                    const content = fs.readFileSync(targetPath, 'utf8');
                    const cleanContent = this.removeJsonComments(content);
                    snippets = JSON.parse(cleanContent);
                    this.outputChannel.appendLine(`[SqlEditorProvider] Loaded existing snippets from ${targetPath}`);
                } catch (parseError) {
                    this.outputChannel.appendLine(`[SqlEditorProvider] Error parsing existing snippets: ${parseError}`);
                    snippets = {};
                }
            }

            // Add new snippet
            snippets[name] = {
                prefix: prefix,
                body: body.split('\n'),
                description: description || `Custom SQL snippet: ${name}`
            };

            // Write back to file with pretty formatting
            const jsonContent = JSON.stringify(snippets, null, 4);
            fs.writeFileSync(targetPath, jsonContent, 'utf8');
            
            this.outputChannel.appendLine(`[SqlEditorProvider] Snippet '${name}' saved successfully to ${targetPath}`);
            
            // Show success message
            vscode.window.showInformationMessage(`Snippet '${name}' created successfully!`);
            
            // Refresh snippets to include the new one
            this.refreshSnippets();
            
        } catch (error) {
            this.outputChannel.appendLine(`[SqlEditorProvider] Error creating snippet: ${error}`);
            vscode.window.showErrorMessage(`Failed to create snippet: ${error}`);
        }
    }

    private async handleSnippetInputRequest(webview: vscode.Webview, selectedText: string): Promise<void> {
        try {
            this.outputChannel.appendLine(`[SqlEditorProvider] Handling snippet input request for ${selectedText.length} characters`);
            
            // Get snippet name from user
            const name = await vscode.window.showInputBox({
                prompt: 'Enter a name for the snippet',
                placeHolder: 'My SQL Snippet',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Snippet name cannot be empty';
                    }
                    if (value.length > 50) {
                        return 'Snippet name too long (max 50 characters)';
                    }
                    return null;
                }
            });
            
            if (!name) {
                webview.postMessage({
                    type: 'snippetInputReceived',
                    success: false
                });
                return;
            }
            
            // Get snippet prefix from user
            const prefix = await vscode.window.showInputBox({
                prompt: 'Enter a prefix/trigger for the snippet',
                placeHolder: 'mysnippet',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Snippet prefix cannot be empty';
                    }
                    if (value.includes(' ')) {
                        return 'Snippet prefix cannot contain spaces';
                    }
                    if (value.length > 20) {
                        return 'Snippet prefix too long (max 20 characters)';
                    }
                    return null;
                }
            });
            
            if (!prefix) {
                webview.postMessage({
                    type: 'snippetInputReceived',
                    success: false
                });
                return;
            }
            
            // Optionally get description
            const description = await vscode.window.showInputBox({
                prompt: 'Enter a description for the snippet (optional)',
                placeHolder: 'Custom SQL snippet'
            });
            
            // Send back to webview
            webview.postMessage({
                type: 'snippetInputReceived',
                success: true,
                name: name.trim(),
                prefix: prefix.trim(),
                body: selectedText,
                description: description?.trim() || `Custom SQL snippet: ${name.trim()}`
            });
            
        } catch (error) {
            this.outputChannel.appendLine(`[SqlEditorProvider] Error handling snippet input: ${error}`);
            webview.postMessage({
                type: 'snippetInputReceived',
                success: false
            });
        }
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

    /**
     * Insert text into SQL editor webview
     */
    public insertTextToEditor(fileUri: vscode.Uri, text: string): boolean {
        this.outputChannel.appendLine(`[SqlEditorProvider] insertTextToEditor called for ${fileUri.fsPath}`);
        
        // Find the webview for this file
        for (const [webview, uri] of this.webviewToDocument.entries()) {
            if (uri.toString() === fileUri.toString() && !this.disposedWebviews.has(webview)) {
                this.outputChannel.appendLine(`[SqlEditorProvider] Found matching webview, inserting text`);
                
                // Send update message to webview
                webview.postMessage({
                    type: 'update',
                    content: text
                });
                
                return true;
            }
        }
        
        this.outputChannel.appendLine(`[SqlEditorProvider] WARNING: No matching webview found for ${fileUri.toString()}`);
        return false;
    }

    /**
     * Trigger auto-execute for SQL editor
     */
    public triggerAutoExecute(fileUri: vscode.Uri): boolean {
        this.outputChannel.appendLine(`[SqlEditorProvider] triggerAutoExecute called for ${fileUri.fsPath}`);
        
        // Find the webview for this file
        for (const [webview, uri] of this.webviewToDocument.entries()) {
            if (uri.toString() === fileUri.toString() && !this.disposedWebviews.has(webview)) {
                this.outputChannel.appendLine(`[SqlEditorProvider] Found matching webview, triggering auto-execute`);
                
                // Send autoExecuteQuery message to webview
                webview.postMessage({
                    type: 'autoExecuteQuery'
                });
                
                return true;
            }
        }
        
        this.outputChannel.appendLine(`[SqlEditorProvider] WARNING: No matching webview found for ${fileUri.toString()}`);
        return false;
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
