const vscode = acquireVsCodeApi();
console.log('SQL Editor Webview loaded');
let editor;
let isUpdatingFromExtension = false;
let currentTab = 'results';
let lastResults = null;
let lastMessages = [];
let isResizing = false;
let activeConnections = [];
let currentConnectionId = null;
let currentDatabaseName = null;
let dbSchema = { tables: [], views: [], foreignKeys: [] };
let validationTimeout = null;
let currentQueryPlan = null;
let actualPlanEnabled = false;

// Helper function to check if string is valid JSON
function isValidJSON(str) {
    if (typeof str !== 'string' || !str.trim()) return false;
    const trimmed = str.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            JSON.parse(trimmed);
            return true;
        } catch (e) {
            return false;
        }
    }
    return false;
}

// Helper function to check if string is valid XML
function isValidXML(str) {
    if (typeof str !== 'string' || !str.trim()) return false;
    const trimmed = str.trim();
    if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(trimmed, 'text/xml');
            const parseError = xmlDoc.querySelector('parsererror');
            return !parseError;
        } catch (e) {
            return false;
        }
    }
    return false;
}

// Helper function to format JSON
function formatJSON(str) {
    try {
        const parsed = JSON.parse(str.trim());
        return JSON.stringify(parsed, null, 2);
    } catch (e) {
        return str;
    }
}

// Helper function to format XML
function formatXML(str) {
    try {
        const xmlDoc = new DOMParser().parseFromString(str.trim(), 'text/xml');
        const serializer = new XMLSerializer();
        const formatted = serializer.serializeToString(xmlDoc);
        // Add basic indentation
        return formatted.replace(/(>)(<)(\/?)/g, '$1\n$2$3');
    } catch (e) {
        return str;
    }
}

// Function to open content in new editor
function openInNewEditor(content, language) {
    vscode.postMessage({
        type: 'openInNewEditor',
        content: content,
        language: language
    });
}

// Global selection state for all tables in results
let globalSelection = {
    type: null, // 'row', 'column', or 'cell'
    tableContainer: null, // reference to the specific table container
    selections: [], // Array of selected items: {rowIndex, columnIndex, cellValue}
    columnDef: null,
    data: null,
    columnDefs: null,
    lastClickedIndex: null // Last clicked row/column index for Shift selection
};

// Initialize Monaco Editor
require.config({ 
    paths: { 
        vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' 
    }
});

require(['vs/editor/editor.main'], function () {
    // Detect VS Code theme
    const theme = document.body.classList.contains('vscode-dark') ? 'vs-dark' : 'vs';
    
    editor = monaco.editor.create(document.getElementById('editor'), {
        value: '',
        language: 'sql',
        theme: theme,
        automaticLayout: true,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        fontSize: 14,
        lineNumbers: 'on',
        renderWhitespace: 'selection',
        tabSize: 4,
        insertSpaces: true
    });

    // Listen for content changes
    editor.onDidChangeModelContent(() => {
        if (!isUpdatingFromExtension) {
            vscode.postMessage({
                type: 'documentChanged',
                content: editor.getValue()
            });
            
            // Validate SQL after a short delay
            clearTimeout(validationTimeout);
            validationTimeout = setTimeout(() => {
                validateSql();
            }, 500);
        }
    });

    // Remember right-click position so context-menu 'Go to definition' can use it
    let lastContextPosition = null;
    editor.onMouseDown(function(e) {
        try {
            // e.event.rightButton is true for right-clicks
            // Robust detection: check common event properties for right click
            var isRight = false;
            try {
                if (e.event) {
                    // PointerEvent / MouseEvent properties
                    isRight = !!(e.event.rightButton || e.event.button === 2 || e.event.which === 3);
                }
            } catch (inner) {
                isRight = false;
            }

            if (isRight) {
                if (e.target && e.target.position) {
                    lastContextPosition = e.target.position;
                } else {
                    lastContextPosition = editor.getPosition();
                }
                console.log('[editor.onMouseDown] right-click at position', lastContextPosition);
            }
        } catch (err) {
            console.error('[editor.onMouseDown] error', err);
        }
    });

    // Add keyboard shortcuts
    editor.addCommand(monaco.KeyCode.F5, () => {
        executeQuery();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE, () => {
        executeQuery();
    });

    // Register SQL completion provider
    console.log('[SQL-COMPLETION] Registering completion provider');
    monaco.languages.registerCompletionItemProvider('sql', {
        provideCompletionItems: (model, position) => {
            console.log('[SQL-COMPLETION] provideCompletionItems called at position:', position);
            console.log('[SQL-COMPLETION] Current dbSchema:', dbSchema);
            return provideSqlCompletions(model, position);
        }
    });

    // Register SQL hover provider - shows table/column details using dbSchema
    console.log('[SQL-HOVER] Registering hover provider');
    monaco.languages.registerHoverProvider('sql', {
        provideHover: (model, position) => {
            try {
                const fullText = model.getValue();
                const tablesInQuery = extractTablesFromQuery(fullText) || [];
                const line = model.getLineContent(position.lineNumber);
                const beforeCursor = line.substring(0, position.column - 1);

                // Helper to render a table's columns as markdown table
                function renderTableMarkdown(schemaName, tableName, cols) {
                    var md = '| Column | Type | Nullable |\n';
                    md += '|---|---|---|\n';
                    for (var i = 0; i < cols.length; i++) {
                        var c = cols[i];
                        var type = c.type + (c.maxLength ? '(' + c.maxLength + ')' : '');
                        var nullable = c.nullable ? 'YES' : 'NO';
                        md += '| ' + c.name + ' | ' + type + ' | ' + nullable + ' |\n';
                    }
                    return '**' + schemaName + '.' + tableName + '**\n\n' + md;
                }

                // Detect alias.column or table.column pattern before cursor
                var aliasColMatch = beforeCursor.match(/([A-Za-z0-9_]+)\.([A-Za-z0-9_]*)$/);
                if (aliasColMatch) {
                    var alias = aliasColMatch[1];
                    var colName = aliasColMatch[2];

                    // Resolve alias to table
                    var tableInfo = findTableForAlias(fullText, alias) || findTable(alias);
                    if (tableInfo) {
                        var cols = getColumnsForTable(tableInfo.schema, tableInfo.table) || [];
                        var col = cols.find(function(c) { return c.name.toLowerCase() === colName.toLowerCase(); });
                        if (col) {
                            var mdSingle = '| Property | Value |\n|---|---:|\n';
                            mdSingle += '| Table | ' + tableInfo.schema + '.' + tableInfo.table + ' |\n';
                            mdSingle += '| Column | ' + col.name + ' |\n';
                            mdSingle += '| Type | ' + col.type + (col.maxLength ? '(' + col.maxLength + ')' : '') + ' |\n';
                            mdSingle += '| Nullable | ' + (col.nullable ? 'YES' : 'NO') + ' |\n';
                            var matchText = aliasColMatch[0];
                            var startCol = beforeCursor.lastIndexOf(matchText) + 1;
                            var range = new monaco.Range(position.lineNumber, startCol, position.lineNumber, startCol + matchText.length);
                            return { contents: [{ value: mdSingle }], range: range };
                        }

                        // Column not found - show top columns preview as table
                        var previewCols = cols.slice(0, 12);
                        var tableMd = renderTableMarkdown(tableInfo.schema, tableInfo.table, previewCols);
                        var startCol2 = beforeCursor.lastIndexOf(alias) + 1;
                        var range2 = new monaco.Range(position.lineNumber, startCol2, position.lineNumber, startCol2 + alias.length);
                        return { contents: [{ value: tableMd }], range: range2 };
                    }
                }

                // No alias dot - check standalone word under cursor
                var wordObj = model.getWordAtPosition(position);
                if (wordObj && wordObj.word) {
                    var w = wordObj.word;

                    // If it's a table name, show full table definition as markdown table
                    var table = findTable(w);
                    if (table) {
                        var cols2 = getColumnsForTable(table.schema, table.table) || [];
                        var md2 = renderTableMarkdown(table.schema, table.table, cols2);
                        // (removed inline link) user can use the editor context menu 'Go to definition'
                        var range3 = new monaco.Range(position.lineNumber, wordObj.startColumn, position.lineNumber, wordObj.endColumn);
                        return { contents: [{ value: md2 }], range: range3 };
                    }

                    // If it's a column name present in multiple tables, prefer tables present in the current query
                    var matching = dbSchema.tables.filter(function(t){ return t.columns.some(function(c){ return c.name.toLowerCase() === w.toLowerCase(); }); });
                    if (matching.length > 1) {
                        // filter by tables present in query
                        var inQuery = matching.filter(function(t){
                            return tablesInQuery.some(function(q){ return q.table.toLowerCase() === t.name.toLowerCase() && (q.schema ? q.schema === t.schema : true); });
                        });
                        var effective = inQuery.length > 0 ? inQuery : matching;

                        // Build a markdown table listing each matching table and the column details
                        var mdMulti = '| Table | Column | Type | Nullable |\n';
                        mdMulti += '|---|---|---|---|\n';
                        for (var mi = 0; mi < effective.length; mi++) {
                            var mt = effective[mi];
                            var mc = mt.columns.find(function(c){ return c.name.toLowerCase() === w.toLowerCase(); });
                            if (mc) {
                                var type = mc.type + (mc.maxLength ? '(' + mc.maxLength + ')' : '');
                                var nullable = mc.nullable ? 'YES' : 'NO';
                                mdMulti += '| ' + mt.schema + '.' + mt.name + ' | ' + mc.name + ' | ' + type + ' | ' + nullable + ' |\n';
                            }
                        }
                        var range5 = new monaco.Range(position.lineNumber, wordObj.startColumn, position.lineNumber, wordObj.endColumn);
                        // (removed inline link) user can use the editor context menu 'Go to definition'
                        return { contents: [{ value: mdMulti }], range: range5 };
                    }

                    // If it's a column name present in exactly one table in schema, show that column
                    if (matching.length === 1) {
                        var t = matching[0];
                        var col = t.columns.find(function(c){ return c.name.toLowerCase() === w.toLowerCase(); });
                        var md3 = '| Property | Value |\n|---|---:|\n';
                        md3 += '| Table | ' + t.schema + '.' + t.name + ' |\n';
                        md3 += '| Column | ' + col.name + ' |\n';
                        md3 += '| Type | ' + col.type + (col.maxLength ? '(' + col.maxLength + ')' : '') + ' |\n';
                        md3 += '| Nullable | ' + (col.nullable ? 'YES' : 'NO') + ' |\n';
                        var range4 = new monaco.Range(position.lineNumber, wordObj.startColumn, position.lineNumber, wordObj.endColumn);
                        // (removed inline link) user can use the editor context menu 'Go to definition'
                        return { contents: [{ value: md3 }], range: range4 };
                    }
                }
            } catch (err) {
                console.error('[SQL-HOVER] Error in hover provider', err);
            }

            return null;
        }
    });

    // Notify extension that webview is ready
    vscode.postMessage({ type: 'ready' });

    // Ensure Go-to-definition action is registered after editor is created
    try {
        if (typeof registerGoToDefinitionAction === 'function') {
            registerGoToDefinitionAction();
            console.log('[GoToDef] Registered action inside require callback');
        }
    } catch (e) {
        console.error('[GoToDef] Failed to register inside require callback', e);
    }
});

// Toolbar buttons
document.getElementById('executeButton').addEventListener('click', () => {
    executeQuery();
});

// Execute button dropdown functionality
const executeDropdownToggle = document.getElementById('executeDropdownToggle');
const executeDropdownMenu = document.getElementById('executeDropdownMenu');

executeDropdownToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    executeDropdownMenu.classList.toggle('show');
    executeDropdownToggle.classList.toggle('open');
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const buttonContainer = executeDropdownToggle.closest('.button-container');
    if (!buttonContainer.contains(e.target)) {
        executeDropdownMenu.classList.remove('show');
        executeDropdownToggle.classList.remove('open');
    }
});


// Register a Monaco editor action that appears in the context menu for "Go to definition"
// This uses the editor selection/word under cursor to build the payload and forwards it to the extension
function registerGoToDefinitionAction() {
    // Helper: build a simple CREATE TABLE DDL from an entry in dbSchema
    function buildTableDDL(table) {
        try {
            var lines = [];
            lines.push('-- Generated table definition');
            lines.push('CREATE TABLE ' + table.schema + '.' + table.name + ' (');
            for (var i = 0; i < table.columns.length; i++) {
                var c = table.columns[i];
                var colType = c.type + (c.maxLength ? '(' + c.maxLength + ')' : '');
                var nullable = c.nullable ? 'NULL' : 'NOT NULL';
                lines.push('    ' + c.name + ' ' + colType + ' ' + nullable + (i < table.columns.length - 1 ? ',' : ''));
            }
            lines.push(');');

            // Append any foreign keys that reference or are defined on this table
            if (dbSchema && Array.isArray(dbSchema.foreignKeys)) {
                var fks = dbSchema.foreignKeys.filter(function(f) {
                    return (f.fromSchema === table.schema && f.fromTable === table.name) || (f.toSchema === table.schema && f.toTable === table.name);
                });
                if (fks.length > 0) {
                    lines.push('\n-- Foreign key relationships (summary):');
                    for (var j = 0; j < fks.length; j++) {
                        var fk = fks[j];
                        lines.push('-- ' + fk.constraintName + ': ' + fk.fromSchema + '.' + fk.fromTable + '(' + fk.fromColumn + ') -> ' + fk.toSchema + '.' + fk.toTable + '(' + fk.toColumn + ')');
                    }
                }
            }

            return lines.join('\n');
        } catch (err) {
            console.error('[buildTableDDL] error', err);
            return '-- Unable to generate definition';
        }
    }

    editor.addAction({
        id: 'mssqlmanager.goToDefinition',
        label: 'Go to definition',
        keybindings: [],
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1.5,
        run: function(ed) {
            try {
            // Prefer lastContextPosition (right-click) when available
            const position = (typeof lastContextPosition !== 'undefined' && lastContextPosition) ? lastContextPosition : ed.getPosition();
                const model = ed.getModel();
                if (!model || !position) return;

                console.log('[GoToDef.run] invoked. position=', position);

                // Get the token/word at position
                const wordInfo = model.getWordAtPosition(position);
                console.log('[GoToDef.run] wordInfo=', wordInfo);
                const line = model.getLineContent(position.lineNumber);
                const before = line.substring(0, position.column - 1);

                // Try alias.column pattern first
                const aliasColMatch = before.match(/([A-Za-z0-9_]+)\.([A-Za-z0-9_]*)$/);
                if (aliasColMatch) {
                    const alias = aliasColMatch[1];
                    const colName = aliasColMatch[2];
                    const fullText = model.getValue();
                    const tableInfo = findTableForAlias(fullText, alias) || findTable(alias);
                    if (tableInfo) {
                        vscode.postMessage({ type: 'goToDefinition', objectType: 'column', schema: tableInfo.schema, table: tableInfo.table, column: colName, connectionId: currentConnectionId, database: currentDatabaseName });
                        return;
                    }
                }

                // Fallback to word under cursor
                if (wordInfo && wordInfo.word) {
                    // Helper to parse qualified identifiers and strip brackets/quotes
                    function stripIdentifierPart(part) {
                        if (!part) return part;
                        // Remove square brackets or double quotes if present
                        part = part.trim();
                        if ((part.startsWith('[') && part.endsWith(']')) || (part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
                            return part.substring(1, part.length - 1);
                        }
                        return part;
                    }

                    function parseQualifiedIdentifier(name) {
                        if (!name) return { schema: null, table: null };
                        // If it contains a dot, split into parts (handles [schema].[table] and schema.table)
                        const parts = name.split('.');
                        if (parts.length === 2) {
                            return { schema: stripIdentifierPart(parts[0]), table: stripIdentifierPart(parts[1]) };
                        }
                        // If single part, strip any brackets
                        return { schema: null, table: stripIdentifierPart(name) };
                    }

                    const rawWord = wordInfo.word;
                    const fullText = model.getValue();

                    // parse possible qualified identifier
                    const parsed = parseQualifiedIdentifier(rawWord);

                    // If we have schema + table from the token itself, try to use it
                    if (parsed.table && parsed.schema) {
                        // Prefer asking the extension to script authoritative CREATE for this table
                        vscode.postMessage({ type: 'scriptTableCreate', schema: parsed.schema, table: parsed.table, connectionId: currentConnectionId, database: currentDatabaseName });
                        return;
                    }

                    // If raw token is just table name (possibly bracketed), normalize and try to find
                    const normalizedTableName = parsed.table;
                    // Attempt to find table by name (findTable handles case-insensitive match)
                    const table = findTable(normalizedTableName);
                    if (table) {
                        // Try to build a DDL preview from the in-memory schema and open in a new editor
                        var schemaTable = dbSchema.tables.find(function(t){ return t.schema === table.schema && (t.name === table.table || t.name === table.name); });
                        if (schemaTable) {
                            // Still prefer extension script for full fidelity, but if no extension available fallback to local DDL
                            try {
                                vscode.postMessage({ type: 'scriptTableCreate', schema: schemaTable.schema, table: schemaTable.name, connectionId: currentConnectionId, database: currentDatabaseName });
                                return;
                            } catch (e) {
                                var ddl = buildTableDDL(schemaTable);
                                openInNewEditor(ddl, 'sql');
                                return;
                            }
                        }

                        // Fallback to extension reveal if schema not available
                        vscode.postMessage({ type: 'goToDefinition', objectType: 'table', schema: table.schema, table: table.table, connectionId: currentConnectionId, database: currentDatabaseName });
                        return;
                    }

                    // If it's a column in a single table, go to that column
                    const matching = dbSchema.tables.filter(function(t){ return t.columns.some(function(c){ return c.name.toLowerCase() === normalizedTableName.toLowerCase(); }); });
                    // Prefer tables found in the query
                    const tablesInQuery = extractTablesFromQuery(fullText) || [];
                    if (matching.length > 0) {
                        const inQuery = matching.filter(function(t){ return tablesInQuery.some(function(q){ return q.table.toLowerCase() === t.name.toLowerCase() && (q.schema ? q.schema === t.schema : true); }); });
                        const effective = inQuery.length > 0 ? inQuery : matching;
                        // If exactly one table match, reveal that column
                        if (effective.length === 1) {
                            // Open table DDL and include a marker for the column
                            var only = effective[0];
                            var schemaTable2 = dbSchema.tables.find(function(t){ return t.schema === only.schema && t.name === only.name; });
                            if (schemaTable2) {
                                var ddl2 = buildTableDDL(schemaTable2);
                                ddl2 += '\n\n-- Column: ' + normalizedTableName;
                                openInNewEditor(ddl2, 'sql');
                                return;
                            }

                            // Fallback to extension reveal
                            vscode.postMessage({ type: 'goToDefinition', objectType: 'column', schema: effective[0].schema, table: effective[0].name, column: normalizedTableName, connectionId: currentConnectionId, database: currentDatabaseName });
                            return;
                        }
                        // Otherwise, send a column-list type so extension can fall back to best guess
                        vscode.postMessage({ type: 'goToDefinition', objectType: 'column-list', column: normalizedTableName, connectionId: currentConnectionId, database: currentDatabaseName });
                        return;
                    }
                }
            } catch (err) {
                console.error('[GoToDefAction] Error building goToDefinition payload', err);
            }
        }
    });
}

// Register the action once the editor is ready
if (typeof editor !== 'undefined' && editor) {
    registerGoToDefinitionAction();
} else {
    // If editor not yet ready, try to register later in the monaco loader callback
    // (the editor is created in require(['vs/editor/editor.main'], ... ) earlier)
}

// Prevent dropdown from closing when clicking inside
executeDropdownMenu.addEventListener('click', (e) => {
    e.stopPropagation();
});

document.getElementById('cancelButton').addEventListener('click', () => {
    vscode.postMessage({ type: 'cancelQuery' });
});

document.getElementById('connectButton').addEventListener('click', () => {
    vscode.postMessage({ type: 'manageConnections' });
});

document.getElementById('estimatedPlanButton').addEventListener('click', () => {
    executeEstimatedPlan();
});

document.getElementById('actualPlanCheckbox').addEventListener('change', (e) => {
    actualPlanEnabled = e.target.checked;
});

// Custom Dropdown Class for Connection and Database Selectors
class CustomDropdown {
    constructor(containerId, onSelect) {
        this.container = document.getElementById(containerId);
        this.trigger = this.container.querySelector('.dropdown-trigger');
        this.menu = this.container.querySelector('.dropdown-menu');
        this.onSelect = onSelect;
        this.selectedValue = null;

        this.init();
    }

    init() {
        // Toggle dropdown on trigger click
        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.close();
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
        });
    }

    toggle() {
        const isOpen = this.menu.classList.contains('open');

        // Close all other dropdowns
        document.querySelectorAll('.dropdown-menu.open').forEach(menu => {
            menu.classList.remove('open');
        });
        document.querySelectorAll('.dropdown-trigger.open').forEach(trigger => {
            trigger.classList.remove('open');
        });

        if (!isOpen) {
            this.open();
        } else {
            this.close();
        }
    }

    open() {
        this.menu.classList.add('open');
        this.trigger.classList.add('open');
    }

    close() {
        this.menu.classList.remove('open');
        this.trigger.classList.remove('open');
    }

    setItems(items) {
        // items should be array of {value, text, selected}
        this.menu.innerHTML = '';
        
        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'dropdown-item';
            div.textContent = item.text;
            div.dataset.value = item.value;
            
            if (item.selected) {
                div.classList.add('selected');
                this.trigger.textContent = item.text;
                this.selectedValue = item.value;
            }
            
            div.addEventListener('click', () => {
                this.selectItem(item.value, item.text);
            });
            
            this.menu.appendChild(div);
        });
    }

    selectItem(value, text) {
        // Remove selected class from all items
        this.menu.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('selected'));

        // Add selected class to clicked item
        const selectedItem = this.menu.querySelector(`[data-value="${value}"]`);
        if (selectedItem) {
            selectedItem.classList.add('selected');
        }

        // Update trigger text
        this.trigger.textContent = text;
        this.selectedValue = value;

        // Close dropdown
        this.close();

        // Call the callback
        if (this.onSelect) {
            this.onSelect(value);
        }
    }

    setValue(value, text) {
        this.trigger.textContent = text;
        this.selectedValue = value;
        
        // Update selected state in menu
        this.menu.querySelectorAll('.dropdown-item').forEach(i => {
            i.classList.remove('selected');
            if (i.dataset.value === value) {
                i.classList.add('selected');
            }
        });
    }

    setDisabled(disabled) {
        this.trigger.disabled = disabled;
    }

    show() {
        this.container.style.display = 'inline-block';
    }

    hide() {
        this.container.style.display = 'none';
    }
}

