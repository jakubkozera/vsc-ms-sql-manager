/**
 * SQL Validator - validates table/view references in SQL queries
 * Port from sqlValidator.js
 */

import type { DatabaseSchema, TableInfo, ViewInfo } from '../types/schema';
import { getColumnsForTable } from './sqlCompletionService';

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
function extractCTEsFromSingleStatement(statementText: string): Set<string> {
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

export function extractCTEs(statementText: string): Set<string> {
  const statements = splitSqlStatements(statementText);
  if (statements.length === 0) {
    return extractCTEsFromSingleStatement(statementText);
  }

  const ctes = new Set<string>();
  for (const statement of statements) {
    const statementCtes = extractCTEsFromSingleStatement(statement.text);
    for (const cte of statementCtes) {
      ctes.add(cte);
    }
  }

  return ctes;
}

export interface CteColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
}

export interface CteDefinition {
  name: string;
  columns: CteColumnInfo[];
  body: string;
}

/**
 * Extract CTE definitions with their inferred column names and types.
 * Columns are inferred from the outermost SELECT clause aliases/names.
 * Types are resolved from the database schema when possible.
 */
function extractCTEsWithColumnsFromSingleStatement(statementText: string, dbSchema?: DatabaseSchema): CteDefinition[] {
  const ctes: CteDefinition[] = [];

  const withMatch = statementText.match(/^\s*WITH\s+/i);
  if (!withMatch) return ctes;

  let remaining = statementText.substring(withMatch[0].length + (withMatch.index || 0));
  const cteStartRegex = /^\s*(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*))\s+AS\s*\(/i;

  while (true) {
    const match = remaining.match(cteStartRegex);
    if (!match) break;

    const cteName = match[1] || match[2];

    // Extract CTE body (balanced parentheses)
    let openCount = 1;
    let i = (match.index || 0) + match[0].length;
    const bodyStart = i;

    for (; i < remaining.length; i++) {
      if (remaining[i] === '(') openCount++;
      else if (remaining[i] === ')') openCount--;
      if (openCount === 0) break;
    }

    const body = remaining.substring(bodyStart, i);
    const columns = extractSelectColumnsWithTypes(body, dbSchema);

    ctes.push({ name: cteName, columns, body });

    if (i >= remaining.length) break;

    remaining = remaining.substring(i + 1);

    const commaMatch = remaining.match(/^\s*,/);
    if (commaMatch) {
      remaining = remaining.substring(commaMatch[0].length);
    } else {
      break;
    }
  }

  return ctes;
}

export function extractCTEsWithColumns(statementText: string, dbSchema?: DatabaseSchema): CteDefinition[] {
  const statements = splitSqlStatements(statementText);
  if (statements.length === 0) {
    return extractCTEsWithColumnsFromSingleStatement(statementText, dbSchema);
  }

  return statements.flatMap(statement => extractCTEsWithColumnsFromSingleStatement(statement.text, dbSchema));
}

/**
 * Extract column names/aliases from the outermost SELECT clause of a CTE body.
 * Returns string[] for backward compatibility.
 */
export function extractSelectColumns(cteBody: string): string[] {
  return extractSelectColumnsWithTypes(cteBody).map(c => c.name);
}

/**
 * Extract column names/aliases with inferred types from the outermost SELECT clause.
 * Handles: `expr AS alias`, `table.column`, `[bracketed]`, `column`, `*`.
 * Skips into subqueries.
 */
