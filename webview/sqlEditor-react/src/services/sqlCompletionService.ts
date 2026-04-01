/**
 * SQL Completion Service - context-aware autocompletion
 * Port from editor.js
 */

import type { DatabaseSchema, TableInfo, ColumnInfo } from '../types/schema';

// SQL keywords that should not be considered as aliases
const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'join', 'inner', 'left', 'right', 'full', 'cross',
  'on', 'and', 'or', 'order', 'group', 'by', 'having', 'as', 'in', 'not', 'null',
  'is', 'like', 'between', 'exists', 'case', 'when', 'then', 'else', 'end',
  'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'alter', 'drop',
  'table', 'view', 'index', 'procedure', 'function', 'trigger', 'with', 'union',
  'except', 'intersect', 'distinct', 'top', 'asc', 'desc', 'limit', 'offset', 'fetch',
  'outer', 'apply', 'pivot', 'unpivot', 'go', 'begin', 'commit', 'rollback',
  'declare', 'exec', 'execute', 'return', 'if', 'while', 'break', 'continue',
  'over', 'partition', 'rows', 'range', 'unbounded', 'preceding', 'following',
  'merge', 'using', 'matched', 'output', 'option', 'nolock',
]);

export interface TableInQuery {
  schema: string;
  table: string;
  alias: string;
  hasExplicitAlias: boolean;
}

export interface SqlContext {
  type: SqlContextType;
  confidence: 'high' | 'medium' | 'low';
  suggestOperators?: boolean;
  suggestSortDirection?: boolean;
  tableName?: string;
  alias?: string;
}

export type SqlContextType =
  | 'SELECT'
  | 'FROM'
  | 'AFTER_FROM'
  | 'WHERE'
  | 'JOIN_TABLE'
  | 'ON_CONDITION'
  | 'ORDER_BY'
  | 'GROUP_BY'
  | 'HAVING'
  | 'INSERT_COLUMNS'
  | 'INSERT_VALUES'
  | 'UPDATE_SET'
  | 'COLUMN'
  | 'DEFAULT';

function getCurrentStatementFragment(text: string): string {
  let lastBoundary = -1;
  let inQuote = false;
  let quoteChar = '';
  let inBrackets = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuote) {
      if (char === quoteChar) {
        if (text[i + 1] === quoteChar) {
          i++;
        } else {
          inQuote = false;
        }
      }
      continue;
    }

    if (inBrackets) {
      if (char === ']') {
        inBrackets = false;
      }
      continue;
    }

    if (char === '\'' || char === '"') {
      inQuote = true;
      quoteChar = char;
      continue;
    }

    if (char === '[') {
      inBrackets = true;
      continue;
    }

    if (char === '-' && text[i + 1] === '-') {
      const newlineIndex = text.indexOf('\n', i);
      if (newlineIndex === -1) {
        break;
      }
      i = newlineIndex;
      continue;
    }

    if (char === '/' && text[i + 1] === '*') {
      const closeIndex = text.indexOf('*/', i + 2);
      if (closeIndex === -1) {
        break;
      }
      i = closeIndex + 1;
      continue;
    }

    if (char === ';') {
      lastBoundary = i;
    }
  }

  return text.substring(lastBoundary + 1);
}

/**
 * Find a table in the schema by name
 */
export function findTable(tableName: string, dbSchema: DatabaseSchema): { schema: string; table: string } | null {
  // Strip brackets and extract schema/table parts
  let cleanName = tableName.replace(/^\[|\]$/g, '');
  let schemaFilter: string | undefined;

  // Handle schema-qualified names: [schema].[table] or schema.table
  const schemaMatch = cleanName.match(/^\[?([^\]]+)\]?\.\[?([^\]]+)\]?$/);
  if (schemaMatch) {
    schemaFilter = schemaMatch[1].toLowerCase();
    cleanName = schemaMatch[2];
  }

  const lowerName = cleanName.toLowerCase();

  // Check tables first
  if (dbSchema?.tables) {
    for (const table of dbSchema.tables) {
      if (table.name.toLowerCase() === lowerName &&
          (!schemaFilter || table.schema.toLowerCase() === schemaFilter)) {
        return { schema: table.schema, table: table.name };
      }
    }
  }

  // Then check views
  if (dbSchema?.views) {
    for (const view of dbSchema.views) {
      if (view.name.toLowerCase() === lowerName &&
          (!schemaFilter || view.schema.toLowerCase() === schemaFilter)) {
        return { schema: view.schema, table: view.name };
      }
    }
  }

  return null;
}

/**
 * Find the table for a given alias in the query
 */