// Initialize custom dropdowns
const connectionDropdown = new CustomDropdown('connection-dropdown', (connectionId) => {
    currentConnectionId = connectionId;
    
    if (connectionId) {
        // Find connection config to check type
        const connection = activeConnections.find(c => c.id === connectionId);
        
        if (connection && connection.connectionType === 'server') {
            // Show database selector and request database list
            document.getElementById('databaseLabel').style.display = 'inline-block';
            databaseDropdown.show();
            
            vscode.postMessage({
                type: 'switchConnection',
                connectionId: connectionId
            });
        } else {
            // Hide database selector for direct database connections
            document.getElementById('databaseLabel').style.display = 'none';
            databaseDropdown.hide();
            currentDatabaseName = null;
            
            vscode.postMessage({
                type: 'switchConnection',
                connectionId: connectionId
            });
        }
    } else {
        document.getElementById('databaseLabel').style.display = 'none';
        databaseDropdown.hide();
    }
});

const databaseDropdown = new CustomDropdown('database-dropdown', (databaseName) => {
    currentDatabaseName = databaseName;
    
    if (currentConnectionId && databaseName) {
        vscode.postMessage({
            type: 'switchDatabase',
            connectionId: currentConnectionId,
            databaseName: databaseName
        });
    }
});

// Tab switching
document.querySelectorAll('.results-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.dataset.tab;

        // Show/hide appropriate container
        const resultsContent = document.getElementById('resultsContent');
        const messagesContent = document.getElementById('messagesContent');
        const queryPlanContent = document.getElementById('queryPlanContent');
        const planTreeContent = document.getElementById('planTreeContent');
        const topOperationsContent = document.getElementById('topOperationsContent');
        
        // Hide all
        resultsContent.style.display = 'none';
        messagesContent.style.display = 'none';
        queryPlanContent.style.display = 'none';
        planTreeContent.style.display = 'none';
        topOperationsContent.style.display = 'none';
        
        // Show selected
        if (currentTab === 'results') {
            resultsContent.style.display = 'block';
        } else if (currentTab === 'messages') {
            messagesContent.style.display = 'block';
        } else if (currentTab === 'queryPlan') {
            queryPlanContent.style.display = 'block';
        } else if (currentTab === 'planTree') {
            planTreeContent.style.display = 'block';
        } else if (currentTab === 'topOperations') {
            topOperationsContent.style.display = 'block';
        }
    });
});

// Resizer functionality
const resizer = document.getElementById('resizer');
const resultsContainer = document.getElementById('resultsContainer');
const editorContainer = document.getElementById('editorContainer');
const container = document.getElementById('container');

resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizer.classList.add('active');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const containerRect = container.getBoundingClientRect();
    const newResultsHeight = containerRect.bottom - e.clientY;
    const minHeight = 100;
    const maxResultsHeight = containerRect.height - minHeight - 40; // 40 for toolbar

    if (newResultsHeight >= minHeight && newResultsHeight <= maxResultsHeight) {
        resultsContainer.style.flex = `0 0 ${newResultsHeight}px`;
    }
});

document.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        resizer.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }
});

function executeQuery() {
    if (!editor) return;

    const selection = editor.getSelection();
    let queryText;

    // If there's a selection, execute only the selected text
    if (selection && !selection.isEmpty()) {
        queryText = editor.getModel().getValueInRange(selection);
    } else {
        queryText = editor.getValue();
    }

    // Build composite connection ID if database is selected
    let connectionId = currentConnectionId;
    if (currentConnectionId && currentDatabaseName) {
        connectionId = `${currentConnectionId}::${currentDatabaseName}`;
    }

    vscode.postMessage({
        type: 'executeQuery',
        query: queryText,
        connectionId: connectionId,
        includeActualPlan: actualPlanEnabled
    });
}

function executeEstimatedPlan() {
    if (!editor) return;

    const selection = editor.getSelection();
    let queryText;

    // If there's a selection, execute only the selected text
    if (selection && !selection.isEmpty()) {
        queryText = editor.getModel().getValueInRange(selection);
    } else {
        queryText = editor.getValue();
    }

    // Build composite connection ID if database is selected
    let connectionId = currentConnectionId;
    if (currentConnectionId && currentDatabaseName) {
        connectionId = `${currentConnectionId}::${currentDatabaseName}`;
    }

    vscode.postMessage({
        type: 'executeEstimatedPlan',
        query: queryText,
        connectionId: connectionId
    });
}

// SQL Completion Provider Function
function provideSqlCompletions(model, position) {
    console.log('[SQL-COMPLETION] provideSqlCompletions called');
    console.log('[SQL-COMPLETION] dbSchema tables count:', dbSchema?.tables?.length || 0);
    console.log('[SQL-COMPLETION] dbSchema:', JSON.stringify(dbSchema, null, 2));
    
    const textUntilPosition = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
    });

    console.log('[SQL-COMPLETION] Text until position:', textUntilPosition);
    
    const word = model.getWordUntilPosition(position);
    console.log('[SQL-COMPLETION] Word at position:', word);
    const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
    };

    // Check if we're after a dot (for column suggestions)
    const lineUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
    });

    const dotMatch = lineUntilPosition.match(/(\\w+)\\\.\\w*$/);
    
    if (dotMatch) {
        // User is typing after a dot, suggest columns
        const prefix = dotMatch[1].toLowerCase();
        
        // Find table/alias in the query
        const tableAlias = findTableForAlias(textUntilPosition, prefix);
        
        if (tableAlias) {
            const columns = getColumnsForTable(tableAlias.schema, tableAlias.table);
            return {
                suggestions: columns.map(col => ({
                    label: col.name,
                    kind: monaco.languages.CompletionItemKind.Field,
                    detail: `${col.type}${col.nullable ? ' (nullable)' : ''}`,
                    insertText: col.name,
                    range: range
                }))
            };
        }
    }

    // Analyze SQL context for intelligent suggestions
    const lowerText = textUntilPosition.toLowerCase();
    
    console.log('[SQL-COMPLETION] Checking context - lowerText:', lowerText);
    
    // Analyze the current SQL context
    const sqlContext = analyzeSqlContext(textUntilPosition, lineUntilPosition);
    console.log('[SQL-COMPLETION] SQL Context analysis:', sqlContext);
    
    // Handle different SQL contexts
    switch (sqlContext.type) {
        case 'JOIN_TABLE':
            console.log('[SQL-COMPLETION] In JOIN context, suggesting related tables');
            const tablesInQuery = extractTablesFromQuery(textUntilPosition);
            console.log('[SQL-COMPLETION] Tables in query for JOIN:', tablesInQuery);
            
            if (tablesInQuery.length > 0) {
                const relatedTables = getRelatedTables(tablesInQuery);
                console.log('[SQL-COMPLETION] Related tables:', relatedTables.map(t => ({ name: t.name, hasFKInfo: !!t.foreignKeyInfo })));
                
                return {
                    suggestions: relatedTables.map(table => {
                        const fullName = table.schema === 'dbo' ? table.name : `${table.schema}.${table.name}`;
                        
                        // Generate smart alias
                        const tableAlias = generateSmartAlias(table.name);
                        
                        // Build the ON clause with FK relationship
                        let insertText = `${fullName} ${tableAlias}`;
                        let detailText = `Table (${table.columns?.length || 0} columns)`;
                        
                        if (table.foreignKeyInfo) {
                            const fkInfo = table.foreignKeyInfo;
                            const toAlias = tableAlias;
                            const fromAlias = fkInfo.fromAlias;
                            
                            if (fkInfo.direction === 'to') {
                                insertText = `${fullName} ${toAlias} ON ${fromAlias}.${fkInfo.fromColumn} = ${toAlias}.${fkInfo.toColumn}`;
                                detailText = `Join on ${fromAlias}.${fkInfo.fromColumn} = ${toAlias}.${fkInfo.toColumn}`;
                            } else {
                                insertText = `${fullName} ${toAlias} ON ${toAlias}.${fkInfo.fromColumn} = ${fromAlias}.${fkInfo.toColumn}`;
                                detailText = `Join on ${toAlias}.${fkInfo.fromColumn} = ${fromAlias}.${fkInfo.toColumn}`;
                            }
                        }
                        
                        return {
                            label: fullName,
                            kind: monaco.languages.CompletionItemKind.Class,
                            detail: detailText,
                            insertText: insertText,
                            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                            range: range,
                            sortText: `0_${fullName}`
                        };
                    })
                };
            }
            break;
            
        case 'ON_CONDITION':
            console.log('[SQL-COMPLETION] In ON clause, suggesting join conditions');
            return getJoinConditionSuggestions(textUntilPosition, range);
            
        case 'ORDER_BY':
            console.log('[SQL-COMPLETION] In ORDER BY clause, suggesting columns and sort options');
            return getOrderBySuggestions(textUntilPosition, range);
            
        case 'GROUP_BY':
            console.log('[SQL-COMPLETION] In GROUP BY clause, suggesting columns');
            return getGroupBySuggestions(textUntilPosition, range);
            
        case 'HAVING':
            console.log('[SQL-COMPLETION] In HAVING clause, suggesting aggregate conditions');
            return getHavingSuggestions(textUntilPosition, range);
            
        case 'INSERT_COLUMNS':
            console.log('[SQL-COMPLETION] In INSERT columns, suggesting table columns');
            return getInsertColumnSuggestions(textUntilPosition, range);
            
        case 'INSERT_VALUES':
            console.log('[SQL-COMPLETION] In INSERT VALUES, suggesting value formats');
            return getInsertValueSuggestions(textUntilPosition, range);
            
        case 'UPDATE_SET':
            console.log('[SQL-COMPLETION] In UPDATE SET, suggesting column assignments');
            return getUpdateSetSuggestions(textUntilPosition, range);
    }
    
    // Detect context: SELECT, WHERE, or FROM clause with enhanced analysis
    const inSelectClause = sqlContext.type === 'SELECT';
    const inWhereClause = sqlContext.type === 'WHERE';
    const inFromClause = sqlContext.type === 'FROM';
    const afterFromClause = sqlContext.type === 'AFTER_FROM';
    
    console.log('[SQL-COMPLETION] Enhanced context detection:', {
        type: sqlContext.type,
        confidence: sqlContext.confidence,
        inSelect: inSelectClause,
        inWhere: inWhereClause,
        inFrom: inFromClause,
        afterFrom: afterFromClause
    });
    
    // Handle WHERE clause with operator suggestions
    if (inWhereClause && sqlContext.suggestOperators) {
        console.log('[SQL-COMPLETION] In WHERE clause, suggesting operators');
        return {
            suggestions: getSqlOperators(range)
        };
    }
    
    // If we're in SELECT, WHERE, or after a complete FROM, suggest columns from tables in query
    if (inSelectClause || inWhereClause || afterFromClause) {
        console.log('[SQL-COMPLETION] Should suggest columns - context type:', sqlContext.type);
        
        // Get all tables/aliases from the FULL query (not just textUntilPosition)
        const fullText = model.getValue();
        const tablesInQuery = extractTablesFromQuery(fullText);
        
        console.log('[SQL-COMPLETION] Tables extracted from query:', tablesInQuery);
        
        if (tablesInQuery.length > 0) {
            const suggestions = [];
            
            // Add columns from all tables in the query
            tablesInQuery.forEach(tableInfo => {
                const columns = getColumnsForTable(tableInfo.schema, tableInfo.table);
                console.log(`[SQL-COMPLETION] Columns for ${tableInfo.schema}.${tableInfo.table}:`, columns.length);
                
                // Use the actual alias if available, otherwise use table name
                const displayAlias = tableInfo.alias || tableInfo.table;
                console.log(`[SQL-COMPLETION] Using alias "${displayAlias}" for table ${tableInfo.table} (hasExplicitAlias: ${tableInfo.hasExplicitAlias})`);
                
                columns.forEach(col => {
                    // For SELECT/WHERE context, prioritize the alias-prefixed suggestions
                    if (tableInfo.hasExplicitAlias || tablesInQuery.length > 1) {
                        // When there's an explicit alias or multiple tables, prioritize prefixed columns
                        suggestions.push({
                            label: `${displayAlias}.${col.name}`,
                            kind: monaco.languages.CompletionItemKind.Field,
                            detail: `${col.type}${col.nullable ? ' (nullable)' : ''} - from ${tableInfo.table}`,
                            insertText: `${displayAlias}.${col.name}`,
                            range: range,
                            sortText: `0_${displayAlias}_${col.name}` // Highest priority for alias-prefixed
                        });
                        
                        // Also suggest without prefix but with lower priority
                        suggestions.push({
                            label: col.name,
                            kind: monaco.languages.CompletionItemKind.Field,
                            detail: `${displayAlias}.${col.name} (${col.type})`,
                            insertText: col.name,
                            range: range,
                            sortText: `1_${col.name}` // Lower priority for non-prefixed
                        });
                    } else {
                        // Single table without explicit alias - prioritize non-prefixed columns
                        suggestions.push({
                            label: col.name,
                            kind: monaco.languages.CompletionItemKind.Field,
                            detail: `${displayAlias}.${col.name} (${col.type})`,
                            insertText: col.name,
                            range: range,
                            sortText: `0_${col.name}` // Prioritize non-prefixed columns
                        });
                        
                        // Also suggest with table prefix
                        suggestions.push({
                            label: `${displayAlias}.${col.name}`,
                            kind: monaco.languages.CompletionItemKind.Field,
                            detail: `${col.type}${col.nullable ? ' (nullable)' : ''}`,
                            insertText: `${displayAlias}.${col.name}`,
                            range: range,
                            sortText: `1_${displayAlias}_${col.name}`
                        });
                    }
                });
            });
            
            // Add SQL keywords too
            const keywords = ['AS', 'AND', 'OR', 'DISTINCT', 'TOP', 'ORDER BY', 'GROUP BY'];
            keywords.forEach(keyword => {
                suggestions.push({
                    label: keyword,
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: keyword,
                    range: range,
                    sortText: `9_${keyword}` // Lower priority
                });
            });
            
            console.log('[SQL-COMPLETION] Returning', suggestions.length, 'column suggestions');
            return { suggestions };
        } else {
            console.log('[SQL-COMPLETION] No tables in query, cannot suggest columns');
        }
    }

    // Default: suggest tables and views
    const suggestions = [];
    
    // Check if this is a new/empty query for special table suggestions
    const isNewQuery = isNewOrEmptyQuery(textUntilPosition);
    console.log('[SQL-COMPLETION] Is new query:', isNewQuery);

    // Add tables
    dbSchema.tables.forEach(table => {
        const fullName = table.schema === 'dbo' ? table.name : `${table.schema}.${table.name}`;
        
        // Regular table suggestion
        suggestions.push({
            label: fullName,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: `Table (${table.columns.length} columns)`,
            insertText: fullName,
            range: range,
            sortText: `2_${fullName}` // Lower priority than special options
        });
        
        // Add special script generation options only for new queries
        if (isNewQuery) {
            // SELECT TOP 100 option
            suggestions.push({
                label: `${table.name}100`,
                kind: monaco.languages.CompletionItemKind.Snippet,
                detail: `Generate SELECT TOP 100 from ${fullName}`,
                insertText: `SELECT TOP 100 *\nFROM ${fullName}`,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range: range,
                sortText: `0_${table.name}_100`, // High priority
                documentation: {
                    value: `**Quick Script**: SELECT TOP 100 rows from ${fullName}\n\nThis will generate a complete SELECT statement to view the first 100 rows from the table.`
                }
            });
            
            // SELECT * option
            suggestions.push({
                label: `${table.name}*`,
                kind: monaco.languages.CompletionItemKind.Snippet,
                detail: `Generate SELECT * from ${fullName}`,
                insertText: `SELECT *\nFROM ${fullName}`,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range: range,
                sortText: `0_${table.name}_all`,
                documentation: {
                    value: `**Quick Script**: SELECT all rows from ${fullName}\n\n⚠️ **Warning**: This will return ALL rows from the table.`
                }
            });
            
            // (COUNT and Schema quick scripts removed per user request)
        }
    });

    // Add views
    dbSchema.views.forEach(view => {
        const fullName = view.schema === 'dbo' ? view.name : `${view.schema}.${view.name}`;
        
        // Regular view suggestion
        suggestions.push({
            label: fullName,
            kind: monaco.languages.CompletionItemKind.Interface,
            detail: `View (${view.columns.length} columns)`,
            insertText: fullName,
            range: range,
            sortText: `2_${fullName}` // Lower priority than special options
        });
        
        // Add special script generation options only for new queries
        if (isNewQuery) {
            // SELECT TOP 100 option for views
            suggestions.push({
                label: `${view.name}100`,
                kind: monaco.languages.CompletionItemKind.Snippet,
                detail: `Generate SELECT TOP 100 from ${fullName} (View)`,
                insertText: `SELECT TOP 100 *\nFROM ${fullName}`,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range: range,
                sortText: `0_${view.name}_100`,
                documentation: {
                    value: `**Quick Script**: SELECT TOP 100 rows from view ${fullName}`
                }
            });
            
            // SELECT * option for views
            suggestions.push({
                label: `${view.name}*`,
                kind: monaco.languages.CompletionItemKind.Snippet,
                detail: `Generate SELECT * from ${fullName} (View)`,
                insertText: `SELECT *\nFROM ${fullName}`,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range: range,
                sortText: `0_${view.name}_all`,
                documentation: {
                    value: `**Quick Script**: SELECT all rows from view ${fullName}`
                }
            });
            
            // (COUNT quick script for views removed per user request)
        }
    });

    // Add SQL keywords
    const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 
                    'ON', 'AND', 'OR', 'ORDER BY', 'GROUP BY', 'HAVING', 'INSERT', 'UPDATE', 
                    'DELETE', 'CREATE', 'ALTER', 'DROP', 'AS', 'DISTINCT', 'TOP', 'LIMIT'];
    
    keywords.forEach(keyword => {
        suggestions.push({
            label: keyword,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: keyword,
            range: range
        });
    });

    return { suggestions };
}