export function extractSelectColumnsWithTypes(cteBody: string, dbSchema?: DatabaseSchema): CteColumnInfo[] {
  // Find the first SELECT (skip leading whitespace/comments)
  const selectMatch = cteBody.match(/\bSELECT\s+(?:TOP\s+\d+\s+)?(?:DISTINCT\s+)?/i);
  if (!selectMatch) return [];

  const afterSelect = cteBody.substring((selectMatch.index || 0) + selectMatch[0].length);

  // Find the end of the SELECT list — look for FROM at depth 0
  let depth = 0;
  let inQuote = false;
  let quoteChar = '';
  let inBrackets = false;
  let fromIndex = -1;

  for (let i = 0; i < afterSelect.length; i++) {
    const ch = afterSelect[i];

    if (inQuote) {
      if (ch === quoteChar) {
        if (afterSelect[i + 1] === quoteChar) { i++; } else { inQuote = false; }
      }
      continue;
    }
    if (inBrackets) {
      if (ch === ']') inBrackets = false;
      continue;
    }

    if (ch === "'" || ch === '"') { inQuote = true; quoteChar = ch; continue; }
    if (ch === '[') { inBrackets = true; continue; }
    if (ch === '-' && afterSelect[i + 1] === '-') {
      const nl = afterSelect.indexOf('\n', i);
      i = nl === -1 ? afterSelect.length : nl;
      continue;
    }
    if (ch === '/' && afterSelect[i + 1] === '*') {
      const close = afterSelect.indexOf('*/', i + 2);
      i = close === -1 ? afterSelect.length : close + 1;
      continue;
    }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }

    if (depth === 0) {
      // Check for FROM keyword at word boundary
      if (/\bFROM\b/i.test(afterSelect.substring(i, i + 4)) &&
          (i === 0 || /\s/.test(afterSelect[i - 1]))) {
        fromIndex = i;
        break;
      }
    }
  }

  const selectList = fromIndex >= 0
    ? afterSelect.substring(0, fromIndex)
    : afterSelect;

  // Extract table aliases from the CTE body for column resolution
  const tableAliases = dbSchema ? extractTableAliasMap(cteBody, dbSchema) : new Map<string, { schema: string; table: string }>();

  // Split the select list by commas at depth 0
  const columns: CteColumnInfo[] = [];
  let current = '';
  depth = 0;
  inQuote = false;
  quoteChar = '';
  inBrackets = false;

  for (let i = 0; i < selectList.length; i++) {
    const ch = selectList[i];

    if (inQuote) {
      current += ch;
      if (ch === quoteChar) {
        if (selectList[i + 1] === quoteChar) { current += selectList[++i]; } else { inQuote = false; }
      }
      continue;
    }
    if (inBrackets) {
      current += ch;
      if (ch === ']') inBrackets = false;
      continue;
    }

    if (ch === "'" || ch === '"') { inQuote = true; quoteChar = ch; current += ch; continue; }
    if (ch === '[') { inBrackets = true; current += ch; continue; }
    if (ch === '(') { depth++; current += ch; continue; }
    if (ch === ')') { depth--; current += ch; continue; }

    if (ch === ',' && depth === 0) {
      const col = inferColumnInfo(current.trim(), dbSchema, tableAliases);
      if (col) columns.push(col);
      current = '';
    } else {
      current += ch;
    }
  }

  // Last column
  const lastCol = inferColumnInfo(current.trim(), dbSchema, tableAliases);
  if (lastCol) columns.push(lastCol);

  return columns;
}

/**
 * Extract a map of alias → {schema, table} from FROM/JOIN clauses.
 */