export function findTableForAlias(
  query: string,
  alias: string,
  dbSchema: DatabaseSchema
): { schema: string; table: string } | null {
  const lowerAlias = alias.toLowerCase();

  const patterns = [
    // Pattern with brackets: FROM [schema].[table] [alias] or FROM [table] [alias]
    new RegExp(`from\\s+(?:\\[(\\w+)\\]\\.)?\\[(\\w+)\\]\\s+(?:as\\s+)?(?:\\[${lowerAlias}\\]|${lowerAlias})(?:\\s|,|$)`, 'i'),
    new RegExp(`join\\s+(?:\\[(\\w+)\\]\\.)?\\[(\\w+)\\]\\s+(?:as\\s+)?(?:\\[${lowerAlias}\\]|${lowerAlias})(?:\\s|,|$)`, 'i'),
    // Pattern without brackets: FROM schema.table alias or FROM table alias
    new RegExp(`from\\s+(?:(\\w+)\\.)?(\\w+)\\s+(?:as\\s+)?(?:\\[${lowerAlias}\\]|${lowerAlias})(?:\\s|,|$)`, 'i'),
    new RegExp(`join\\s+(?:(\\w+)\\.)?(\\w+)\\s+(?:as\\s+)?(?:\\[${lowerAlias}\\]|${lowerAlias})(?:\\s|,|$)`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) {
      const matchedSchema = match[1];
      const matchedTable = match[2];
      // Resolve via findTable to get the correct schema (handles CTEs with schema 'cte')
      const resolved = findTable(matchedSchema ? `${matchedSchema}.${matchedTable}` : matchedTable, dbSchema);
      if (resolved) {
        return resolved;
      }
      return {
        schema: matchedSchema || 'dbo',
        table: matchedTable,
      };
    }
  }

  // Check if alias is actually the table name itself
  return findTable(lowerAlias, dbSchema);
}

/**
 * Get columns for a specific table
 */
export function getColumnsForTable(
  schema: string,
  tableName: string,
  dbSchema: DatabaseSchema
): ColumnInfo[] {
  const lowerName = tableName.toLowerCase();

  if (dbSchema?.tables) {
    for (const table of dbSchema.tables) {
      if (table.name.toLowerCase() === lowerName && table.schema === schema) {
        return table.columns;
      }
    }
  }

  if (dbSchema?.views) {
    for (const view of dbSchema.views) {
      if (view.name.toLowerCase() === lowerName && view.schema === schema) {
        return view.columns || [];
      }
    }
  }

  return [];
}

/**
 * Extract tables from a SQL query
 */
export function extractTablesFromQuery(query: string, dbSchema: DatabaseSchema): TableInQuery[] {
  const tables: TableInQuery[] = [];

  const patterns = [
    // Pattern for bracketed identifiers: FROM [schema].[table] [alias] or FROM [table] [alias]
    /\b(?:from|(?:inner\s+|left\s+|right\s+|full\s+(?:outer\s+)?|cross\s+)?join)\s+(?:\[([^\]]+)\]\.)?\[([^\]]+)\](?:\s+(?:as\s+)?(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*)))?(?=\s+(?:on|where|order|group|having|inner|left|right|full|cross|join|with\s*\()\b|\s*$|\s*\r?\n|\s*[,;)])/gi,
    // Pattern for schema.table with alias (must have dot)
    /\b(?:from|(?:inner\s+|left\s+|right\s+|full\s+(?:outer\s+)?|cross\s+)?join)\s+([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:as\s+)?(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*)))?(?=\s+(?:on|where|order|group|having|inner|left|right|full|cross|join|with\s*\()\b|\s*$|\s*\r?\n|\s*[,;)])/gi,
    // Pattern for just table name with alias (no schema)
    /\b(?:from|(?:inner\s+|left\s+|right\s+|full\s+(?:outer\s+)?|cross\s+)?join)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:as\s+)?(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*)))?(?=\s+(?:on|where|order|group|having|inner|left|right|full|cross|join|with\s*\()\b|\s*$|\s*\r?\n|\s*[,;)])/gi,
  ];

  patterns.forEach((pattern, patternIndex) => {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    
    while ((match = regex.exec(query)) !== null) {
      let table: string, alias: string | undefined;

      if (patternIndex === 0) {
        // Bracketed: [schema].[table] [alias] or [table] [alias]
        // schema = match[1] || 'dbo'; // not used, tableInfo has correct schema
        table = match[2];
        alias = match[3] || match[4];
      } else if (patternIndex === 1) {
        // schema.table [alias] or alias (with dot)
        // schema = match[1]; // not used
        table = match[2];
        alias = match[3] || match[4];
      } else {
        // table only (no schema) [alias] or alias
        // schema = 'dbo'; // not used
        table = match[1];
        alias = match[2] || match[3];
      }

      addTableIfValid(table, alias, tables, dbSchema);
    }
  });

  // Extract comma-separated tables: FROM table1 alias1, table2 alias2
  extractCommaSeparatedTables(query, tables, dbSchema);

  // Extract UPDATE target table: UPDATE [schema].[table] SET ...
  extractUpdateTargetTable(query, tables, dbSchema);

  return tables;
}

/**
 * Add a table to the list after validation
 */
function addTableIfValid(
  table: string,
  alias: string | undefined,
  tables: TableInQuery[],
  dbSchema: DatabaseSchema
): void {
  // Skip if the captured alias is actually a SQL keyword
  if (alias && SQL_KEYWORDS.has(alias.toLowerCase())) {
    alias = undefined;
  }

  // Verify this is a valid table in our schema
  const tableInfo = findTable(table.toLowerCase(), dbSchema);

  if (tableInfo) {
    const hasExplicitAlias = !!alias;

    // If no explicit alias, use the table name as the alias
    if (!alias) {
      alias = tableInfo.table;
    }

    // Check if table is already added to avoid duplicates
    const existingTable = tables.find(
      (t) => t.schema === tableInfo.schema && t.table === tableInfo.table
    );

    if (!existingTable) {
      tables.push({
        schema: tableInfo.schema,
        table: tableInfo.table,
        alias: alias,
        hasExplicitAlias: hasExplicitAlias,
      });
    }
  }
}