function analyzeSqlContext(textUntilPosition, lineUntilPosition) {
    const lowerText = textUntilPosition.toLowerCase();
    const lowerLine = lineUntilPosition.toLowerCase();
    
    // Find positions of key SQL keywords
    const lastSelectPos = lowerText.lastIndexOf('select');
    const lastFromPos = lowerText.lastIndexOf('from');
    const lastWherePos = lowerText.lastIndexOf('where');
    const lastOrderByPos = lowerText.lastIndexOf('order by');
    const lastGroupByPos = lowerText.lastIndexOf('group by');
    const lastHavingPos = lowerText.lastIndexOf('having');
    const lastInsertPos = lowerText.lastIndexOf('insert');
    const lastUpdatePos = lowerText.lastIndexOf('update');
    const lastSetPos = lowerText.lastIndexOf('set');
    const lastValuesPos = lowerText.lastIndexOf('values');
    
    // Check for JOIN context
    const joinMatch = /\b((?:inner|left|right|full|cross)\s+)?join\s*$/i.exec(lowerLine);
    if (joinMatch) {
        return { type: 'JOIN_TABLE', confidence: 'high' };
    }
    
    // Check for ON clause context (after JOIN table alias)
    const onMatch = /\bjoin\s+(?:\w+\.)?(\w+)(?:\s+(?:as\s+)?(\w+))?\s+on\s*/i.exec(lowerLine);
    if (onMatch || /\bon\s*$/i.test(lowerLine)) {
        return { type: 'ON_CONDITION', confidence: 'high' };
    }
    
    // Check for ORDER BY context
    if (lastOrderByPos !== -1 && (lastOrderByPos > lastWherePos || lastWherePos === -1)) {
        const textAfterOrderBy = lowerText.substring(lastOrderByPos + 8); // +8 for "order by".length
        // Check if we're still in ORDER BY or have moved to next clause
        if (!/\b(limit|offset|fetch|for|union|intersect|except)\b/.test(textAfterOrderBy)) {
            return { type: 'ORDER_BY', confidence: 'high' };
        }
    }
    
    // Check for GROUP BY context
    if (lastGroupByPos !== -1 && lastGroupByPos > Math.max(lastWherePos, lastOrderByPos, lastHavingPos)) {
        return { type: 'GROUP_BY', confidence: 'high' };
    }
    
    // Check for HAVING context
    if (lastHavingPos !== -1 && lastHavingPos > Math.max(lastWherePos, lastGroupByPos)) {
        const textAfterHaving = lowerText.substring(lastHavingPos + 6); // +6 for "having".length
        if (!/\b(order|limit|union|intersect|except)\b/.test(textAfterHaving)) {
            const shouldSuggestOperators = analyzeHavingContext(textAfterHaving);
            return { 
                type: 'HAVING', 
                confidence: 'high',
                suggestOperators: shouldSuggestOperators
            };
        }
    }
    
    // Check for INSERT context
    if (lastInsertPos !== -1 && lastInsertPos > Math.max(lastSelectPos, lastUpdatePos)) {
        // Check if we're in column list: INSERT INTO table (col1, col2...)
        const insertMatch = /insert\s+into\s+(?:\w+\.)?(\w+)\s*\(\s*([^)]*)?$/i.exec(lowerLine);
        if (insertMatch) {
            return { type: 'INSERT_COLUMNS', confidence: 'high', tableName: insertMatch[1] };
        }
        
        // Check if we're in VALUES clause
        if (lastValuesPos !== -1 && lastValuesPos > lastInsertPos) {
            return { type: 'INSERT_VALUES', confidence: 'high' };
        }
    }
    
    // Check for UPDATE SET context
    if (lastUpdatePos !== -1 && lastSetPos !== -1 && lastSetPos > lastUpdatePos) {
        const textAfterSet = lowerText.substring(lastSetPos + 3); // +3 for "set".length
        if (!/\bwhere\b/.test(textAfterSet) || lastWherePos === -1 || lastWherePos < lastSetPos) {
            return { type: 'UPDATE_SET', confidence: 'high' };
        }
    }
    
    // Check for WHERE context
    if (lastWherePos !== -1 && lastWherePos > Math.max(lastFromPos, lastSetPos)) {
        const textAfterWhere = lowerText.substring(lastWherePos + 5); // +5 for "where".length
        const shouldSuggestOperators = analyzeWhereContext(textAfterWhere);
        return { 
            type: 'WHERE', 
            confidence: 'high',
            suggestOperators: shouldSuggestOperators
        };
    }
    
    // Check for SELECT context
    if (lastSelectPos !== -1) {
        if (lastFromPos === -1 || lastSelectPos > lastFromPos) {
            return { type: 'SELECT', confidence: 'medium' };
        } else if (lastFromPos !== -1 && lastSelectPos < lastFromPos) {
            // Check if FROM clause is complete
            const textAfterFrom = lowerText.substring(lastFromPos);
            if (textAfterFrom.match(/from\s+(?:\w+\.)?(\w+)(?:\s+(?:as\s+)?(\w+))?/)) {
                return { type: 'AFTER_FROM', confidence: 'medium' };
            } else {
                return { type: 'FROM', confidence: 'high' };
            }
        }
    }
    
    // Default context
    return { type: 'DEFAULT', confidence: 'low' };
}

function analyzeHavingContext(textAfterHaving) {
    // Similar to WHERE clause analysis but for HAVING (typically with aggregates)
    const trimmedText = textAfterHaving.trim();
    
    if (!trimmedText) {
        return false;
    }
    
    const conditions = trimmedText.split(/\s+(?:and|or)\s+/i);
    const currentCondition = conditions[conditions.length - 1].trim();
    
    // Check for aggregate function followed by space (e.g., "COUNT(*) ", "SUM(price) ")
    const aggregatePatterns = [
        /^(?:count|sum|avg|min|max|stddev|variance)\s*\([^)]*\)\s*$/i,
        /^(?:\w+\.)*\w+\s*$/  // Column name
    ];
    
    for (const pattern of aggregatePatterns) {
        if (pattern.test(currentCondition)) {
            const hasOperator = /\s*(=|<>|!=|<|>|<=|>=|like|in|not\s+in|is\s+null|is\s+not\s+null|between)\s*/i.test(currentCondition);
            return !hasOperator;
        }
    }
    
    return false;
}

function getJoinConditionSuggestions(textUntilPosition, range) {
    const tablesInQuery = extractTablesFromQuery(textUntilPosition);
    const suggestions = [];
    
    if (tablesInQuery.length >= 2) {
        // Get the last two tables for join condition suggestions
        const table1 = tablesInQuery[tablesInQuery.length - 2];
        const table2 = tablesInQuery[tablesInQuery.length - 1];
        
        // Find foreign key relationships between these tables
        if (dbSchema.foreignKeys) {
            dbSchema.foreignKeys.forEach(fk => {
                if ((fk.fromTable.toLowerCase() === table1.table.toLowerCase() && 
                     fk.toTable.toLowerCase() === table2.table.toLowerCase()) ||
                    (fk.fromTable.toLowerCase() === table2.table.toLowerCase() && 
                     fk.toTable.toLowerCase() === table1.table.toLowerCase())) {
                    
                    const leftAlias = table1.alias;
                    const rightAlias = table2.alias;
                    
                    suggestions.push({
                        label: `${leftAlias}.${fk.fromColumn} = ${rightAlias}.${fk.toColumn}`,
                        kind: monaco.languages.CompletionItemKind.Reference,
                        detail: `Foreign key relationship`,
                        insertText: `${leftAlias}.${fk.fromColumn} = ${rightAlias}.${fk.toColumn}`,
                        range: range,
                        sortText: `0_fk`
                    });
                }
            });
        }
        
        // Suggest all possible column combinations
        const table1Columns = getColumnsForTable(table1.schema, table1.table);
        const table2Columns = getColumnsForTable(table2.schema, table2.table);
        
        table1Columns.forEach(col1 => {
            table2Columns.forEach(col2 => {
                if (col1.name.toLowerCase() === col2.name.toLowerCase() || 
                    col1.name.toLowerCase().includes('id') && col2.name.toLowerCase().includes('id')) {
                    
                    suggestions.push({
                        label: `${table1.alias}.${col1.name} = ${table2.alias}.${col2.name}`,
                        kind: monaco.languages.CompletionItemKind.Reference,
                        detail: `Join on matching columns`,
                        insertText: `${table1.alias}.${col1.name} = ${table2.alias}.${col2.name}`,
                        range: range,
                        sortText: `1_match_${col1.name}`
                    });
                }
            });
        });
    }
    
    return { suggestions };
}

function getOrderBySuggestions(textUntilPosition, range) {
    const suggestions = [];
    const tablesInQuery = extractTablesFromQuery(textUntilPosition);
    
    // Add column suggestions
    tablesInQuery.forEach(tableInfo => {
        const columns = getColumnsForTable(tableInfo.schema, tableInfo.table);
        const displayAlias = tableInfo.alias || tableInfo.table;
        
        columns.forEach(col => {
            // Column only
            suggestions.push({
                label: `${displayAlias}.${col.name}`,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type} - Order by column`,
                insertText: `${displayAlias}.${col.name}`,
                range: range,
                sortText: `0_${col.name}`
            });
            
            // Column with ASC
            suggestions.push({
                label: `${displayAlias}.${col.name} ASC`,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type} - Ascending order`,
                insertText: `${displayAlias}.${col.name} ASC`,
                range: range,
                sortText: `1_${col.name}_asc`
            });
            
            // Column with DESC
            suggestions.push({
                label: `${displayAlias}.${col.name} DESC`,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type} - Descending order`,
                insertText: `${displayAlias}.${col.name} DESC`,
                range: range,
                sortText: `1_${col.name}_desc`
            });
        });
    });
    
    // Add sort direction keywords
    ['ASC', 'DESC'].forEach(direction => {
        suggestions.push({
            label: direction,
            kind: monaco.languages.CompletionItemKind.Keyword,
            detail: `Sort direction`,
            insertText: direction,
            range: range,
            sortText: `9_${direction}`
        });
    });
    
    return { suggestions };
}

function getGroupBySuggestions(textUntilPosition, range) {
    const suggestions = [];
    const tablesInQuery = extractTablesFromQuery(textUntilPosition);
    
    tablesInQuery.forEach(tableInfo => {
        const columns = getColumnsForTable(tableInfo.schema, tableInfo.table);
        const displayAlias = tableInfo.alias || tableInfo.table;
        
        columns.forEach(col => {
            suggestions.push({
                label: `${displayAlias}.${col.name}`,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type} - Group by column`,
                insertText: `${displayAlias}.${col.name}`,
                range: range,
                sortText: `0_${col.name}`
            });
        });
    });
    
    return { suggestions };
}

function getHavingSuggestions(textUntilPosition, range) {
    const suggestions = [];
    
    // Check if we should suggest operators
    const lowerText = textUntilPosition.toLowerCase();
    const lastHavingPos = lowerText.lastIndexOf('having');
    
    if (lastHavingPos !== -1) {
        const textAfterHaving = textUntilPosition.substring(lastHavingPos + 6);
        const shouldSuggestOperators = analyzeHavingContext(textAfterHaving);
        
        if (shouldSuggestOperators) {
            return { suggestions: getSqlOperators(range) };
        }
    }
    
    // Suggest aggregate functions
    const aggregateFunctions = [
        { name: 'COUNT(*)', detail: 'Count all rows' },
        { name: 'COUNT(column)', detail: 'Count non-null values' },
        { name: 'SUM(column)', detail: 'Sum of values' },
        { name: 'AVG(column)', detail: 'Average of values' },
        { name: 'MIN(column)', detail: 'Minimum value' },
        { name: 'MAX(column)', detail: 'Maximum value' },
        { name: 'STDDEV(column)', detail: 'Standard deviation' },
        { name: 'VARIANCE(column)', detail: 'Variance' }
    ];
    
    aggregateFunctions.forEach(func => {
        suggestions.push({
            label: func.name,
            kind: monaco.languages.CompletionItemKind.Function,
            detail: func.detail,
            insertText: func.name,
            range: range,
            sortText: `0_${func.name}`
        });
    });
    
    // Also suggest columns for grouping expressions
    const tablesInQuery = extractTablesFromQuery(textUntilPosition);
    tablesInQuery.forEach(tableInfo => {
        const columns = getColumnsForTable(tableInfo.schema, tableInfo.table);
        const displayAlias = tableInfo.alias || tableInfo.table;
        
        columns.forEach(col => {
            suggestions.push({
                label: `${displayAlias}.${col.name}`,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type} - Column for aggregate`,
                insertText: `${displayAlias}.${col.name}`,
                range: range,
                sortText: `1_${col.name}`
            });
        });
    });
    
    return { suggestions };
}

function getInsertColumnSuggestions(textUntilPosition, range) {
    const suggestions = [];
    
    // Extract table name from INSERT statement
    const insertMatch = /insert\s+into\s+(?:(\w+)\.)?(\w+)\s*\(/i.exec(textUntilPosition);
    if (insertMatch) {
        const schema = insertMatch[1] || 'dbo';
        const tableName = insertMatch[2];
        
        const columns = getColumnsForTable(schema, tableName);
        columns.forEach(col => {
            suggestions.push({
                label: col.name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type}${col.nullable ? ' (nullable)' : ' (required)'}`,
                insertText: col.name,
                range: range,
                sortText: col.nullable ? `1_${col.name}` : `0_${col.name}` // Required columns first
            });
        });
    }
    
    return { suggestions };
}

function getInsertValueSuggestions(textUntilPosition, range) {
    const suggestions = [];
    
    // Suggest common value patterns
    const valuePatterns = [
        { label: 'NULL', detail: 'Null value', insertText: 'NULL' },
        { label: "'text'", detail: 'Text value', insertText: "''" },
        { label: '0', detail: 'Number value', insertText: '0' },
        { label: 'GETDATE()', detail: 'Current date/time', insertText: 'GETDATE()' },
        { label: 'NEWID()', detail: 'New GUID', insertText: 'NEWID()' }
    ];
    
    valuePatterns.forEach(pattern => {
        suggestions.push({
            label: pattern.label,
            kind: monaco.languages.CompletionItemKind.Value,
            detail: pattern.detail,
            insertText: pattern.insertText,
            range: range,
            sortText: `0_${pattern.label}`
        });
    });
    
    return { suggestions };
}