function extractTableAliasMap(
  cteBody: string,
  dbSchema: DatabaseSchema
): Map<string, { schema: string; table: string }> {
  const map = new Map<string, { schema: string; table: string }>();

  // Match FROM/JOIN table references with aliases
  const patterns = [
    // [schema].[table] alias
    /\b(?:from|join)\s+\[([^\]]+)\]\s*\.\s*\[([^\]]+)\](?:\s+(?:as\s+)?([a-zA-Z_]\w*))?/gi,
    // [schema].table alias (bracketed schema, unbracketed table)
    /\b(?:from|join)\s+\[([^\]]+)\]\s*\.\s*([a-zA-Z_]\w*)\b(?:\s+(?:as\s+)?([a-zA-Z_]\w*))?/gi,
    // schema.[table] alias (unbracketed schema, bracketed table)
    /\b(?:from|join)\s+([a-zA-Z_]\w*)\s*\.\s*\[([^\]]+)\](?:\s+(?:as\s+)?([a-zA-Z_]\w*))?/gi,
    // schema.table alias
    /\b(?:from|join)\s+([a-zA-Z_]\w*)\s*\.\s*([a-zA-Z_]\w*)(?:\s+(?:as\s+)?([a-zA-Z_]\w*))?/gi,
    // [table] alias
    /\b(?:from|join)\s+\[([^\]]+)\](?!\s*\.)(?:\s+(?:as\s+)?([a-zA-Z_]\w*))?/gi,
    // table alias — \b prevents backtracking into schema prefix (e.g. 'db' from 'dbo.[Table]')
    /\b(?:from|join)\s+([a-zA-Z_]\w*)\b(?!\s*\.)(?:\s+(?:as\s+)?([a-zA-Z_]\w*))?/gi,
  ];

  for (let pi = 0; pi < patterns.length; pi++) {
    const regex = new RegExp(patterns[pi].source, patterns[pi].flags);
    let m;
    while ((m = regex.exec(cteBody)) !== null) {
      let schemaName: string | undefined;
      let tableName: string;
      let alias: string | undefined;

      if (pi <= 3) {
        // Has schema (patterns 0-3: [s].[t], [s].t, s.[t], s.t)
        schemaName = m[1];
        tableName = m[2];
        alias = m[3];
      } else {
        // No schema (patterns 4-5: [t], t)
        tableName = m[1];
        alias = m[2];
      }

      // Skip SQL keywords as aliases
      if (alias && /^(on|where|inner|left|right|full|cross|outer|and|or|set|into|values|order|group|having)$/i.test(alias)) {
        alias = undefined;
      }

      // Resolve actual schema from dbSchema
      const resolved = resolveTableSchema(tableName, schemaName, dbSchema);
      if (resolved) {
        if (alias) {
          map.set(alias.toLowerCase(), resolved);
        }
        map.set(tableName.toLowerCase(), resolved);
      }
    }
  }

  return map;
}

/**
 * Resolve a table name to its schema info from the database schema.
 */
function resolveTableSchema(
  tableName: string,
  schemaName: string | undefined,
  dbSchema: DatabaseSchema
): { schema: string; table: string } | null {
  const tLower = tableName.toLowerCase();
  const sLower = schemaName?.toLowerCase();

  for (const t of dbSchema.tables || []) {
    if (t.name.toLowerCase() === tLower && (!sLower || t.schema.toLowerCase() === sLower)) {
      return { schema: t.schema, table: t.name };
    }
  }
  for (const v of dbSchema.views || []) {
    if (v.name.toLowerCase() === tLower && (!sLower || v.schema.toLowerCase() === sLower)) {
      return { schema: v.schema, table: v.name };
    }
  }
  return null;
}