/**
 * Extract comma-separated tables from FROM clause (old-style joins):
 * FROM table1 alias1, table2 alias2, table3 alias3
 */
function extractCommaSeparatedTables(
  query: string,
  tables: TableInQuery[],
  dbSchema: DatabaseSchema
): void {
  // Find FROM ... and look for ,table patterns
  const commaTableRegex = /,\s*(?:\[([^\]]+)\]\.)?(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*)(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?)(?:\s+(?:as\s+)?(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*)))?/gi;
  
  // Only match commas that appear in FROM context (between FROM and WHERE/JOIN/ORDER/GROUP etc.)
  const fromBlockRegex = /\bFROM\s+(?:\[?[^\s,]+\]?(?:\.\[?[^\s,]+\]?)?)(?:\s+(?:AS\s+)?(?:\[?\w+\]?))?\s*,([^;]*?)(?=\s+(?:WHERE|ORDER|GROUP|HAVING|UNION|INTERSECT|EXCEPT)\b|\s*$|\s*;)/gi;
  let fromMatch;
  
  while ((fromMatch = fromBlockRegex.exec(query)) !== null) {
    const commaBlock = fromMatch[1];
    let commaMatch;
    const localRegex = new RegExp(commaTableRegex.source, commaTableRegex.flags);
    
    // Prepend a comma to match the first item in the comma block
    const textToSearch = ',' + commaBlock;
    
    while ((commaMatch = localRegex.exec(textToSearch)) !== null) {
      // Resolve table name: bracketed schema.table, schema.table, or plain table
      let table: string;
      let alias: string | undefined;
      
      if (commaMatch[2]) {
        // Bracketed: [schema].[table] or [table]
        table = commaMatch[2];
      } else if (commaMatch[4]) {
        // schema.table (dot notation)
        table = commaMatch[4];
      } else if (commaMatch[3]) {
        // Plain table name
        table = commaMatch[3];
      } else {
        continue;
      }
      
      alias = commaMatch[5] || commaMatch[6];
      addTableIfValid(table, alias, tables, dbSchema);
    }
  }
}

/**
 * Extract the target table from UPDATE statements:
 * UPDATE [schema].[table] SET ... or UPDATE table SET ...
 */
function extractUpdateTargetTable(
  query: string,
  tables: TableInQuery[],
  dbSchema: DatabaseSchema
): void {
  const updateRegex = /\bUPDATE\s+(?:\[([^\]]+)\]\.)?(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*)(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?)(?:\s+(?:AS\s+)?(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*)))?\s+SET\b/gi;
  let match;
  
  while ((match = updateRegex.exec(query)) !== null) {
    let table: string;
    let alias: string | undefined;
    
    if (match[2]) {
      table = match[2];
    } else if (match[4]) {
      table = match[4];
    } else if (match[3]) {
      table = match[3];
    } else {
      continue;
    }
    
    alias = match[5] || match[6];
    addTableIfValid(table, alias, tables, dbSchema);
  }
}

/**
 * Get related tables via foreign keys
 */
export function getRelatedTables(
  tablesInQuery: TableInQuery[],
  dbSchema: DatabaseSchema
): (TableInfo & { foreignKeyInfo?: ForeignKeyInfo })[] {
  const relatedTables: (TableInfo & { foreignKeyInfo?: ForeignKeyInfo })[] = [];
  const existingTableNames = tablesInQuery.map((t) => t.table.toLowerCase());

  if (dbSchema?.foreignKeys) {
    tablesInQuery.forEach((tableInfo) => {
      const tableName = tableInfo.table.toLowerCase();

      dbSchema.foreignKeys!.forEach((fk) => {
        // Find foreign keys FROM this table
        if (
          fk.fromTable.toLowerCase() === tableName &&
          !existingTableNames.includes(fk.toTable.toLowerCase())
        ) {
          const table = dbSchema.tables?.find(
            (t) => t.name.toLowerCase() === fk.toTable.toLowerCase() && t.schema === fk.toSchema
          );

          if (
            table &&
            !relatedTables.find(
              (rt) => rt.name.toLowerCase() === table.name.toLowerCase() && rt.schema === table.schema
            )
          ) {
            relatedTables.push({
              ...table,
              foreignKeyInfo: {
                direction: 'to',
                fromTable: fk.fromTable,
                fromAlias: tableInfo.alias,
                fromHasExplicitAlias: tableInfo.hasExplicitAlias,
                fromColumn: fk.fromColumn,
                toTable: fk.toTable,
                toColumn: fk.toColumn,
              },
            });
          }
        }

        // Find foreign keys TO this table
        if (
          fk.toTable.toLowerCase() === tableName &&
          !existingTableNames.includes(fk.fromTable.toLowerCase())
        ) {
          const table = dbSchema.tables?.find(
            (t) => t.name.toLowerCase() === fk.fromTable.toLowerCase() && t.schema === fk.fromSchema
          );

          if (
            table &&
            !relatedTables.find(
              (rt) => rt.name.toLowerCase() === table.name.toLowerCase() && rt.schema === table.schema
            )
          ) {
            relatedTables.push({
              ...table,
              foreignKeyInfo: {
                direction: 'from',
                fromTable: fk.fromTable,
                fromAlias: tableInfo.alias,
                fromHasExplicitAlias: tableInfo.hasExplicitAlias,
                fromColumn: fk.fromColumn,
                toTable: fk.toTable,
                toColumn: fk.toColumn,
              },
            });
          }
        }
      });
    });
  }

  // If no related tables found, return all tables except those already in query
  if (relatedTables.length === 0 && dbSchema?.tables) {
    return dbSchema.tables.filter((table) => !existingTableNames.includes(table.name.toLowerCase()));
  }

  return relatedTables;
}

