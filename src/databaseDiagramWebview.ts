import * as vscode from 'vscode';
import * as path from 'path';
import { ConnectionProvider } from './connectionProvider';

export class DatabaseDiagramWebview {
    private panel: vscode.WebviewPanel | undefined;
    private connectionProvider: ConnectionProvider;
    private outputChannel: vscode.OutputChannel;

    constructor(connectionProvider: ConnectionProvider, outputChannel: vscode.OutputChannel) {
        this.connectionProvider = connectionProvider;
        this.outputChannel = outputChannel;
    }

    async show(connectionId: string, database: string) {
        this.outputChannel.appendLine(`[DatabaseDiagram] Opening diagram for database: ${database}`);

        // Create webview panel
        this.panel = vscode.window.createWebviewPanel(
            'databaseDiagram',
            `Database Diagram - ${database}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        // Load database schema
        const schema = await this.loadDatabaseSchema(connectionId, database);

        // Set HTML content
        this.panel.webview.html = this.getWebviewContent(database, schema);

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
            vscode.window.showInformationMessage(`Diagram exported successfully to ${uri.fsPath}`);
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

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Database Diagram - ${database}</title>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/dagre@0.8.5/dist/dagre.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            overflow: hidden;
        }

        #diagram {
            width: 100vw;
            height: 100vh;
            cursor: grab;
        }

        #diagram:active {
            cursor: grabbing;
        }

        .table {
            cursor: move;
        }

        .table-header {
            fill: var(--vscode-editor-selectionBackground, #264f78);
            stroke: var(--vscode-panel-border, #454545);
            stroke-width: 2;
        }

        .table-body {
            fill: var(--vscode-editor-background, #1e1e1e);
            stroke: var(--vscode-panel-border, #454545);
            stroke-width: 1;
        }

        .table-name {
            fill: var(--vscode-editor-foreground, #cccccc);
            font-weight: bold;
            font-size: 14px;
        }

        .column-text {
            fill: var(--vscode-editor-foreground, #cccccc);
            font-size: 12px;
        }

        .pk-indicator {
            fill: none;
            stroke: #ffd700;
            stroke-width: 1.5;
            stroke-linecap: round;
            stroke-linejoin: round;
        }

        .fk-indicator {
            fill: #4fc3f7;
        }

        .relationship-line {
            stroke: var(--vscode-charts-blue, #4fc3f7);
            stroke-width: 2;
            fill: none;
            marker-end: url(#arrowhead);
        }

        .toolbar {
            position: absolute;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            padding: 8px 12px;
            border-radius: 6px;
            z-index: 1000;
            display: flex;
            gap: 4px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }

        .toolbar button {
            margin: 0;
            padding: 8px;
            background: transparent;
            color: var(--vscode-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.2s;
            position: relative;
        }

        .toolbar button:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .toolbar button svg {
            width: 20px;
            height: 20px;
            stroke: currentColor;
        }

        .toolbar-divider {
            width: 1px;
            background: var(--vscode-panel-border);
            margin: 0 4px;
        }

        .export-btn-wrapper {
            position: relative;
        }

        .export-menu {
            position: absolute;
            top: calc(100% + 8px);
            left: 50%;
            transform: translateX(-50%);
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            display: none !important;
            flex-direction: column;
            min-width: 120px;
            z-index: 1001;
        }

        .export-menu.visible {
            display: flex !important;
        }

        .export-menu button {
            padding: 8px 16px;
            text-align: left;
            border-radius: 0;
            background: transparent;
            justify-content: flex-start;
            font-size: 13px;
        }

        .export-menu button:first-child {
            border-radius: 4px 4px 0 0;
        }

        .export-menu button:last-child {
            border-radius: 0 0 4px 4px;
        }

        .export-menu button:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .toolbar button[data-tooltip] {
            position: relative;
        }

        .toolbar button[data-tooltip]::after {
            content: attr(data-tooltip);
            position: absolute;
            bottom: -35px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--vscode-editorHoverWidget-background);
            color: var(--vscode-editorHoverWidget-foreground);
            border: 1px solid var(--vscode-editorHoverWidget-border);
            padding: 6px 10px;
            border-radius: 4px;
            font-size: 12px;
            white-space: nowrap;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s;
            z-index: 1002;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .toolbar button[data-tooltip]:hover::after {
            opacity: 1;
        }

        .filter-panel {
            position: absolute;
            top: 60px;
            right: 10px;
            width: 300px;
            max-height: 500px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            z-index: 1001;
            display: none;
            flex-direction: column;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        }

        .filter-panel.visible {
            display: flex;
        }

        .filter-header {
            padding: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-weight: bold;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .filter-search {
            padding: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .filter-search input {
            width: 100%;
            padding: 5px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
        }

        .filter-search input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        .filter-actions {
            padding: 8px 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 5px;
        }

        .filter-actions button {
            padding: 3px 8px;
            font-size: 11px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
        }

        .filter-actions button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .filter-list {
            overflow-y: auto;
            flex: 1;
            padding: 5px 0;
        }

        .filter-item {
            padding: 5px 10px;
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            user-select: none;
        }

        .filter-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .filter-item input[type="checkbox"] {
            cursor: pointer;
        }

        .filter-item label {
            cursor: pointer;
            flex: 1;
            font-size: 13px;
        }

        .filter-item.hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button onclick="resetZoom()" data-tooltip="Reset View">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" />
                <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
            </svg>
        </button>
        <button onclick="fitToScreen()" data-tooltip="Fit to Screen">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 12v-6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v6" />
                <path d="M10 18h-7" />
                <path d="M21 18h-7" />
                <path d="M6 15l-3 3l3 3" />
                <path d="M18 15l3 3l-3 3" />
            </svg>
        </button>
        <div class="toolbar-divider"></div>
        <button onclick="toggleFilterPanel()" data-tooltip="Filter Tables">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227z" />
            </svg>
        </button>
        <div class="toolbar-divider"></div>
        <div class="export-btn-wrapper">
            <button id="exportBtn" onclick="toggleExportMenu()" data-tooltip="Export Diagram">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2" />
                    <path d="M9 12h12l-3 -3" />
                    <path d="M18 15l3 -3" />
                </svg>
            </button>
            <div id="exportMenu" class="export-menu">
                <button onclick="console.log('[Export] SVG button clicked'); exportAsSVG();">SVG</button>
                <button onclick="console.log('[Export] PNG button clicked'); exportAsPNG();">PNG</button>
            </div>
        </div>
    </div>
    
    <div id="filterPanel" class="filter-panel">
        <div class="filter-header">
            <span>Filter Tables</span>
            <span style="cursor: pointer;" onclick="toggleFilterPanel()">✕</span>
        </div>
        <div class="filter-search">
            <input type="text" id="filterSearch" placeholder="Search tables..." oninput="filterTableList()">
        </div>
        <div class="filter-actions">
            <button onclick="selectAllTables()">Select All</button>
            <button onclick="deselectAllTables()">Deselect All</button>
        </div>
        <div class="filter-list" id="filterList">
            <!-- Table checkboxes will be inserted here -->
        </div>
    </div>
    
    <svg id="diagram"></svg>

    <script>
        // Initialize VS Code API
        const vscode = acquireVsCodeApi();
        console.log('[Diagram] VS Code API initialized');

        const tables = ${tablesJson};
        const relationships = ${relationshipsJson};

        console.log('Tables loaded:', tables);
        console.log('Relationships loaded:', relationships);
        console.log('Tables count:', tables ? tables.length : 0);

        // Check if d3 is loaded
        if (typeof d3 === 'undefined') {
            console.error('D3.js is not loaded!');
            document.body.innerHTML = '<div style="color: white; padding: 20px;">Error: D3.js library failed to load</div>';
        }

        // Check if dagre is loaded
        if (typeof dagre === 'undefined') {
            console.error('Dagre.js is not loaded!');
            document.body.innerHTML = '<div style="color: white; padding: 20px;">Error: Dagre.js library failed to load</div>';
        }

        if (!tables || tables.length === 0) {
            console.warn('No tables to display');
            document.body.innerHTML = '<div style="color: white; padding: 20px;">No tables found in database</div>';
        }

        const width = window.innerWidth;
        const height = window.innerHeight;

        const svg = d3.select('#diagram')
            .attr('width', width)
            .attr('height', height);

        // Define arrowhead marker
        svg.append('defs').append('marker')
            .attr('id', 'arrowhead')
            .attr('viewBox', '-0 -5 10 10')
            .attr('refX', 8)
            .attr('refY', 0)
            .attr('orient', 'auto')
            .attr('markerWidth', 8)
            .attr('markerHeight', 8)
            .append('path')
            .attr('d', 'M 0,-5 L 10,0 L 0,5')
            .attr('fill', '#4fc3f7');

        // Create container for zoom/pan
        const container = svg.append('g');

        // Zoom behavior
        const zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                container.attr('transform', event.transform);
            });

        svg.call(zoom);

        // Calculate table dimensions
        const tableWidth = 250;
        const headerHeight = 40;
        const rowHeight = 25;

        // Calculate table heights
        tables.forEach((table) => {
            table.height = headerHeight + table.columns.length * rowHeight;
            table.width = tableWidth;
        });

        // Use Dagre for automatic layout
        const g = new dagre.graphlib.Graph();
        g.setGraph({
            rankdir: 'TB', // Top to Bottom
            nodesep: 80,   // Horizontal spacing between nodes
            ranksep: 100,  // Vertical spacing between ranks
            marginx: 50,
            marginy: 50
        });
        g.setDefaultEdgeLabel(() => ({}));

        // Add nodes (tables) to graph
        tables.forEach(table => {
            const tableKey = \`\${table.schema}.\${table.name}\`;
            g.setNode(tableKey, {
                label: tableKey,
                width: table.width,
                height: table.height
            });
        });

        // Add edges (relationships) to graph
        relationships.forEach(rel => {
            g.setEdge(rel.from, rel.to);
        });

        // Run Dagre layout algorithm
        dagre.layout(g);

        // Apply calculated positions to tables
        tables.forEach(table => {
            const tableKey = \`\${table.schema}.\${table.name}\`;
            const node = g.node(tableKey);
            if (node) {
                // Dagre gives us the center position, convert to top-left
                table.x = node.x - table.width / 2;
                table.y = node.y - table.height / 2;
            }
        });

        // Create table map for relationship drawing
        const tableMap = new Map();
        tables.forEach(table => {
            tableMap.set(\`\${table.schema}.\${table.name}\`, table);
            table.visible = true; // All tables visible by default
            
            // Mark columns that are part of FK relationships
            table.columns.forEach(col => {
                col.isForeignKey = false;
                col.isReferenced = false;
            });
        });

        // Mark FK and referenced columns
        relationships.forEach(rel => {
            const fromTable = tableMap.get(rel.from);
            const toTable = tableMap.get(rel.to);
            
            if (fromTable) {
                const fromCol = fromTable.columns.find(c => c.name === rel.fromColumn);
                if (fromCol) fromCol.isForeignKey = true;
            }
            
            if (toTable) {
                const toCol = toTable.columns.find(c => c.name === rel.toColumn);
                if (toCol) toCol.isReferenced = true;
            }
        });

        // Populate filter list
        const filterList = document.getElementById('filterList');
        tables.forEach((table, index) => {
            const tableKey = \`\${table.schema}.\${table.name}\`;
            const item = document.createElement('div');
            item.className = 'filter-item';
            item.setAttribute('data-table-name', tableKey.toLowerCase());
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = \`table-\${index}\`;
            checkbox.checked = true;
            checkbox.onchange = () => toggleTableVisibility(tableKey, checkbox.checked);
            
            const label = document.createElement('label');
            label.htmlFor = \`table-\${index}\`;
            label.textContent = tableKey;
            
            item.appendChild(checkbox);
            item.appendChild(label);
            filterList.appendChild(item);
        });

        // Draw relationships
        const relationshipGroup = container.append('g').attr('class', 'relationships');

        relationships.forEach(rel => {
            const fromTable = tableMap.get(rel.from);
            const toTable = tableMap.get(rel.to);

            if (fromTable && toTable) {
                // Calculate connection points
                const x1 = fromTable.x + tableWidth;
                const y1 = fromTable.y + fromTable.height / 2;
                const x2 = toTable.x;
                const y2 = toTable.y + toTable.height / 2;

                // Draw curved line
                const midX = (x1 + x2) / 2;
                
                relationshipGroup.append('path')
                    .attr('class', 'relationship-line')
                    .attr('d', \`M \${x1},\${y1} C \${midX},\${y1} \${midX},\${y2} \${x2},\${y2}\`)
                    .append('title')
                    .text(\`\${rel.name}: \${rel.fromColumn} → \${rel.toColumn}\`);
            }
        });

        // Draw tables
        const tableGroup = container.append('g').attr('class', 'tables');

        // Define drag behavior once
        const drag = d3.drag()
            .on('start', function(event, d) {
                d3.select(this).raise();
            })
            .on('drag', function(event, d) {
                d.x = event.x;
                d.y = event.y;
                d3.select(this).attr('transform', \`translate(\${d.x}, \${d.y})\`);
                
                // Update relationship lines during drag
                updateRelationships();
            })
            .on('end', function(event, d) {
                // Ensure final position is set
                updateRelationships();
            });

        // Initial draw of tables
        drawTables();

        function drawTables() {
            // Clear existing tables
            tableGroup.selectAll('*').remove();

            // Filter visible tables
            const visibleTables = tables.filter(t => t.visible);

            visibleTables.forEach(table => {
                const tableG = tableGroup.append('g')
                    .attr('class', 'table')
                    .attr('transform', \`translate(\${table.x}, \${table.y})\`)
                    .datum(table)
                    .call(drag);

            // Table header
            tableG.append('rect')
                .attr('class', 'table-header')
                .attr('width', tableWidth)
                .attr('height', headerHeight)
                .attr('rx', 4);

            tableG.append('text')
                .attr('class', 'table-name')
                .attr('x', tableWidth / 2)
                .attr('y', headerHeight / 2 + 5)
                .attr('text-anchor', 'middle')
                .text(\`\${table.schema}.\${table.name}\`);

            // Table body
            tableG.append('rect')
                .attr('class', 'table-body')
                .attr('y', headerHeight)
                .attr('width', tableWidth)
                .attr('height', table.columns.length * rowHeight)
                .attr('rx', 4);

                // Columns
                table.columns.forEach((column, i) => {
                    const y = headerHeight + i * rowHeight + rowHeight / 2 + 5;
                    let xOffset = 10;

                    // Primary key indicator
                    if (column.isPrimaryKey) {
                        const pkIcon = tableG.append('g')
                            .attr('transform', \`translate(\${xOffset}, \${y - 6})\`);
                        
                        pkIcon.append('path')
                            .attr('class', 'pk-indicator')
                            .attr('d', 'M8.278 1.922l1.801 1.801a1.439 1.439 0 0 1 0 2.035l-1.322 1.322a1.439 1.439 0 0 1 -2.035 0l-.15 -.15l-3.279 3.279a1 1 0 0 1 -.62 .289l-.087 .004h-.586a.5.5 0 0 1 -.497 -.442l-.003 -.058v-.586a1 1 0 0 1 .234 -.642l.059 -.065l.207 -.207h1v-1h1v-1l1.072 -1.072l-.15 -.15a1.439 1.439 0 0 1 0 -2.035l1.322 -1.322a1.439 1.439 0 0 1 2.035 0z')
                            .attr('transform', 'scale(0.8)');
                        
                        pkIcon.append('path')
                            .attr('class', 'pk-indicator')
                            .attr('d', 'M7.5 4.5h.005')
                            .attr('transform', 'scale(0.8)');
                        
                        xOffset += 18;
                    }

                    // Foreign key indicator
                    if (column.isForeignKey) {
                        const fkIcon = tableG.append('g')
                            .attr('transform', \`translate(\${xOffset}, \${y - 6})\`);
                        
                        fkIcon.append('path')
                            .attr('class', 'fk-indicator')
                            .attr('d', 'M10.5 5h-4.175C5.915 3.835 4.805 3 3.5 3c-1.655 0-3 1.345-3 3s1.345 3 3 3c1.305 0 2.415-.835 2.825-2H6.5l1 1 1-1 1 1 2-2.02zM3.5 7.5c-.825 0-1.5-.675-1.5-1.5s.675-1.5 1.5-1.5 1.5.675 1.5 1.5-.675 1.5-1.5 1.5')
                            .attr('transform', 'scale(0.8)');
                        
                        xOffset += 14;
                    }

                    // Column name
                    tableG.append('text')
                        .attr('class', 'column-text')
                        .attr('x', xOffset)
                        .attr('y', y)
                        .text(\`\${column.name}\`);

                    // Column type (right-aligned)
                    tableG.append('text')
                        .attr('class', 'column-text')
                        .attr('x', tableWidth - 10)
                        .attr('y', y)
                        .attr('text-anchor', 'end')
                        .style('opacity', 0.7)
                        .text(\`\${column.type}\`);
                });
            });
        }        function getColumnYPosition(table, columnName) {
            // Find the column index in the table
            const columnIndex = table.columns.findIndex(col => col.name === columnName);
            if (columnIndex === -1) {
                // If column not found, return middle of table
                return table.y + headerHeight + (table.columns.length * rowHeight) / 2;
            }
            // Return Y position of the specific column (middle of the row)
            return table.y + headerHeight + columnIndex * rowHeight + rowHeight / 2;
        }

        function updateRelationships() {
            // Redraw all relationship lines based on current table positions
            relationshipGroup.selectAll('path').remove();
            
            relationships.forEach(rel => {
                const fromTable = tableMap.get(rel.from);
                const toTable = tableMap.get(rel.to);

                if (fromTable && toTable && fromTable.visible && toTable.visible) {
                    // Get Y positions for specific columns
                    const fromY = getColumnYPosition(fromTable, rel.fromColumn);
                    const toY = getColumnYPosition(toTable, rel.toColumn);
                    
                    // Always connect from sides (left/right edges)
                    let x1, y1, x2, y2;
                    
                    // Determine which side to connect from based on relative X positions
                    if (fromTable.x < toTable.x) {
                        // From is left of To - connect from right edge of From to left edge of To
                        x1 = fromTable.x + tableWidth;
                        x2 = toTable.x;
                    } else {
                        // From is right of To - connect from left edge of From to right edge of To
                        x1 = fromTable.x;
                        x2 = toTable.x + tableWidth;
                    }
                    
                    y1 = fromY;
                    y2 = toY;
                    
                    // Bezier curve for smooth connections
                    const midX = (x1 + x2) / 2;
                    relationshipGroup.append('path')
                        .attr('class', 'relationship-line')
                        .attr('d', \`M \${x1},\${y1} C \${midX},\${y1} \${midX},\${y2} \${x2},\${y2}\`)
                        .append('title')
                        .text(\`\${rel.name}: \${rel.fromColumn} → \${rel.toColumn}\`);
                }
            });
        }

        function resetZoom() {
            // Instead of just resetting to identity, fit to the current visible tables
            fitToScreen();
        }

        function fitToScreen() {
            try {
                const containerNode = container.node();
                if (!containerNode) {
                    console.warn('Container node not found');
                    return;
                }
                
                const bounds = containerNode.getBBox();
                const fullWidth = bounds.width;
                const fullHeight = bounds.height;
                const midX = bounds.x + fullWidth / 2;
                const midY = bounds.y + fullHeight / 2;

                if (fullWidth === 0 || fullHeight === 0) {
                    console.warn('Container has zero dimensions');
                    return;
                }

                // Calculate scale with some padding (0.85 instead of 0.9 for more breathing room)
                const scale = 0.85 / Math.max(fullWidth / width, fullHeight / height);
                const translate = [width / 2 - scale * midX, height / 2 - scale * midY];

                svg.transition().duration(750).call(
                    zoom.transform,
                    d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
                );
            } catch (error) {
                console.error('Error in fitToScreen:', error);
            }
        }

        // Initial fit to screen only if we have tables
        if (tables && tables.length > 0) {
            setTimeout(() => fitToScreen(), 100);
        }

        // Close export menu when clicking outside
        document.addEventListener('click', (e) => {
            console.log('[Export] Document clicked, target:', e.target);
            const exportBtn = document.getElementById('exportBtn');
            const exportMenu = document.getElementById('exportMenu');
            
            if (!exportBtn || !exportMenu) {
                console.error('[Export] Export button or menu not found');
                return;
            }
            
            // Don't close if clicking the export button or menu itself
            if (exportBtn.contains(e.target) || exportMenu.contains(e.target)) {
                console.log('[Export] Click on export button or menu, ignoring');
                return;
            }
            
            if (exportMenu.classList.contains('visible')) {
                console.log('[Export] Closing menu due to outside click');
                exportMenu.classList.remove('visible');
            }
        });

        // Filter panel functions
        function toggleFilterPanel() {
            const panel = document.getElementById('filterPanel');
            panel.classList.toggle('visible');
            // Close export menu if open
            document.getElementById('exportMenu').classList.remove('visible');
        }

        function toggleExportMenu() {
            if (event) event.stopPropagation();
            console.log('[Export] Toggle export menu called');
            const menu = document.getElementById('exportMenu');
            if (!menu) {
                console.error('[Export] Export menu element not found!');
                return;
            }
            const wasVisible = menu.classList.contains('visible');
            menu.classList.toggle('visible');
            const isVisible = menu.classList.contains('visible');
            console.log('[Export] Menu visibility toggled:', wasVisible, '->', isVisible);
            console.log('[Export] Menu classes:', menu.className);
            console.log('[Export] Menu display style:', window.getComputedStyle(menu).display);
        }

        function filterTableList() {
            const searchInput = document.getElementById('filterSearch');
            const searchTerm = searchInput.value.toLowerCase();
            const items = document.querySelectorAll('.filter-item');
            
            items.forEach(item => {
                const tableName = item.getAttribute('data-table-name');
                if (tableName.includes(searchTerm)) {
                    item.classList.remove('hidden');
                } else {
                    item.classList.add('hidden');
                }
            });
        }

        function selectAllTables() {
            const checkboxes = document.querySelectorAll('.filter-item:not(.hidden) input[type="checkbox"]');
            let changed = false;
            
            checkboxes.forEach(cb => {
                if (!cb.checked) {
                    cb.checked = true;
                    // Update visibility directly
                    const label = cb.nextElementSibling;
                    if (label) {
                        const tableKey = label.textContent;
                        const table = tableMap.get(tableKey);
                        if (table) {
                            table.visible = true;
                            changed = true;
                        }
                    }
                }
            });
            
            if (changed) {
                recalculateLayout();
                redrawDiagram();
            }
        }

        function deselectAllTables() {
            const checkboxes = document.querySelectorAll('.filter-item:not(.hidden) input[type="checkbox"]');
            let changed = false;
            
            checkboxes.forEach(cb => {
                if (cb.checked) {
                    cb.checked = false;
                    // Update visibility directly
                    const label = cb.nextElementSibling;
                    if (label) {
                        const tableKey = label.textContent;
                        const table = tableMap.get(tableKey);
                        if (table) {
                            table.visible = false;
                            changed = true;
                        }
                    }
                }
            });
            
            if (changed) {
                recalculateLayout();
                redrawDiagram();
            }
        }

        function toggleTableVisibility(tableKey, visible) {
            const table = tableMap.get(tableKey);
            if (table) {
                table.visible = visible;
                recalculateLayout();
                redrawDiagram();
            }
        }

        function recalculateLayout() {
            // Filter visible tables
            const visibleTables = tables.filter(t => t.visible);
            
            if (visibleTables.length === 0) {
                return;
            }

            // Create new Dagre graph for visible tables only
            const g = new dagre.graphlib.Graph();
            g.setGraph({
                rankdir: 'TB',
                nodesep: 80,
                ranksep: 100,
                marginx: 50,
                marginy: 50
            });
            g.setDefaultEdgeLabel(() => ({}));

            // Add only visible nodes
            visibleTables.forEach(table => {
                const tableKey = \`\${table.schema}.\${table.name}\`;
                g.setNode(tableKey, {
                    label: tableKey,
                    width: table.width,
                    height: table.height
                });
            });

            // Add only edges between visible tables
            relationships.forEach(rel => {
                const fromTable = tableMap.get(rel.from);
                const toTable = tableMap.get(rel.to);
                if (fromTable && toTable && fromTable.visible && toTable.visible) {
                    g.setEdge(rel.from, rel.to);
                }
            });

            // Run Dagre layout
            dagre.layout(g);

            // Apply new positions
            visibleTables.forEach(table => {
                const tableKey = \`\${table.schema}.\${table.name}\`;
                const node = g.node(tableKey);
                if (node) {
                    table.x = node.x - table.width / 2;
                    table.y = node.y - table.height / 2;
                }
            });
        }

        function redrawDiagram() {
            // Redraw tables and relationships
            drawTables();
            updateRelationships();
        }

        // Export functions
        function exportAsSVG() {
            console.log('[Export] SVG export function called');
            if (event) event.stopPropagation();
            const menu = document.getElementById('exportMenu');
            if (menu) {
                menu.classList.remove('visible');
                console.log('[Export] Menu hidden');
            }
            
            try {
                console.log('[Export] Starting SVG export...');
                // Clone the SVG
                const svgElement = document.getElementById('diagram');
                if (!svgElement) {
                    console.error('[Export] SVG element not found!');
                    return;
                }
                console.log('[Export] SVG element found, cloning...');
                const svgClone = svgElement.cloneNode(true);
                
                // Get the bounding box of visible content
                const bounds = container.node().getBBox();
                
                // Set viewBox to show only visible tables
                svgClone.setAttribute('viewBox', \`\${bounds.x - 20} \${bounds.y - 20} \${bounds.width + 40} \${bounds.height + 40}\`);
                svgClone.setAttribute('width', bounds.width + 40);
                svgClone.setAttribute('height', bounds.height + 40);
                
                // Serialize to string
                console.log('[Export] Serializing SVG...');
                const serializer = new XMLSerializer();
                let svgString = serializer.serializeToString(svgClone);
                console.log('[Export] SVG serialized, length:', svgString.length);
                
                // Add XML declaration
                svgString = '<?xml version="1.0" encoding="UTF-8"?>\\n' + svgString;
                
                // Send to VS Code extension host for saving
                console.log('[Export] Sending SVG data to extension host...');
                vscode.postMessage({
                    command: 'exportDiagram',
                    format: 'svg',
                    data: svgString,
                    defaultFilename: \`database-diagram-\${Date.now()}.svg\`
                });
                
                console.log('[Export] SVG export message sent');
            } catch (error) {
                console.error('[Export] Error exporting SVG:', error);
                vscode.postMessage({
                    command: 'error',
                    message: 'Failed to export SVG: ' + error.message
                });
            }
        }

        function exportAsPNG() {
            console.log('[Export] PNG export function called');
            if (event) event.stopPropagation();
            const menu = document.getElementById('exportMenu');
            if (menu) {
                menu.classList.remove('visible');
                console.log('[Export] Menu hidden');
            }
            
            try {
                console.log('[Export] Starting PNG export...');
                // Get SVG element
                const svgElement = document.getElementById('diagram');
                if (!svgElement) {
                    console.error('[Export] SVG element not found!');
                    return;
                }
                console.log('[Export] SVG element found, cloning...');
                const svgClone = svgElement.cloneNode(true);
                
                // Get the bounding box of visible content
                const bounds = container.node().getBBox();
                
                // Set viewBox and dimensions
                svgClone.setAttribute('viewBox', \`\${bounds.x - 20} \${bounds.y - 20} \${bounds.width + 40} \${bounds.height + 40}\`);
                const width = bounds.width + 40;
                const height = bounds.height + 40;
                svgClone.setAttribute('width', width);
                svgClone.setAttribute('height', height);
                
                // Serialize SVG
                const serializer = new XMLSerializer();
                const svgString = serializer.serializeToString(svgClone);
                
                // Create canvas
                console.log('[Export] Creating canvas:', width * 2, 'x', height * 2);
                const canvas = document.createElement('canvas');
                canvas.width = width * 2; // 2x for better quality
                canvas.height = height * 2;
                const ctx = canvas.getContext('2d');
                ctx.scale(2, 2);
                console.log('[Export] Canvas created and scaled');
                
                // Create image from SVG
                const img = new Image();
                const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
                console.log('[Export] SVG blob created, size:', svgBlob.size);
                const url = URL.createObjectURL(svgBlob);
                console.log('[Export] Blob URL created:', url);
                
                img.onload = () => {
                    console.log('[Export] Image loaded successfully');
                    // Fill background with VS Code dark theme color
                    ctx.fillStyle = '#1e1e1e';
                    ctx.fillRect(0, 0, width, height);
                    
                    // Draw image
                    ctx.drawImage(img, 0, 0);
                    
                    // Convert to PNG and download via extension host
                    console.log('[Export] Converting canvas to data URL...');
                    const dataUrl = canvas.toDataURL('image/png');
                    console.log('[Export] Data URL created, length:', dataUrl.length);
                    
                    // Extract base64 data (remove "data:image/png;base64," prefix)
                    const base64Data = dataUrl.split(',')[1];
                    
                    // Send to VS Code extension host for saving
                    console.log('[Export] Sending PNG data to extension host...');
                    vscode.postMessage({
                        command: 'exportDiagram',
                        format: 'png',
                        data: base64Data,
                        defaultFilename: \`database-diagram-\${Date.now()}.png\`
                    });
                    
                    // Cleanup
                    URL.revokeObjectURL(url);
                    console.log('[Export] PNG export message sent');
                };
                
                img.onerror = (error) => {
                    console.error('[Export] Error loading SVG for PNG export:', error);
                    URL.revokeObjectURL(url);
                    vscode.postMessage({
                        command: 'error',
                        message: 'Failed to export PNG: ' + error
                    });
                };
                
                img.src = url;
                
            } catch (error) {
                console.error('[Export] Error exporting PNG:', error);
                vscode.postMessage({
                    command: 'error',
                    message: 'Failed to export PNG: ' + error.message
                });
            }
        }
    </script>
</body>
</html>`;
    }
}