/** Map of SQL functions/expressions to their return types */
const SQL_FUNCTION_TYPES: Record<string, { type: string; nullable: boolean }> = {
  'count': { type: 'int', nullable: false },
  'sum': { type: 'numeric', nullable: true },
  'avg': { type: 'numeric', nullable: true },
  'min': { type: 'varies', nullable: true },
  'max': { type: 'varies', nullable: true },
  'len': { type: 'int', nullable: true },
  'datalength': { type: 'int', nullable: true },
  'year': { type: 'int', nullable: true },
  'month': { type: 'int', nullable: true },
  'day': { type: 'int', nullable: true },
  'datepart': { type: 'int', nullable: true },
  'datediff': { type: 'int', nullable: true },
  'getdate': { type: 'datetime', nullable: false },
  'getutcdate': { type: 'datetime', nullable: false },
  'sysdatetime': { type: 'datetime2', nullable: false },
  'newid': { type: 'uniqueidentifier', nullable: false },
  'isnull': { type: 'varies', nullable: false },
  'coalesce': { type: 'varies', nullable: true },
  'cast': { type: 'varies', nullable: true },
  'convert': { type: 'varies', nullable: true },
  'json_value': { type: 'nvarchar', nullable: true },
  'json_query': { type: 'nvarchar', nullable: true },
  'concat': { type: 'nvarchar', nullable: false },
  'upper': { type: 'nvarchar', nullable: true },
  'lower': { type: 'nvarchar', nullable: true },
  'ltrim': { type: 'nvarchar', nullable: true },
  'rtrim': { type: 'nvarchar', nullable: true },
  'trim': { type: 'nvarchar', nullable: true },
  'replace': { type: 'nvarchar', nullable: true },
  'substring': { type: 'nvarchar', nullable: true },
  'left': { type: 'nvarchar', nullable: true },
  'right': { type: 'nvarchar', nullable: true },
  'charindex': { type: 'int', nullable: false },
  'patindex': { type: 'int', nullable: false },
  'abs': { type: 'numeric', nullable: true },
  'ceiling': { type: 'numeric', nullable: true },
  'floor': { type: 'numeric', nullable: true },
  'round': { type: 'numeric', nullable: true },
  'row_number': { type: 'bigint', nullable: false },
  'rank': { type: 'bigint', nullable: false },
  'dense_rank': { type: 'bigint', nullable: false },
  'ntile': { type: 'bigint', nullable: false },
  'stuff': { type: 'nvarchar', nullable: true },
};

/**
 * Look up a column's type from a table in the schema.
 */
function lookupColumnType(
  columnName: string,
  tableRef: string | undefined,
  dbSchema: DatabaseSchema,
  tableAliases: Map<string, { schema: string; table: string }>
): { type: string; nullable: boolean } | null {
  const colLower = columnName.toLowerCase();

  // If we have a table/alias prefix, look it up directly
  if (tableRef) {
    const resolved = tableAliases.get(tableRef.toLowerCase());
    if (resolved) {
      const col = findColumnInTable(resolved.schema, resolved.table, colLower, dbSchema);
      if (col) return col;
    }
  }

  // Search all tables in schema for a matching column
  for (const t of dbSchema.tables || []) {
    for (const c of t.columns) {
      if (c.name.toLowerCase() === colLower) {
        return { type: formatColType(c), nullable: c.nullable };
      }
    }
  }
  for (const v of dbSchema.views || []) {
    for (const c of v.columns || []) {
      if (c.name.toLowerCase() === colLower) {
        return { type: formatColType(c), nullable: c.nullable };
      }
    }
  }

  return null;
}

function findColumnInTable(
  schemaName: string,
  tableName: string,
  columnName: string,
  dbSchema: DatabaseSchema
): { type: string; nullable: boolean } | null {
  const sLower = schemaName.toLowerCase();
  const tLower = tableName.toLowerCase();

  for (const t of dbSchema.tables || []) {
    if (t.schema.toLowerCase() === sLower && t.name.toLowerCase() === tLower) {
      const col = t.columns.find(c => c.name.toLowerCase() === columnName);
      if (col) return { type: formatColType(col), nullable: col.nullable };
    }
  }
  for (const v of dbSchema.views || []) {
    if (v.schema.toLowerCase() === sLower && v.name.toLowerCase() === tLower) {
      const col = (v.columns || []).find(c => c.name.toLowerCase() === columnName);
      if (col) return { type: formatColType(col), nullable: col.nullable };
    }
  }
  return null;
}

function formatColType(col: { type: string; maxLength?: number; precision?: number; scale?: number }): string {
  let t = col.type;
  if (col.maxLength) t += `(${col.maxLength})`;
  else if (col.precision && col.scale) t += `(${col.precision},${col.scale})`;
  else if (col.precision) t += `(${col.precision})`;
  return t;
}