export interface ForeignKeyInfo {
  direction: 'to' | 'from';
  fromTable: string;
  fromAlias: string;
  fromHasExplicitAlias: boolean;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

/**
 * Generate a smart alias for a table name
 */
export function generateSmartAlias(tableName: string): string {
  // Remove common prefixes
  let name = tableName.replace(/^(tbl_?|t_|vw_?|fn_?)/i, '');
  
  // If name has underscores, split by underscore first, then further split PascalCase parts
  if (name.includes('_')) {
    const parts = name.split('_');
    const initials: string[] = [];
    for (const part of parts) {
      const subWords = part.split(/(?=[A-Z])/).filter(Boolean);
      if (subWords.length > 1) {
        initials.push(...subWords.map(w => w[0]?.toLowerCase() || ''));
      } else {
        initials.push(part[0]?.toLowerCase() || '');
      }
    }
    return initials.join('');
  }
  
  // If name is PascalCase, use first letter of each word
  const words = name.split(/(?=[A-Z])/);
  if (words.length > 1) {
    return words.map((w) => w[0]?.toLowerCase() || '').join('');
  }
  
  // Otherwise, just use first letter
  return name[0]?.toLowerCase() || 't';
}

/**
 * Analyze SQL context for intelligent suggestions
 */
export function analyzeSqlContext(textUntilPosition: string, lineUntilPosition: string): SqlContext {
  const currentStatementText = getCurrentStatementFragment(textUntilPosition);
  const currentStatementLine = getCurrentStatementFragment(lineUntilPosition);

  if (!currentStatementText.trim()) {
    return { type: 'DEFAULT', confidence: 'low' };
  }

  const lowerText = currentStatementText.toLowerCase();
  const lowerLine = currentStatementLine.toLowerCase();

  // Check for alias dot notation (e.g., "u.", "[u].") — highest priority
  const aliasDotMatch = lowerLine.match(/(?:\[?(\w+)\]?)\.\s*$/);
  if (aliasDotMatch) {
    return { type: 'COLUMN', confidence: 'high', alias: aliasDotMatch[1] };
  }

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

  // Check for ON clause context
  if (/\bjoin\s+(?:\[?\w+\]?\.)?(?:\[?\w+\]?)(?:\s+(?:as\s+)?(?:\[?\w+\]?))?\s+on\s*/i.test(lowerLine) || /\bon\s*$/i.test(lowerLine)) {
    return { type: 'ON_CONDITION', confidence: 'high' };
  }

  // Check for DELETE FROM context
  const lastDeletePos = lowerText.lastIndexOf('delete');
  if (lastDeletePos !== -1 && lastFromPos !== -1 && lastFromPos > lastDeletePos && lastSelectPos < lastDeletePos) {
    // DELETE FROM <table> — if no WHERE yet, treat like FROM
    if (lastWherePos === -1 || lastWherePos < lastFromPos) {
      const textAfterFrom = lowerText.substring(lastFromPos);
      if (textAfterFrom.match(/from\s+(?:\[?\w+\]?\.)?(?:\[?\w+\]?)(?:\s+(?:as\s+)?(?:\[?\w+\]?))?/)) {
        // Already have a table — let WHERE detection handle it below
      } else {
        return { type: 'FROM', confidence: 'high' };
      }
    }
  }

  // Check for ORDER BY context
  if (lastOrderByPos !== -1 && (lastOrderByPos > lastWherePos || lastWherePos === -1)) {
    const textAfterOrderBy = lowerText.substring(lastOrderByPos + 8);
    if (!/\b(limit|for|union|intersect|except)\b/.test(textAfterOrderBy)) {
      const shouldSuggestSortDirection = analyzeOrderByContext(textAfterOrderBy);
      return { type: 'ORDER_BY', confidence: 'high', suggestSortDirection: shouldSuggestSortDirection };
    }
  }

  // Check for GROUP BY context
  if (lastGroupByPos !== -1 && lastGroupByPos > Math.max(lastWherePos, lastOrderByPos, lastHavingPos)) {
    return { type: 'GROUP_BY', confidence: 'high' };
  }

  // Check for HAVING context
  if (lastHavingPos !== -1 && lastHavingPos > Math.max(lastWherePos, lastGroupByPos)) {
    const textAfterHaving = lowerText.substring(lastHavingPos + 6);
    if (!/\b(order|limit|union|intersect|except)\b/.test(textAfterHaving)) {
      const shouldSuggestOperators = analyzeHavingContext(textAfterHaving);
      return {
        type: 'HAVING',
        confidence: 'high',
        suggestOperators: shouldSuggestOperators,
      };
    }
  }

  // Check for INSERT context
  if (lastInsertPos !== -1 && lastInsertPos > Math.max(lastSelectPos, lastUpdatePos)) {
    const insertMatch = /insert\s+into\s+(?:\[?\w+\]?\.)?(?:\[?(\w+)\]?)\s*\(\s*([^)]*)?$/i.exec(lowerLine);
    if (insertMatch) {
      return { type: 'INSERT_COLUMNS', confidence: 'high', tableName: insertMatch[1] };
    }

    if (lastValuesPos !== -1 && lastValuesPos > lastInsertPos) {
      return { type: 'INSERT_VALUES', confidence: 'high' };
    }
  }

  // Check for UPDATE SET context
  if (lastUpdatePos !== -1 && lastSetPos !== -1 && lastSetPos > lastUpdatePos) {
    const textAfterSet = lowerText.substring(lastSetPos + 3);
    if (!/\bwhere\b/.test(textAfterSet) || lastWherePos === -1 || lastWherePos < lastSetPos) {
      // Extract target table name for column suggestions
      const updateTableMatch = lowerText.substring(lastUpdatePos).match(
        /update\s+(?:\[?\w+\]?\.)?\[?(\w+)\]?/i
      );
      return {
        type: 'UPDATE_SET',
        confidence: 'high',
        tableName: updateTableMatch?.[1],
      };
    }
  }

  // Check for WHERE context
  if (lastWherePos !== -1 && lastWherePos > Math.max(lastFromPos, lastSetPos)) {
    // Check if we're inside a subquery (e.g., WHERE Id IN (SELECT ...))
    // If the last SELECT is after the last WHERE and inside parentheses, it's a subquery
    if (lastSelectPos > lastWherePos) {
      // Count open parens between WHERE and the last SELECT
      const textBetween = lowerText.substring(lastWherePos, lastSelectPos);
      const openParens = (textBetween.match(/\(/g) || []).length;
      const closeParens = (textBetween.match(/\)/g) || []).length;
      if (openParens > closeParens) {
        // We're inside a subquery — analyze based on the subquery text
        const subqueryText = lowerText.substring(lastSelectPos);
        // Find FROM within the subquery scope
        const subFromPos = subqueryText.indexOf('from');
        if (subFromPos === -1) {
          return { type: 'SELECT', confidence: 'medium' };
        }
        const subFromTextAfter = subqueryText.substring(subFromPos);
        if (subFromTextAfter.match(/from\s+(?:\[?\w+\]?\.)?(?:\[?\w+\]?)(?:\s+(?:as\s+)?(?:\[?\w+\]?))?/)) {
          // Subquery has a table — check for WHERE inside subquery
          const subWherePos = subqueryText.indexOf('where');
          if (subWherePos !== -1 && subWherePos > subFromPos) {
            const textAfterSubWhere = subqueryText.substring(subWherePos + 5);
            return {
              type: 'WHERE',
              confidence: 'high',
              suggestOperators: analyzeWhereContext(textAfterSubWhere),
            };
          }
          return { type: 'AFTER_FROM', confidence: 'medium' };
        } else {
          return { type: 'FROM', confidence: 'high' };
        }
      }
    }
    const textAfterWhere = lowerText.substring(lastWherePos + 5);
    const shouldSuggestOperators = analyzeWhereContext(textAfterWhere);
    return {
      type: 'WHERE',
      confidence: 'high',
      suggestOperators: shouldSuggestOperators,
    };
  }

  // Check for SELECT context
  if (lastSelectPos !== -1) {
    if (lastFromPos === -1 || lastSelectPos > lastFromPos) {
      return { type: 'SELECT', confidence: 'medium' };
    } else if (lastFromPos !== -1 && lastSelectPos < lastFromPos) {
      const textAfterFrom = lowerText.substring(lastFromPos);
      if (textAfterFrom.match(/from\s+(?:\[?\w+\]?\.)?(?:\[?\w+\]?)(?:\s+(?:as\s+)?(?:\[?\w+\]?))?/)) {
        return { type: 'AFTER_FROM', confidence: 'medium' };
      } else {
        return { type: 'FROM', confidence: 'high' };
      }
    }
  }

  return { type: 'DEFAULT', confidence: 'low' };
}

/**
 * Analyze WHERE clause to determine if we should suggest operators
 */
function analyzeWhereContext(textAfterWhere: string): boolean {
  const trimmedText = textAfterWhere.trim();

  if (!trimmedText) {
    return false;
  }

  const conditions = trimmedText.split(/\s+(?:and|or)\s+/i);
  const currentCondition = conditions[conditions.length - 1].trim();

  const columnPatterns = [
    /^(?:\w+\.)*\w+\s*$/,
    /^['"]\w*$/,
    /^\d+\.?\d*$/,
  ];

  for (const pattern of columnPatterns) {
    if (pattern.test(currentCondition)) {
      const hasOperator = /\s*(=|<>|!=|<|>|<=|>=|like|in|not\s+in|is\s+null|is\s+not\s+null|between)\s*/i.test(
        currentCondition
      );
      return !hasOperator;
    }
  }

  return false;
}

/**
 * Analyze HAVING clause context
 */
function analyzeHavingContext(textAfterHaving: string): boolean {
  const trimmedText = textAfterHaving.trim();

  if (!trimmedText) {
    return false;
  }

  const conditions = trimmedText.split(/\s+(?:and|or)\s+/i);
  const currentCondition = conditions[conditions.length - 1].trim();

  const aggregatePatterns = [
    /^(?:count|sum|avg|min|max|stddev|variance)\s*\([^)]*\)\s*$/i,
    /^(?:\w+\.)*\w+\s*$/,
  ];

  for (const pattern of aggregatePatterns) {
    if (pattern.test(currentCondition)) {
      const hasOperator = /\s*(=|<>|!=|<|>|<=|>=|like|in|not\s+in|is\s+null|is\s+not\s+null|between)\s*/i.test(
        currentCondition
      );
      return !hasOperator;
    }
  }

  return false;
}

/**
 * Analyze ORDER BY clause to determine if we should suggest ASC/DESC
 * Returns true when cursor is positioned after a column expression (not after a comma or at the start)
 */
function analyzeOrderByContext(textAfterOrderBy: string): boolean {
  const trimmed = textAfterOrderBy.trim();
  if (!trimmed) return false;

  // Split by commas to find the last ordering item
  // Respect parentheses so expressions like COUNT(*) aren't split
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of trimmed) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  items.push(current.trim());