function getUpdateSetSuggestions(textUntilPosition, range) {
    const suggestions = [];
    
    // Extract table name from UPDATE statement
    const updateMatch = /update\s+(?:(\w+)\.)?(\w+)\s+set/i.exec(textUntilPosition);
    if (updateMatch) {
        const schema = updateMatch[1] || 'dbo';
        const tableName = updateMatch[2];
        
        const columns = getColumnsForTable(schema, tableName);
        columns.forEach(col => {
            // Suggest column = value pattern
            suggestions.push({
                label: `${col.name} = `,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type} - Set column value`,
                insertText: `${col.name} = `,
                range: range,
                sortText: `0_${col.name}`
            });
        });
    }
    
    return { suggestions };
}

function isNewOrEmptyQuery(textUntilPosition) {
    // Check if the query is essentially empty or just starting
    const trimmedText = textUntilPosition.trim();
    
    // Empty or just whitespace
    if (!trimmedText) {
        return true;
    }
    
    // Check if we're at the very beginning of a statement
    // Remove comments and check if there's any substantial SQL content
    const withoutComments = trimmedText
        .replace(/--.*$/gm, '') // Remove line comments
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
        .trim();
    
    if (!withoutComments) {
        return true;
    }
    
    // Check if we only have incomplete statement starters
    const incompletePatterns = [
        /^\s*$/, // Empty
        /^\s*select\s*$/i, // Just "SELECT"
        /^\s*insert\s*$/i, // Just "INSERT"
        /^\s*update\s*$/i, // Just "UPDATE"
        /^\s*delete\s*$/i, // Just "DELETE"
        /^\s*with\s*$/i, // Just "WITH" (CTE)
        /^\s*create\s*$/i, // Just "CREATE"
        /^\s*alter\s*$/i, // Just "ALTER"
        /^\s*drop\s*$/i // Just "DROP"
    ];
    
    for (const pattern of incompletePatterns) {
        if (pattern.test(withoutComments)) {
            return true;
        }
    }
    
    // Check if we're at the start of a new statement after semicolon
    const statements = withoutComments.split(';');
    const lastStatement = statements[statements.length - 1].trim();
    
    // If the last statement is empty or just a keyword, consider it new
    if (!lastStatement || incompletePatterns.some(pattern => pattern.test(lastStatement))) {
        return true;
    }
    
    // Check if we have a very short incomplete statement (less than 20 characters)
    // This catches cases like "SEL" or "SELECT " without much content
    if (lastStatement.length < 20) {
        // Check if it's just keywords without table names or substantial content
        const hasSubstantialContent = /\b(?:from|join|where|set|into|values)\s+\w+/i.test(lastStatement);
        if (!hasSubstantialContent) {
            return true;
        }
    }
    
    return false;
}

function getSqlOperators(range) {
    const operators = [
        { label: '=', detail: 'Equal to', insertText: '= ' },
        { label: '<>', detail: 'Not equal to', insertText: '<> ' },
        { label: '!=', detail: 'Not equal to (alternative)', insertText: '!= ' },
        { label: '<', detail: 'Less than', insertText: '< ' },
        { label: '>', detail: 'Greater than', insertText: '> ' },
        { label: '<=', detail: 'Less than or equal to', insertText: '<= ' },
        { label: '>=', detail: 'Greater than or equal to', insertText: '>= ' },
        { label: 'LIKE', detail: 'Pattern matching', insertText: 'LIKE ' },
        { label: 'NOT LIKE', detail: 'Pattern not matching', insertText: 'NOT LIKE ' },
        { label: 'IN', detail: 'Value in list', insertText: 'IN (' },
        { label: 'NOT IN', detail: 'Value not in list', insertText: 'NOT IN (' },
        { label: 'IS NULL', detail: 'Is null value', insertText: 'IS NULL' },
        { label: 'IS NOT NULL', detail: 'Is not null value', insertText: 'IS NOT NULL' },
        { label: 'BETWEEN', detail: 'Between two values', insertText: 'BETWEEN ' },
        { label: 'NOT BETWEEN', detail: 'Not between two values', insertText: 'NOT BETWEEN ' },
        { label: 'EXISTS', detail: 'Subquery returns rows', insertText: 'EXISTS (' },
        { label: 'NOT EXISTS', detail: 'Subquery returns no rows', insertText: 'NOT EXISTS (' }
    ];
    
    return operators.map(op => ({
        label: op.label,
        kind: monaco.languages.CompletionItemKind.Operator,
        detail: op.detail,
        insertText: op.insertText,
        range: range,
        sortText: `0_${op.label}` // High priority for operators
    }));
}

function generateSmartAlias(tableName) {
    // Handle short table names (3 characters or less)
    if (tableName.length <= 3) {
        return tableName.toLowerCase();
    }
    
    // Remove common prefixes/suffixes
    let cleanName = tableName
        .replace(/^tbl_?/i, '')  // Remove tbl prefix
        .replace(/_?tbl$/i, '')  // Remove tbl suffix
        .replace(/^tb_?/i, '')   // Remove tb prefix
        .replace(/_?tb$/i, '');  // Remove tb suffix
    
    // Split on various word boundaries
    const words = cleanName.split(/[_\-\s]|(?=[A-Z])/)
        .filter(word => word && word.length > 0)
        .map(word => word.toLowerCase());
    
    if (words.length === 1) {
        const word = words[0];
        // For single words, use intelligent abbreviation
        if (word.length <= 3) {
            return word;
        } else if (word.length <= 6) {
            // For medium words, take first 2-3 chars
            return word.substring(0, word.length <= 4 ? 2 : 3);
        } else {
            // For long words, take first and some consonants
            const vowels = 'aeiou';
            let alias = word.charAt(0);
            for (let i = 1; i < word.length && alias.length < 3; i++) {
                if (!vowels.includes(word.charAt(i))) {
                    alias += word.charAt(i);
                }
            }
            // If we don't have enough characters, add more
            if (alias.length < 2) {
                alias = word.substring(0, 2);
            }
            return alias;
        }
    } else {
        // Multiple words: take first letter of each significant word
        let alias = '';
        
        for (const word of words) {
            if (word.length > 0) {
                alias += word.charAt(0);
            }
        }
        
        // Ensure we have at least 2 characters and at most 4
        if (alias.length === 1) {
            // If only one word or very short, use first 2-3 chars of the original
            alias = cleanName.substring(0, Math.min(3, cleanName.length)).toLowerCase();
        } else if (alias.length > 6) {
            // If too long, take first 6 letters
            alias = alias.substring(0, 6);
        }
        
        return alias.toLowerCase();
    }
}

function extractTablesFromQuery(query) {
    const tables = [];
    const lowerQuery = query.toLowerCase();
    
    console.log('[SQL-COMPLETION] extractTablesFromQuery called with:', query);
    
    // SQL keywords that should not be considered as aliases
    const sqlKeywords = ['select', 'from', 'where', 'join', 'inner', 'left', 'right', 'full', 'cross', 'on', 'and', 'or', 'order', 'group', 'by', 'having'];
    
    // Match FROM and JOIN clauses with optional aliases
    // Patterns: FROM schema.table alias, FROM [schema].[table] alias, FROM table alias, JOIN schema.table alias, etc.
    const patterns = [
        // Pattern for bracketed identifiers: FROM [schema].[table] alias or FROM [table] alias
        /\b(?:from|(?:inner\s+|left\s+|right\s+|full\s+|cross\s+)?join)\s+(?:\[([^\]]+)\]\.)?\[([^\]]+)\](?:\s+(?:as\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?/gi,
        // Pattern for regular identifiers: FROM schema.table alias or FROM table alias  
        /\b(?:from|(?:inner\s+|left\s+|right\s+|full\s+|cross\s+)?join)\s+(?:([a-zA-Z_][a-zA-Z0-9_]*)\\.)?([a-zA-Z_][a-zA-Z0-9_]*)(?:\\s+(?:as\\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?/gi
    ];
    
    patterns.forEach((pattern, patternIndex) => {
        console.log(`[SQL-COMPLETION] Testing pattern ${patternIndex + 1}:`, pattern);
        // Create a new regex instance to avoid global flag issues
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = regex.exec(query)) !== null) {
            console.log('[SQL-COMPLETION] Regex match:', match);
            const schema = match[1] || 'dbo';
            const table = match[2];
            let alias = match[3];
            
            console.log('[SQL-COMPLETION] Parsed - schema:', schema, 'table:', table, 'alias:', alias);
            
            // Skip if the captured alias is actually a SQL keyword
            if (alias && sqlKeywords.includes(alias.toLowerCase())) {
                console.log('[SQL-COMPLETION] Skipping alias as it\'s a SQL keyword:', alias);
                alias = undefined;
            }
            
            // Verify this is a valid table in our schema
            const tableInfo = findTable(table.toLowerCase());
            console.log('[SQL-COMPLETION] findTable result for', table, ':', tableInfo);
            
            if (tableInfo) {
                const hasExplicitAlias = !!alias;
                
                // If no explicit alias, use the table name as the alias
                if (!alias) {
                    alias = tableInfo.table;
                }
                
                // Check if table is already added to avoid duplicates
                const existingTable = tables.find(t => 
                    t.schema === tableInfo.schema && 
                    t.table === tableInfo.table
                );
                
                if (!existingTable) {
                    const tableEntry = {
                        schema: tableInfo.schema,
                        table: tableInfo.table,
                        alias: alias,
                        hasExplicitAlias: hasExplicitAlias
                    };
                    
                    tables.push(tableEntry);
                    console.log('[SQL-COMPLETION] Added table:', tableEntry);
                }
            } else {
                console.log('[SQL-COMPLETION] Table not found in schema:', table);
            }
        }
    });
    
    console.log('[SQL-COMPLETION] Final extracted tables:', tables);
    return tables;
}

function findTableForAlias(query, alias) {
    const lowerQuery = query.toLowerCase();
    const lowerAlias = alias.toLowerCase();

    // Pattern: FROM tableName alias or JOIN tableName alias
    const patterns = [
        new RegExp(`from\\\\s+(?:(\\\\w+)\\\\.)?(\\\\w+)\\\\s+(?:as\\\\s+)?${lowerAlias}(?:\\\\s|,|\\$)`, 'i'),
        new RegExp(`join\\\\s+(?:(\\\\w+)\\\\.)?(\\\\w+)\\\\s+(?:as\\\\s+)?${lowerAlias}(?:\\\\s|,|\\$)`, 'i')
    ];

    for (const pattern of patterns) {
        const match = query.match(pattern);
        if (match) {
            return {
                schema: match[1] || 'dbo',
                table: match[2]
            };
        }
    }

    // Check if alias is actually the table name itself
    const directTable = findTable(lowerAlias);
    if (directTable) {
        return directTable;
    }

    return null;
}

function findTable(tableName) {
    const lowerName = tableName.toLowerCase();
    
    // Check tables first
    for (const table of dbSchema.tables) {
        if (table.name.toLowerCase() === lowerName) {
            return { schema: table.schema, table: table.name };
        }
    }
    
    // Then check views
    for (const view of dbSchema.views) {
        if (view.name.toLowerCase() === lowerName) {
            return { schema: view.schema, table: view.name };
        }
    }
    
    return null;
}

function getColumnsForTable(schema, tableName) {
    const lowerName = tableName.toLowerCase();
    
    for (const table of dbSchema.tables) {
        if (table.name.toLowerCase() === lowerName && table.schema === schema) {
            return table.columns;
        }
    }
    
    for (const view of dbSchema.views) {
        if (view.name.toLowerCase() === lowerName && view.schema === schema) {
            return view.columns;
        }
    }
    
    return [];
}

function getRelatedTables(tablesInQuery) {
    const relatedTables = [];
    const existingTableNames = tablesInQuery.map(t => t.table.toLowerCase());
    
    // Get all tables with foreign keys
    if (dbSchema.foreignKeys) {
        tablesInQuery.forEach(tableInfo => {
            const tableName = tableInfo.table.toLowerCase();
            
            // Find foreign keys FROM this table (this table references other tables)
            dbSchema.foreignKeys.forEach(fk => {
                if (fk.fromTable.toLowerCase() === tableName && 
                    !existingTableNames.includes(fk.toTable.toLowerCase())) {
                    
                    const table = dbSchema.tables.find(t => 
                        t.name.toLowerCase() === fk.toTable.toLowerCase() && 
                        t.schema === fk.toSchema
                    );
                    
                    if (table && !relatedTables.find(rt => 
                        rt.name.toLowerCase() === table.name.toLowerCase() && 
                        rt.schema === table.schema
                    )) {
                        relatedTables.push({
                            ...table,
                            foreignKeyInfo: {
                                direction: 'to',
                                fromTable: fk.fromTable,
                                fromAlias: tableInfo.alias,
                                fromHasExplicitAlias: tableInfo.hasExplicitAlias,
                                fromColumn: fk.fromColumn,
                                toTable: fk.toTable,
                                toColumn: fk.toColumn
                            }
                        });
                    }
                }
                
                // Find foreign keys TO this table (other tables reference this table)
                if (fk.toTable.toLowerCase() === tableName && 
                    !existingTableNames.includes(fk.fromTable.toLowerCase())) {
                    
                    const table = dbSchema.tables.find(t => 
                        t.name.toLowerCase() === fk.fromTable.toLowerCase() && 
                        t.schema === fk.fromSchema
                    );
                    
                    if (table && !relatedTables.find(rt => 
                        rt.name.toLowerCase() === table.name.toLowerCase() && 
                        rt.schema === table.schema
                    )) {
                        relatedTables.push({
                            ...table,
                            foreignKeyInfo: {
                                direction: 'from',
                                fromTable: fk.fromTable,
                                fromAlias: tableInfo.alias,
                                fromHasExplicitAlias: tableInfo.hasExplicitAlias,
                                fromColumn: fk.fromColumn,
                                toTable: fk.toTable,
                                toColumn: fk.toColumn
                            }
                        });
                    }
                }
            });
        });
    }
    
    // If no related tables found or no FK info, return all tables except those already in query
    if (relatedTables.length === 0) {
        return dbSchema.tables.filter(table => 
            !existingTableNames.includes(table.name.toLowerCase())
        );
    }
    
    return relatedTables;
}

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;

    switch (message.type) {
        case 'update':
            if (editor && message.content !== editor.getValue()) {
                isUpdatingFromExtension = true;
                const position = editor.getPosition();
                editor.setValue(message.content);
                if (position) {
                    editor.setPosition(position);
                }
                isUpdatingFromExtension = false;
            }
            break;

        case 'connectionsUpdate':
            // message.connections is an array of connection configs
            updateConnectionsList(message.connections || [], message.currentConnectionId, message.currentDatabase);
            break;

        case 'databasesUpdate':
            // message.databases is an array of database names for current server connection
            updateDatabasesList(message.databases || [], message.currentDatabase);
            break;

        case 'schemaUpdate':
            console.log('[SQL-COMPLETION] Received schemaUpdate message');
            console.log('[SQL-COMPLETION] Message schema:', message.schema);
            dbSchema = message.schema || { tables: [], views: [], foreignKeys: [] };
            console.log('[SQL-COMPLETION] Schema updated:', dbSchema.tables.length, 'tables', dbSchema.views.length, 'views', dbSchema.foreignKeys.length, 'foreign keys');
            console.log('[SQL-COMPLETION] Tables:', dbSchema.tables?.map(t => `${t.schema}.${t.name}`).join(', '));
            break;

        case 'executing':
            showLoading();
            break;

        case 'results':
            showResults(message.resultSets, message.executionTime, message.rowsAffected, message.messages, message.planXml);
            break;

        case 'queryPlan':
            showQueryPlan(message.planXml, message.executionTime, message.messages, message.resultSets);
            break;

        case 'error':
            showError(message.error, message.messages);
            break;

        case 'autoExecuteQuery':
            // Auto-execute the query if conditions are met
            if (editor && currentConnectionId) {
                const content = editor.getValue().trim();
                if (content && content.toLowerCase().startsWith('select')) {
                    // Small delay to ensure the webview is fully initialized
                    setTimeout(() => {
                        executeQuery();
                    }, 50);
                }
            }
            break;
    }
});

function updateConnectionsList(connections, selectedConnectionId, selectedDatabase) {
    // connections: [{ id, server, database, connectionType }]
    activeConnections = connections;
    currentConnectionId = selectedConnectionId;
    currentDatabaseName = selectedDatabase;

    const databaseLabel = document.getElementById('databaseLabel');
    
    if (!connections || connections.length === 0) {
        connectionDropdown.setItems([{
            value: '',
            text: 'Not Connected',
            selected: true
        }]);
        connectionDropdown.setDisabled(true);
        databaseDropdown.hide();
        databaseLabel.style.display = 'none';
        return;
    }

    connectionDropdown.setDisabled(false);
    
    const items = connections.map(conn => ({
        value: conn.id,
        text: conn.name,
        selected: selectedConnectionId && conn.id === selectedConnectionId
    }));
    
    connectionDropdown.setItems(items);
    
    // Handle database selector visibility
    const selectedConnection = connections.find(c => c.id === selectedConnectionId);
    if (selectedConnection && selectedConnection.connectionType === 'server') {
        databaseLabel.style.display = 'inline-block';
        databaseDropdown.show();
        // Request databases list from extension - pass current database selection
        vscode.postMessage({
            type: 'getDatabases',
            connectionId: selectedConnectionId,
            selectedDatabase: currentDatabaseName
        });
    } else {
        databaseLabel.style.display = 'none';
        databaseDropdown.hide();
        
        // Request schema for direct database connection
        if (selectedConnectionId) {
            vscode.postMessage({ 
                type: 'getSchema', 
                connectionId: selectedConnectionId 
            });
        }
    }
}

function updateDatabasesList(databases, selectedDatabase) {
    if (!databases || databases.length === 0) {
        databaseDropdown.setItems([{
            value: '',
            text: 'No databases available',
            selected: true
        }]);
        databaseDropdown.setDisabled(true);
        return;
    }
    
    databaseDropdown.setDisabled(false);
    
    const items = databases.map(dbName => ({
        value: dbName,
        text: dbName,
        selected: selectedDatabase && dbName === selectedDatabase
    }));
    
    databaseDropdown.setItems(items);
    
    // If a database is selected, request its schema
    if (selectedDatabase && currentConnectionId) {
        vscode.postMessage({ 
            type: 'getSchema', 
            connectionId: `${currentConnectionId}::${selectedDatabase}` 
        });
    }
}

function showLoading() {
    const resultsContent = document.getElementById('resultsContent');
    const statusLabel = document.getElementById('statusLabel');
    const executeButton = document.getElementById('executeButton');
    const cancelButton = document.getElementById('cancelButton');
    const resizer = document.getElementById('resizer');
    
    resultsContent.innerHTML = '<div class="loading">Executing query...</div>';
    resultsContainer.classList.add('visible');
    resizer.classList.add('visible');
    
    executeButton.disabled = true;
    cancelButton.disabled = false;
    statusLabel.textContent = 'Executing query...';

    // Show results panel with initial height if not already set
    if (!resultsContainer.style.flex) {
        resultsContainer.style.flex = '0 0 300px';
    }

    // Switch to results tab
    document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.results-tab[data-tab="results"]').classList.add('active');
    currentTab = 'results';
    
    // Ensure results container is visible and messages is hidden
    document.getElementById('resultsContent').style.display = 'block';
    document.getElementById('messagesContent').style.display = 'none';
}

function showResults(resultSets, executionTime, rowsAffected, messages, planXml) {
    const executeButton = document.getElementById('executeButton');
    const cancelButton = document.getElementById('cancelButton');
    const statusLabel = document.getElementById('statusLabel');
    
    lastResults = resultSets;
    lastMessages = messages || [];
    
    executeButton.disabled = false;
    cancelButton.disabled = true;
    
    const totalRows = resultSets.reduce((sum, rs) => sum + rs.length, 0);
    statusLabel.textContent = `Query completed (${resultSets.length} result set(s), ${totalRows} rows)`;

    // Update aggregation stats (initially empty)
    updateAggregationStats();

    // Show/hide plan tabs based on whether we have a plan
    if (planXml) {
        // Parse and store the plan data
        currentQueryPlan = parseQueryPlan(planXml);
        
        // Show plan tabs
        document.querySelectorAll('.results-tab').forEach(tab => {
            if (tab.dataset.tab === 'queryPlan' || tab.dataset.tab === 'planTree' || tab.dataset.tab === 'topOperations') {
                tab.style.display = 'block';
            }
        });
        
        // Display the plan in different views
        displayQueryPlanGraphical(currentQueryPlan);
        displayPlanTree(currentQueryPlan);
        displayTopOperations(currentQueryPlan);
    } else {
        // Hide plan tabs when no plan
        document.querySelectorAll('.results-tab').forEach(tab => {
            if (tab.dataset.tab === 'queryPlan' || tab.dataset.tab === 'planTree' || tab.dataset.tab === 'topOperations') {
                tab.style.display = 'none';
            }
        });
    }

    // Always update both containers
    displayResults(resultSets, planXml);
    displayMessages(messages);
}

function displayResults(resultSets, planXml) {
    console.log('[SQL EDITOR] displayResults called with', resultSets.length, 'result set(s)');
    console.log('[SQL EDITOR] planXml present:', !!planXml, 'length:', planXml ? planXml.length : 0);
    const resultsContent = document.getElementById('resultsContent');
    console.log('[SQL EDITOR] resultsContent element:', resultsContent);

    if (!resultSets || resultSets.length === 0) {
        resultsContent.innerHTML = '<div class="no-results">No rows returned</div>';
        return;
    }

    // Clear previous content
    resultsContent.innerHTML = '';
    
    // Determine if we should use single-result-set mode (100% height)
    const isSingleResultSet = resultSets.length === 1 && !planXml;
    
    // Add appropriate class to resultsContent
    if (isSingleResultSet) {
        resultsContent.classList.add('single-result-set');
        resultsContent.classList.remove('multiple-result-sets');
    } else {
        resultsContent.classList.add('multiple-result-sets');
        resultsContent.classList.remove('single-result-set');
    }

    // Create a table for each result set
    resultSets.forEach((results, index) => {
        if (!results || results.length === 0) {
            return;
        }

        // Create container for this result set
        const resultSetContainer = document.createElement('div');
        resultSetContainer.className = 'result-set-container';
        if (isSingleResultSet) {
            resultSetContainer.classList.add('full-height');
        }

        // Create table container
        const tableContainer = document.createElement('div');
        tableContainer.className = 'result-set-table';
        if (isSingleResultSet) {
            tableContainer.classList.add('full-height');
        }
        
        // Initialize AG-Grid-like table for this result set
        console.log('[SQL EDITOR] Creating table for result set', index + 1, 'with', results.length, 'rows');
        initAgGridTable(results, tableContainer, isSingleResultSet);
        
        resultSetContainer.appendChild(tableContainer);
        resultsContent.appendChild(resultSetContainer);
    });
    
    // Add execution plan as a separate result set if present
    if (planXml) {
        const planContainer = document.createElement('div');
        planContainer.className = 'result-set-container';
        planContainer.style.marginTop = '20px';
        
        const planTitle = document.createElement('h3');
        planTitle.textContent = 'Execution Plan (XML)';
        planTitle.style.marginBottom = '10px';
        planContainer.appendChild(planTitle);
        
        const planTableContainer = document.createElement('div');
        planTableContainer.className = 'result-set-table';
        
        // Create a single-cell table with the XML plan
        const planData = [{ 'Microsoft SQL Server 2005 XML Showplan': planXml }];
        initAgGridTable(planData, planTableContainer, false);
        
        planContainer.appendChild(planTableContainer);
        resultsContent.appendChild(planContainer);
    }
    
    // Check if the results content parent has overflow
    const resultsContainer = document.getElementById('resultsContainer');
    console.log('[SQL EDITOR] resultsContainer height:', resultsContainer?.offsetHeight);
    console.log('[SQL EDITOR] resultsContent height:', resultsContent?.offsetHeight, 'scrollHeight:', resultsContent?.scrollHeight);
}

function initAgGridTable(rowData, container, isSingleResultSet = false) {
    console.log('[AG-GRID] initAgGridTable called with', rowData.length, 'rows, single result set:', isSingleResultSet);
    console.log('[AG-GRID] Container element:', container, 'offsetHeight:', container.offsetHeight, 'scrollHeight:', container.scrollHeight);
    
    // Virtual scrolling configuration
    const ROW_HEIGHT = 30; // Fixed row height in pixels
    const VISIBLE_ROWS = 30; // Number of rows to render in viewport
    const BUFFER_ROWS = 10; // Extra rows to render above/below viewport
    const RENDER_CHUNK_SIZE = VISIBLE_ROWS + (BUFFER_ROWS * 2);
    
    // Detect column types and create columnDefs
    const columns = Object.keys(rowData[0]);
    console.log('[AG-GRID] Detected columns:', columns);
    
    const columnDefs = columns.map(col => {
        const sampleValue = rowData[0][col];
        let type = 'string';
        
        if (typeof sampleValue === 'number') {
            type = 'number';
        } else if (typeof sampleValue === 'boolean') {
            type = 'boolean';
        } else if (sampleValue instanceof Date || (typeof sampleValue === 'string' && !isNaN(Date.parse(sampleValue)) && sampleValue.match(/\\d{4}-\\d{2}-\\d{2}/))) {
            type = 'date';
        }
        
        return {
            field: col,
            headerName: col,
            type: type,
            width: 150,
            pinned: false
        };
    });

    console.log('[AG-GRID] Column definitions created:', columnDefs.map(c => ({ name: c.headerName, type: c.type, width: c.width })));

    let filteredData = [...rowData];
    let activeFilters = {};
    let currentFilterPopup = null;
    let sortConfig = { field: null, direction: null };
    
    // Virtual scrolling state
    let currentStartRow = 0;
    let scrollTimeout = null;

    // Build the table HTML structure with virtual scrolling support
    const tableId = `agGrid_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const viewportClass = isSingleResultSet ? 'ag-grid-viewport full-height' : 'ag-grid-viewport';
    const tableHtml = `
        <div class="${viewportClass}" style="overflow: auto; position: relative; height: 100%; width: 100%;">
            <table class="ag-grid-table" style="border-collapse: collapse; table-layout: auto; width: 100%;">
                <thead class="ag-grid-thead"></thead>
                <tbody class="ag-grid-tbody" style="position: relative;"></tbody>
            </table>
        </div>
    `;
    
    console.log('[AG-GRID] Setting container innerHTML');
    container.innerHTML = tableHtml;
    
    const viewport = container.querySelector('.ag-grid-viewport');
    const table = container.querySelector('.ag-grid-table');
    const tbody = container.querySelector('.ag-grid-tbody');
    console.log('[AG-GRID] Table element:', table, 'border-collapse:', table?.style.borderCollapse);

    renderAgGridHeaders(columnDefs, sortConfig, activeFilters, container, filteredData);
    renderAgGridRows(columnDefs, filteredData, container, 0, ROW_HEIGHT, RENDER_CHUNK_SIZE);
    
    // Set up virtual scrolling
    viewport.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            const scrollTop = viewport.scrollTop;
            const newStartRow = Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS;
            const clampedStartRow = Math.max(0, Math.min(newStartRow, filteredData.length - RENDER_CHUNK_SIZE));
            
            if (clampedStartRow !== currentStartRow) {
                currentStartRow = clampedStartRow;
                renderAgGridRows(columnDefs, filteredData, container, currentStartRow, ROW_HEIGHT, RENDER_CHUNK_SIZE);
            }
        }, 10);
    });
    
    console.log('[AG-GRID] Virtual scrolling initialized with', filteredData.length, 'total rows, rendering', RENDER_CHUNK_SIZE, 'at a time');

    function renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, data) {
        console.log('[AG-GRID] renderAgGridHeaders called with', colDefs.length, 'columns');
        const thead = containerEl.querySelector('.ag-grid-thead');
        if (!thead) {
            console.error('[AG-GRID] thead element not found!');
            return;
        }
        
        const tr = document.createElement('tr');
        
        // Add row number header
        const rowNumTh = document.createElement('th');
        rowNumTh.className = 'ag-grid-row-number-header';
        rowNumTh.textContent = '#';
        
        // Set styles individually to avoid cssText issues
        rowNumTh.style.width = '50px';
        rowNumTh.style.minWidth = '50px';
        rowNumTh.style.maxWidth = '50px';
        rowNumTh.style.borderBottom = '1px solid var(--vscode-panel-border, #3c3c3c)';
        rowNumTh.style.padding = '8px';
        
        console.log('[AG-GRID] Row number header created with class:', rowNumTh.className);
        tr.appendChild(rowNumTh);
        
        const totalWidth = colDefs.reduce((sum, col) => sum + col.width, 0) + 50;
        const table = containerEl.querySelector('.ag-grid-table');
        table.style.width = totalWidth + 'px';
        table.style.minWidth = totalWidth + 'px';
        console.log('[AG-GRID] Table total width set to:', totalWidth);

        colDefs.forEach((col, index) => {
            const th = document.createElement('th');
            
            // Base styles - set individually to avoid cssText overriding
            th.style.width = col.width + 'px';
            th.style.minWidth = col.width + 'px';
            th.style.maxWidth = col.width + 'px';
            th.style.backgroundColor = 'var(--vscode-editorGroupHeader-tabsBackground, #252526)';
            th.style.borderBottom = '1px solid var(--vscode-panel-border, #3c3c3c)';
            th.style.borderRight = '1px solid var(--vscode-panel-border, #3c3c3c)';
            th.style.padding = '8px';
            th.style.textAlign = 'left';
            th.style.fontWeight = '600';
            th.style.userSelect = 'none';
            th.style.whiteSpace = 'nowrap';
            th.style.overflow = 'hidden';
            th.style.textOverflow = 'ellipsis';
            
            // Don't set position, top, or z-index inline - let CSS classes handle it
            console.log(`[AG-GRID] Header for column "${col.headerName}" - pinned: ${col.pinned}`);
            
            if (col.pinned) {
                const leftOffset = calculatePinnedOffset(colDefs, index);
                th.style.left = leftOffset + 'px';
                th.classList.add('ag-grid-pinned-header');
                console.log(`[AG-GRID] Pinned column "${col.headerName}" left offset:`, leftOffset);
            }
            
            th.dataset.field = col.field;

            const headerContent = document.createElement('div');
            headerContent.style.cssText = 'position: relative; width: 100%; height: 100%; display: flex; align-items: center;';

            const headerTitle = document.createElement('span');
            headerTitle.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; width: 100%; display: block;';
            headerTitle.textContent = col.headerName;

            headerTitle.onclick = (e) => {
                e.stopPropagation();
                highlightColumn(index, colDefs, containerEl, filteredData, e);
            };
            
            // Add context menu for column header
            headerTitle.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                showColumnHeaderContextMenu(e, {
                    table: containerEl.querySelector('.ag-grid-table'),
                    columnIndex: index,
                    columnDefs: colDefs,
                    data: data
                });
            };

            headerContent.appendChild(headerTitle);

            // Action buttons positioned absolutely on the right (no container)
            const sortIcon = document.createElement('span');
            const isSorted = sortCfg.field === col.field;
            sortIcon.className = 'ag-header-icon';
            sortIcon.style.cssText = `
                position: absolute;
                right: 44px;
                top: 50%;
                transform: translateY(-50%);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                padding: 4px;
                border-radius: 2px;
                opacity: ${isSorted ? 1 : 0};
                transition: opacity 0.2s, background-color 0.2s;
                background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
                z-index: 1;
            `;
            
            if (isSorted) {
                // Show chevron when sorted
                sortIcon.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--vscode-button-background, #0e639c)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="${sortCfg.direction === 'desc' ? 'transform: rotate(180deg);' : ''}">
                        <path d="M6 15l6 -6l6 6" />
                    </svg>
                `;
            } else {
                // Show sort icon when not sorted
                sortIcon.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 9l4 -4l4 4m-4 -4v14" />
                        <path d="M21 15l-4 4l-4 -4m4 4v-14" />
                    </svg>
                `;
            }
            
            sortIcon.onclick = (e) => {
                e.stopPropagation();
                handleSort(col, colDefs, sortCfg, filters, containerEl);
            };
            
            sortIcon.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            headerContent.appendChild(sortIcon);

            const pinIcon = document.createElement('span');
            pinIcon.className = 'ag-header-icon';
            pinIcon.style.cssText = `
                position: absolute;
                right: 24px;
                top: 50%;
                transform: translateY(-50%);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                padding: 4px;
                border-radius: 2px;
                opacity: ${col.pinned ? 1 : 0};
                transition: opacity 0.2s, background-color 0.2s;
                background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
                z-index: 1;
            `;
            pinIcon.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${col.pinned ? 'var(--vscode-button-background, #0e639c)' : 'currentColor'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4" />
                    <path d="M9 15l-4.5 4.5" />
                    <path d="M14.5 4l5.5 5.5" />
                </svg>
            `;
            pinIcon.onclick = (e) => {
                e.stopPropagation();
                // Preserve current vertical scroll position so user doesn't jump to top
                try {
                    const prevScrollTop = viewport.scrollTop;
                    const prevStartRow = Math.floor(prevScrollTop / ROW_HEIGHT);

                    // Toggle pinned state
                    col.pinned = !col.pinned;

                    // Re-render headers first (pinned classes may change layout)
                    renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, filteredData);

                    // Re-render rows keeping the user's current view
                    currentStartRow = Math.max(0, Math.min(prevStartRow, Math.max(0, filteredData.length - RENDER_CHUNK_SIZE)));
                    renderAgGridRows(colDefs, filteredData, containerEl, currentStartRow, ROW_HEIGHT, RENDER_CHUNK_SIZE);

                    // Restore exact scroll position (in case row heights/layout changed slightly)
                    // Use requestAnimationFrame to ensure DOM was updated
                    requestAnimationFrame(() => {
                        viewport.scrollTop = prevScrollTop;
                    });
                } catch (err) {
                    // Fallback to safe behavior: render from top
                    col.pinned = !col.pinned;
                    currentStartRow = 0;
                    viewport.scrollTop = 0;
                    renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, filteredData);
                    renderAgGridRows(colDefs, filteredData, containerEl, 0, ROW_HEIGHT, RENDER_CHUNK_SIZE);
                }
            };
            
            pinIcon.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            headerContent.appendChild(pinIcon);

            const filterIcon = document.createElement('span');
            const isFiltered = !!filters[col.field];
            filterIcon.className = 'ag-header-icon';
            filterIcon.style.cssText = `
                position: absolute;
                right: 4px;
                top: 50%;
                transform: translateY(-50%);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                padding: 4px;
                border-radius: 2px;
                opacity: ${isFiltered ? 1 : 0};
                transition: opacity 0.2s, background-color 0.2s;
                background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
                z-index: 1;
            `;
            filterIcon.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${isFiltered ? 'var(--vscode-button-background, #0e639c)' : 'currentColor'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227z" />
                </svg>
            `;
            filterIcon.onclick = (e) => showAgGridFilter(e, col, th, colDefs, sortCfg, filters, containerEl);
            
            filterIcon.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            headerContent.appendChild(filterIcon);

            // Add hover effect to show icons
            th.onmouseenter = () => {
                if (!isSorted) sortIcon.style.opacity = '1';
                if (!col.pinned) pinIcon.style.opacity = '1';
                if (!isFiltered) filterIcon.style.opacity = '1';
            };
            th.onmouseleave = () => {
                if (!isSorted) sortIcon.style.opacity = '0';
                if (!col.pinned) pinIcon.style.opacity = '0';
                if (!isFiltered) filterIcon.style.opacity = '0';
            };

            // Add resize handle
            const resizeHandle = document.createElement('div');
            resizeHandle.style.cssText = `
                position: absolute;
                right: 0;
                top: 0;
                width: 4px;
                height: 100%;
                cursor: col-resize;
                background-color: transparent;
                transition: background-color 0.2s;
                z-index: 25;
            `;
            resizeHandle.onmouseover = () => resizeHandle.style.backgroundColor = 'var(--vscode-button-background, #0e639c)';
            resizeHandle.onmouseout = () => resizeHandle.style.backgroundColor = 'transparent';
            resizeHandle.onmousedown = (e) => startResize(e, th, index, colDefs, sortCfg, filters, containerEl);
            resizeHandle.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            th.style.position = 'relative';
            th.appendChild(headerContent);
            th.appendChild(resizeHandle);
            tr.appendChild(th);
        });

        thead.innerHTML = '';
        thead.appendChild(tr);
    }

    // Column highlighting functionality
    function highlightColumn(colIndex, colDefs, containerEl, filteredData, event) {
        const ctrlPressed = event?.ctrlKey || event?.metaKey;
        const shiftPressed = event?.shiftKey;
        
        // Check if same table
        const sameTable = globalSelection.tableContainer === containerEl;
        const sameType = globalSelection.type === 'column';
        
        if (shiftPressed && sameTable && sameType && globalSelection.lastClickedIndex !== null) {
            // Shift: select range from last clicked to current
            const start = Math.min(globalSelection.lastClickedIndex, colIndex);
            const end = Math.max(globalSelection.lastClickedIndex, colIndex);
            
            clearAllSelections();
            globalSelection.selections = [];
            
            for (let i = start; i <= end; i++) {
                globalSelection.selections.push({ columnIndex: i });
                applyColumnHighlightGlobal(containerEl, i);
            }
            
            globalSelection.type = 'column';
            globalSelection.tableContainer = containerEl;
            globalSelection.data = filteredData;
            globalSelection.columnDefs = colDefs;
        } else if (ctrlPressed && sameTable && sameType) {
            // Ctrl: toggle individual selection
            const existingIndex = globalSelection.selections.findIndex(s => s.columnIndex === colIndex);
            
            if (existingIndex >= 0) {
                // Remove from selection
                globalSelection.selections.splice(existingIndex, 1);
                
                if (globalSelection.selections.length === 0) {
                    // No more selections
                    clearAllSelections();
                    globalSelection = {
                        type: null,
                        tableContainer: null,
                        selections: [],
                        columnDef: null,
                        data: null,
                        columnDefs: null,
                        lastClickedIndex: null
                    };
                } else {
                    // Reapply all selections
                    clearAllSelections();
                    globalSelection.selections.forEach(s => {
                        applyColumnHighlightGlobal(containerEl, s.columnIndex);
                    });
                }
            } else {
                // Add to selection
                globalSelection.selections.push({ columnIndex: colIndex });
                applyColumnHighlightGlobal(containerEl, colIndex);
            }
            
            globalSelection.lastClickedIndex = colIndex;
        } else {
            // Normal click: single selection
            const isAlreadySelected = sameTable && sameType && 
                globalSelection.selections.length === 1 && 
                globalSelection.selections[0].columnIndex === colIndex;
            
            if (isAlreadySelected) {
                // Unselect - clear all selections
                clearAllSelections();
                globalSelection = {
                    type: null,
                    tableContainer: null,
                    selections: [],
                    columnDef: null,
                    data: null,
                    columnDefs: null,
                    lastClickedIndex: null
                };
            } else {
                // Clear all selections across all tables
                clearAllSelections();
                
                // Set global selection state
                globalSelection = {
                    type: 'column',
                    tableContainer: containerEl,
                    selections: [{ columnIndex: colIndex }],
                    columnDef: colDefs[colIndex],
                    data: filteredData,
                    columnDefs: colDefs,
                    lastClickedIndex: colIndex
                };
                
                // Apply highlighting
                applyColumnHighlightGlobal(containerEl, colIndex);
            }
        }
        
        // Update aggregation stats
        updateAggregationStats();
    }

    // Column resizing functionality
    let resizingColumn = null;
    let startX = 0;
    let startWidth = 0;
    
    function doResize(e) {
        if (!resizingColumn) return;

        const diff = e.clientX - startX;
        const newWidth = Math.max(50, startWidth + diff);
        
        resizingColumn.th.style.width = newWidth + 'px';
        resizingColumn.th.style.minWidth = newWidth + 'px';
        resizingColumn.th.style.maxWidth = newWidth + 'px';
        resizingColumn.colDefs[resizingColumn.colIndex].width = newWidth;
        
        // Update total table width
        const totalWidth = resizingColumn.colDefs.reduce((sum, col) => sum + col.width, 0) + 50;
        const table = resizingColumn.containerEl.querySelector('.ag-grid-table');
        table.style.width = totalWidth + 'px';
        table.style.minWidth = totalWidth + 'px';
        
        // Update all cells in this column (+2 because row number is first column)
        const cells = table.querySelectorAll(`td:nth-child(${resizingColumn.colIndex + 2})`);
        cells.forEach(cell => {
            cell.style.width = newWidth + 'px';
            cell.style.minWidth = newWidth + 'px';
            cell.style.maxWidth = newWidth + 'px';
        });
    }
    
    function stopResize() {
        resizingColumn = null;
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
    }

    function startResize(e, th, colIndex, colDefs, sortCfg, filters, containerEl) {
        resizingColumn = { th, colIndex, colDefs, containerEl };
        startX = e.clientX;
        startWidth = th.offsetWidth;

        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
        e.preventDefault();
        e.stopPropagation();
    }

    function renderAgGridRows(colDefs, data, containerEl, startRow = 0, rowHeight = 30, chunkSize = 50) {
        console.log('[AG-GRID] renderAgGridRows called - total:', data.length, 'rows, rendering from:', startRow, 'chunk:', chunkSize);
        const tbody = containerEl.querySelector('.ag-grid-tbody');
        if (!tbody) {
            console.error('[AG-GRID] tbody element not found!');
            return;
        }
        
        // Clear existing rows
        tbody.innerHTML = '';
        
        // Calculate visible range
        const endRow = Math.min(startRow + chunkSize, data.length);
        const totalHeight = data.length * rowHeight;
        const offsetY = startRow * rowHeight;
        
        // Set tbody height to accommodate all rows (for scrolling)
        tbody.style.height = totalHeight + 'px';
        
        console.log('[AG-GRID] Rendering rows', startRow, 'to', endRow, '- offset:', offsetY, 'total height:', totalHeight);

        // Only render visible rows
        for (let i = startRow; i < endRow; i++) {
            const row = data[i];
            const rowIndex = i;
            
            const tr = document.createElement('tr');
            tr.dataset.rowIndex = rowIndex;
            // Position rows absolutely with calculated offset
            tr.style.cssText = `
                position: absolute;
                top: ${i * rowHeight}px;
                left: 0;
                right: 0;
                height: ${rowHeight}px;
                border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
                display: table;
                width: 100%;
                table-layout: fixed;
            `;
            // Mouse hover handling
            tr.addEventListener('mouseenter', function() {
                if (!this.classList.contains('selected')) {
                    this.style.backgroundColor = 'var(--vscode-list-hoverBackground, #2a2d2e)';
                }
            });
            tr.addEventListener('mouseleave', function() {
                if (!this.classList.contains('selected')) {
                    this.style.backgroundColor = '';
                }
            });

            // Add row number cell
            const rowNumTd = document.createElement('td');
            rowNumTd.className = 'ag-grid-row-number-cell';
            rowNumTd.textContent = rowIndex + 1;
            
            // Set styles individually to avoid cssText overriding class styles
            rowNumTd.style.width = '50px';
            rowNumTd.style.minWidth = '50px';
            rowNumTd.style.maxWidth = '50px';
            rowNumTd.style.cursor = 'pointer';
            rowNumTd.style.padding = '0 8px';
            rowNumTd.style.whiteSpace = 'nowrap';
            rowNumTd.style.overflow = 'hidden';
            rowNumTd.style.textOverflow = 'ellipsis';
            rowNumTd.style.height = rowHeight + 'px';
            rowNumTd.style.lineHeight = rowHeight + 'px';
            rowNumTd.style.display = 'table-cell';
            rowNumTd.style.verticalAlign = 'middle';
            
            rowNumTd.addEventListener('mouseenter', function() {
                if (!tr.classList.contains('selected')) {
                    this.style.backgroundColor = 'var(--vscode-list-hoverBackground, #2a2d2e)';
                }
            });
            rowNumTd.addEventListener('mouseleave', function() {
                if (!tr.classList.contains('selected')) {
                    this.style.backgroundColor = 'var(--vscode-editor-background, #1e1e1e)';
                }
            });
            rowNumTd.addEventListener('click', function(event) {
                const ctrlPressed = event.ctrlKey || event.metaKey;
                const shiftPressed = event.shiftKey;
                
                // Check if same table
                const sameTable = globalSelection.tableContainer === containerEl;
                const sameType = globalSelection.type === 'row';
                
                if (shiftPressed && sameTable && sameType && globalSelection.lastClickedIndex !== null) {
                    // Shift: select range from last clicked to current
                    const start = Math.min(globalSelection.lastClickedIndex, rowIndex);
                    const end = Math.max(globalSelection.lastClickedIndex, rowIndex);
                    
                    clearAllSelections();
                    globalSelection.selections = [];
                    
                    for (let i = start; i <= end; i++) {
                        globalSelection.selections.push({ rowIndex: i });
                        applyRowHighlightGlobal(containerEl, i);
                    }
                    
                    globalSelection.type = 'row';
                    globalSelection.tableContainer = containerEl;
                    globalSelection.data = data;
                    globalSelection.columnDefs = colDefs;
                } else if (ctrlPressed && sameTable && sameType) {
                    // Ctrl: toggle individual selection
                    const existingIndex = globalSelection.selections.findIndex(s => s.rowIndex === rowIndex);
                    
                    if (existingIndex >= 0) {
                        // Remove from selection
                        globalSelection.selections.splice(existingIndex, 1);
                        
                        if (globalSelection.selections.length === 0) {
                            // No more selections
                            clearAllSelections();
                            globalSelection = {
                                type: null,
                                tableContainer: null,
                                selections: [],
                                columnDef: null,
                                data: null,
                                columnDefs: null,
                                lastClickedIndex: null
                            };
                        } else {
                            // Reapply all selections
                            clearAllSelections();
                            globalSelection.selections.forEach(s => {
                                applyRowHighlightGlobal(containerEl, s.rowIndex);
                            });
                        }
                    } else {
                        // Add to selection
                        globalSelection.selections.push({ rowIndex: rowIndex });
                        applyRowHighlightGlobal(containerEl, rowIndex);
                    }
                    
                    globalSelection.lastClickedIndex = rowIndex;
                } else {
                    // Normal click: single selection
                    const isAlreadySelected = sameTable && sameType && 
                        globalSelection.selections.length === 1 && 
                        globalSelection.selections[0].rowIndex === rowIndex;
                    
                    if (isAlreadySelected) {
                        // Unselect - clear all selections
                        clearAllSelections();
                        globalSelection = {
                            type: null,
                            tableContainer: null,
                            selections: [],
                            columnDef: null,
                            data: null,
                            columnDefs: null,
                            lastClickedIndex: null
                        };
                    } else {
                        // Clear all selections across all tables
                        clearAllSelections();
                        
                        // Set global selection state
                        globalSelection = {
                            type: 'row',
                            tableContainer: containerEl,
                            selections: [{ rowIndex: rowIndex }],
                            data: data,
                            columnDefs: colDefs,
                            lastClickedIndex: rowIndex
                        };
                        
                        // Apply highlighting
                        applyRowHighlightGlobal(containerEl, rowIndex);
                    }
                }
                
                // Update aggregation stats
                updateAggregationStats();
            });
            
            // Add context menu for row number cell
            rowNumTd.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showRowContextMenu(e, {
                    table: containerEl.querySelector('.ag-grid-table'),
                    rowIndex: rowIndex,
                    columnDefs: colDefs,
                    data: data
                });
            });
            tr.appendChild(rowNumTd);

            colDefs.forEach((col, colIndex) => {
                const td = document.createElement('td');
                
                // Base styles
                td.style.width = col.width + 'px';
                td.style.minWidth = col.width + 'px';
                td.style.maxWidth = col.width + 'px';
                td.style.borderRight = '1px solid var(--vscode-panel-border, #3c3c3c)';
                td.style.padding = '0 8px';
                td.style.whiteSpace = 'nowrap';
                td.style.overflow = 'hidden';
                td.style.textOverflow = 'ellipsis';
                td.style.height = rowHeight + 'px';
                td.style.lineHeight = rowHeight + 'px';
                td.style.display = 'table-cell';
                td.style.verticalAlign = 'middle';
                
                if (col.pinned) {
                    const leftOffset = calculatePinnedOffset(colDefs, colIndex);
                    td.style.left = leftOffset + 'px';
                    td.classList.add('ag-grid-pinned-cell');
                }
                
                const value = row[col.field];
                
                if (value === null || value === undefined) {
                    td.textContent = 'NULL';
                    td.style.color = 'var(--vscode-descriptionForeground)';
                    td.style.fontStyle = 'italic';
                } else if (col.type === 'boolean') {
                    td.textContent = value ? '✓' : '✗';
                } else if (col.type === 'number') {
                    td.textContent = typeof value === 'number' ? value.toLocaleString() : value;
                    td.style.textAlign = 'right';
                } else {
                    const strValue = String(value);
                    td.textContent = strValue;
                    
                    // Check if content is valid JSON or XML
                    const isJSON = isValidJSON(strValue);
                    const isXML = !isJSON && isValidXML(strValue);
                    
                    if (isJSON || isXML) {
                        // Make it clickable
                        td.classList.add('clickable-cell');
                        td.style.cursor = 'pointer';
                        td.style.color = 'var(--vscode-textLink-foreground, #3794ff)';
                        
                        // Add hover effect
                        td.addEventListener('mouseenter', function() {
                            this.style.textDecoration = 'underline';
                        });
                        td.addEventListener('mouseleave', function() {
                            this.style.textDecoration = 'none';
                        });
                        
                        // Add click handler to open in new editor
                        const contentType = isJSON ? 'json' : 'xml';
                        td.addEventListener('click', function(e) {
                            // Prevent context menu or selection behavior
                            e.stopPropagation();
                            
                            const formatted = isJSON ? formatJSON(strValue) : formatXML(strValue);
                            openInNewEditor(formatted, contentType);
                        });
                        
                        // Update title to indicate it's clickable
                        td.title = `Click to open ${contentType.toUpperCase()} in new editor\n\n${strValue.substring(0, 200)}${strValue.length > 200 ? '...' : ''}`;
                    }
                }
                
                // Add context menu handler
                td.addEventListener('contextmenu', (e) => {
                    showContextMenu(e, {
                        table: containerEl.querySelector('.ag-grid-table'),
                        rowIndex: rowIndex,
                        columnIndex: colIndex,
                        columnDefs: colDefs,
                        data: data
                    });
                });
                
                // Add click handler for cell selection
                td.addEventListener('click', (e) => {
                    const ctrlPressed = e.ctrlKey || e.metaKey;
                    const shiftPressed = e.shiftKey;
                    
                    // Check if same table
                    const sameTable = globalSelection.tableContainer === containerEl;
                    const sameType = globalSelection.type === 'cell';
                    
                    if (shiftPressed && sameTable && sameType && globalSelection.lastClickedIndex !== null) {
                        // Shift: select rectangular range from last clicked to current
                        const lastSel = globalSelection.lastClickedIndex;
                        const startRow = Math.min(lastSel.rowIndex, rowIndex);
                        const endRow = Math.max(lastSel.rowIndex, rowIndex);
                        const startCol = Math.min(lastSel.columnIndex, colIndex);
                        const endCol = Math.max(lastSel.columnIndex, colIndex);
                        
                        clearAllSelections();
                        globalSelection.selections = [];
                        
                        for (let r = startRow; r <= endRow; r++) {
                            for (let c = startCol; c <= endCol; c++) {
                                globalSelection.selections.push({ 
                                    rowIndex: r, 
                                    columnIndex: c,
                                    cellValue: data[r][colDefs[c].field]
                                });
                                applyCellHighlightGlobal(containerEl, r, c);
                            }
                        }
                        
                        globalSelection.type = 'cell';
                        globalSelection.tableContainer = containerEl;
                        globalSelection.data = data;
                        globalSelection.columnDefs = colDefs;
                    } else if (ctrlPressed && sameTable && sameType) {
                        // Ctrl: toggle individual cell
                        const existingIndex = globalSelection.selections.findIndex(
                            s => s.rowIndex === rowIndex && s.columnIndex === colIndex
                        );
                        
                        if (existingIndex >= 0) {
                            // Remove from selection
                            globalSelection.selections.splice(existingIndex, 1);
                            
                            if (globalSelection.selections.length === 0) {
                                // No more selections
                                clearAllSelections();
                                globalSelection = {
                                    type: null,
                                    tableContainer: null,
                                    selections: [],
                                    columnDef: null,
                                    data: null,
                                    columnDefs: null,
                                    lastClickedIndex: null
                                };
                            } else {
                                // Reapply all selections
                                clearAllSelections();
                                globalSelection.selections.forEach(s => {
                                    applyCellHighlightGlobal(containerEl, s.rowIndex, s.columnIndex);
                                });
                            }
                        } else {
                            // Add to selection
                            globalSelection.selections.push({ 
                                rowIndex: rowIndex, 
                                columnIndex: colIndex,
                                cellValue: row[col.field]
                            });
                            applyCellHighlightGlobal(containerEl, rowIndex, colIndex);
                        }
                        
                        globalSelection.lastClickedIndex = { rowIndex, columnIndex };
                    } else {
                        // Normal click: single selection
                        const isAlreadySelected = sameTable && sameType && 
                            globalSelection.selections.length === 1 && 
                            globalSelection.selections[0].rowIndex === rowIndex &&
                            globalSelection.selections[0].columnIndex === colIndex;
                        
                        if (isAlreadySelected) {
                            // Unselect - clear all selections
                            clearAllSelections();
                            globalSelection = {
                                type: null,
                                tableContainer: null,
                                selections: [],
                                columnDef: null,
                                data: null,
                                columnDefs: null,
                                lastClickedIndex: null
                            };
                        } else {
                            // Clear all selections across all tables
                            clearAllSelections();
                            
                            // Set global selection state
                            globalSelection = {
                                type: 'cell',
                                tableContainer: containerEl,
                                selections: [{ 
                                    rowIndex: rowIndex, 
                                    columnIndex: colIndex,
                                    cellValue: row[col.field]
                                }],
                                columnDef: colDefs[colIndex],
                                data: data,
                                columnDefs: colDefs,
                                lastClickedIndex: { rowIndex, columnIndex }
                            };
                            
                            // Apply highlighting
                            applyCellHighlightGlobal(containerEl, rowIndex, colIndex);
                        }
                    }
                    
                    // Update aggregation stats
                    updateAggregationStats();
                });

                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        }
        
        console.log('[AG-GRID] Rendered', endRow - startRow, 'rows successfully (from', startRow, 'to', endRow, ')');
        
        // Reapply selection if this is the selected table
        if (globalSelection.tableContainer === containerEl) {
            reapplySelection();
        }
    }

    function calculatePinnedOffset(colDefs, colIndex) {
        let offset = 50; // Start after row number column
        for (let i = 0; i < colIndex; i++) {
            if (colDefs[i].pinned) {
                offset += colDefs[i].width;
            }
        }
        return offset;
    }

    function handleSort(col, colDefs, sortCfg, filters, containerEl) {
        if (sortCfg.field === col.field) {
            if (sortCfg.direction === 'asc') {
                sortCfg.direction = 'desc';
            } else if (sortCfg.direction === 'desc') {
                sortCfg.field = null;
                sortCfg.direction = null;
            }
        } else {
            sortCfg.field = col.field;
            sortCfg.direction = 'asc';
        }
        
        currentStartRow = 0; // Reset to top after sort
        const viewport = containerEl.querySelector('.ag-grid-viewport');
        if (viewport) viewport.scrollTop = 0;
        
        updateFilteredData(colDefs, sortCfg, filters, containerEl);
        renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, filteredData);
    }

    function showAgGridFilter(e, col, th, colDefs, sortCfg, filters, containerEl) {
        e.stopPropagation();

        if (currentFilterPopup) {
            currentFilterPopup.remove();
            currentFilterPopup = null;
        }

        const popup = document.createElement('div');
        popup.style.cssText = `
            position: absolute;
            background-color: var(--vscode-dropdown-background, #3c3c3c);
            border: 1px solid var(--vscode-dropdown-border, #454545);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
            padding: 12px;
            z-index: 1000;
            min-width: 200px;
            max-width: 300px;
            border-radius: 3px;
        `;

        const rect = th.getBoundingClientRect();
        popup.style.left = rect.left + 'px';
        popup.style.top = (rect.bottom + 5) + 'px';

        let html = `<h4 style="margin-bottom: 8px; font-size: 12px;">Filter: ${col.headerName}</h4>`;

        // Simple value selection for now
        const uniqueValues = [...new Set(rowData.map(row => row[col.field]))].sort();
        const currentFilter = filters[col.field];
        const selectedValues = currentFilter?.values || uniqueValues;

        html += '<input type="text" id="agFilterSearch" placeholder="Search..." style="width: 100%; padding: 4px 6px; margin-bottom: 8px; background-color: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); border: 1px solid var(--vscode-input-border, #3c3c3c); border-radius: 2px; font-size: 12px;">';
        html += '<div style="font-size: 11px; color: var(--vscode-descriptionForeground, #999999); margin-bottom: 4px;">' + selectedValues.length + ' Selected</div>';
        html += '<div style="margin-bottom: 8px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);">';
        html += '<label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" id="agSelectAll" ' + (selectedValues.length === uniqueValues.length ? 'checked' : '') + ' style="cursor: pointer; accent-color: var(--vscode-button-background, #0e639c);"><span style="font-size: 12px;">(Select All)</span></label>';
        html += '</div>';
        html += '<div id="agFilterValuesList" style="max-height: 200px; overflow-y: auto; margin-bottom: 8px;">';

        uniqueValues.forEach((value, idx) => {
            const displayValue = col.type === 'boolean' ? (value ? 'True' : 'False') : 
                               value === null || value === undefined ? 'NULL' : String(value);
            const checked = selectedValues.includes(value) ? 'checked' : '';
            html += `
                <label style="display: flex; align-items: center; gap: 6px; padding: 4px 0; cursor: pointer;" data-value="${displayValue.toString().toLowerCase()}">
                    <input type="checkbox" value="${value}" ${checked} class="ag-value-checkbox" style="cursor: pointer; accent-color: var(--vscode-button-background, #0e639c);">
                    <span style="flex: 1; font-size: 12px;">${displayValue}</span>
                </label>
            `;
        });

        html += '</div>';
        html += `
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="agFilterClear" style="padding: 4px 12px; background-color: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #cccccc); border: none; border-radius: 2px; cursor: pointer; font-size: 11px;">Clear</button>
                <button id="agFilterApply" style="padding: 4px 12px; background-color: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #ffffff); border: none; border-radius: 2px; cursor: pointer; font-size: 11px;">Apply</button>
            </div>
        `;

        popup.innerHTML = html;
        document.body.appendChild(popup);
        currentFilterPopup = popup;

        // Setup event listeners
        const searchInput = popup.querySelector('#agFilterSearch');
        searchInput.oninput = () => {
            const searchTerm = searchInput.value.toLowerCase();
            const items = popup.querySelectorAll('#agFilterValuesList label');
            items.forEach(item => {
                const value = item.dataset.value;
                item.style.display = value.includes(searchTerm) ? 'flex' : 'none';
            });
        };

        const selectAllCheckbox = popup.querySelector('#agSelectAll');
        const valueCheckboxes = popup.querySelectorAll('.ag-value-checkbox');
        
        selectAllCheckbox.onchange = () => {
            valueCheckboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
        };

        popup.querySelector('#agFilterClear').onclick = () => {
            delete filters[col.field];
            
            currentStartRow = 0; // Reset to top after clearing filter
            const viewport = containerEl.querySelector('.ag-grid-viewport');
            if (viewport) viewport.scrollTop = 0;
            
            updateFilteredData(colDefs, sortCfg, filters, containerEl);
            renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, filteredData);
            popup.remove();
            currentFilterPopup = null;
        };

        popup.querySelector('#agFilterApply').onclick = () => {
            const checkboxes = popup.querySelectorAll('.ag-value-checkbox:checked');
            const values = [...checkboxes].map(cb => {
                const val = cb.value;
                if (col.type === 'number') return parseFloat(val);
                if (col.type === 'boolean') return val === 'true';
                return val;
            });
            filters[col.field] = { values };
            
            currentStartRow = 0; // Reset to top after filter
            const viewport = containerEl.querySelector('.ag-grid-viewport');
            if (viewport) viewport.scrollTop = 0;
            
            updateFilteredData(colDefs, sortCfg, filters, containerEl);
            renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, filteredData);
            popup.remove();
            currentFilterPopup = null;
        };

        setTimeout(() => {
            document.addEventListener('click', closeFilterPopup);
        }, 0);

        function closeFilterPopup(e) {
            if (currentFilterPopup && !currentFilterPopup.contains(e.target)) {
                currentFilterPopup.remove();
                currentFilterPopup = null;
                document.removeEventListener('click', closeFilterPopup);
            }
        }
    }

    function updateFilteredData(colDefs, sortCfg, filters, containerEl) {
        filteredData = rowData.filter(row => {
            return Object.entries(filters).every(([field, filter]) => {
                const value = row[field];
                return filter.values && filter.values.includes(value);
            });
        });

        if (sortCfg.field) {
            filteredData.sort((a, b) => {
                const aVal = a[sortCfg.field];
                const bVal = b[sortCfg.field];
                
                let comparison = 0;
                if (aVal < bVal) comparison = -1;
                if (aVal > bVal) comparison = 1;
                
                return sortCfg.direction === 'asc' ? comparison : -comparison;
            });
        }

        renderAgGridRows(colDefs, filteredData, containerEl, currentStartRow, ROW_HEIGHT, RENDER_CHUNK_SIZE);
    }
}