/**
 * Try to infer CAST/CONVERT target type from expression.
 */
function inferCastType(expr: string): string | null {
  // CAST(x AS type)
  const castMatch = expr.match(/\bCAST\s*\([\s\S]+\bAS\s+([a-zA-Z_]\w*(?:\s*\([^)]*\))?)\s*\)/i);
  if (castMatch) return castMatch[1].trim();

  // CONVERT(type, x)
  const convertMatch = expr.match(/\bCONVERT\s*\(\s*([a-zA-Z_]\w*(?:\s*\([^)]*\))?)\s*,/i);
  if (convertMatch) return convertMatch[1].trim();

  return null;
}

/**
 * Infer column name, type, and nullability from a single SELECT expression.
 */
function inferColumnInfo(
  expr: string,
  dbSchema?: DatabaseSchema,
  tableAliases?: Map<string, { schema: string; table: string }>
): CteColumnInfo | null {
  if (!expr) return null;

  // Strip trailing comments
  expr = expr.replace(/--.*$/, '').trim();
  if (!expr) return null;

  const name = inferColumnName(expr);
  if (!name) return null;

  // Default
  let type = '';
  let nullable = true;

  // Try to infer type from the expression
  if (dbSchema) {
    const aliases = tableAliases || new Map();

    // Check for AS alias — analyze the expression part before AS
    const asMatch = expr.match(/^([\s\S]+)\bAS\s+(?:\[([^\]]+)\]|'[^']+'|"[^"]+"|[a-zA-Z_]\w*)\s*$/i);
    const exprPart = asMatch ? asMatch[1].trim() : expr;

    // 1. Simple column reference: column or table.column
    const dottedRef = exprPart.match(/^(?:(\[?[a-zA-Z_]\w*\]?)\s*\.\s*)?(\[?[a-zA-Z_]\w*\]?)$/);
    if (dottedRef) {
      const tableRef = dottedRef[1]?.replace(/^\[|\]$/g, '');
      const colRef = dottedRef[2]?.replace(/^\[|\]$/g, '');
      if (colRef) {
        const resolved = lookupColumnType(colRef, tableRef, dbSchema, aliases);
        if (resolved) {
          type = resolved.type;
          nullable = resolved.nullable;
        }
      }
    }

    // 2. Function call
    if (!type) {
      const funcMatch = exprPart.match(/^([a-zA-Z_]\w*)\s*\(/i);
      if (funcMatch) {
        const funcName = funcMatch[1].toLowerCase();
        const funcInfo = SQL_FUNCTION_TYPES[funcName];
        if (funcInfo) {
          type = funcInfo.type;
          nullable = funcInfo.nullable;

          // For CAST/CONVERT, extract target type
          if ((funcName === 'cast' || funcName === 'convert') && funcInfo.type === 'varies') {
            const castType = inferCastType(exprPart);
            if (castType) type = castType;
          }
        }
      }
    }

    // 3. String literal
    if (!type && /^'[^']*'$/.test(exprPart)) {
      type = 'nvarchar';
      nullable = false;
    }

    // 4. Numeric literal
    if (!type && /^-?\d+$/.test(exprPart)) {
      type = 'int';
      nullable = false;
    }
    if (!type && /^-?\d+\.\d+$/.test(exprPart)) {
      type = 'decimal';
      nullable = false;
    }
  }

  // Star
  if (name === '*') {
    return { name: '*', type: '', nullable: true };
  }

  return { name, type, nullable };
}

/**
 * Infer the output column name from a single SELECT expression.
 *   - `expr AS alias`         → alias
 *   - `expr AS [alias]`       → alias
 *   - `table.column`          → column
 *   - `[table].[column]`      → column
 *   - `column`                → column
 *   - `*`                     → *
 *   - function(...)           → (expression)
 */