  const lastItem = items[items.length - 1];
  if (!lastItem) return false;

  // If last item already ends with ASC or DESC, no need to suggest direction
  if (/\b(?:asc|desc)\s*$/i.test(lastItem)) return false;

  // Check if the last item looks like a column reference (possibly qualified)
  // e.g., "CostCentre", "p.Name", "[p].[Name]", "COUNT(*)"
  if (/^(?:\[?\w+\]?\.)?(?:\[?\w+\]?)$/.test(lastItem) ||
      /^(?:count|sum|avg|min|max)\s*\([^)]*\)$/i.test(lastItem)) {
    return true;
  }

  return false;
}

/**
 * Get SQL operators for WHERE/HAVING clauses
 */
export function getSqlOperators(): { label: string; detail: string; insertText: string }[] {
  return [
    { label: '=', detail: 'Equal to', insertText: '= ' },
    { label: '<>', detail: 'Not equal to', insertText: '<> ' },
    { label: '>', detail: 'Greater than', insertText: '> ' },
    { label: '<', detail: 'Less than', insertText: '< ' },
    { label: '>=', detail: 'Greater than or equal to', insertText: '>= ' },
    { label: '<=', detail: 'Less than or equal to', insertText: '<= ' },
    { label: 'LIKE', detail: 'Pattern matching', insertText: "LIKE '%${1}%'" },
    { label: 'IN', detail: 'Match any in list', insertText: 'IN (${1})' },
    { label: 'NOT IN', detail: 'Not in list', insertText: 'NOT IN (${1})' },
    { label: 'IS NULL', detail: 'Is null', insertText: 'IS NULL' },
    { label: 'IS NOT NULL', detail: 'Is not null', insertText: 'IS NOT NULL' },
    { label: 'BETWEEN', detail: 'Range', insertText: 'BETWEEN ${1} AND ${2}' },
  ];
}