function displayMessages(messages) {
    const messagesContent = document.getElementById('messagesContent');
    
    if (!messages || messages.length === 0) {
        messagesContent.innerHTML = '<div class="message info">No messages</div>';
        return;
    }

    let messagesHtml = '';
    messages.forEach(msg => {
        const msgClass = msg.type || 'info';
        messagesHtml += `<div class="message ${msgClass}">${escapeHtml(msg.text)}</div>`;
    });
    
    messagesContent.innerHTML = messagesHtml;
}

function showError(error, messages) {
    const executeButton = document.getElementById('executeButton');
    const cancelButton = document.getElementById('cancelButton');
    const statusLabel = document.getElementById('statusLabel');
    const resizer = document.getElementById('resizer');
    
    lastResults = [];
    lastMessages = messages || [{ type: 'error', text: error }];
    
    executeButton.disabled = false;
    cancelButton.disabled = true;
    
    const isCancelled = error.includes('cancel');
    statusLabel.textContent = isCancelled ? 'Query cancelled' : 'Query failed';

    resultsContainer.classList.add('visible');
    resizer.classList.add('visible');

    // Show results panel with initial height if not already set
    if (!resultsContainer.style.flex) {
        resultsContainer.style.flex = '0 0 300px';
    }

    // Switch to messages tab to show error
    document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.results-tab[data-tab="messages"]').classList.add('active');
    currentTab = 'messages';
    
    // Show messages container, hide results
    document.getElementById('resultsContent').style.display = 'none';
    document.getElementById('messagesContent').style.display = 'block';

    displayMessages(lastMessages);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// SQL Validation
function validateSql() {
    if (!editor || !dbSchema || dbSchema.tables.length === 0) {
        return;
    }
    
    const model = editor.getModel();
    if (!model) return;
    
    const content = model.getValue();
    const markers = [];
    
    console.log('[SQL-VALIDATION] Starting validation...');
    
    // Parse SQL to find table and column references
    const lines = content.split('\n');
    
    lines.forEach((line, lineIndex) => {
        const lowerLine = line.toLowerCase();
        
        // Find FROM and JOIN clauses - supports both unquoted and bracket-quoted identifiers
        // Matches: FROM table, FROM [table], FROM schema.table, FROM [schema].[table]
        const fromMatch = /\bfrom\s+(?:\[?(\w+)\]?\.)?(\[?[\w]+\]?)/gi;
        const joinMatch = /\bjoin\s+(?:\[?(\w+)\]?\.)?(\[?[\w]+\]?)/gi;
        
        let match;
        
        // Check table names in FROM
        while ((match = fromMatch.exec(line)) !== null) {
            const schema = match[1] || 'dbo';
            let tableName = match[2];
            
            // Remove brackets if present
            const cleanSchema = schema.replace(/[\[\]]/g, '');
            const cleanTableName = tableName.replace(/[\[\]]/g, '');
            
            const tableInfo = findTableByName(`${cleanSchema}.${cleanTableName}`);
            
            if (!tableInfo) {
                // Calculate position of the table name (not schema)
                const tableNameIndex = match.index + match[0].lastIndexOf(match[2]);
                const startColumn = tableNameIndex + 1;
                markers.push({
                    severity: monaco.MarkerSeverity.Error,
                    message: `Table '${cleanSchema}.${cleanTableName}' does not exist in the database`,
                    startLineNumber: lineIndex + 1,
                    startColumn: startColumn,
                    endLineNumber: lineIndex + 1,
                    endColumn: startColumn + match[2].length
                });
                console.log('[SQL-VALIDATION] Invalid table in FROM:', `${cleanSchema}.${cleanTableName}`);
            }
        }
        
        // Check table names in JOIN
        while ((match = joinMatch.exec(line)) !== null) {
            const schema = match[1] || 'dbo';
            let tableName = match[2];
            
            // Remove brackets if present
            const cleanSchema = schema.replace(/[\[\]]/g, '');
            const cleanTableName = tableName.replace(/[\[\]]/g, '');
            
            const tableInfo = findTableByName(`${cleanSchema}.${cleanTableName}`);
            
            if (!tableInfo) {
                // Calculate position of the table name (not schema)
                const tableNameIndex = match.index + match[0].lastIndexOf(match[2]);
                const startColumn = tableNameIndex + 1;
                markers.push({
                    severity: monaco.MarkerSeverity.Error,
                    message: `Table '${cleanSchema}.${cleanTableName}' does not exist in the database`,
                    startLineNumber: lineIndex + 1,
                    startColumn: startColumn,
                    endLineNumber: lineIndex + 1,
                    endColumn: startColumn + match[2].length
                });
                console.log('[SQL-VALIDATION] Invalid table in JOIN:', `${cleanSchema}.${cleanTableName}`);
            }
        }
        
        // Check column references (table.column pattern)
        const columnMatch = /\b([\w]+)\.([\w]+)\b/g;
        while ((match = columnMatch.exec(line)) !== null) {
            const tableOrAlias = match[1];
            const columnName = match[2];
            
            // Skip if it's a schema.table reference
            if (lowerLine.includes(`from ${match[0].toLowerCase()}`) || 
                lowerLine.includes(`join ${match[0].toLowerCase()}`)) {
                continue;
            }
            
            // Find the table in the query context
            const fullQuery = content.toLowerCase();
            const tableInfo = findTableForColumnCheck(fullQuery, tableOrAlias);
            
            if (tableInfo) {
                const column = tableInfo.columns.find(col => 
                    col.name.toLowerCase() === columnName.toLowerCase()
                );
                
                if (!column) {
                    const startColumn = match.index + match[1].length + 2; // +2 for the dot
                    markers.push({
                        severity: monaco.MarkerSeverity.Error,
                        message: `Column '${columnName}' does not exist in table '${tableInfo.name}'`,
                        startLineNumber: lineIndex + 1,
                        startColumn: startColumn,
                        endLineNumber: lineIndex + 1,
                        endColumn: startColumn + columnName.length
                    });
                    console.log('[SQL-VALIDATION] Invalid column:', columnName, 'in table:', tableInfo.name);
                }
            }
        }
    });
    
    console.log('[SQL-VALIDATION] Found', markers.length, 'validation errors');
    monaco.editor.setModelMarkers(model, 'sql-validation', markers);
}

function findTableByName(tableName) {
    const parts = tableName.split('.');
    const name = parts.length > 1 ? parts[1] : parts[0];
    const schema = parts.length > 1 ? parts[0] : 'dbo';
    
    return dbSchema.tables.find(t => 
        t.name.toLowerCase() === name.toLowerCase() && 
        t.schema.toLowerCase() === schema.toLowerCase()
    );
}

function findTableForColumnCheck(query, tableOrAlias) {
    // Try to find table by alias or name in the query
    const aliasPattern = new RegExp(`from\\s+(?:(\\w+)\\.)?(\\w+)\\s+(?:as\\s+)?${tableOrAlias}\\b`, 'i');
    const directPattern = new RegExp(`from\\s+(?:(\\w+)\\.)?(${tableOrAlias})\\b`, 'i');
    
    let match = aliasPattern.exec(query) || directPattern.exec(query);
    
    if (match) {
        const schema = match[1] || 'dbo';
        const tableName = match[2];
        return findTableByName(`${schema}.${tableName}`);
    }
    
    // Try JOIN clauses
    const joinPattern = new RegExp(`join\\s+(?:(\\w+)\\.)?(\\w+)\\s+(?:as\\s+)?${tableOrAlias}\\b`, 'i');
    match = joinPattern.exec(query);
    
    if (match) {
        const schema = match[1] || 'dbo';
        const tableName = match[2];
        return findTableByName(`${schema}.${tableName}`);
    }
    
    // Try direct table name
    return findTableByName(tableOrAlias);
}

// Update editor layout when window resizes
window.addEventListener('resize', () => {
    if (editor) {
        editor.layout();
    }
});

// Context menu functionality
let contextMenu = null;
let contextMenuData = null;
let rowContextMenu = null;
let columnHeaderContextMenu = null;

// Create context menu HTML for table cells
function createContextMenu(cellData) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.display = 'none';
    
    // Determine labels based on selection
    const hasMultipleSelections = globalSelection.selections && globalSelection.selections.length > 1;
    const selectionCount = globalSelection.selections ? globalSelection.selections.length : 0;
    
    let cellLabel = 'Copy Cell';
    let rowLabel = 'Copy Row';
    let rowHeaderLabel = 'Copy Row with Headers';
    let columnLabel = 'Copy Column';
    
    if (hasMultipleSelections) {
        if (globalSelection.type === 'cell') {
            cellLabel = `Copy ${selectionCount} Cells`;
        } else if (globalSelection.type === 'row') {
            rowLabel = `Copy ${selectionCount} Rows`;
            rowHeaderLabel = `Copy ${selectionCount} Rows with Headers`;
        } else if (globalSelection.type === 'column') {
            columnLabel = `Copy ${selectionCount} Columns`;
        }
    }
    
    menu.innerHTML = `
        <div class="context-menu-item" data-action="copy-cell">${cellLabel}</div>
        <div class="context-menu-item" data-action="copy-row">${rowLabel}</div>
        <div class="context-menu-item" data-action="copy-row-header">${rowHeaderLabel}</div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" data-action="copy-column">${columnLabel}</div>
        <div class="context-menu-item" data-action="copy-table">Copy Table</div>
    `;
    document.body.appendChild(menu);
    
    // Prevent default context menu on the custom menu itself
    menu.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Add click handlers
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const action = item.dataset.action;
            handleContextMenuAction(action);
            hideContextMenu();
        });
    });
    
    return menu;
}

