import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConnectionProvider } from './connectionProvider';
import { SchemaCache } from './utils/schemaCache';

export class DatabaseDiagramWebview {
    private panel: vscode.WebviewPanel | undefined;
    private connectionProvider: ConnectionProvider;
    private outputChannel: vscode.OutputChannel;
    private context: vscode.ExtensionContext;
    private schemaCache: SchemaCache;

    constructor(connectionProvider: ConnectionProvider, outputChannel: vscode.OutputChannel, context: vscode.ExtensionContext) {
        this.connectionProvider = connectionProvider;
        this.outputChannel = outputChannel;
        this.context = context;
        this.schemaCache = SchemaCache.getInstance(context);
    }

    async show(connectionId: string, database: string) {
        this.outputChannel.appendLine(`[DatabaseDiagram] Opening diagram for database: ${database}`);

        // Get webview resource paths
        const webviewPath = path.join(this.context.extensionPath, 'webview', 'databaseDiagram');

        // Create webview panel
        this.panel = vscode.window.createWebviewPanel(
            'databaseDiagram',
            `Database Diagram - ${database}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(webviewPath)]
            }
        );

        // Load database schema
        const schema = await this.loadDatabaseSchema(connectionId, database);

        // Set HTML content
        this.panel.webview.html = this.getWebviewContent(database, schema);

        // Set panel icon (light/dark)
        try {
            const lightIcon = path.join(this.context.extensionPath, 'resources', 'icons', 'database-diagram-icon.svg');
            const darkIcon = path.join(this.context.extensionPath, 'resources', 'icons', 'database-diagram-icon-dark.svg');

            const setIcon = (kind: vscode.ColorThemeKind) => {
                try {
                    if (kind === vscode.ColorThemeKind.Light) {
                        this.panel!.iconPath = vscode.Uri.file(lightIcon);
                    } else {
                        this.panel!.iconPath = vscode.Uri.file(darkIcon);
                    }
                } catch (e) {}
            };

            setIcon(vscode.window.activeColorTheme.kind);
            const themeDisposable = vscode.window.onDidChangeActiveColorTheme(e => setIcon(e.kind));
            this.context.subscriptions.push(themeDisposable);
        } catch (e) {
            // ignore
        }

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showInformationMessage(message.text);
                        break;
                    case 'exportDiagram':
                        await this.handleExport(message.format, message.data, message.defaultFilename);
                        break;
                    case 'error':
                        vscode.window.showErrorMessage(message.message);
                        break;
                }
            },
            undefined
        );

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }

    private async handleExport(format: 'svg' | 'png', data: string, defaultFilename: string) {
        try {
            this.outputChannel.appendLine(`[DatabaseDiagram] Handling ${format.toUpperCase()} export...`);
            
            // Show save dialog
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(defaultFilename),
                filters: format === 'svg' 
                    ? { 'SVG Files': ['svg'] }
                    : { 'PNG Files': ['png'] }
            });

            if (!uri) {
                this.outputChannel.appendLine('[DatabaseDiagram] Export cancelled by user');
                return;
            }

            this.outputChannel.appendLine(`[DatabaseDiagram] Saving to: ${uri.fsPath}`);

            // Convert data to buffer
            let buffer: Buffer;
            if (format === 'svg') {
                // SVG is already a string
                buffer = Buffer.from(data, 'utf8');
            } else {
                // PNG is base64 encoded
                buffer = Buffer.from(data, 'base64');
            }

            // Write file
            await vscode.workspace.fs.writeFile(uri, buffer);

            this.outputChannel.appendLine(`[DatabaseDiagram] Export successful: ${uri.fsPath}`);
            
            // Show information message with "Open File" button
            const action = await vscode.window.showInformationMessage(
                `Diagram exported successfully to ${path.basename(uri.fsPath)}`,
                'Open File'
            );

            if (action === 'Open File') {
                await vscode.commands.executeCommand('vscode.open', uri);
            }
        } catch (error) {
            this.outputChannel.appendLine(`[DatabaseDiagram] Export failed: ${error}`);
            vscode.window.showErrorMessage(`Failed to export diagram: ${error}`);
        }
    }

    private async loadDatabaseSchema(connectionId: string, database: string): Promise<any> {
        try {
            this.outputChannel.appendLine(`[DatabaseDiagram] Loading schema for database: ${database}`);
            
            // Create a pool specifically for this database context
            const pool = await this.connectionProvider.createDbPool(connectionId, database);
            if (!pool) {
                throw new Error('Connection not found or failed to create database pool');
            }

            this.outputChannel.appendLine(`[DatabaseDiagram] Database pool created successfully for ${database}`);

            // Get connection info for SchemaCache
            const connectionConfig = this.connectionProvider.getConnectionConfig(connectionId);
            if (!connectionConfig) {
                throw new Error('Connection config not found');
            }

            const connectionInfo = {
                server: connectionConfig.server || '',
                database: database
            };

            this.outputChannel.appendLine(`[DatabaseDiagram] Fetching schema from cache...`);

            // Get all tables from cache
            const tables = await this.schemaCache.getTables(connectionInfo, pool);
            this.outputChannel.appendLine(`[DatabaseDiagram] Got ${tables.length} tables from cache`);

            // Get all foreign keys from cache
            const foreignKeys = await this.schemaCache.getAllForeignKeys(connectionInfo, pool);
            this.outputChannel.appendLine(`[DatabaseDiagram] Got ${foreignKeys.length} foreign keys from cache`);

            // Transform data into structure for diagram
            const diagramTables: any[] = [];
            const tableMap = new Map();

            for (const table of tables) {
                const tableKey = `${table.schema}.${table.name}`;
                
                // Get columns for this table from cache
                const columns = await this.schemaCache.getTableColumns(connectionInfo, pool, table.schema, table.name);
                
                const diagramTable = {
                    schema: table.schema,
                    name: table.name,
                    columns: columns.map(col => ({
                        name: col.columnName,
                        type: col.dataType + (col.maxLength && col.maxLength !== -1 ? `(${col.maxLength})` : ''),
                        nullable: col.isNullable,
                        isPrimaryKey: col.isPrimaryKey
                    }))
                };
                
                diagramTables.push(diagramTable);
                tableMap.set(tableKey, diagramTable);
            }

            // Transform foreign keys into relationships
            const relationships = foreignKeys.map((fk: any) => ({
                from: `${fk.tableSchema}.${fk.tableName}`,
                to: `${fk.referencedTableSchema}.${fk.referencedTableName}`,
                fromColumn: fk.columns?.[0] || '',
                toColumn: fk.referencedColumns?.[0] || '',
                name: fk.constraintName
            }));

            this.outputChannel.appendLine(`[DatabaseDiagram] Processed ${diagramTables.length} tables and ${relationships.length} relationships`);
            
            if (diagramTables.length === 0) {
                this.outputChannel.appendLine(`[DatabaseDiagram] WARNING: No tables found!`);
            } else {
                this.outputChannel.appendLine(`[DatabaseDiagram] First table: ${diagramTables[0]?.schema}.${diagramTables[0]?.name} with ${diagramTables[0]?.columns?.length} columns`);
            }

            // Close the database-specific pool
            try {
                await pool.close();
                this.outputChannel.appendLine(`[DatabaseDiagram] Database pool closed`);
            } catch (closeError) {
                this.outputChannel.appendLine(`[DatabaseDiagram] Warning: Failed to close pool: ${closeError}`);
            }

            return { tables: diagramTables, relationships };

        } catch (error: any) {
            this.outputChannel.appendLine(`[DatabaseDiagram] Error loading schema: ${error.message}`);
            this.outputChannel.appendLine(`[DatabaseDiagram] Error stack: ${error.stack}`);
            vscode.window.showErrorMessage(`Failed to load database schema: ${error.message}`);
            return { tables: [], relationships: [] };
        }
    }

    private getWebviewContent(database: string, schema: any): string {
        this.outputChannel.appendLine(`[DatabaseDiagram] Rendering diagram with ${schema.tables?.length || 0} tables and ${schema.relationships?.length || 0} relationships`);
        
        const tablesJson = JSON.stringify(schema.tables);
        const relationshipsJson = JSON.stringify(schema.relationships);

        // Get URIs for webview resources
        const webviewPath = path.join(this.context.extensionPath, 'webview', 'databaseDiagram');
        const htmlPath = path.join(webviewPath, 'databaseDiagram.html');
        const cssUri = this.panel!.webview.asWebviewUri(vscode.Uri.file(path.join(webviewPath, 'databaseDiagram.css')));
        const jsUri = this.panel!.webview.asWebviewUri(vscode.Uri.file(path.join(webviewPath, 'databaseDiagram.js')));

        // Read HTML template
        let html = fs.readFileSync(htmlPath, 'utf8');

        // Replace placeholders
        html = html.replace(/{{cssUri}}/g, cssUri.toString());
        html = html.replace(/{{jsUri}}/g, jsUri.toString());
        html = html.replace(/{{tablesJson}}/g, tablesJson);
        html = html.replace(/{{relationshipsJson}}/g, relationshipsJson);
        html = html.replace(/{{databaseName}}/g, database);

        return html;
    }
}