/**
 * Get aggregate functions for HAVING clause
 */
export function getAggregateFunctions(): { label: string; detail: string; insertText: string }[] {
  return [
    { label: 'COUNT(*)', detail: 'Count all rows', insertText: 'COUNT(*)' },
    { label: 'COUNT(column)', detail: 'Count non-null values', insertText: 'COUNT(${1:column})' },
    { label: 'SUM(column)', detail: 'Sum of values', insertText: 'SUM(${1:column})' },
    { label: 'AVG(column)', detail: 'Average of values', insertText: 'AVG(${1:column})' },
    { label: 'MIN(column)', detail: 'Minimum value', insertText: 'MIN(${1:column})' },
    { label: 'MAX(column)', detail: 'Maximum value', insertText: 'MAX(${1:column})' },
    { label: 'STDEV(column)', detail: 'Standard deviation', insertText: 'STDEV(${1:column})' },
    { label: 'VAR(column)', detail: 'Variance', insertText: 'VAR(${1:column})' },
  ];
}

/**
 * Get SQL clause keywords valid immediately after a FROM clause table reference.
 * Used when the cursor is positioned after a table name but before WHERE/JOIN/etc.
 */
export function getAfterFromKeywords(): { label: string; detail: string; insertText: string }[] {
  return [
    { label: 'WHERE', detail: 'Filter rows', insertText: 'WHERE ' },
    { label: 'INNER JOIN', detail: 'Inner join', insertText: 'INNER JOIN ' },
    { label: 'LEFT JOIN', detail: 'Left outer join', insertText: 'LEFT JOIN ' },
    { label: 'LEFT OUTER JOIN', detail: 'Left outer join (explicit)', insertText: 'LEFT OUTER JOIN ' },
    { label: 'RIGHT JOIN', detail: 'Right outer join', insertText: 'RIGHT JOIN ' },
    { label: 'RIGHT OUTER JOIN', detail: 'Right outer join (explicit)', insertText: 'RIGHT OUTER JOIN ' },
    { label: 'FULL OUTER JOIN', detail: 'Full outer join', insertText: 'FULL OUTER JOIN ' },
    { label: 'CROSS JOIN', detail: 'Cross join (Cartesian product)', insertText: 'CROSS JOIN ' },
    { label: 'CROSS APPLY', detail: 'Cross apply (lateral join)', insertText: 'CROSS APPLY ' },
    { label: 'OUTER APPLY', detail: 'Outer apply (lateral join)', insertText: 'OUTER APPLY ' },
    { label: 'GROUP BY', detail: 'Group results', insertText: 'GROUP BY ' },
    { label: 'ORDER BY', detail: 'Sort results', insertText: 'ORDER BY ' },
    { label: 'HAVING', detail: 'Filter grouped results', insertText: 'HAVING ' },
    { label: 'UNION', detail: 'Combine result sets (distinct)', insertText: 'UNION\n' },
    { label: 'UNION ALL', detail: 'Combine result sets (with duplicates)', insertText: 'UNION ALL\n' },
  ];
}

