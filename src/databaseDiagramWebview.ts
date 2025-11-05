import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConnectionProvider } from './connectionProvider';

export class DatabaseDiagramWebview {
    private panel: vscode.WebviewPanel | undefined;
    private connectionProvider: ConnectionProvider;
    private outputChannel: vscode.OutputChannel;
    private context: vscode.ExtensionContext;

    constructor(connectionProvider: ConnectionProvider, outputChannel: vscode.OutputChannel, context: vscode.ExtensionContext) {
        this.connectionProvider = connectionProvider;
        this.outputChannel = outputChannel;
        this.context = context;
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

            // Get tables with columns
            const tablesQuery = `
                SELECT 
                    t.TABLE_SCHEMA,
                    t.TABLE_NAME,
                    c.COLUMN_NAME,
                    c.DATA_TYPE,
                    c.CHARACTER_MAXIMUM_LENGTH,
                    c.IS_NULLABLE,
                    c.ORDINAL_POSITION,
                    CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PRIMARY_KEY
                FROM INFORMATION_SCHEMA.TABLES t
                INNER JOIN INFORMATION_SCHEMA.COLUMNS c ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_SCHEMA = c.TABLE_SCHEMA
                LEFT JOIN (
                    SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
                    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                    INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
                    WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
                ) pk ON t.TABLE_SCHEMA = pk.TABLE_SCHEMA AND t.TABLE_NAME = pk.TABLE_NAME AND c.COLUMN_NAME = pk.COLUMN_NAME
                WHERE t.TABLE_TYPE = 'BASE TABLE'
                ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME, c.ORDINAL_POSITION
            `;
            
            this.outputChannel.appendLine(`[DatabaseDiagram] Executing tables query...`);

            // Get foreign key relationships
            const fkQuery = `
                SELECT 
                    fk.name AS FK_NAME,
                    OBJECT_SCHEMA_NAME(fk.parent_object_id) AS FK_SCHEMA,
                    OBJECT_NAME(fk.parent_object_id) AS FK_TABLE,
                    COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS FK_COLUMN,
                    OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS PK_SCHEMA,
                    OBJECT_NAME(fk.referenced_object_id) AS PK_TABLE,
                    COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS PK_COLUMN
                FROM sys.foreign_keys fk
                INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
                ORDER BY FK_TABLE, FK_NAME
            `;

            const request1 = pool.request();
            const request2 = pool.request();

            this.outputChannel.appendLine(`[DatabaseDiagram] About to execute tables query...`);
            const tablesResult = await request1.query(tablesQuery);
            this.outputChannel.appendLine(`[DatabaseDiagram] Tables query returned ${tablesResult.recordset?.length || 0} rows`);
            
            if (tablesResult.recordset && tablesResult.recordset.length > 0) {
                this.outputChannel.appendLine(`[DatabaseDiagram] Sample row: ${JSON.stringify(tablesResult.recordset[0])}`);
            }
            
            this.outputChannel.appendLine(`[DatabaseDiagram] About to execute FK query...`);
            const fkResult = await request2.query(fkQuery);
            this.outputChannel.appendLine(`[DatabaseDiagram] FK query returned ${fkResult.recordset?.length || 0} rows`);

            // Transform data into structure for diagram
            const tables: any[] = [];
            const tableMap = new Map();

            for (const row of tablesResult.recordset) {
                const tableKey = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
                if (!tableMap.has(tableKey)) {
                    const table = {
                        schema: row.TABLE_SCHEMA,
                        name: row.TABLE_NAME,
                        columns: []
                    };
                    tables.push(table);
                    tableMap.set(tableKey, table);
                }

                const table = tableMap.get(tableKey);
                table.columns.push({
                    name: row.COLUMN_NAME,
                    type: row.DATA_TYPE + (row.CHARACTER_MAXIMUM_LENGTH ? `(${row.CHARACTER_MAXIMUM_LENGTH})` : ''),
                    nullable: row.IS_NULLABLE === 'YES',
                    isPrimaryKey: row.IS_PRIMARY_KEY === 1
                });
            }

            const relationships = fkResult.recordset.map((row: any) => ({
                from: `${row.FK_SCHEMA}.${row.FK_TABLE}`,
                to: `${row.PK_SCHEMA}.${row.PK_TABLE}`,
                fromColumn: row.FK_COLUMN,
                toColumn: row.PK_COLUMN,
                name: row.FK_NAME
            }));

            this.outputChannel.appendLine(`[DatabaseDiagram] Processed ${tables.length} tables and ${relationships.length} relationships`);
            
            if (tables.length === 0) {
                this.outputChannel.appendLine(`[DatabaseDiagram] WARNING: No tables found!`);
            } else {
                this.outputChannel.appendLine(`[DatabaseDiagram] First table: ${tables[0]?.schema}.${tables[0]?.name} with ${tables[0]?.columns?.length} columns`);
            }

            // Close the database-specific pool
            try {
                await pool.close();
                this.outputChannel.appendLine(`[DatabaseDiagram] Database pool closed`);
            } catch (closeError) {
                this.outputChannel.appendLine(`[DatabaseDiagram] Warning: Failed to close pool: ${closeError}`);
            }

            return { tables, relationships };

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