function inferColumnName(expr: string): string | null {
  if (!expr) return null;

  // Strip trailing comments
  expr = expr.replace(/--.*$/, '').trim();
  if (!expr) return null;

  // Check for AS alias (last occurrence, outside parens/quotes)
  const asMatch = expr.match(/\bAS\s+(?:\[([^\]]+)\]|'([^']+)'|"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))\s*$/i);
  if (asMatch) {
    return asMatch[1] || asMatch[2] || asMatch[3] || asMatch[4];
  }

  // `*` or `table.*`
  if (expr === '*' || expr.endsWith('.*')) return '*';

  // Simple identifier: column or [column]
  const simpleMatch = expr.match(/^(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*))$/);
  if (simpleMatch) {
    return simpleMatch[1] || simpleMatch[2];
  }

  // Dotted: schema.table.column or table.column
  const dottedMatch = expr.match(/\.(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*))\s*$/);
  if (dottedMatch) {
    return dottedMatch[1] || dottedMatch[2];
  }

  // Function call or complex expression without alias — use the expression itself
  return `(${expr.length > 30 ? expr.substring(0, 27) + '...' : expr})`;
}

/**
 * Find table references in FROM/JOIN clauses
 */
export function findTableReferences(statementText: string): TableReference[] {
  const references: TableReference[] = [];
  
  const patterns = [
    // [schema].[table]
    { regex: /\b(?:from|join)\s+(?:\[([^\]]+)\]\s*\.\s*)\[([^\]]+)\]/gi, hasSchema: true },
    // [schema].table (bracketed schema, unbracketed table)
    { regex: /\b(?:from|join)\s+\[([^\]]+)\]\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)\b/gi, hasSchema: true },
    // schema.[table] (unbracketed schema, bracketed table)
    { regex: /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*\[([^\]]+)\]/gi, hasSchema: true },
    // schema.table
    { regex: /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)/gi, hasSchema: true },
    // [table] (no dot after)
    { regex: /\b(?:from|join)\s+\[([^\]]+)\](?!\s*\.)/gi, hasSchema: false },
    // table (no dot after) — \b prevents backtracking into schema prefix (e.g. 'db' from 'dbo.[Table]')
    { regex: /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)\b(?!\s*\.)/gi, hasSchema: false },
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

export interface ColumnReference {
  prefix: string;       // alias or table name before the dot
  column: string;       // column name after the dot
  startIndex: number;   // position of the column name in the statement
  length: number;       // length of the column name
}

/**
 * Find qualified column references (alias.column, table.column) in a SQL statement.
 * Only finds prefix.column patterns — standalone column names are too ambiguous.
 * Skips string literals and ignores the table part of FROM/JOIN clauses.
 */