// --- CTE Support ---

export interface CTEDefinition {
  name: string;
  body: string;
  explicitColumns?: string[];
}

/**
 * Strip SQL line comments (--) and block comments (/* *\/) from a SQL string.
 * String literals are preserved so comment-like text inside quotes is not removed.
 * Duplicated here to avoid a circular dependency with sqlValidator.ts.
 */
function stripSqlComments(sql: string): string {
  let result = '';
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      result += sql[i++];
      while (i < sql.length) {
        const ch = sql[i++];
        result += ch;
        if (ch === "'") {
          if (sql[i] === "'") {
            result += sql[i++];
          } else {
            break;
          }
        }
      }
    } else if (sql[i] === '-' && sql[i + 1] === '-') {
      result += ' ';
      while (i < sql.length && sql[i] !== '\n') {
        i++;
      }
    } else if (sql[i] === '/' && sql[i + 1] === '*') {
      result += ' ';
      i += 2;
      while (i < sql.length) {
        if (sql[i] === '*' && sql[i + 1] === '/') {
          i += 2;
          break;
        }
        i++;
      }
    } else {
      result += sql[i++];
    }
  }
  return result;
}

/**
 * Extract CTE definitions from a SQL query (WITH ... AS (...) blocks)
 */
export function extractCTEsFromQuery(query: string): CTEDefinition[] {
  const ctes: CTEDefinition[] = [];

  // Strip comments to avoid matching WITH inside a comment
  const stripped = stripSqlComments(query);

  const withMatch = stripped.match(/\bWITH\s+/i);
  if (!withMatch || withMatch.index === undefined) return ctes;

  let pos = withMatch.index + withMatch[0].length;
  const text = stripped;

  while (pos < text.length) {
    const cteHeaderMatch = text.substring(pos).match(
      /^(\[?\w+\]?)\s*(?:\(([^)]+)\)\s*)?AS\s*\(/i
    );
    if (!cteHeaderMatch) break;

    const cteName = cteHeaderMatch[1].replace(/^\[|\]$/g, '');
    const explicitColumns = cteHeaderMatch[2]
      ? cteHeaderMatch[2].split(',').map(c => c.trim().replace(/^\[|\]$/g, ''))
      : undefined;

    // Find matching closing paren (handle nested parens)
    const bodyStart = pos + cteHeaderMatch[0].length;
    let depth = 1;
    let bodyEnd = bodyStart;

    while (bodyEnd < text.length && depth > 0) {
      if (text[bodyEnd] === '(') depth++;
      else if (text[bodyEnd] === ')') depth--;
      if (depth > 0) bodyEnd++;
    }

    if (depth !== 0) break;

    const body = text.substring(bodyStart, bodyEnd);
    ctes.push({ name: cteName, body, explicitColumns });

    // Check for comma (more CTEs) or stop
    pos = bodyEnd + 1;
    const afterCTE = text.substring(pos).match(/^\s*,\s*/);
    if (afterCTE) {
      pos += afterCTE[0].length;
    } else {
      break;
    }
  }

  return ctes;
}

/**
 * Split a SELECT column list respecting parentheses
 */
function splitSelectColumns(selectPart: string): string[] {
  const columns: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of selectPart) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      columns.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) {
    columns.push(current.trim());
  }

  return columns;
}

/**
 * Find the position of the first FROM keyword at depth 0 (not inside parentheses)
 */
function findOuterFromPosition(text: string): number {
  let depth = 0;
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    if (lower[i] === '(') depth++;
    else if (lower[i] === ')') depth--;
    else if (depth === 0 && lower.substring(i, i + 4) === 'from' &&
      (i === 0 || /\s/.test(lower[i - 1])) &&
      (i + 4 >= lower.length || /[\s\r\n]/.test(lower[i + 4]))) {
      return i;
    }
  }
  return -1;
}

/**
 * Get columns from a CTE definition
 */
