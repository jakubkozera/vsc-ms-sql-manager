// Helper functions for SQL parsing and schema lookup
var completionProviderRegistered = false;

function extractTablesFromQuery(query) {
    const tables = [];
    const lowerQuery = query.toLowerCase();
    
    console.log('[SQL-COMPLETION] extractTablesFromQuery called with:', query);
    
    // SQL keywords that should not be considered as aliases
    const sqlKeywords = ['select', 'from', 'where', 'join', 'inner', 'left', 'right', 'full', 'cross', 'on', 'and', 'or', 'order', 'group', 'by', 'having'];
    
    // Match FROM and JOIN clauses with optional aliases
    // Patterns: FROM schema.table alias, FROM [schema].[table] alias, FROM table alias, JOIN schema.table alias, etc.
    const patterns = [
        // Pattern for bracketed identifiers: FROM [schema].[table] [alias] or FROM [table] [alias]
        /\b(?:from|(?:inner\s+|left\s+|right\s+|full\s+|cross\s+)?join)\s+(?:\[([^\]]+)\]\.)?\[([^\]]+)\](?:\s+(?:as\s+)?(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*)))?(?:\s+on\s+|\s+where\s+|\s+order\s+by\s+|\s+group\s+by\s+|\s+having\s+|\s*$|\s*\r?\n)/gi,
        // Pattern for schema.table with alias (must have dot)
        /\b(?:from|(?:inner\s+|left\s+|right\s+|full\s+|cross\s+)?join)\s+([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:as\s+)?(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*)))?(?:\s+on\s+|\s+where\s+|\s+order\s+by\s+|\s+group\s+by\s+|\s+having\s+|\s*$|\s*\r?\n)/gi,
        // Pattern for just table name with alias (no schema)
        /\b(?:from|(?:inner\s+|left\s+|right\s+|full\s+|cross\s+)?join)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:as\s+)?(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*)))?(?:\s+on\s+|\s+where\s+|\s+order\s+by\s+|\s+group\s+by\s+|\s+having\s+|\s*$|\s*\r?\n)/gi
    ];
    
    patterns.forEach((pattern, patternIndex) => {
        console.log(`[SQL-COMPLETION] Testing pattern ${patternIndex + 1}:`, pattern);
        // Create a new regex instance to avoid global flag issues
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = regex.exec(query)) !== null) {
            console.log('[SQL-COMPLETION] Regex match:', match);
            
            // Pattern-specific parsing
            let schema, table, alias;
            if (patternIndex === 0) {
                // Bracketed: [schema].[table] [alias] or [table] [alias]
                schema = match[1] || 'dbo';
                table = match[2];
                alias = match[3] || match[4]; // [alias] or alias
            } else if (patternIndex === 1) {
                // schema.table [alias] or alias (with dot)
                schema = match[1];
                table = match[2];
                alias = match[3] || match[4]; // [alias] or alias
            } else {
                // table only (no schema) [alias] or alias
                schema = 'dbo';
                table = match[1];
                alias = match[2] || match[3]; // [alias] or alias
            }
            
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

    // Pattern: FROM tableName alias or JOIN tableName alias (with or without brackets)
    const patterns = [
        // Pattern with brackets: FROM [schema].[table] [alias] or FROM [table] [alias]
        new RegExp(`from\\s+(?:\\[(\\w+)\\]\\.)?\\[(\\w+)\\]\\s+(?:as\\s+)?(?:\\[${lowerAlias}\\]|${lowerAlias})(?:\\s|,|$)`, 'i'),
        new RegExp(`join\\s+(?:\\[(\\w+)\\]\\.)?\\[(\\w+)\\]\\s+(?:as\\s+)?(?:\\[${lowerAlias}\\]|${lowerAlias})(?:\\s|,|$)`, 'i'),
        // Pattern without brackets: FROM schema.table alias or FROM table alias
        new RegExp(`from\\s+(?:(\\w+)\\.)?(\\w+)\\s+(?:as\\s+)?(?:\\[${lowerAlias}\\]|${lowerAlias})(?:\\s|,|$)`, 'i'),
        new RegExp(`join\\s+(?:(\\w+)\\.)?(\\w+)\\s+(?:as\\s+)?(?:\\[${lowerAlias}\\]|${lowerAlias})(?:\\s|,|$)`, 'i')
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
    if (dbSchema && dbSchema.tables) {
        for (const table of dbSchema.tables) {
            if (table.name.toLowerCase() === lowerName) {
                return { schema: table.schema, table: table.name };
            }
        }
    }
    
    // Then check views
    if (dbSchema && dbSchema.views) {
        for (const view of dbSchema.views) {
            if (view.name.toLowerCase() === lowerName) {
                return { schema: view.schema, table: view.name };
            }
        }
    }
    
    return null;
}

function getColumnsForTable(schema, tableName) {
    const lowerName = tableName.toLowerCase();
    
    if (dbSchema && dbSchema.tables) {
        for (const table of dbSchema.tables) {
            if (table.name.toLowerCase() === lowerName && table.schema === schema) {
                return table.columns;
            }
        }
    }
    
    if (dbSchema && dbSchema.views) {
        for (const view of dbSchema.views) {
            if (view.name.toLowerCase() === lowerName && view.schema === schema) {
                return view.columns;
            }
        }
    }
    
    return [];
}

function getRelatedTables(tablesInQuery) {
    const relatedTables = [];
    const existingTableNames = tablesInQuery.map(t => t.table.toLowerCase());
    
    // Get all tables with foreign keys
    if (dbSchema && dbSchema.foreignKeys) {
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
                    suggestions: relatedTables.filter(t => t && t.name).map(table => {
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
    console.log('[SQL-COMPLETION] Available snippets:', sqlSnippets.map(s => s.prefix).join(', '));

    // Add tables
    dbSchema.tables.forEach(table => {
        const fullName = table.schema === 'dbo' ? table.name : `${table.schema}.${table.name}`;
        
        // Regular table suggestion
        suggestions.push({
            label: fullName,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: `ðŸ—‚ï¸ Table (${table.columns.length} columns)`,
            insertText: fullName,
            range: range,
            sortText: `2_${fullName}` // Lower priority than special options
        });
        
        // Add special script generation options only for new queries
        if (isNewQuery) {
            const table100Label = `${table.name}100`;
            const tableAllLabel = `${table.name}*`;
            
            // Check if user has custom snippets with same prefixes
            const hasConflict100 = sqlSnippets.some(s => s.prefix.toLowerCase() === table100Label.toLowerCase());
            const hasConflictAll = sqlSnippets.some(s => s.prefix.toLowerCase() === tableAllLabel.toLowerCase());
            
            // Only add if no conflict with user snippets (user snippets take priority)
            if (!hasConflict100) {
                const bracketedName = `[${table.schema}].[${table.name}]`;
                const aliasName = generateSmartAlias(table.name);
                suggestions.push({
                    label: table100Label,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    detail: `\uD83D\uDCC5 Generate SELECT TOP 100 from ${fullName}`,
                    insertText: `SELECT TOP 100 *\nFROM ${bracketedName} [${aliasName}]`,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: range,
                    sortText: `0_${table.name}_100`, // High priority
                    documentation: {
                        value: `**Quick Script**: SELECT TOP 100 rows from ${fullName}\n\nThis will generate a complete SELECT statement to view the first 100 rows from the table.`
                    }
                });
            }
            
            if (!hasConflictAll) {
                const bracketedName = `[${table.schema}].[${table.name}]`;
                const aliasName = generateSmartAlias(table.name);
                suggestions.push({
                    label: tableAllLabel,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    detail: `\uD83D\uDCC5 Generate SELECT * from ${fullName}`,
                    insertText: `SELECT *\nFROM ${bracketedName} [${aliasName}]`,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: range,
                    sortText: `0_${table.name}_all`,
                    documentation: {
                        value: `**Quick Script**: SELECT all rows from ${fullName}\n\nâš ï¸ **Warning**: This will return ALL rows from the table.`
                    }
                });
            }
        }
    });

    // Add views
    dbSchema.views.forEach(view => {
        const fullName = view.schema === 'dbo' ? view.name : `${view.schema}.${view.name}`;
        
        // Regular view suggestion
        suggestions.push({
            label: fullName,
            kind: monaco.languages.CompletionItemKind.Interface,
            detail: `ðŸ‘ï¸ View (${view.columns.length} columns)`,
            insertText: fullName,
            range: range,
            sortText: `2_${fullName}` // Lower priority than special options
        });
        
        // Add special script generation options only for new queries
        if (isNewQuery) {
            const view100Label = `${view.name}100`;
            const viewAllLabel = `${view.name}*`;
            
            // Check if user has custom snippets with same prefixes
            const hasConflict100 = sqlSnippets.some(s => s.prefix.toLowerCase() === view100Label.toLowerCase());
            const hasConflictAll = sqlSnippets.some(s => s.prefix.toLowerCase() === viewAllLabel.toLowerCase());
            
            // Only add if no conflict with user snippets
            if (!hasConflict100) {
                const bracketedName = `[${view.schema}].[${view.name}]`;
                const aliasName = generateSmartAlias(view.name);
                suggestions.push({
                    label: view100Label,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    detail: `\uD83D\uDCC5 Generate SELECT TOP 100 from ${fullName} (View)`,
                    insertText: `SELECT TOP 100 *\nFROM ${bracketedName} [${aliasName}]`,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: range,
                    sortText: `0_${view.name}_100`,
                    documentation: {
                        value: `**Quick Script**: SELECT TOP 100 rows from view ${fullName}`
                    }
                });
            }
            
            if (!hasConflictAll) {
                const bracketedName = `[${view.schema}].[${view.name}]`;
                const aliasName = generateSmartAlias(view.name);
                suggestions.push({
                    label: viewAllLabel,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    detail: `\uD83D\uDCC5 Generate SELECT * from ${fullName} (View)`,
                    insertText: `SELECT *\nFROM ${bracketedName} [${aliasName}]`,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: range,
                    sortText: `0_${view.name}_all`,
                    documentation: {
                        value: `**Quick Script**: SELECT all rows from view ${fullName}`
                    }
                });
            }
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
            detail: `ðŸ”‘ SQL Keyword`,
            insertText: keyword,
            range: range,
            sortText: `9_${keyword}` // Low priority for keywords
        });
    });
    
    // Combine user snippets with built-in snippets
    const allSnippets = [...sqlSnippets, ...builtInSnippets];
    console.log('[SQL-COMPLETION] Adding snippets:', sqlSnippets.length, 'user +', builtInSnippets.length, 'built-in =', allSnippets.length, 'total');
    
    const existingLabels = new Set(suggestions.map(s => s.label.toLowerCase()));
    
    allSnippets.forEach(snippet => {
        // Skip snippets that conflict with existing table suggestions
        if (existingLabels.has(snippet.prefix.toLowerCase())) {
            console.log('[SQL-COMPLETION] Skipping duplicate snippet:', snippet.prefix);
            return;
        }
        
        // Determine if this is a user snippet or built-in
        const isUserSnippet = sqlSnippets.includes(snippet) || sqlSnippets.some(userSnippet => userSnippet.prefix === snippet.prefix);
        const snippetType = isUserSnippet ? 'User' : 'Built-in';
        const iconPrefix = isUserSnippet ? '\uD83D\uDCDD' : '\u26A1';
        // Ensure user snippets (database generated) are always on top
        const sortPrefix = isUserSnippet ? '00_user' : 'zz_builtin';
        
        suggestions.push({
            label: snippet.prefix,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: `${iconPrefix} ${snippet.description}`,
            insertText: snippet.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: range,
            sortText: `${sortPrefix}_snippet_${snippet.prefix}`,
            documentation: {
                value: `**${snippetType} Snippet**: ${snippet.name}\n\n${snippet.description || 'SQL snippet'}\n\n---\n*${isUserSnippet ? 'Loaded from snippets file' : 'Built into MS SQL Manager'}*`
            }
        });
        existingLabels.add(snippet.prefix.toLowerCase());
    });

    // Final deduplication based on label (case-insensitive)
    const uniqueSuggestions = [];
    const seenLabels = new Set();
    
    for (const suggestion of suggestions) {
        const labelKey = suggestion.label.toLowerCase();
        if (!seenLabels.has(labelKey)) {
            uniqueSuggestions.push(suggestion);
            seenLabels.add(labelKey);
        } else {
            console.log('[SQL-COMPLETION] Skipping duplicate suggestion:', suggestion.label);
        }
    }
    
    console.log('[SQL-COMPLETION] Returning', uniqueSuggestions.length, 'unique suggestions (removed', suggestions.length - uniqueSuggestions.length, 'duplicates)');
    return { suggestions: uniqueSuggestions };
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

function analyzeWhereContext(textAfterWhere) {
    // Analyze WHERE clause to determine if we should suggest operators
    const trimmedText = textAfterWhere.trim();
    
    if (!trimmedText) {
        return false;
    }
    
    const conditions = trimmedText.split(/\s+(?:and|or)\s+/i);
    const currentCondition = conditions[conditions.length - 1].trim();
    
    // Check if current condition has a column/value but no operator yet
    const columnPatterns = [
        /^(?:\w+\.)*\w+\s*$/,  // Column name (e.g., "p.Id ", "columnName ")
        /^['"]\w*$/,  // Starting a string literal
        /^\d+\.?\d*$/  // Number
    ];
    
    for (const pattern of columnPatterns) {
        if (pattern.test(currentCondition)) {
            const hasOperator = /\s*(=|<>|!=|<|>|<=|>=|like|in|not\s+in|is\s+null|is\s+not\s+null|between)\s*/i.test(currentCondition);
            return !hasOperator;
        }
    }
    
    return false;
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
    if (!tableName) return 't';

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


// Register completion provider (can be called multiple times to update snippets)
function registerCompletionProvider() {
    if (!monaco || !monaco.languages) {
        console.log('[SNIPPETS] Monaco not ready, skipping completion provider registration');
        return;
    }
    
    // Only register once - Monaco doesn't support clean disposal/re-registration
    if (completionProviderRegistered) {
        console.log('[SNIPPETS] Completion provider already registered, snippets will be updated automatically');
        return;
    }
    
    console.log('[SNIPPETS] Registering completion provider for the first time with', sqlSnippets.length, 'snippets');
    
    // Configure Monaco Editor for better snippet support (only set once)
    try {
        monaco.languages.setLanguageConfiguration('sql', {
            wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
        });
    } catch (e) {
        // Language config might already be set, ignore error
        console.log('[SNIPPETS] Language config already set:', e.message);
    }
    
    // Register completion provider and store reference
    completionProvider = monaco.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: ['.', ' '], // Trigger on dot and space for better snippet matching
        provideCompletionItems: (model, position) => {
            console.log('[SQL-COMPLETION] provideCompletionItems called at position:', position);
            console.log('[SQL-COMPLETION] Current dbSchema:', dbSchema);
            return provideSqlCompletions(model, position);
        }
    });
    
    completionProviderRegistered = true;
    console.log('[SNIPPETS] Completion provider registered successfully');
}

// Debug function to reset completion provider (for development)
function resetCompletionProvider() {
    console.log('[DEBUG] Resetting completion provider...');
    completionProviderRegistered = false;
    if (completionProvider) {
        try {
            completionProvider.dispose();
        } catch (e) {
            console.log('[DEBUG] Error disposing completion provider:', e);
        }
        completionProvider = null;
    }
    registerCompletionProvider();
    console.log('[DEBUG] Completion provider reset complete');
}

// Make reset function available globally for debugging
window.resetCompletionProvider = resetCompletionProvider;

// Register Monaco Editor context menu action for creating snippets
function registerCreateSnippetAction() {
    if (!monaco || !monaco.editor || !editor) {
        console.log('[SNIPPETS] Monaco or editor not ready for context menu registration');
        return;
    }

    try {
        editor.addAction({
            id: 'create-snippet',
            label: 'Create Snippet...',
            contextMenuGroupId: '9_cutcopypaste',
            contextMenuOrder: 1.5,
            precondition: 'editorHasSelection',
            run: async function(editor) {
                const selection = editor.getSelection();
                const selectedText = editor.getModel().getValueInRange(selection);
                
                if (!selectedText || selectedText.trim().length === 0) {
                    console.log('[SNIPPETS] No text selected');
                    return;
                }
                
                console.log('[SNIPPETS] Creating snippet from selection:', selectedText.length, 'characters');
                await createSnippetFromSelection(selectedText.trim());
            }
        });
        console.log('[SNIPPETS] Create snippet action registered successfully');
    } catch (error) {
        console.error('[SNIPPETS] Failed to register create snippet action:', error);
    }
}

// Function to handle snippet creation from selected text
async function createSnippetFromSelection(selectedText) {
    try {
        console.log('[SNIPPETS] Starting snippet creation process...');
        
        // Send message to extension to get user input
        vscode.postMessage({
            type: 'requestSnippetInput',
            selectedText: selectedText
        });
        
    } catch (error) {
        console.error('[SNIPPETS] Error creating snippet:', error);
    }
}

// Helper function to find table at position
function findTableAtPosition(ed, position) {
    console.log('[findTableAtPosition] Called with position:', position);
    const model = ed.getModel();
    if (!model || !position) {
        console.log('[findTableAtPosition] No model or position');
        return null;
    }

    const wordInfo = model.getWordAtPosition(position);
    console.log('[findTableAtPosition] wordInfo:', wordInfo);
    if (!wordInfo || !wordInfo.word) {
        console.log('[findTableAtPosition] No word found at position');
        return null;
    }

    const rawWord = wordInfo.word;
    console.log('[findTableAtPosition] rawWord:', rawWord);
    const fullText = model.getValue();

    // Parse qualified identifier
    function stripIdentifierPart(part) {
        if (!part) return part;
        part = part.trim();
        if ((part.startsWith('[') && part.endsWith(']')) || (part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
            return part.substring(1, part.length - 1);
        }
        return part;
    }

    function parseQualifiedIdentifier(name) {
        if (!name) return { schema: null, table: null };
        const parts = name.split('.');
        if (parts.length === 2) {
            return { schema: stripIdentifierPart(parts[0]), table: stripIdentifierPart(parts[1]) };
        }
        return { schema: null, table: stripIdentifierPart(name) };
    }

    const parsed = parseQualifiedIdentifier(rawWord);
    console.log('[findTableAtPosition] parsed:', parsed);
    const normalizedTableName = parsed.table;
    console.log('[findTableAtPosition] normalizedTableName:', normalizedTableName);

    // Find table in schema
    const table = findTable(normalizedTableName);
    console.log('[findTableAtPosition] findTable result:', table);
    if (table) {
        console.log('[findTableAtPosition] Returning table info');
        return { schema: table.schema, table: table.table };
    }

    console.log('[findTableAtPosition] Table not found');
    return null;
}

require.config({ 
    paths: { 
        vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' 
    }
});

require(['vs/editor/editor.main'], function () {

    // Detect VS Code theme
    function detectTheme() {
        const body = document.body;
        if (body.classList.contains('vscode-dark') || body.classList.contains('vscode-high-contrast')) {
            return 'vs-dark';
        }
        return 'vs';
    }
    
    const theme = detectTheme();
    let validationTimeout = null;

    function validateSql() {
        // Use external validator if available
        if (typeof window.validateSql === 'function') {
            window.validateSql(editor, dbSchema);
        } else {
            console.warn('sqlValidator.js not loaded');
        }
    }
    
    const editorElement = document.getElementById('editor');
    if (editorElement) {
        editor = monaco.editor.create(editorElement, {
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

        // Create context key for table at cursor
        var tableAtCursorContextKey = editor.createContextKey('tableAtCursor', false);

        // Watch for theme changes
        const observer = new MutationObserver(() => {
            const newTheme = detectTheme();
            if (editor) {
                monaco.editor.setTheme(newTheme);
            }
        });
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

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
                    
                    // Check if there's a table at the cursor position
                    const tableInfo = findTableAtPosition(editor, lastContextPosition);
                    tableAtCursorContextKey.set(!!tableInfo);
                    console.log('[editor.onMouseDown] table at cursor:', !!tableInfo, tableInfo);
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

    // Register SQL completion provider (initial registration)
    registerCompletionProvider();

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
    
    // Request SQL snippets from extension
    vscode.postMessage({ type: 'getSnippets' });

    // Ensure Go-to-definition action is registered after editor is created
    try {
        if (typeof registerGoToDefinitionAction === 'function') {
            registerGoToDefinitionAction();
            console.log('[GoToDef] Registered action inside require callback');
        }
    } catch (e) {
        console.error('[GoToDef] Failed to register inside require callback', e);
    }
    
    // Register Create Snippet action
    try {
        registerCreateSnippetAction();
        console.log('[SNIPPETS] Create snippet action registered');
    } catch (e) {
        console.error('[SNIPPETS] Failed to register create snippet action:', e);
    }

    // Add global keyboard listener for CTRL+C to copy table selections
    setupGlobalKeyboardHandlers();
});
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

    // Add Script ROW as INSERT action
    editor.addAction({
        id: 'mssqlmanager.scriptRowAsInsert',
        label: 'Script as INSERT',
        keybindings: [],
        contextMenuGroupId: 'script',
        contextMenuOrder: 1.1,
        precondition: 'tableAtCursor',
        run: function(ed) {
            try {
                const position = (typeof lastContextPosition !== 'undefined' && lastContextPosition) ? lastContextPosition : ed.getPosition();
                const tableInfo = findTableAtPosition(ed, position);
                if (tableInfo) {
                    vscode.postMessage({ 
                        type: 'scriptRowAsInsert', 
                        schema: tableInfo.schema, 
                        table: tableInfo.table, 
                        connectionId: currentConnectionId, 
                        database: currentDatabaseName 
                    });
                }
            } catch (error) {
                console.error('[Script Action] Error in Script as INSERT:', error);
            }
        }
    });

    // Add Script ROW as UPDATE action
    editor.addAction({
        id: 'mssqlmanager.scriptRowAsUpdate',
        label: 'Script as UPDATE',
        keybindings: [],
        contextMenuGroupId: 'script',
        contextMenuOrder: 1.2,
        precondition: 'tableAtCursor',
        run: function(ed) {
            try {
                const position = (typeof lastContextPosition !== 'undefined' && lastContextPosition) ? lastContextPosition : ed.getPosition();
                const tableInfo = findTableAtPosition(ed, position);
                if (tableInfo) {
                    vscode.postMessage({ 
                        type: 'scriptRowAsUpdate', 
                        schema: tableInfo.schema, 
                        table: tableInfo.table, 
                        connectionId: currentConnectionId, 
                        database: currentDatabaseName 
                    });
                }
            } catch (error) {
                console.error('[Script Action] Error in Script as UPDATE:', error);
            }
        }
    });

    // Add Script ROW as DELETE action
    editor.addAction({
        id: 'mssqlmanager.scriptRowAsDelete',
        label: 'Script as DELETE',
        keybindings: [],
        contextMenuGroupId: 'script',
        contextMenuOrder: 1.3,
        precondition: 'tableAtCursor',
        run: function(ed) {
            try {
                const position = (typeof lastContextPosition !== 'undefined' && lastContextPosition) ? lastContextPosition : ed.getPosition();
                const tableInfo = findTableAtPosition(ed, position);
                if (tableInfo) {
                    vscode.postMessage({ 
                        type: 'scriptRowAsDelete', 
                        schema: tableInfo.schema, 
                        table: tableInfo.table, 
                        connectionId: currentConnectionId, 
                        database: currentDatabaseName 
                    });
                }
            } catch (error) {
                console.error('[Script Action] Error in Script as DELETE:', error);
            }
        }
    });
}