// Create context menu HTML for row number cells
function createRowContextMenu() {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.display = 'none';
    
    // Determine labels based on selection
    const hasMultipleSelections = globalSelection.selections && globalSelection.selections.length > 1;
    const selectionCount = globalSelection.selections ? globalSelection.selections.length : 0;
    
    let rowLabel = 'Copy Row';
    let rowHeaderLabel = 'Copy Row with Headers';
    
    if (hasMultipleSelections && globalSelection.type === 'row') {
        rowLabel = `Copy ${selectionCount} Rows`;
        rowHeaderLabel = `Copy ${selectionCount} Rows with Headers`;
    }
    
    menu.innerHTML = `
        <div class="context-menu-item" data-action="copy-row">${rowLabel}</div>
        <div class="context-menu-item" data-action="copy-row-header">${rowHeaderLabel}</div>
    `;
    document.body.appendChild(menu);
    
    // Prevent default context menu on the custom menu itself
    menu.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Add click handlers
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const action = item.dataset.action;
            handleContextMenuAction(action);
            hideRowContextMenu();
        });
    });
    
    return menu;
}

// Create context menu HTML for column headers
function createColumnHeaderContextMenu() {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.display = 'none';
    
    // Determine labels based on selection
    const hasMultipleSelections = globalSelection.selections && globalSelection.selections.length > 1;
    const selectionCount = globalSelection.selections ? globalSelection.selections.length : 0;
    
    let columnLabel = 'Copy Column';
    let columnHeaderLabel = 'Copy Column with Header';
    let distinctLabel = 'Copy Distinct Values';
    
    if (hasMultipleSelections && globalSelection.type === 'column') {
        columnLabel = `Copy ${selectionCount} Columns`;
        columnHeaderLabel = `Copy ${selectionCount} Columns with Headers`;
    }
    
    menu.innerHTML = `
        <div class="context-menu-item" data-action="copy-column">${columnLabel}</div>
        <div class="context-menu-item" data-action="copy-column-header">${columnHeaderLabel}</div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" data-action="copy-column-distinct">${distinctLabel}</div>
    `;
    document.body.appendChild(menu);
    
    // Prevent default context menu on the custom menu itself
    menu.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Add click handlers
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const action = item.dataset.action;
            handleContextMenuAction(action);
            hideColumnHeaderContextMenu();
        });
    });
    
    return menu;
}