export function getCTEColumns(
  cte: CTEDefinition,
  dbSchema: DatabaseSchema
): ColumnInfo[] {
  if (cte.explicitColumns && cte.explicitColumns.length > 0) {
    return cte.explicitColumns.map(name => ({
      name,
      type: 'unknown',
      nullable: true,
    }));
  }

  // Strip leading SELECT keyword (and DISTINCT / TOP N)
  const selectMatch = cte.body.match(/^\s*SELECT\s+(?:DISTINCT\s+)?(?:TOP\s+\d+\s+)?/i);
  if (!selectMatch) return [];

  const afterSelect = cte.body.substring(selectMatch[0].length);

  // Find the outer FROM (not inside subqueries)
  const fromPos = findOuterFromPosition(afterSelect);
  const selectPart = (fromPos === -1 ? afterSelect : afterSelect.substring(0, fromPos)).trim();

  // Handle SELECT *
  if (selectPart === '*') {
    const innerTables = extractTablesFromQuery(cte.body, dbSchema);
    const columns: ColumnInfo[] = [];
    innerTables.forEach(t => {
      columns.push(...getColumnsForTable(t.schema, t.table, dbSchema));
    });
    return columns;
  }

  // Helper to expand alias.* patterns
  const expandAliasStar = (aliasPart: string): ColumnInfo[] => {
    const aliasName = aliasPart.replace(/^\[|\]$/g, '').replace(/\.\*$/, '');
    // Find which table this alias refers to within the CTE body
    const innerTables = extractTablesFromQuery(cte.body, dbSchema);
    const matchingTable = innerTables.find(t => t.alias.toLowerCase() === aliasName.toLowerCase());
    if (matchingTable) {
      return getColumnsForTable(matchingTable.schema, matchingTable.table, dbSchema);
    }
    return [];
  };

  const columns: ColumnInfo[] = [];
  const columnExprs = splitSelectColumns(selectPart);

  for (const expr of columnExprs) {
    const trimmed = expr.trim();
    if (!trimmed) continue;

    // Handle alias.* pattern (e.g., u.*)
    const aliasStarMatch = trimmed.match(/^\[?\w+\]?\.\*$/);
    if (aliasStarMatch) {
      columns.push(...expandAliasStar(trimmed));
      continue;
    }

    // alias = expr (T-SQL assignment style)
    const assignMatch = trimmed.match(/^\[?(\w+)\]?\s*=/);
    if (assignMatch) {
      columns.push({ name: assignMatch[1], type: 'unknown', nullable: true });
      continue;
    }

    // expr AS alias
    const asMatch = trimmed.match(/\bAS\s+\[?(\w+)\]?\s*$/i);
    if (asMatch) {
      columns.push({ name: asMatch[1], type: 'unknown', nullable: true });
      continue;
    }

    // qualified: alias.column or [alias].[column]
    const qualMatch = trimmed.match(/^\[?\w+\]?\.\[?(\w+)\]?$/);
    if (qualMatch) {
      columns.push({ name: qualMatch[1], type: 'unknown', nullable: true });
      continue;
    }

    // Simple column name
    const simpleMatch = trimmed.match(/^\[?(\w+)\]?$/);
    if (simpleMatch) {
      columns.push({ name: simpleMatch[1], type: 'unknown', nullable: true });
      continue;
    }

    // Complex expression without alias — skip
  }

  // Deduplicate columns by name
  const seen = new Set<string>();
  const deduped: ColumnInfo[] = [];
  for (const col of columns) {
    if (!seen.has(col.name)) {
      seen.add(col.name);
      deduped.push(col);
    }
  }

  return deduped;
}

/**
 * Build an augmented schema that includes CTE definitions as virtual tables
 */
export function buildAugmentedSchema(dbSchema: DatabaseSchema, query: string): DatabaseSchema {
  const ctes = extractCTEsFromQuery(query);
  if (ctes.length === 0) return dbSchema;

  const cteTableInfos: TableInfo[] = ctes.map(cte => ({
    schema: 'cte',
    name: cte.name,
    columns: getCTEColumns(cte, dbSchema),
  }));

  return {
    ...dbSchema,
    tables: [...(dbSchema.tables || []), ...cteTableInfos],
  };
}

/**
 * Get the main query text after stripping CTE definitions.
 * This returns only the portion of the query after WITH...AS(...) blocks.
 */
export function getMainQueryText(query: string): string {
  const withMatch = query.match(/\bWITH\s+/i);
  if (!withMatch || withMatch.index === undefined) return query;

  let pos = withMatch.index + withMatch[0].length;

  while (pos < query.length) {
    const cteHeaderMatch = query.substring(pos).match(
      /^(\[?\w+\]?)\s*(?:\(([^)]+)\)\s*)?AS\s*\(/i
    );
    if (!cteHeaderMatch) break;

    const bodyStart = pos + cteHeaderMatch[0].length;
    let depth = 1;
    let bodyEnd = bodyStart;
    while (bodyEnd < query.length && depth > 0) {
      if (query[bodyEnd] === '(') depth++;
      else if (query[bodyEnd] === ')') depth--;
      if (depth > 0) bodyEnd++;
    }

    pos = bodyEnd + 1;
    const afterCTE = query.substring(pos).match(/^\s*,\s*/);
    if (afterCTE) {
      pos += afterCTE[0].length;
    } else {
      break;
    }
  }

  return query.substring(pos);
}

/**
 * Remove execution comments from query text (from query history)
 */
export function removeExecutionComments(queryText: string): string {
  if (!queryText) return queryText;

  const lines = queryText.split('\n');
  const resultLines: string[] = [];
  let skipComments = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Check if this line starts an execution summary comment block
    if (trimmedLine.startsWith('-- Query from history')) {
      skipComments = true;
      continue;
    }

    // If we're in a comment block, skip lines that look like execution metadata
    if (skipComments) {
      if (
        trimmedLine.startsWith('-- Executed:') ||
        trimmedLine.startsWith('-- Connection:') ||
        trimmedLine.startsWith('-- Result Sets:') ||
        trimmedLine === ''
      ) {
        continue;
      } else {
        skipComments = false;
      }
    }

    if (!skipComments) {
      resultLines.push(line);
    }
  }

  return resultLines.join('\n').trimEnd();
}
