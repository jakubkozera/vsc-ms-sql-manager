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
let dbSchema = { tables: [], views: [], foreignKeys: [] };
let validationTimeout = null;

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

    // Notify extension that webview is ready
    vscode.postMessage({ type: 'ready' });
});

// Toolbar buttons
document.getElementById('executeButton').addEventListener('click', () => {
    executeQuery();
});

document.getElementById('cancelButton').addEventListener('click', () => {
    vscode.postMessage({ type: 'cancelQuery' });
});

document.getElementById('connectButton').addEventListener('click', () => {
    vscode.postMessage({ type: 'manageConnections' });
});

// Database selector
document.getElementById('databaseSelector').addEventListener('change', (e) => {
    const connectionId = e.target.value;
    if (connectionId) {
        vscode.postMessage({
            type: 'switchConnection',
            connectionId: connectionId
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
        
        if (currentTab === 'results') {
            resultsContent.style.display = 'block';
            messagesContent.style.display = 'none';
        } else if (currentTab === 'messages') {
            resultsContent.style.display = 'none';
            messagesContent.style.display = 'block';
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

    const databaseSelector = document.getElementById('databaseSelector');
    const connectionId = databaseSelector.value || null;

    vscode.postMessage({
        type: 'executeQuery',
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

    // Check if we're in SELECT or WHERE clause - suggest columns
    const lowerText = textUntilPosition.toLowerCase();
    
    console.log('[SQL-COMPLETION] Checking context - lowerText:', lowerText);
    
    // Check if we're in JOIN clause (after JOIN keyword, before ON)
    const joinMatch = /\b((?:inner|left|right|full|cross)\s+)?join\s*$/i.exec(lineUntilPosition);
    console.log('[SQL-COMPLETION] JOIN match:', joinMatch ? 'YES' : 'NO');
    
    if (joinMatch) {
        console.log('[SQL-COMPLETION] In JOIN context, suggesting related tables');
        // Suggest tables that have foreign key relationships with tables already in the query
        const tablesInQuery = extractTablesFromQuery(textUntilPosition);
        console.log('[SQL-COMPLETION] Tables in query for JOIN:', tablesInQuery);
        
        if (tablesInQuery.length > 0) {
            const relatedTables = getRelatedTables(tablesInQuery);
            console.log('[SQL-COMPLETION] Related tables:', relatedTables.map(t => ({ name: t.name, hasFKInfo: !!t.foreignKeyInfo })));
            
            return {
                suggestions: relatedTables.map(table => {
                    const fullName = table.schema === 'dbo' ? table.name : `${table.schema}.${table.name}`;
                    
                    // Generate alias (first letter of table name or full name if short)
                    const tableAlias = table.name.length <= 3 ? table.name.toLowerCase() : table.name.charAt(0).toLowerCase();
                    
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
    }
    
    // Detect context: SELECT, WHERE, or FROM clause
    let inSelectClause = false;
    let inWhereClause = false;
    let inFromClause = false;
    
    // Better context detection
    const lastSelectPos = lowerText.lastIndexOf('select');
    const lastFromPos = lowerText.lastIndexOf('from');
    const lastWherePos = lowerText.lastIndexOf('where');
    const lastJoinPos = Math.max(
        lowerText.lastIndexOf('join'),
        lowerText.lastIndexOf('inner join'),
        lowerText.lastIndexOf('left join'),
        lowerText.lastIndexOf('right join')
    );
    
    console.log('[SQL-COMPLETION] Context positions - SELECT:', lastSelectPos, 'FROM:', lastFromPos, 'WHERE:', lastWherePos, 'JOIN:', lastJoinPos);
    
    if (lastSelectPos !== -1 && lastFromPos !== -1) {
        if (lastWherePos !== -1 && lastWherePos > lastFromPos) {
            inWhereClause = true;
            console.log('[SQL-COMPLETION] Context: WHERE clause');
        } else if (lastSelectPos < lastFromPos && lowerText.length <= lastFromPos + 50) {
            // Close to FROM keyword
            inFromClause = true;
            console.log('[SQL-COMPLETION] Context: FROM clause');
        } else if (lastSelectPos > -1 && (lastFromPos === -1 || lastSelectPos > lastFromPos)) {
            inSelectClause = true;
            console.log('[SQL-COMPLETION] Context: SELECT clause (no FROM yet)');
        } else if (lastSelectPos < lastFromPos) {
            // We have both SELECT and FROM, check position
            inSelectClause = false;
            console.log('[SQL-COMPLETION] Context: After FROM');
        }
    } else if (lastSelectPos !== -1 && lastFromPos === -1) {
        inSelectClause = true;
        console.log('[SQL-COMPLETION] Context: SELECT clause (no FROM)');
    } else if (lastFromPos !== -1 && lastWherePos === -1) {
        inFromClause = true;
        console.log('[SQL-COMPLETION] Context: FROM clause (no WHERE)');
    }
    
    // If we're in SELECT or WHERE, suggest columns from tables in query
    if (inSelectClause || inWhereClause) {
        console.log('[SQL-COMPLETION] Should suggest columns - inSelect:', inSelectClause, 'inWhere:', inWhereClause);
        
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
                
                columns.forEach(col => {
                    const prefix = tableInfo.alias || tableInfo.table;
                    suggestions.push({
                        label: col.name,
                        kind: monaco.languages.CompletionItemKind.Field,
                        detail: `${prefix}.${col.name} (${col.type})`,
                        insertText: col.name,
                        range: range,
                        sortText: `0_${col.name}` // Prioritize columns
                    });
                    
                    // Also suggest with table prefix
                    suggestions.push({
                        label: `${prefix}.${col.name}`,
                        kind: monaco.languages.CompletionItemKind.Field,
                        detail: `${col.type}${col.nullable ? ' (nullable)' : ''}`,
                        insertText: `${prefix}.${col.name}`,
                        range: range,
                        sortText: `1_${col.name}`
                    });
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

    // Add tables
    dbSchema.tables.forEach(table => {
        const fullName = table.schema === 'dbo' ? table.name : `${table.schema}.${table.name}`;
        suggestions.push({
            label: fullName,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: `Table (${table.columns.length} columns)`,
            insertText: fullName,
            range: range
        });
    });

    // Add views
    dbSchema.views.forEach(view => {
        const fullName = view.schema === 'dbo' ? view.name : `${view.schema}.${view.name}`;
        suggestions.push({
            label: fullName,
            kind: monaco.languages.CompletionItemKind.Interface,
            detail: `View (${view.columns.length} columns)`,
            insertText: fullName,
            range: range
        });
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

function extractTablesFromQuery(query) {
    const tables = [];
    const lowerQuery = query.toLowerCase();
    
    console.log('[SQL-COMPLETION] extractTablesFromQuery called with:', query);
    
    // SQL keywords that should not be considered as aliases
    const sqlKeywords = ['select', 'from', 'where', 'join', 'inner', 'left', 'right', 'full', 'cross', 'on', 'and', 'or', 'order', 'group', 'by', 'having'];
    
    // Match FROM and JOIN clauses with optional aliases
    // Patterns: FROM schema.table alias, FROM table alias, JOIN schema.table alias, etc.
    const patterns = [
        /\b(?:from|join)\s+(?:(\w+)\.)?(\w+)(?:\s+(?:as\s+)?(\w+))?/gi
    ];
    
    patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(query)) !== null) {
            console.log('[SQL-COMPLETION] Regex match:', match);
            const schema = match[1] || 'dbo';
            const table = match[2];
            let alias = match[3];
            
            console.log('[SQL-COMPLETION] Parsed - schema:', schema, 'table:', table, 'alias:', alias);
            
            // Skip if the captured alias is actually a SQL keyword
            if (alias && sqlKeywords.includes(alias.toLowerCase())) {
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
                
                tables.push({
                    schema: tableInfo.schema,
                    table: tableInfo.table,
                    alias: alias,
                    hasExplicitAlias: hasExplicitAlias
                });
                
                console.log('[SQL-COMPLETION] Added table:', { schema: tableInfo.schema, table: tableInfo.table, alias });
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
    
    for (const table of dbSchema.tables) {
        if (table.name.toLowerCase() === lowerName) {
            return { schema: table.schema, table: table.name };
        }
    }
    
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
            updateConnectionsList(message.connections, message.currentConnectionId);
            // Request schema update when connection changes
            vscode.postMessage({ type: 'getSchema' });
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
            showResults(message.resultSets, message.executionTime, message.rowsAffected, message.messages);
            break;

        case 'error':
            showError(message.error, message.messages);
            break;
    }
});

function updateConnectionsList(connections, currentId) {
    activeConnections = connections;
    currentConnectionId = currentId;
    
    const databaseSelector = document.getElementById('databaseSelector');
    databaseSelector.innerHTML = '';
    
    if (connections.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Not Connected';
        databaseSelector.appendChild(option);
        databaseSelector.disabled = true;
    } else {
        databaseSelector.disabled = false;
        connections.forEach(conn => {
            const option = document.createElement('option');
            option.value = conn.id;
            option.textContent = conn.database;
            option.title = `${conn.server}/${conn.database}`;
            if (conn.id === currentId) {
                option.selected = true;
            }
            databaseSelector.appendChild(option);
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
}

function showResults(resultSets, executionTime, rowsAffected, messages) {
    const executeButton = document.getElementById('executeButton');
    const cancelButton = document.getElementById('cancelButton');
    const statusLabel = document.getElementById('statusLabel');
    const executionStatsEl = document.getElementById('executionStats');
    
    lastResults = resultSets;
    lastMessages = messages || [];
    
    executeButton.disabled = false;
    cancelButton.disabled = true;
    
    const totalRows = resultSets.reduce((sum, rs) => sum + rs.length, 0);
    statusLabel.textContent = `Query completed (${resultSets.length} result set(s), ${totalRows} rows)`;

    // Update execution stats in compact format
    executionStatsEl.textContent = `${resultSets.length} result set(s) | ${totalRows} rows | ${executionTime}ms`;

    // Always update both containers
    displayResults(resultSets);
    displayMessages(messages);
}

function displayResults(resultSets) {
    console.log('[SQL EDITOR] displayResults called with', resultSets.length, 'result set(s)');
    const resultsContent = document.getElementById('resultsContent');
    console.log('[SQL EDITOR] resultsContent element:', resultsContent);

    if (!resultSets || resultSets.length === 0) {
        resultsContent.innerHTML = '<div class="no-results">No rows returned</div>';
        return;
    }

    // Clear previous content
    resultsContent.innerHTML = '';

    // Create a table for each result set
    resultSets.forEach((results, index) => {
        if (!results || results.length === 0) {
            return;
        }

        // Create container for this result set
        const resultSetContainer = document.createElement('div');
        resultSetContainer.className = 'result-set-container';
        resultSetContainer.style.cssText = 'margin-bottom: 20px;';

        // Create table container
        const tableContainer = document.createElement('div');
        tableContainer.className = 'result-set-table';
        
        // Initialize AG-Grid-like table for this result set
        console.log('[SQL EDITOR] Creating table for result set', index + 1, 'with', results.length, 'rows');
        initAgGridTable(results, tableContainer);
        
        resultSetContainer.appendChild(tableContainer);
        resultsContent.appendChild(resultSetContainer);
    });
    
    // Check if the results content parent has overflow
    const resultsContainer = document.getElementById('resultsContainer');
    console.log('[SQL EDITOR] resultsContainer height:', resultsContainer?.offsetHeight);
    console.log('[SQL EDITOR] resultsContent height:', resultsContent?.offsetHeight, 'scrollHeight:', resultsContent?.scrollHeight);
}

function initAgGridTable(rowData, container) {
    console.log('[AG-GRID] initAgGridTable called with', rowData.length, 'rows');
    console.log('[AG-GRID] Container element:', container, 'offsetHeight:', container.offsetHeight, 'scrollHeight:', container.scrollHeight);
    
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

    // Build the table HTML structure
    const tableId = `agGrid_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const tableHtml = `
        <table class="ag-grid-table" style="border-collapse: collapse; table-layout: auto; width: 100%;">
            <thead class="ag-grid-thead"></thead>
            <tbody class="ag-grid-tbody"></tbody>
        </table>
    `;
    
    console.log('[AG-GRID] Setting container innerHTML');
    container.innerHTML = tableHtml;
    
    const table = container.querySelector('.ag-grid-table');
    console.log('[AG-GRID] Table element:', table, 'border-collapse:', table?.style.borderCollapse);

    renderAgGridHeaders(columnDefs, sortConfig, activeFilters, container);
    renderAgGridRows(columnDefs, filteredData, container);
    
    console.log('[AG-GRID] Initial render complete. Checking header positions...');
    
    // Add scroll event listener for debugging on the scrollable container
    console.log('[AG-GRID] Container dimensions:', {
        offsetHeight: container.offsetHeight,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        isScrollable: container.scrollHeight > container.clientHeight,
        overflow: window.getComputedStyle(container).overflow
    });
    
    container.addEventListener('scroll', () => {
        console.log('[AG-GRID] Container scrolled - scrollTop:', container.scrollTop, 'scrollLeft:', container.scrollLeft);
        // Check if headers are still sticky
        const firstHeader = container.querySelector('.ag-grid-thead th');
        if (firstHeader) {
            const rect = firstHeader.getBoundingClientRect();
            const computed = window.getComputedStyle(firstHeader);
            console.log('[AG-GRID] First header position during scroll - top:', rect.top, 'position:', computed.position);
        }
    });
    
    setTimeout(() => {
        const headers = container.querySelectorAll('.ag-grid-thead th');
        headers.forEach((h, i) => {
            const computed = window.getComputedStyle(h);
            console.log(`[AG-GRID] Header ${i} computed styles - position: ${computed.position}, top: ${computed.top}, z-index: ${computed.zIndex}, sticky: ${computed.position === 'sticky'}`);
        });
    }, 100);

    function renderAgGridHeaders(colDefs, sortCfg, filters, containerEl) {
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
        rowNumTh.style.cssText = `
            width: 50px;
            min-width: 50px;
            max-width: 50px;
            position: sticky;
            left: 0;
            background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
            border-right: 2px solid var(--vscode-panel-border, #3c3c3c);
            text-align: center;
            font-weight: 600;
            user-select: none;
            z-index: 20;
            top: 0;
            border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
            padding: 8px;
        `;
        console.log('[AG-GRID] Row number header z-index:', rowNumTh.style.zIndex, 'position:', rowNumTh.style.position, 'top:', rowNumTh.style.top);
        tr.appendChild(rowNumTh);
        
        const totalWidth = colDefs.reduce((sum, col) => sum + col.width, 0) + 50;
        const table = containerEl.querySelector('.ag-grid-table');
        table.style.width = totalWidth + 'px';
        table.style.minWidth = totalWidth + 'px';
        console.log('[AG-GRID] Table total width set to:', totalWidth);

        colDefs.forEach((col, index) => {
            const th = document.createElement('th');
            th.style.cssText = `
                width: ${col.width}px;
                min-width: ${col.width}px;
                max-width: ${col.width}px;
                background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
                border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
                border-right: 1px solid var(--vscode-panel-border, #3c3c3c);
                padding: 8px;
                text-align: left;
                font-weight: 600;
                position: sticky;
                top: 0;
                z-index: ${col.pinned ? 19 : 10};
                user-select: none;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            `;
            console.log(`[AG-GRID] Header for column "${col.headerName}" - position: sticky, top: 0, z-index: ${col.pinned ? 19 : 10}, pinned: ${col.pinned}`);
            
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
                highlightColumn(index, colDefs, containerEl);
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
                col.pinned = !col.pinned;
                renderAgGridHeaders(colDefs, sortCfg, filters, containerEl);
                renderAgGridRows(colDefs, filteredData, containerEl);
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

            th.style.position = 'relative';
            th.appendChild(headerContent);
            th.appendChild(resizeHandle);
            tr.appendChild(th);
        });

        thead.innerHTML = '';
        thead.appendChild(tr);
    }

    // Column highlighting functionality
    function highlightColumn(colIndex, colDefs, containerEl) {
        const table = containerEl.querySelector('.ag-grid-table');
        const allCells = table.querySelectorAll('th, td');
        
        // Remove previous column highlights
        allCells.forEach(cell => {
            cell.style.backgroundColor = '';
        });
        
        // Remove row selection
        const allRows = table.querySelectorAll('tbody tr');
        allRows.forEach(row => {
            row.classList.remove('selected');
        });
        
        // Highlight the selected column (colIndex + 2 because row number is column 1)
        const columnCells = table.querySelectorAll(`th:nth-child(${colIndex + 2}), td:nth-child(${colIndex + 2})`);
        columnCells.forEach(cell => {
            if (cell.classList.contains('ag-grid-pinned-cell') || cell.classList.contains('ag-grid-pinned-header')) {
                cell.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
            } else {
                cell.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
            }
        });
    }

    // Column resizing functionality
    let resizingColumn = null;
    let startX = 0;
    let startWidth = 0;

    function startResize(e, th, colIndex, colDefs, sortCfg, filters, containerEl) {
        resizingColumn = { th, colIndex };
        startX = e.clientX;
        startWidth = th.offsetWidth;

        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
        e.preventDefault();
        e.stopPropagation();
        
        function doResize(e) {
            if (!resizingColumn) return;

            const diff = e.clientX - startX;
            const newWidth = Math.max(50, startWidth + diff);
            
            resizingColumn.th.style.width = newWidth + 'px';
            resizingColumn.th.style.minWidth = newWidth + 'px';
            resizingColumn.th.style.maxWidth = newWidth + 'px';
            colDefs[resizingColumn.colIndex].width = newWidth;
            
            // Update total table width
            const totalWidth = colDefs.reduce((sum, col) => sum + col.width, 0) + 50;
            const table = containerEl.querySelector('.ag-grid-table');
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
    }

    function stopResize() {
        resizingColumn = null;
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
    }

    function renderAgGridRows(colDefs, data, containerEl) {
        console.log('[AG-GRID] renderAgGridRows called with', data.length, 'rows');
        const tbody = containerEl.querySelector('.ag-grid-tbody');
        if (!tbody) {
            console.error('[AG-GRID] tbody element not found!');
            return;
        }
        
        tbody.innerHTML = '';

        data.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');
            tr.dataset.rowIndex = rowIndex;
            tr.style.cssText = 'border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);';
            tr.onmouseenter = () => tr.style.backgroundColor = 'var(--vscode-list-hoverBackground, #2a2d2e)';
            tr.onmouseleave = () => {
                if (!tr.classList.contains('selected')) {
                    tr.style.backgroundColor = '';
                }
            };

            // Add row number cell
            const rowNumTd = document.createElement('td');
            rowNumTd.className = 'ag-grid-row-number-cell';
            rowNumTd.textContent = rowIndex + 1;
            rowNumTd.style.cssText = `
                width: 50px;
                min-width: 50px;
                max-width: 50px;
                position: sticky;
                left: 0;
                background-color: var(--vscode-editor-background, #1e1e1e);
                border-right: 2px solid var(--vscode-panel-border, #3c3c3c);
                text-align: center;
                font-weight: 600;
                user-select: none;
                z-index: 6;
                cursor: pointer;
                padding: 6px 8px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            `;
            rowNumTd.onmouseenter = () => rowNumTd.style.backgroundColor = 'var(--vscode-list-hoverBackground, #2a2d2e)';
            rowNumTd.onmouseleave = () => {
                if (!tr.classList.contains('selected')) {
                    rowNumTd.style.backgroundColor = 'var(--vscode-editor-background, #1e1e1e)';
                }
            };
            rowNumTd.onclick = () => {
                const table = container.querySelector('.ag-grid-table');
                
                // Remove column highlights
                const allCells = table.querySelectorAll('th, td');
                allCells.forEach(cell => {
                    if (!cell.classList.contains('ag-grid-row-number-cell') && !cell.classList.contains('ag-grid-row-number-header')) {
                        cell.style.backgroundColor = '';
                    }
                });
                
                // Remove previous row selection
                const allRows = tbody.querySelectorAll('tr');
                allRows.forEach(r => {
                    r.classList.remove('selected');
                    r.style.backgroundColor = '';
                    const numCell = r.querySelector('.ag-grid-row-number-cell');
                    if (numCell) numCell.style.backgroundColor = 'var(--vscode-editor-background, #1e1e1e)';
                });
                
                // Highlight selected row
                tr.classList.add('selected');
                tr.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
                rowNumTd.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
            };
            tr.appendChild(rowNumTd);

            colDefs.forEach((col, colIndex) => {
                const td = document.createElement('td');
                td.style.cssText = `
                    width: ${col.width}px;
                    min-width: ${col.width}px;
                    max-width: ${col.width}px;
                    border-right: 1px solid var(--vscode-panel-border, #3c3c3c);
                    padding: 6px 8px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                `;
                
                if (col.pinned) {
                    const leftOffset = calculatePinnedOffset(colDefs, colIndex);
                    td.style.position = 'sticky';
                    td.style.left = leftOffset + 'px';
                    td.style.backgroundColor = 'var(--vscode-editor-background, #1e1e1e)';
                    td.style.zIndex = '5';
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
                    td.textContent = String(value);
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

                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });
        
        console.log('[AG-GRID] Rendered', data.length, 'rows successfully');
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
        
        updateFilteredData(colDefs, sortCfg, filters, containerEl);
        renderAgGridHeaders(colDefs, sortCfg, filters, containerEl);
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
            updateFilteredData(colDefs, sortCfg, filters, containerEl);
            renderAgGridHeaders(colDefs, sortCfg, filters, containerEl);
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
            updateFilteredData(colDefs, sortCfg, filters, containerEl);
            renderAgGridHeaders(colDefs, sortCfg, filters, containerEl);
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

        renderAgGridRows(colDefs, filteredData, containerEl);
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
    const executionStatsEl = document.getElementById('executionStats');
    const resizer = document.getElementById('resizer');
    
    lastResults = [];
    lastMessages = messages || [{ type: 'error', text: error }];
    
    executeButton.disabled = false;
    cancelButton.disabled = true;
    
    const isCancelled = error.includes('cancel');
    statusLabel.textContent = isCancelled ? 'Query cancelled' : 'Query failed';
    executionStatsEl.textContent = '';

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

// Create context menu HTML
function createContextMenu() {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.display = 'none';
    menu.innerHTML = `
        <div class="context-menu-item" data-action="copy-cell">Copy Cell</div>
        <div class="context-menu-item" data-action="copy-row">Copy Row</div>
        <div class="context-menu-item" data-action="copy-row-header">Copy Row with Headers</div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" data-action="copy-column">Copy Column</div>
        <div class="context-menu-item" data-action="copy-table">Copy Table</div>
    `;
    document.body.appendChild(menu);
    
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

function showContextMenu(e, cellData) {
    e.preventDefault();
    
    if (!contextMenu) {
        contextMenu = createContextMenu();
    }
    
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

function handleContextMenuAction(action) {
    if (!contextMenuData) return;
    
    const { table, rowIndex, columnIndex, columnDefs, data } = contextMenuData;
    let textToCopy = '';
    
    switch (action) {
        case 'copy-cell':
            const cellValue = data[rowIndex][columnDefs[columnIndex].field];
            textToCopy = cellValue === null ? 'NULL' : String(cellValue);
            break;
            
        case 'copy-row':
            const row = data[rowIndex];
            textToCopy = columnDefs.map(col => {
                const val = row[col.field];
                return val === null ? 'NULL' : String(val);
            }).join('\t');
            break;
            
        case 'copy-row-header':
            const headers = columnDefs.map(col => col.headerName).join('\t');
            const rowData = columnDefs.map(col => {
                const val = data[rowIndex][col.field];
                return val === null ? 'NULL' : String(val);
            }).join('\t');
            textToCopy = headers + '\n' + rowData;
            break;
            
        case 'copy-column':
            const colField = columnDefs[columnIndex].field;
            textToCopy = data.map(row => {
                const val = row[colField];
                return val === null ? 'NULL' : String(val);
            }).join('\n');
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

// Hide context menu when clicking elsewhere
document.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
        hideContextMenu();
    }
});

// Hide context menu on scroll
document.addEventListener('scroll', hideContextMenu, true);