// SQL Validation Logic
// This file should be loaded before or with editor.js

(function(global) {
    
    global.validateSql = function(editor, dbSchema) {
        const model = editor.getModel();
        if (!model) return;
        
        const sql = model.getValue();
        const markers = [];
        
        const statements = splitSqlStatements(sql);
        
        for (const stmt of statements) {
            // Mask comments with spaces to preserve character indices for error highlighting
            const maskedText = stmt.text.replace(/\/\*[\s\S]*?\*\/|--.*$/gm, match => ' '.repeat(match.length));
            
            const ctes = extractCTEs(maskedText);
            const references = findTableReferences(maskedText);
            
            for (const ref of references) {
                // 1. Valid if temp table
                if (ref.isTemp) continue;
                
                // 2. Valid if CTE (only if no schema specified)
                if (!ref.schema && ctes.has(ref.table.toLowerCase())) continue;
                
                // 3. Valid if exists in database schema
                if (findTableInSchema(ref.table, ref.schema, dbSchema)) continue;
                
                // If we reached here, the object is invalid
                const absStart = stmt.startOffset + ref.startIndex;
                const startPos = model.getPositionAt(absStart);
                const endPos = model.getPositionAt(absStart + ref.length);
                
                markers.push({
                    severity: monaco.MarkerSeverity.Error,
                    message: `Invalid object name '${ref.table}'.`,
                    startLineNumber: startPos.lineNumber,
                    startColumn: startPos.column,
                    endLineNumber: endPos.lineNumber,
                    endColumn: endPos.column
                });
            }
        }
        
        monaco.editor.setModelMarkers(model, 'sql', markers);
    };

    // Function to split script into statements (by semicolon, ignoring strings and comments)
    function splitSqlStatements(sql) {
        const statements = [];
        let inQuote = false;
        let quoteChar = '';
        let inBrackets = false;
        let currentStmtStart = 0;
        
        for (let i = 0; i < sql.length; i++) {
            const char = sql[i];
            
            if (inQuote) {
                if (char === quoteChar) {
                    if (sql[i + 1] === quoteChar) {
                        i++; // Skip escaped quote
                    } else {
                        inQuote = false;
                    }
                }
            } else if (inBrackets) {
                if (char === ']') {
                    inBrackets = false;
                }
            } else {
                if (char === "'" || char === '"') {
                    inQuote = true;
                    quoteChar = char;
                } else if (char === '[') {
                    inBrackets = true;
                } else if (char === '-' && sql[i+1] === '-') {
                    // Single line comment
                    const newlineIndex = sql.indexOf('\n', i);
                    if (newlineIndex === -1) i = sql.length;
                    else i = newlineIndex;
                } else if (char === '/' && sql[i+1] === '*') {
                    // Block comment
                    const closeIndex = sql.indexOf('*/', i + 2);
                    if (closeIndex === -1) i = sql.length;
                    else i = closeIndex + 1;
                } else if (char === ';') {
                    statements.push({
                        text: sql.substring(currentStmtStart, i),
                        startOffset: currentStmtStart,
                        endOffset: i
                    });
                    currentStmtStart = i + 1;
                }
            }
        }
        
        if (currentStmtStart < sql.length) {
            const text = sql.substring(currentStmtStart);
            if (text.trim()) {
                statements.push({
                    text: text,
                    startOffset: currentStmtStart,
                    endOffset: sql.length
                });
            }
        }
        
        return statements;
    }

    // Function to extract CTE names from a statement
    function extractCTEs(statementText) {
        const ctes = new Set();
        // Find start of WITH clause
        const withMatch = statementText.match(/^\s*WITH\s+/i);
        if (!withMatch) return ctes;

        let remaining = statementText.substring(withMatch[0].length + withMatch.index);
        // Regex for CTE name: name AS (
        const cteStartRegex = /^\s*(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*))\s+AS\s*\(/i;
        
        while (true) {
            const match = remaining.match(cteStartRegex);
            if (!match) break;
            
            const cteName = match[1] || match[2];
            ctes.add(cteName.toLowerCase());
            
            // Skip CTE body (parentheses)
            let openCount = 1;
            let i = match.index + match[0].length;
            
            for (; i < remaining.length; i++) {
                if (remaining[i] === '(') openCount++;
                else if (remaining[i] === ')') openCount--;
                if (openCount === 0) break;
            }
            
            if (i >= remaining.length) break;
            
            remaining = remaining.substring(i + 1);
            // Check for comma (next CTE)
            const commaMatch = remaining.match(/^\s*,/);
            if (commaMatch) {
                remaining = remaining.substring(commaMatch[0].length);
            } else {
                break;
            }
        }
        return ctes;
    }

    // Function to find tables in FROM/JOIN
    function findTableReferences(statementText) {
        const references = [];
        // Patterns with negative lookahead (?!\.) to avoid capturing schema names as tables
        // Updated to handle spaces around dot: \s*\.\s* and (?!\s*\.)
        const patterns = [
            // [schema] . [table]
            { regex: /\b(?:from|join)\s+(?:\[([^\]]+)\]\s*\.\s*)\[([^\]]+)\]/gi, hasSchema: true, bracketed: true },
            // schema . table
            { regex: /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)/gi, hasSchema: true, bracketed: false },
            // [table] (no dot after)
            { regex: /\b(?:from|join)\s+\[([^\]]+)\](?!\s*\.)/gi, hasSchema: false, bracketed: true },
            // table (no dot after)
            { regex: /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?!\s*\.)/gi, hasSchema: false, bracketed: false }
        ];

        for (const p of patterns) {
            let match;
            // Reset regex
            const regex = new RegExp(p.regex.source, p.regex.flags);
            while ((match = regex.exec(statementText)) !== null) {
                const fullMatch = match[0];
                const matchIndex = match.index;
                let tableName, schemaName;
                
                if (p.hasSchema) {
                    schemaName = match[1];
                    tableName = match[2];
                    
                    // Calculate start index and length of the reference part
                    // We strip the "FROM " or "JOIN " prefix
                    const prefixMatch = fullMatch.match(/^\b(?:from|join)\s+/i);
                    const prefixLen = prefixMatch ? prefixMatch[0].length : 0;
                    const refText = fullMatch.substring(prefixLen);
                    
                    references.push({
                        schema: schemaName,
                        table: tableName,
                        startIndex: matchIndex + prefixLen,
                        length: refText.length,
                        isTemp: tableName.startsWith('#')
                    });
                } else {
                    tableName = match[1];
                    const prefixMatch = fullMatch.match(/^\b(?:from|join)\s+/i);
                    const prefixLen = prefixMatch ? prefixMatch[0].length : 0;
                    const refText = fullMatch.substring(prefixLen);
                    
                    references.push({
                        schema: undefined,
                        table: tableName,
                        startIndex: matchIndex + prefixLen,
                        length: refText.length,
                        isTemp: tableName.startsWith('#')
                    });
                }
            }
        }
        
        // Remove overlapping matches - keep longer ones (schema.table over just table)
        // Sort by startIndex, then by length (descending)
        references.sort((a, b) => {
            if (a.startIndex !== b.startIndex) {
                return a.startIndex - b.startIndex;
            }
            return b.length - a.length; // Longer matches first
        });
        
        // Filter out references that are contained within other references
        const filteredReferences = [];
        for (let i = 0; i < references.length; i++) {
            const current = references[i];
            let isContained = false;
            
            // Check if this reference is contained in any other reference
            for (let j = 0; j < references.length; j++) {
                if (i === j) continue;
                const other = references[j];
                
                // Check if current is contained within other
                const currentEnd = current.startIndex + current.length;
                const otherEnd = other.startIndex + other.length;
                
                if (current.startIndex >= other.startIndex && currentEnd <= otherEnd && current.length < other.length) {
                    isContained = true;
                    break;
                }
            }
            
            if (!isContained) {
                filteredReferences.push(current);
            }
        }
        
        return filteredReferences;
    }

    // Check in cache (dbSchema)
    function findTableInSchema(tableName, schemaName, dbSchema) {
        if (!dbSchema) return false;
        const targetTable = tableName.toLowerCase();
        const targetSchema = schemaName ? schemaName.toLowerCase() : null;
        
        const checkCollection = (collection) => {
            if (!collection) return false;
            return collection.some(t => {
                if (t.name.toLowerCase() !== targetTable) return false;
                // If schema not specified in query, consider valid if table exists in any schema
                // (simplification, but safe for validation)
                return targetSchema ? t.schema.toLowerCase() === targetSchema : true;
            });
        };
        
        return checkCollection(dbSchema.tables) || checkCollection(dbSchema.views);
    }

})(window);