function showContextMenu(e, cellData) {
    e.preventDefault();
    
    // Remove existing menu to recreate with updated labels
    if (contextMenu) {
        contextMenu.remove();
    }
    
    contextMenu = createContextMenu(cellData);
    contextMenuData = cellData;
    
    // Position menu at cursor
    contextMenu.style.display = 'block';
    contextMenu.style.left = e.pageX + 'px';
    contextMenu.style.top = e.pageY + 'px';
    
    // Adjust if menu goes off screen
    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        contextMenu.style.left = (e.pageX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        contextMenu.style.top = (e.pageY - rect.height) + 'px';
    }
}

function hideContextMenu() {
    if (contextMenu) {
        contextMenu.style.display = 'none';
    }
    contextMenuData = null;
}

function showRowContextMenu(e, cellData) {
    e.preventDefault();
    
    // Remove existing menu to recreate with updated labels
    if (rowContextMenu) {
        rowContextMenu.remove();
    }
    
    rowContextMenu = createRowContextMenu();
    contextMenuData = cellData;
    
    // Position menu at cursor
    rowContextMenu.style.display = 'block';
    rowContextMenu.style.left = e.pageX + 'px';
    rowContextMenu.style.top = e.pageY + 'px';
    
    // Adjust if menu goes off screen
    const rect = rowContextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        rowContextMenu.style.left = (e.pageX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        rowContextMenu.style.top = (e.pageY - rect.height) + 'px';
    }
}

function hideRowContextMenu() {
    if (rowContextMenu) {
        rowContextMenu.style.display = 'none';
    }
    contextMenuData = null;
}

function showColumnHeaderContextMenu(e, cellData) {
    e.preventDefault();
    
    // Remove existing menu to recreate with updated labels
    if (columnHeaderContextMenu) {
        columnHeaderContextMenu.remove();
    }
    
    columnHeaderContextMenu = createColumnHeaderContextMenu();
    contextMenuData = cellData;
    
    // Position menu at cursor
    columnHeaderContextMenu.style.display = 'block';
    columnHeaderContextMenu.style.left = e.pageX + 'px';
    columnHeaderContextMenu.style.top = e.pageY + 'px';
    
    // Adjust if menu goes off screen
    const rect = columnHeaderContextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        columnHeaderContextMenu.style.left = (e.pageX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        columnHeaderContextMenu.style.top = (e.pageY - rect.height) + 'px';
    }
}

function hideColumnHeaderContextMenu() {
    if (columnHeaderContextMenu) {
        columnHeaderContextMenu.style.display = 'none';
    }
    contextMenuData = null;
}

function handleContextMenuAction(action) {
    if (!contextMenuData) return;
    
    const { table, rowIndex, columnIndex, columnDefs, data } = contextMenuData;
    let textToCopy = '';
    
    // Check if we have multiple selections
    const hasMultipleSelections = globalSelection.selections && globalSelection.selections.length > 1;
    
    switch (action) {
        case 'copy-cell':
            if (hasMultipleSelections && globalSelection.type === 'cell') {
                // Copy all selected cells (tab-separated on same row, newline for different rows)
                const cellsByRow = {};
                globalSelection.selections.forEach(sel => {
                    if (!cellsByRow[sel.rowIndex]) cellsByRow[sel.rowIndex] = [];
                    cellsByRow[sel.rowIndex].push({ col: sel.columnIndex, val: sel.cellValue });
                });
                
                textToCopy = Object.keys(cellsByRow).sort((a, b) => a - b).map(rowIdx => {
                    return cellsByRow[rowIdx].sort((a, b) => a.col - b.col).map(cell => {
                        return cell.val === null ? 'NULL' : String(cell.val);
                    }).join('\t');
                }).join('\n');
            } else {
                const cellValue = data[rowIndex][columnDefs[columnIndex].field];
                textToCopy = cellValue === null ? 'NULL' : String(cellValue);
            }
            break;
            
        case 'copy-row':
            if (hasMultipleSelections && globalSelection.type === 'row') {
                // Copy all selected rows
                textToCopy = globalSelection.selections.map(sel => {
                    const row = data[sel.rowIndex];
                    return columnDefs.map(col => {
                        const val = row[col.field];
                        return val === null ? 'NULL' : String(val);
                    }).join('\t');
                }).join('\n');
            } else {
                const row = data[rowIndex];
                textToCopy = columnDefs.map(col => {
                    const val = row[col.field];
                    return val === null ? 'NULL' : String(val);
                }).join('\t');
            }
            break;
            
        case 'copy-row-header':
            const headers = columnDefs.map(col => col.headerName).join('\t');
            if (hasMultipleSelections && globalSelection.type === 'row') {
                // Copy all selected rows with header
                const rowsData = globalSelection.selections.map(sel => {
                    const row = data[sel.rowIndex];
                    return columnDefs.map(col => {
                        const val = row[col.field];
                        return val === null ? 'NULL' : String(val);
                    }).join('\t');
                }).join('\n');
                textToCopy = headers + '\n' + rowsData;
            } else {
                const rowData = columnDefs.map(col => {
                    const val = data[rowIndex][col.field];
                    return val === null ? 'NULL' : String(val);
                }).join('\t');
                textToCopy = headers + '\n' + rowData;
            }
            break;
            
        case 'copy-column':
            if (hasMultipleSelections && globalSelection.type === 'column') {
                // Copy all selected columns (tab-separated)
                const columnValues = data.map(row => {
                    return globalSelection.selections.map(sel => {
                        const colField = columnDefs[sel.columnIndex].field;
                        const val = row[colField];
                        return val === null ? 'NULL' : String(val);
                    }).join('\t');
                }).join('\n');
                textToCopy = columnValues;
            } else {
                const colField = columnDefs[columnIndex].field;
                textToCopy = data.map(row => {
                    const val = row[colField];
                    return val === null ? 'NULL' : String(val);
                }).join('\n');
            }
            break;
            
        case 'copy-column-header':
            if (hasMultipleSelections && globalSelection.type === 'column') {
                // Copy all selected columns with headers
                const colHeaders = globalSelection.selections.map(sel => {
                    return columnDefs[sel.columnIndex].headerName;
                }).join('\t');
                const columnValues = data.map(row => {
                    return globalSelection.selections.map(sel => {
                        const colField = columnDefs[sel.columnIndex].field;
                        const val = row[colField];
                        return val === null ? 'NULL' : String(val);
                    }).join('\t');
                }).join('\n');
                textToCopy = colHeaders + '\n' + columnValues;
            } else {
                const colFieldWithHeader = columnDefs[columnIndex].field;
                const colHeaderName = columnDefs[columnIndex].headerName;
                const columnValues = data.map(row => {
                    const val = row[colFieldWithHeader];
                    return val === null ? 'NULL' : String(val);
                }).join('\n');
                textToCopy = colHeaderName + '\n' + columnValues;
            }
            break;
            
        case 'copy-column-distinct':
            const colFieldDistinct = columnDefs[columnIndex].field;
            const distinctValues = [...new Set(data.map(row => {
                const val = row[colFieldDistinct];
                return val === null ? 'NULL' : String(val);
            }))].sort().join('\n');
            textToCopy = distinctValues;
            break;
            
        case 'copy-table':
            const tableHeaders = columnDefs.map(col => col.headerName).join('\t');
            const tableRows = data.map(row => {
                return columnDefs.map(col => {
                    const val = row[col.field];
                    return val === null ? 'NULL' : String(val);
                }).join('\t');
            }).join('\n');
            textToCopy = tableHeaders + '\n' + tableRows;
            break;
    }
    
    // Copy to clipboard
    navigator.clipboard.writeText(textToCopy).then(() => {
        console.log('[CONTEXT-MENU] Copied to clipboard:', action);
    }).catch(err => {
        console.error('[CONTEXT-MENU] Failed to copy:', err);
    });
}

// Global helper functions for selection management across all tables
function clearAllSelections() {
    // Find all result tables
    const allTables = document.querySelectorAll('.result-set-table .ag-grid-table');
    
    allTables.forEach(table => {
        // Clear column highlights
        const allCells = table.querySelectorAll('th, td');
        allCells.forEach(cell => {
            if (!cell.classList.contains('ag-grid-row-number-cell') && 
                !cell.classList.contains('ag-grid-row-number-header')) {
                cell.style.backgroundColor = '';
                cell.classList.remove('selected-cell');
            }
        });
        
        // Clear row selections
        const allRows = table.querySelectorAll('tbody tr');
        allRows.forEach(row => {
            row.classList.remove('selected');
            row.style.backgroundColor = '';
        });
        
        // Reset row number cells
        const rowNumCells = table.querySelectorAll('.ag-grid-row-number-cell');
        rowNumCells.forEach(cell => {
            cell.style.backgroundColor = 'var(--vscode-editor-background, #1e1e1e)';
        });
    });
    
    // Clear aggregation stats
    updateAggregationStats();
}

function reapplySelection() {
    if (!globalSelection.type || !globalSelection.tableContainer || !globalSelection.selections.length) {
        return;
    }
    
    globalSelection.selections.forEach(sel => {
        if (globalSelection.type === 'column' && sel.columnIndex !== undefined) {
            applyColumnHighlightGlobal(globalSelection.tableContainer, sel.columnIndex);
        } else if (globalSelection.type === 'row' && sel.rowIndex !== undefined) {
            applyRowHighlightGlobal(globalSelection.tableContainer, sel.rowIndex);
        } else if (globalSelection.type === 'cell' && sel.rowIndex !== undefined && sel.columnIndex !== undefined) {
            applyCellHighlightGlobal(globalSelection.tableContainer, sel.rowIndex, sel.columnIndex);
        }
    });
}

function applyColumnHighlightGlobal(containerEl, colIndex) {
    const table = containerEl.querySelector('.ag-grid-table');
    if (!table) return;
    
    // Highlight the selected column (colIndex + 2 because row number is column 1)
    const columnCells = table.querySelectorAll(`th:nth-child(${colIndex + 2}), td:nth-child(${colIndex + 2})`);
    columnCells.forEach(cell => {
        cell.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
    });
}

function applyRowHighlightGlobal(containerEl, rowIndex) {
    const table = containerEl.querySelector('.ag-grid-table');
    if (!table) return;
    
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    
    // Find the row by data attribute
    const targetRow = tbody.querySelector(`tr[data-row-index="${rowIndex}"]`);
    if (targetRow) {
        targetRow.classList.add('selected');
        targetRow.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
        
        const rowNumCell = targetRow.querySelector('.ag-grid-row-number-cell');
        if (rowNumCell) {
            rowNumCell.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
        }
    }
}

function applyCellHighlightGlobal(containerEl, rowIndex, colIndex) {
    const table = containerEl.querySelector('.ag-grid-table');
    if (!table) return;
    
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    
    // Find the row by data attribute
    const targetRow = tbody.querySelector(`tr[data-row-index="${rowIndex}"]`);
    if (targetRow) {
        // Find the cell (colIndex + 2 because row number is column 1, and nth-child is 1-indexed)
        const targetCell = targetRow.querySelector(`td:nth-child(${colIndex + 2})`);
        if (targetCell) {
            targetCell.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
            targetCell.classList.add('selected-cell');
        }
    }
}

function updateAggregationStats() {
    // This function is now a no-op since we removed the execution stats display
    // Aggregation stats could be shown elsewhere if needed in the future
    return;
}

// Hide context menu when clicking elsewhere
document.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
        hideContextMenu();
    }
    if (rowContextMenu && !rowContextMenu.contains(e.target)) {
        hideRowContextMenu();
    }
    if (columnHeaderContextMenu && !columnHeaderContextMenu.contains(e.target)) {
        hideColumnHeaderContextMenu();
    }
});

// Hide context menu on scroll
document.addEventListener('scroll', () => {
    hideContextMenu();
    hideRowContextMenu();
    hideColumnHeaderContextMenu();
}, true);

// Query Plan Display Functions
function showQueryPlan(planXml, executionTime, messages, resultSets) {
    const executeButton = document.getElementById('executeButton');
    const cancelButton = document.getElementById('cancelButton');
    const statusLabel = document.getElementById('statusLabel');
    const resizer = document.getElementById('resizer');
    
    // Enable buttons
    executeButton.disabled = false;
    cancelButton.disabled = true;
    
    // Parse the XML plan
    const planData = parseQueryPlan(planXml);
    currentQueryPlan = planData;
    
    // Show plan tabs
    document.querySelectorAll('.results-tab').forEach(tab => {
        if (tab.dataset.tab === 'queryPlan' || tab.dataset.tab === 'planTree' || tab.dataset.tab === 'topOperations') {
            tab.style.display = 'block';
        }
    });
    
    // Update status
    statusLabel.textContent = resultSets ? `Query completed with execution plan` : `Estimated execution plan generated`;
    
    resultsContainer.classList.add('visible');
    resizer.classList.add('visible');
    
    // Show results panel if not visible
    if (!resultsContainer.style.flex) {
        resultsContainer.style.flex = '0 0 400px';
    }
    
    // Display the plan in different views
    displayQueryPlanGraphical(planData);
    displayPlanTree(planData);
    displayTopOperations(planData);
    
    // If we have result sets (actual plan), display them
    if (resultSets && resultSets.length > 0) {
        displayResults(resultSets);
        displayMessages(messages);
        
        // Switch to results tab first
        document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.results-tab[data-tab="results"]').classList.add('active');
        currentTab = 'results';
        document.getElementById('resultsContent').style.display = 'block';
        document.getElementById('messagesContent').style.display = 'none';
        document.getElementById('queryPlanContent').style.display = 'none';
        document.getElementById('planTreeContent').style.display = 'none';
        document.getElementById('topOperationsContent').style.display = 'none';
    } else {
        // For estimated plan, show XML in results
        const resultsContent = document.getElementById('resultsContent');
        resultsContent.innerHTML = `
            <div style="padding: 12px;">
                <h3 style="margin-top: 0; font-size: 14px;">ShowPlanXML</h3>
                <pre style="background-color: var(--vscode-editor-background); padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; overflow: auto; font-family: 'Courier New', monospace; font-size: 12px;">${escapeHtml(planXml)}</pre>
            </div>
        `;
        displayMessages(messages);
        
        // Switch to Query Plan tab
        document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.results-tab[data-tab="queryPlan"]').classList.add('active');
        currentTab = 'queryPlan';
        document.getElementById('resultsContent').style.display = 'none';
        document.getElementById('messagesContent').style.display = 'none';
        document.getElementById('queryPlanContent').style.display = 'block';
        document.getElementById('planTreeContent').style.display = 'none';
        document.getElementById('topOperationsContent').style.display = 'none';
    }
}

function parseQueryPlan(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
    
    const planData = {
        operations: [],
        hierarchicalOperations: [],
        topOperations: [],
        totalCost: 0
    };
    
    // Get statement info for root SELECT node
    const stmtSimple = xmlDoc.querySelector('StmtSimple');
    const statementText = stmtSimple?.getAttribute('StatementText') || 'SELECT';
    const statementCost = parseFloat(stmtSimple?.getAttribute('StatementSubTreeCost') || '0');
    
    // Find the root RelOp (usually under QueryPlan > RelOp)
    const rootRelOp = xmlDoc.querySelector('QueryPlan > RelOp, StmtSimple > QueryPlan > RelOp');
    
    if (!rootRelOp) {
        return planData;
    }
    
    // Set total cost from statement
    planData.totalCost = statementCost;
    
    let operationId = 0;
    
    // Create artificial SELECT root node
    const selectNode = {
        id: operationId++,
        level: 0,
        parent: null,
        physicalOp: 'SELECT',
        logicalOp: 'SELECT',
        estimatedCost: 0,
        estimatedRows: parseFloat(stmtSimple?.getAttribute('StatementEstRows') || '0'),
        estimatedSubtreeCost: statementCost,
        estimatedCPU: 0,
        estimatedIO: 0,
        avgRowSize: 0,
        estimatedExecutions: 1,
        actualRows: 0,
        actualExecutions: 0,
        children: [],
        details: { statement: statementText }
    };
    
    planData.operations.push(selectNode);
    
    // Recursive function to parse operation tree
    function parseOperation(relOpElement, level = 1, parent = selectNode) {
        const estimatedSubtreeCost = parseFloat(relOpElement.getAttribute('EstimatedTotalSubtreeCost') || '0');
        
        const operation = {
            id: operationId++,
            level: level,
            parent: parent,
            physicalOp: relOpElement.getAttribute('PhysicalOp') || 'Unknown',
            logicalOp: relOpElement.getAttribute('LogicalOp') || 'Unknown',
            estimatedCost: 0, // Will be calculated later
            estimatedRows: parseFloat(relOpElement.getAttribute('EstimateRows') || '0'),
            estimatedSubtreeCost: estimatedSubtreeCost,
            estimatedCPU: parseFloat(relOpElement.getAttribute('EstimateCPU') || '0'),
            estimatedIO: parseFloat(relOpElement.getAttribute('EstimateIO') || '0'),
            avgRowSize: parseInt(relOpElement.getAttribute('AvgRowSize') || '0'),
            estimatedExecutions: parseFloat(relOpElement.getAttribute('EstimateRewinds') || '0') + parseFloat(relOpElement.getAttribute('EstimateRebinds') || '0') + 1,
            actualRows: 0,
            actualExecutions: 0,
            children: [],
            details: {}
        };
        
        // Extract specific operation details
        const indexScan = relOpElement.querySelector(':scope > IndexScan, :scope > TableScan, :scope > ClusteredIndexScan');
        if (indexScan) {
            const object = indexScan.querySelector('Object');
            if (object) {
                operation.details.table = object.getAttribute('Table')?.replace(/[\[\]]/g, '') || '';
                operation.details.index = object.getAttribute('Index')?.replace(/[\[\]]/g, '') || '';
                operation.details.schema = object.getAttribute('Schema')?.replace(/[\[\]]/g, '') || 'dbo';
            }
        }
        
        // Extract actual execution stats if present (for actual plans)
        const runTimeInfo = relOpElement.querySelector(':scope > RunTimeInformation');
        if (runTimeInfo) {
            const rowCount = runTimeInfo.querySelector('RunTimeCountersPerThread');
            if (rowCount) {
                operation.actualRows = parseInt(rowCount.getAttribute('ActualRows') || '0');
                operation.actualExecutions = parseInt(rowCount.getAttribute('ActualExecutions') || '0');
            }
        }
        
        planData.operations.push(operation);
        
        // Parse child operations recursively
        const childRelOps = [];
        
        // Check for operation-specific child locations
        const nestedLoops = relOpElement.querySelector(':scope > NestedLoops');
        const merge = relOpElement.querySelector(':scope > Merge');
        const hash = relOpElement.querySelector(':scope > Hash');
        const sort = relOpElement.querySelector(':scope > Sort');
        const top = relOpElement.querySelector(':scope > Top');
        
        if (nestedLoops) {
            childRelOps.push(...nestedLoops.querySelectorAll(':scope > RelOp'));
        } else if (merge) {
            childRelOps.push(...merge.querySelectorAll(':scope > RelOp'));
        } else if (hash) {
            childRelOps.push(...hash.querySelectorAll(':scope > RelOp'));
        } else if (sort) {
            childRelOps.push(...sort.querySelectorAll(':scope > RelOp'));
        } else if (top) {
            childRelOps.push(...top.querySelectorAll(':scope > RelOp'));
        } else {
            // General case: look for direct RelOp children
            childRelOps.push(...relOpElement.querySelectorAll(':scope > RelOp'));
        }
        
        childRelOps.forEach(childRelOp => {
            const childOp = parseOperation(childRelOp, level + 1, operation);
            operation.children.push(childOp);
        });
        
        // Calculate operator cost as subtree cost minus children costs
        const childrenCost = operation.children.reduce((sum, child) => sum + child.estimatedSubtreeCost, 0);
        operation.estimatedCost = Math.max(0, operation.estimatedSubtreeCost - childrenCost);
        
        return operation;
    }
    
    // Parse the entire operation tree starting from root RelOp
    const rootOperation = parseOperation(rootRelOp, 1, selectNode);
    selectNode.children.push(rootOperation);
    
    // Flatten the tree for hierarchical display (depth-first traversal)
    function flattenTree(operation, result = []) {
        result.push(operation);
        operation.children.forEach(child => flattenTree(child, result));
        return result;
    }
    
    planData.hierarchicalOperations = flattenTree(selectNode);
    
    // Sort by cost for top operations (exclude SELECT node)
    planData.topOperations = [...planData.operations]
        .filter(op => op.physicalOp !== 'SELECT')
        .sort((a, b) => b.estimatedCost - a.estimatedCost)
        .slice(0, 20);
    
    return planData;
}