export function findColumnReferences(statementText: string): ColumnReference[] {
  const refs: ColumnReference[] = [];
  // Match prefix.column or [prefix].[column] patterns
  // Negative lookbehind avoids matching table references after FROM/JOIN
  const regex = /(?:\[([^\]]+)\]|([a-zA-Z_]\w*))\s*\.\s*(?:\[([^\]]+)\]|([a-zA-Z_]\w*))/g;
  let m;
  while ((m = regex.exec(statementText)) !== null) {
    const prefix = m[1] || m[2];
    const column = m[3] || m[4];
    if (!column) continue;

    // Skip if this is a FROM/JOIN table reference (schema.table)
    const beforeMatch = statementText.substring(0, m.index);
    if (/\b(?:from|join)\s+$/i.test(beforeMatch.trimEnd())) continue;
    // Also skip if preceded by just whitespace after FROM/JOIN keyword
    if (/\b(?:from|join)\s+$/i.test(beforeMatch)) continue;

    // Calculate position of the column part
    const fullMatch = m[0];
    const dotIdx = fullMatch.indexOf('.');
    // Find column start within the full match
    const afterDot = fullMatch.substring(dotIdx + 1);
    const colStart = afterDot.match(/^\s*\[?/);
    const colOffset = dotIdx + 1 + (colStart ? colStart[0].length : 0);
    const colLen = column.length;

    refs.push({
      prefix,
      column,
      startIndex: m.index + colOffset,
      length: colLen,
    });
  }
  return refs;
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

    // ── Column validation ──────────────────────────────────────────────
    const aliasMap = extractTableAliasMap(maskedText, dbSchema);
    const cteDefs = extractCTEsWithColumns(maskedText, dbSchema);
    const cteMap = new Map<string, CteDefinition>();
    for (const cte of cteDefs) {
      cteMap.set(cte.name.toLowerCase(), cte);
    }

    // Build CTE alias map: FROM CteName alias → alias maps to CTE
    const cteAliasMap = new Map<string, CteDefinition>();
    if (cteMap.size > 0) {
      const aliasPatterns = [
        /\b(?:from|join)\s+(?:\[([^\]]+)\]|([a-zA-Z_]\w*))(?:\s+(?:as\s+)?([a-zA-Z_]\w*))?/gi,
      ];
      for (const pat of aliasPatterns) {
        const regex = new RegExp(pat.source, pat.flags);
        let am;
        while ((am = regex.exec(maskedText)) !== null) {
          const tName = am[1] || am[2];
          const alias = am[3];
          const cte = cteMap.get(tName.toLowerCase());
          if (cte) {
            // CTE name itself maps
            cteAliasMap.set(tName.toLowerCase(), cte);
            if (alias && !/^(on|where|inner|left|right|full|cross|outer|and|or|set|into|values|order|group|having)$/i.test(alias)) {
              cteAliasMap.set(alias.toLowerCase(), cte);
            }
          }
        }
      }
    }

    const columnRefs = findColumnReferences(maskedText);
    for (const colRef of columnRefs) {
      const prefixLower = colRef.prefix.toLowerCase();

      // 1. Try to resolve prefix as a CTE name or CTE alias
      let resolvedCte: CteDefinition | undefined;
      resolvedCte = cteMap.get(prefixLower) || cteAliasMap.get(prefixLower);
      if (resolvedCte) {
        // Validate column against CTE columns
        // If CTE has * columns, skip validation
        if (resolvedCte.columns.some(c => c.name === '*')) continue;
        const colExists = resolvedCte.columns.some(
          c => c.name.toLowerCase() === colRef.column.toLowerCase()
        );
        if (!colExists) {
          const absStart = stmt.startOffset + colRef.startIndex;
          const startPos = getPositionAt(sql, absStart);
          const endPos = getPositionAt(sql, absStart + colRef.length);
          markers.push({
            severity: 'warning',
            message: `Invalid column name '${colRef.column}'.`,
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column,
          });
        }
        continue;
      }

      // 2. Try to resolve prefix as a table/view alias or name
      const resolvedTable = aliasMap.get(prefixLower);
      if (resolvedTable) {
        const cols = getColumnsForTable(resolvedTable.schema, resolvedTable.table, dbSchema);
        if (cols.length > 0) {
          const colExists = cols.some(
            c => c.name.toLowerCase() === colRef.column.toLowerCase()
          );
          if (!colExists) {
            const absStart = stmt.startOffset + colRef.startIndex;
            const startPos = getPositionAt(sql, absStart);
            const endPos = getPositionAt(sql, absStart + colRef.length);
            markers.push({
              severity: 'warning',
              message: `Invalid column name '${colRef.column}'.`,
              startLineNumber: startPos.lineNumber,
              startColumn: startPos.column,
              endLineNumber: endPos.lineNumber,
              endColumn: endPos.column,
            });
          }
        }
      }
    }
  }

  // Deduplicate markers by position + message
  const seen = new Set<string>();
  return markers.filter(m => {
    const key = `${m.startLineNumber}:${m.startColumn}:${m.endLineNumber}:${m.endColumn}:${m.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
