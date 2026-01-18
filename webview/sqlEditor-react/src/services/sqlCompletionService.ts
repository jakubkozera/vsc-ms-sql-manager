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
  'except', 'intersect', 'distinct', 'top', 'asc', 'desc', 'limit', 'offset', 'fetch'
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
  tableName?: string;
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
  | 'DEFAULT';

/**
 * Find a table in the schema by name
 */
export function findTable(tableName: string, dbSchema: DatabaseSchema): { schema: string; table: string } | null {
  const lowerName = tableName.toLowerCase();

  // Check tables first
  if (dbSchema?.tables) {
    for (const table of dbSchema.tables) {
      if (table.name.toLowerCase() === lowerName) {
        return { schema: table.schema, table: table.name };
      }
    }
  }

  // Then check views
  if (dbSchema?.views) {
    for (const view of dbSchema.views) {
      if (view.name.toLowerCase() === lowerName) {
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
      return {
        schema: match[1] || 'dbo',
        table: match[2],
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
    /\b(?:from|(?:inner\s+|left\s+|right\s+|full\s+|cross\s+)?join)\s+(?:\[([^\]]+)\]\.)?\[([^\]]+)\](?:\s+(?:as\s+)?(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*)))?(?:\s+on\s+|\s+where\s+|\s+order\s+by\s+|\s+group\s+by\s+|\s+having\s+|\s*$|\s*\r?\n)/gi,
    // Pattern for schema.table with alias (must have dot)
    /\b(?:from|(?:inner\s+|left\s+|right\s+|full\s+|cross\s+)?join)\s+([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:as\s+)?(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*)))?(?:\s+on\s+|\s+where\s+|\s+order\s+by\s+|\s+group\s+by\s+|\s+having\s+|\s*$|\s*\r?\n)/gi,
    // Pattern for just table name with alias (no schema)
    /\b(?:from|(?:inner\s+|left\s+|right\s+|full\s+|cross\s+)?join)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:as\s+)?(?:\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*)))?(?:\s+on\s+|\s+where\s+|\s+order\s+by\s+|\s+group\s+by\s+|\s+having\s+|\s*$|\s*\r?\n)/gi,
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
  });

  return tables;
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
  let name = tableName.replace(/^(tbl_?|t_)/i, '');
  
  // If name has underscores, use first letter of each word
  if (name.includes('_')) {
    return name.split('_').map((w) => w[0]?.toLowerCase() || '').join('');
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

  // Check for ON clause context
  if (/\bjoin\s+(?:\w+\.)?(\w+)(?:\s+(?:as\s+)?(\w+))?\s+on\s*/i.test(lowerLine) || /\bon\s*$/i.test(lowerLine)) {
    return { type: 'ON_CONDITION', confidence: 'high' };
  }

  // Check for ORDER BY context
  if (lastOrderByPos !== -1 && (lastOrderByPos > lastWherePos || lastWherePos === -1)) {
    const textAfterOrderBy = lowerText.substring(lastOrderByPos + 8);
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
    const insertMatch = /insert\s+into\s+(?:\w+\.)?(\w+)\s*\(\s*([^)]*)?$/i.exec(lowerLine);
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
      return { type: 'UPDATE_SET', confidence: 'high' };
    }
  }

  // Check for WHERE context
  if (lastWherePos !== -1 && lastWherePos > Math.max(lastFromPos, lastSetPos)) {
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
      if (textAfterFrom.match(/from\s+(?:\w+\.)?(\w+)(?:\s+(?:as\s+)?(\w+))?/)) {
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
