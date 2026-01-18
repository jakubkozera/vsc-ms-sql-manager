/**
 * SQL Validator - validates table/view references in SQL queries
 * Port from sqlValidator.js
 */

import type { DatabaseSchema, TableInfo, ViewInfo } from '../types/schema';

export interface SqlStatement {
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface TableReference {
  schema: string | undefined;
  table: string;
  startIndex: number;
  length: number;
  isTemp: boolean;
}

export interface ValidationMarker {
  severity: 'error' | 'warning' | 'info';
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/**
 * Split SQL script into individual statements (by semicolon, ignoring strings and comments)
 */
export function splitSqlStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
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
      } else if (char === '-' && sql[i + 1] === '-') {
        // Single line comment
        const newlineIndex = sql.indexOf('\n', i);
        if (newlineIndex === -1) i = sql.length;
        else i = newlineIndex;
      } else if (char === '/' && sql[i + 1] === '*') {
        // Block comment
        const closeIndex = sql.indexOf('*/', i + 2);
        if (closeIndex === -1) i = sql.length;
        else i = closeIndex + 1;
      } else if (char === ';') {
        statements.push({
          text: sql.substring(currentStmtStart, i),
          startOffset: currentStmtStart,
          endOffset: i,
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
        endOffset: sql.length,
      });
    }
  }

  return statements;
}

/**
 * Extract CTE (Common Table Expression) names from a statement
 */
export function extractCTEs(statementText: string): Set<string> {
  const ctes = new Set<string>();
  
  // Find start of WITH clause
  const withMatch = statementText.match(/^\s*WITH\s+/i);
  if (!withMatch) return ctes;

  let remaining = statementText.substring(withMatch[0].length + (withMatch.index || 0));
  
  // Regex for CTE name: name AS (
  const cteStartRegex = /^\s*(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*))\s+AS\s*\(/i;

  while (true) {
    const match = remaining.match(cteStartRegex);
    if (!match) break;

    const cteName = match[1] || match[2];
    ctes.add(cteName.toLowerCase());

    // Skip CTE body (parentheses)
    let openCount = 1;
    let i = (match.index || 0) + match[0].length;

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

/**
 * Find table references in FROM/JOIN clauses
 */
export function findTableReferences(statementText: string): TableReference[] {
  const references: TableReference[] = [];
  
  const patterns = [
    // [schema].[table]
    { regex: /\b(?:from|join)\s+(?:\[([^\]]+)\]\s*\.\s*)\[([^\]]+)\]/gi, hasSchema: true },
    // schema.table
    { regex: /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)/gi, hasSchema: true },
    // [table] (no dot after)
    { regex: /\b(?:from|join)\s+\[([^\]]+)\](?!\s*\.)/gi, hasSchema: false },
    // table (no dot after)
    { regex: /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?!\s*\.)/gi, hasSchema: false },
  ];

  for (const p of patterns) {
    let match;
    const regex = new RegExp(p.regex.source, p.regex.flags);
    
    while ((match = regex.exec(statementText)) !== null) {
      const fullMatch = match[0];
      const matchIndex = match.index;
      let tableName: string;
      let schemaName: string | undefined;

      if (p.hasSchema) {
        schemaName = match[1];
        tableName = match[2];
      } else {
        tableName = match[1];
        schemaName = undefined;
      }

      // Calculate start index and length of the reference part
      const prefixMatch = fullMatch.match(/^\b(?:from|join)\s+/i);
      const prefixLen = prefixMatch ? prefixMatch[0].length : 0;
      const refText = fullMatch.substring(prefixLen);

      references.push({
        schema: schemaName,
        table: tableName,
        startIndex: matchIndex + prefixLen,
        length: refText.length,
        isTemp: tableName.startsWith('#'),
      });
    }
  }

  // Remove overlapping matches - keep longer ones (schema.table over just table)
  references.sort((a, b) => {
    if (a.startIndex !== b.startIndex) {
      return a.startIndex - b.startIndex;
    }
    return b.length - a.length;
  });

  const filteredReferences: TableReference[] = [];
  for (let i = 0; i < references.length; i++) {
    const current = references[i];
    let isContained = false;

    for (let j = 0; j < references.length; j++) {
      if (i === j) continue;
      const other = references[j];

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

/**
 * Check if a table/view exists in the schema
 */
export function findTableInSchema(
  tableName: string,
  schemaName: string | undefined,
  dbSchema: DatabaseSchema
): boolean {
  if (!dbSchema) return false;
  
  const targetTable = tableName.toLowerCase();
  const targetSchema = schemaName ? schemaName.toLowerCase() : null;

  const checkCollection = (collection: TableInfo[] | ViewInfo[] | undefined): boolean => {
    if (!collection) return false;
    return collection.some((t) => {
      if (t.name.toLowerCase() !== targetTable) return false;
      // If schema not specified in query, consider valid if table exists in any schema
      return targetSchema ? t.schema.toLowerCase() === targetSchema : true;
    });
  };

  return checkCollection(dbSchema.tables) || checkCollection(dbSchema.views);
}

/**
 * Get position in text from absolute offset
 */
function getPositionAt(text: string, offset: number): { lineNumber: number; column: number } {
  const lines = text.substring(0, offset).split('\n');
  return {
    lineNumber: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

/**
 * Validate SQL and return validation markers
 */
export function validateSql(sql: string, dbSchema: DatabaseSchema): ValidationMarker[] {
  const markers: ValidationMarker[] = [];
  const statements = splitSqlStatements(sql);

  for (const stmt of statements) {
    // Mask comments with spaces to preserve character indices
    const maskedText = stmt.text.replace(/\/\*[\s\S]*?\*\/|--.*$/gm, (match) => ' '.repeat(match.length));

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
      const startPos = getPositionAt(sql, absStart);
      const endPos = getPositionAt(sql, absStart + ref.length);

      markers.push({
        severity: 'error',
        message: `Invalid object name '${ref.table}'.`,
        startLineNumber: startPos.lineNumber,
        startColumn: startPos.column,
        endLineNumber: endPos.lineNumber,
        endColumn: endPos.column,
      });
    }
  }

  return markers;
}