function displayQueryPlanGraphical(planData) {
    const queryPlanContent = document.getElementById('queryPlanContent');
    
    if (!planData || !planData.hierarchicalOperations || planData.hierarchicalOperations.length === 0) {
        queryPlanContent.innerHTML = '<div class="no-results">No query plan available</div>';
        return;
    }
    
    // Clear previous content
    queryPlanContent.innerHTML = '';
    
    // Node dimensions
    const nodeWidth = 180;
    const nodeHeight = 100;
    const horizontalSpacing = 60;
    const verticalSpacing = 40;
    
    // Create D3 hierarchy from our data
    const root = d3.hierarchy(convertToHierarchy(planData.hierarchicalOperations[0]), d => d.children);
    
    // Custom left-to-right layout
    let nodeId = 0;
    root.eachBefore(node => {
        node.id = nodeId++;
    });
    
    function calculateLayout(node, x = 0, y = 0) {
        node.x = x;
        node.y = y;
        
        if (node.children) {
            if (node.children.length === 1) {
                calculateLayout(node.children[0], x + nodeWidth + horizontalSpacing, y);
            } else {
                const totalHeight = (node.children.length - 1) * (nodeHeight + verticalSpacing);
                let currentY = y - totalHeight / 2;
                
                node.children.forEach(child => {
                    calculateLayout(child, x + nodeWidth + horizontalSpacing, currentY);
                    currentY += nodeHeight + verticalSpacing;
                });
            }
        }
    }
    
    calculateLayout(root);
    
    // Calculate bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    root.each(node => {
        minX = Math.min(minX, node.x);
        maxX = Math.max(maxX, node.x + nodeWidth);
        minY = Math.min(minY, node.y);
        maxY = Math.max(maxY, node.y + nodeHeight);
    });
    
    const padding = 40;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;
    
    const svg = d3.select(queryPlanContent)
        .append('svg')
        .attr('class', 'query-plan-svg')
        .attr('width', '100%')
        .attr('height', Math.max(600, height))
        .attr('viewBox', [0, 0, width, height]);
    
    const g = svg.append('g')
        .attr('transform', `translate(${padding - minX}, ${padding - minY})`);
    
    // Draw links with arrows - data flows from right (children) to left (parent)
    const linkGroup = g.append('g').attr('class', 'links');
    
    root.each(node => {
        if (node.children) {
            const parentX = node.x;
            const parentY = node.y + nodeHeight / 2;
            
            if (node.children.length === 1) {
                // Single child - straight horizontal line with arrow at parent
                const child = node.children[0];
                const childX = child.x;
                const childY = child.y + nodeHeight / 2;
                
                linkGroup.append('line')
                    .attr('class', 'plan-link')
                    .attr('x1', childX)
                    .attr('y1', childY)
                    .attr('x2', parentX + nodeWidth + 10)
                    .attr('y2', parentY);
                
                // Arrow pointing RIGHT to parent (only if not root)
                if (node.depth > 0) {
                    linkGroup.append('polygon')
                        .attr('class', 'arrow')
                        .attr('points', `${parentX + nodeWidth + 10},${parentY - 6} ${parentX + nodeWidth},${parentY} ${parentX + nodeWidth + 10},${parentY + 6}`)
                        .style('fill', 'var(--connection-color, #808080)');
                }
            } else {
                // Multiple children - branching with vertical connector
                // Branch point is in the middle between children and parent
                const firstChild = node.children[0];
                const branchX = (firstChild.x + parentX + nodeWidth) / 2;
                
                // Draw vertical line connecting all children
                const firstChildY = node.children[0].y + nodeHeight / 2;
                const lastChildY = node.children[node.children.length - 1].y + nodeHeight / 2;
                
                linkGroup.append('line')
                    .attr('class', 'plan-link')
                    .attr('x1', branchX)
                    .attr('y1', firstChildY)
                    .attr('x2', branchX)
                    .attr('y2', lastChildY);
                
                // Draw horizontal line from branch point to parent
                linkGroup.append('line')
                    .attr('class', 'plan-link')
                    .attr('x1', branchX)
                    .attr('y1', parentY)
                    .attr('x2', parentX + nodeWidth + 10)
                    .attr('y2', parentY);
                
                // Arrow pointing RIGHT to parent (only if not root)
                if (node.depth > 0) {
                    linkGroup.append('polygon')
                        .attr('class', 'arrow')
                        .attr('points', `${parentX + nodeWidth + 10},${parentY - 6} ${parentX + nodeWidth},${parentY} ${parentX + nodeWidth + 10},${parentY + 6}`)
                        .style('fill', 'var(--connection-color, #808080)');
                }
                
                // Draw horizontal lines from each child to branch point
                node.children.forEach(child => {
                    const childX = child.x;
                    const childY = child.y + nodeHeight / 2;
                    
                    linkGroup.append('line')
                        .attr('class', 'plan-link')
                        .attr('x1', childX)
                        .attr('y1', childY)
                        .attr('x2', branchX)
                        .attr('y2', childY);
                });
            }
        }
    });
    
    // Create nodes
    const nodes = g.append('g').attr('class', 'nodes')
        .selectAll('.plan-node')
        .data(root.descendants())
        .join('g')
        .attr('class', d => {
            const costPercent = planData.totalCost > 0 ? ((d.data.estimatedCost / planData.totalCost) * 100) : 0;
            return `plan-node ${costPercent > 10 ? 'high-cost' : ''}`;
        })
        .attr('transform', d => `translate(${d.x},${d.y})`)
        .on('click', function(event, d) {
            event.stopPropagation();
            
            const isSelected = d3.select(this).classed('selected');
            
            if (isSelected) {
                // Unclick - remove selection and hide tooltip
                g.selectAll('.plan-node').classed('selected', false);
                g.selectAll('.node-selection-outline').style('stroke', 'transparent');
                hideTooltip();
            } else {
                // Click - remove other selections, select this node, show tooltip
                g.selectAll('.plan-node').classed('selected', false);
                g.selectAll('.node-selection-outline').style('stroke', 'transparent');
                d3.select(this).classed('selected', true);
                d3.select(this).select('.node-selection-outline')
                    .style('stroke', 'var(--vscode-button-background)');
                showTooltip(event, d.data);
            }
        });
    
    // Add main rectangles for nodes
    nodes.append('rect')
        .attr('class', 'node-main-rect')
        .attr('width', nodeWidth)
        .attr('height', nodeHeight)
        .attr('rx', 4)
        .style('fill', 'var(--vscode-input-background)')
        .style('stroke', 'var(--vscode-panel-border)')
        .style('stroke-width', 1);
    
    // Add selection outline (dashed border on entire node)
    nodes.append('rect')
        .attr('class', 'node-selection-outline')
        .attr('width', nodeWidth)
        .attr('height', nodeHeight)
        .attr('rx', 4)
        .style('fill', 'none')
        .style('stroke', 'transparent')
        .style('stroke-width', 3)
        .style('stroke-dasharray', '5,5')
        .style('pointer-events', 'none');
    
    // Add operation name
    nodes.append('text')
        .attr('class', 'node-title')
        .attr('text-anchor', 'middle')
        .attr('x', nodeWidth / 2)
        .attr('y', 30)
        .style('fill', 'var(--vscode-editor-foreground)')
        .style('font-size', '12px')
        .style('font-weight', '600')
        .text(d => d.data.physicalOp);
    
    // Add subtitle if exists (table/index name)
    nodes.filter(d => d.data.details && (d.data.details.table || d.data.details.index))
        .append('text')
        .attr('class', 'node-subtitle')
        .attr('text-anchor', 'middle')
        .attr('x', nodeWidth / 2)
        .attr('y', 45)
        .style('fill', '#858585')
        .style('font-size', '10px')
        .text(d => {
            const table = d.data.details.table ? `[${d.data.details.schema || 'dbo'}].[${d.data.details.table}]` : '';
            const index = d.data.details.index ? `[${d.data.details.index}]` : '';
            const text = table + (index ? ' ' + index : '');
            return text.length > 30 ? text.substring(0, 27) + '...' : text;
        });
    
    // Add cost percentage badge
    nodes.append('rect')
        .attr('class', d => {
            const costPercent = planData.totalCost > 0 ? ((d.data.estimatedCost / planData.totalCost) * 100) : 0;
            return costPercent >= 50 ? 'cost-badge high' : costPercent >= 10 ? 'cost-badge medium' : 'cost-badge low';
        })
        .attr('x', nodeWidth / 2 - 20)
        .attr('y', 60)
        .attr('width', 40)
        .attr('height', 18)
        .attr('rx', 9)
        .style('fill', d => {
            const costPercent = planData.totalCost > 0 ? ((d.data.estimatedCost / planData.totalCost) * 100) : 0;
            if (costPercent >= 50) return '#d73027';
            if (costPercent >= 10) return '#fc8d59';
            return '#4575b4';
        });
    
    nodes.append('text')
        .attr('class', 'cost-text')
        .attr('text-anchor', 'middle')
        .attr('x', nodeWidth / 2)
        .attr('y', 73)
        .style('fill', '#ffffff')
        .style('font-size', '10px')
        .style('font-weight', '600')
        .text(d => {
            const costPercent = planData.totalCost > 0 ? ((d.data.estimatedCost / planData.totalCost) * 100).toFixed(0) : 0;
            return `${costPercent}%`;
        });
    
    // Add row count in bottom right
    nodes.append('text')
        .attr('class', 'row-count')
        .attr('text-anchor', 'end')
        .attr('x', nodeWidth - 10)
        .attr('y', nodeHeight - 10)
        .style('fill', '#858585')
        .style('font-size', '11px')
        .text(d => d.data.estimatedRows.toLocaleString());
    
    // Add zoom behavior
    const zoom = d3.zoom()
        .scaleExtent([0.3, 3])
        .on('zoom', (event) => {
            g.attr('transform', `translate(${padding - minX}, ${padding - minY}) ${event.transform}`);
        });
    
    svg.call(zoom);
    
    // Click outside to deselect and hide tooltip
    queryPlanContent.addEventListener('click', function(event) {
        if (event.target === queryPlanContent || event.target.tagName === 'svg') {
            g.selectAll('.plan-node').classed('selected', false);
            hideTooltip();
        }
    });
    
    // Create tooltip element
    let tooltip = d3.select('body').select('.plan-tooltip');
    if (tooltip.empty()) {
        tooltip = d3.select('body')
            .append('div')
            .attr('class', 'plan-tooltip')
            .style('display', 'none')
            .style('position', 'fixed');
    }
    
    function showTooltip(event, operation) {
        let html = `<h4>${operation.physicalOp}</h4>`;
        html += '<div class="plan-tooltip-grid">';
        
        html += `<div class="plan-tooltip-label">Logical Op:</div><div class="plan-tooltip-value">${operation.logicalOp}</div>`;
        html += `<div class="plan-tooltip-label">Est. Cost:</div><div class="plan-tooltip-value">${operation.estimatedCost.toFixed(4)}</div>`;
        html += `<div class="plan-tooltip-label">Est. Subtree:</div><div class="plan-tooltip-value">${operation.estimatedSubtreeCost.toFixed(4)}</div>`;
        html += `<div class="plan-tooltip-label">Est. Rows:</div><div class="plan-tooltip-value">${operation.estimatedRows.toLocaleString()}</div>`;
        html += `<div class="plan-tooltip-label">Est. Executions:</div><div class="plan-tooltip-value">${operation.estimatedExecutions}</div>`;
        html += `<div class="plan-tooltip-label">Est. CPU:</div><div class="plan-tooltip-value">${operation.estimatedCPU.toFixed(6)}</div>`;
        html += `<div class="plan-tooltip-label">Est. I/O:</div><div class="plan-tooltip-value">${operation.estimatedIO.toFixed(6)}</div>`;
        html += `<div class="plan-tooltip-label">Avg Row Size:</div><div class="plan-tooltip-value">${operation.avgRowSize} bytes</div>`;
        
        if (operation.actualRows > 0) {
            html += `<div class="plan-tooltip-label">Actual Rows:</div><div class="plan-tooltip-value">${operation.actualRows.toLocaleString()}</div>`;
            html += `<div class="plan-tooltip-label">Actual Executions:</div><div class="plan-tooltip-value">${operation.actualExecutions}</div>`;
        }
        
        if (operation.details.table) {
            html += `<div class="plan-tooltip-label">Object:</div><div class="plan-tooltip-value">${operation.details.schema}.${operation.details.table}</div>`;
        }
        if (operation.details.index) {
            html += `<div class="plan-tooltip-label">Index:</div><div class="plan-tooltip-value">${operation.details.index}</div>`;
        }
        
        html += '</div>';
        
        tooltip
            .html(html)
            .style('display', 'block');
        
        // Position tooltip next to the node
        positionTooltip(event);
    }
    
    function positionTooltip(event) {
        const tooltipNode = tooltip.node();
        const tooltipWidth = 400;
        const tooltipHeight = tooltipNode.offsetHeight;
        
        // Get the clicked element's position
        const nodeRect = event.target.closest('g').getBoundingClientRect();
        
        let left = nodeRect.right + 15;
        let top = nodeRect.top;
        
        // Keep tooltip on screen - if it would go off right edge, put it on left side
        if (left + tooltipWidth > window.innerWidth) {
            left = nodeRect.left - tooltipWidth - 15;
        }
        
        // If still off screen on left, just position with some margin
        if (left < 0) {
            left = nodeRect.right + 15;
        }
        
        // Adjust vertical position if needed
        if (top + tooltipHeight > window.innerHeight) {
            top = window.innerHeight - tooltipHeight - 10;
        }
        if (top < 0) {
            top = 10;
        }
        
        tooltip
            .style('left', left + 'px')
            .style('top', top + 'px');
    }
    
    function hideTooltip() {
        tooltip.style('display', 'none');
    }
}

// Helper function to convert flat hierarchical array to nested tree structure
function convertToHierarchy(rootOp) {
    if (!rootOp) return null;
    
    return {
        ...rootOp,
        children: rootOp.children && rootOp.children.length > 0 
            ? rootOp.children.map(child => convertToHierarchy(child))
            : undefined
    };
}

function displayPlanTree(planData) {
    const planTreeContent = document.getElementById('planTreeContent');
    
    if (!planData || !planData.hierarchicalOperations || planData.hierarchicalOperations.length === 0) {
        planTreeContent.innerHTML = '<div class="no-results">No plan tree available</div>';
        return;
    }
    
    let html = '<table class="plan-tree-table">';
    html += '<thead><tr>';
    html += '<th>Operation</th>';
    html += '<th>Estimated Cost %</th>';
    html += '<th>Estimated Subtree Cost</th>';
    html += '<th>Estimated Rows</th>';
    html += '<th>Average Row Size</th>';
    html += '<th>Estimated CPU Cost</th>';
    html += '<th>Estimated I/O Cost</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    planData.hierarchicalOperations.forEach((op) => {
        const costPercent = planData.totalCost > 0 ? ((op.estimatedCost / planData.totalCost) * 100).toFixed(0) : 0;
        const indentPixels = op.level * 24; // 24 pixels per level
        
        html += '<tr>';
        html += `<td><span class="plan-tree-indent" style="display: inline-block; width: ${indentPixels}px;"></span>${op.physicalOp}</td>`;
        html += `<td>${costPercent}%</td>`;
        html += `<td>${op.estimatedSubtreeCost.toFixed(4)}</td>`;
        html += `<td>${op.estimatedRows.toLocaleString()}</td>`;
        html += `<td>${op.avgRowSize}</td>`;
        html += `<td>${op.estimatedCPU.toFixed(6)}</td>`;
        html += `<td>${op.estimatedIO.toFixed(6)}</td>`;
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    planTreeContent.innerHTML = html;
}

function displayOperationDetails(operation) {
    const detailsPanel = document.getElementById('planDetailsPanel');
    
    let html = `<h3>Operation Details: ${operation.physicalOp}</h3>`;
    html += '<div class="plan-details-grid">';
    
    html += `<div class="plan-details-label">Physical Operation:</div><div class="plan-details-value">${operation.physicalOp}</div>`;
    html += `<div class="plan-details-label">Logical Operation:</div><div class="plan-details-value">${operation.logicalOp}</div>`;
    html += `<div class="plan-details-label">Estimated Cost:</div><div class="plan-details-value">${operation.estimatedCost.toFixed(4)}</div>`;
    html += `<div class="plan-details-label">Estimated Subtree Cost:</div><div class="plan-details-value">${operation.estimatedSubtreeCost.toFixed(4)}</div>`;
    html += `<div class="plan-details-label">Estimated Rows:</div><div class="plan-details-value">${operation.estimatedRows.toLocaleString()}</div>`;
    html += `<div class="plan-details-label">Estimated Executions:</div><div class="plan-details-value">${operation.estimatedExecutions}</div>`;
    html += `<div class="plan-details-label">Estimated CPU Cost:</div><div class="plan-details-value">${operation.estimatedCPU.toFixed(6)}</div>`;
    html += `<div class="plan-details-label">Estimated I/O Cost:</div><div class="plan-details-value">${operation.estimatedIO.toFixed(6)}</div>`;
    html += `<div class="plan-details-label">Average Row Size:</div><div class="plan-details-value">${operation.avgRowSize} bytes</div>`;
    
    if (operation.actualRows > 0) {
        html += `<div class="plan-details-label">Actual Rows:</div><div class="plan-details-value">${operation.actualRows.toLocaleString()}</div>`;
        html += `<div class="plan-details-label">Actual Executions:</div><div class="plan-details-value">${operation.actualExecutions}</div>`;
    }
    
    if (operation.details.table) {
        html += `<div class="plan-details-label">Object:</div><div class="plan-details-value">${operation.details.schema}.${operation.details.table}</div>`;
    }
    if (operation.details.index) {
        html += `<div class="plan-details-label">Index:</div><div class="plan-details-value">${operation.details.index}</div>`;
    }
    
    html += '</div>';
    
    detailsPanel.innerHTML = html;
    detailsPanel.style.display = 'block';
}

function displayTopOperations(planData) {
    const topOperationsContent = document.getElementById('topOperationsContent');
    
    if (!planData || !planData.topOperations || planData.topOperations.length === 0) {
        topOperationsContent.innerHTML = '<div class="no-results">No operations available</div>';
        return;
    }
    
    let html = '<table class="top-operations-table">';
    html += '<thead><tr>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'operation\')">Operation</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'cost\')">Estimated Cost %</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'subtreeCost\')">Estimated Subtree Cost</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'rows\')">Estimated Rows</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'executions\')">Estimated Executions</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'cpu\')">Estimated CPU Cost</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'io\')">Estimated I/O Cost</th>';
    html += '<th>Object</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    planData.topOperations.forEach(op => {
        const costPercent = planData.totalCost > 0 ? ((op.estimatedCost / planData.totalCost) * 100).toFixed(1) : 0;
        const objectName = op.details.table ? `${op.details.schema}.${op.details.table}` : '-';
        
        html += '<tr>';
        html += `<td>${op.physicalOp}</td>`;
        html += `<td>${costPercent}%</td>`;
        html += `<td>${op.estimatedSubtreeCost.toFixed(4)}</td>`;
        html += `<td>${op.estimatedRows.toLocaleString()}</td>`;
        html += `<td>${op.estimatedExecutions}</td>`;
        html += `<td>${op.estimatedCPU.toFixed(6)}</td>`;
        html += `<td>${op.estimatedIO.toFixed(6)}</td>`;
        html += `<td>${objectName}</td>`;
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    topOperationsContent.innerHTML = html;
}

function selectPlanNode(opId) {
    // Remove previous selection
    document.querySelectorAll('.plan-node.selected').forEach(node => {
        node.classList.remove('selected');
    });
    
    // Select new node
    const node = document.querySelector(`.plan-node[data-op-id="${opId}"]`);
    if (node) {
        node.classList.add('selected');
    }
    
    // Show details - find operation in hierarchicalOperations
    let operation = null;
    if (currentQueryPlan && currentQueryPlan.hierarchicalOperations) {
        operation = currentQueryPlan.hierarchicalOperations.find(op => op.id === opId);
    } else if (currentQueryPlan && currentQueryPlan.operations) {
        operation = currentQueryPlan.operations.find(op => op.id === opId);
    }
    
    if (operation) {
        displayOperationDetails(operation);
    }
}

// Make selectPlanNode available globally
window.selectPlanNode = selectPlanNode;

// Sorting function for top operations (simple implementation)
window.sortTopOperations = function(column) {
    // This is a placeholder - in a full implementation, you would re-sort and re-render
    console.log('Sort by:', column);
};