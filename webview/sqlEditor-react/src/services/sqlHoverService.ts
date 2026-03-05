import type { ColumnInfo, TableInfo, DatabaseSchema } from '../types/schema';
import { extractTablesFromQuery, findTable, findTableForAlias, getColumnsForTable } from './sqlCompletionService';

export interface HoverResult {
  contents: { value: string }[];
  range: {
    startLineNumber: number;
    endLineNumber: number;
    startColumn: number;
    endColumn: number;
  };
}

function formatColumnType(col: ColumnInfo): string {
  let type = col.type;
  if (col.maxLength) {
    type += `(${col.maxLength})`;
  } else if (col.precision && col.scale) {
    type += `(${col.precision},${col.scale})`;
  } else if (col.precision) {
    type += `(${col.precision})`;
  }
  return type;
}

/**
 * Render a table's columns as a markdown table.
 */
export function renderTableMarkdown(schemaName: string, tableName: string, cols: ColumnInfo[]): string {
  let md = `**${schemaName}.${tableName}** *(${cols.length} columns)*\n\n`;
  md += '| Column | Type | Nullable |\n';
  md += '|:---|:---|:---:|\n';
  for (const c of cols) {
    const type = formatColumnType(c);
    const nullable = c.nullable ? 'YES' : 'NO';
    md += `| ${c.name} | ${type} | ${nullable} |\n`;
  }
  return md;
}

/**
 * Render a single column's details as a properties markdown table.
 */
export function renderColumnMarkdown(schemaName: string, tableName: string, col: ColumnInfo): string {
  let md = '| Property | Value |\n';
  md += '|:---|---:|\n';
  md += `| **Table** | ${schemaName}.${tableName} |\n`;
  md += `| **Column** | ${col.name} |\n`;
  md += `| **Type** | ${formatColumnType(col)} |\n`;
  md += `| **Nullable** | ${col.nullable ? 'YES' : 'NO'} |\n`;
  if (col.isPrimaryKey) md += '| **Primary Key** | YES |\n';
  if (col.isForeignKey) md += '| **Foreign Key** | YES |\n';
  return md;
}

/**
 * Render multiple tables' matching column as a markdown table.
 */
export function renderMultiTableColumnMarkdown(tables: TableInfo[], columnName: string): string {
  let md = '| Table | Column | Type | Nullable |\n';
  md += '|:---|:---|:---|:---:|\n';
  for (const mt of tables) {
    const mc = mt.columns.find((c) => c.name.toLowerCase() === columnName.toLowerCase());
    if (mc) {
      const type = formatColumnType(mc);
      const nullable = mc.nullable ? 'YES' : 'NO';
      md += `| ${mt.schema}.${mt.name} | ${mc.name} | ${type} | ${nullable} |\n`;
    }
  }
  return md;
}

/**
 * Provide hover information for SQL text at a given position.
 * Pure function — no Monaco dependency.
 */
export function provideHoverContent(
  fullText: string,
  lineText: string,
  position: { lineNumber: number; column: number },
  wordAtPosition: { word: string; startColumn: number; endColumn: number } | null,
  dbSchema: DatabaseSchema
): HoverResult | null {
  const tablesInQuery = extractTablesFromQuery(fullText, dbSchema) || [];
  const beforeCursor = lineText.substring(0, position.column - 1);

  // 1. Detect alias.column or table.column pattern before cursor
  const aliasColMatch = beforeCursor.match(/([A-Za-z0-9_]+)\.([A-Za-z0-9_]*)$/);
  if (aliasColMatch) {
    const alias = aliasColMatch[1];
    const colName = aliasColMatch[2];

    const tableInfo = findTableForAlias(fullText, alias, dbSchema) || findTable(alias, dbSchema);
    if (tableInfo) {
      const cols = getColumnsForTable(tableInfo.schema, tableInfo.table, dbSchema) || [];

      // If colName matches a column, show single-column detail
      const col = cols.find((c) => c.name.toLowerCase() === colName.toLowerCase());
      if (col) {
        const mdSingle = renderColumnMarkdown(tableInfo.schema, tableInfo.table, col);
        const matchText = aliasColMatch[0];
        const startCol = beforeCursor.lastIndexOf(matchText) + 1;
        return {
          contents: [{ value: mdSingle }],
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: startCol,
            endColumn: startCol + matchText.length,
          },
        };
      }

      // Column not found — show table schema preview
      const previewCols = cols.slice(0, 15);
      const tableMd = renderTableMarkdown(tableInfo.schema, tableInfo.table, previewCols);
      const startCol2 = beforeCursor.lastIndexOf(alias) + 1;
      return {
        contents: [{ value: tableMd }],
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: startCol2,
          endColumn: startCol2 + alias.length,
        },
      };
    }
  }

  // 2. No alias dot — check standalone word under cursor
  if (wordAtPosition?.word) {
    const w = wordAtPosition.word;

    // If it's a table name, show full table definition
    const table = findTable(w, dbSchema);
    if (table) {
      const cols2 = getColumnsForTable(table.schema, table.table, dbSchema) || [];
      const md2 = renderTableMarkdown(table.schema, table.table, cols2);
      return {
        contents: [{ value: md2 }],
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: wordAtPosition.startColumn,
          endColumn: wordAtPosition.endColumn,
        },
      };
    }

    // If it's a column name present in multiple tables, prefer tables in the current query
    const matching = (dbSchema.tables || []).filter((t: TableInfo) =>
      t.columns.some((c) => c.name.toLowerCase() === w.toLowerCase())
    );

    if (matching.length > 1) {
      const inQuery = matching.filter((t: TableInfo) =>
        tablesInQuery.some(
          (q) => q.table.toLowerCase() === t.name.toLowerCase() && (q.schema ? q.schema === t.schema : true)
        )
      );
      const effective = inQuery.length > 0 ? inQuery : matching;
      const mdMulti = renderMultiTableColumnMarkdown(effective, w);
      return {
        contents: [{ value: mdMulti }],
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: wordAtPosition.startColumn,
          endColumn: wordAtPosition.endColumn,
        },
      };
    }

    // If it's a column name in exactly one table, show that column
    if (matching.length === 1) {
      const t = matching[0];
      const col = t.columns.find((c) => c.name.toLowerCase() === w.toLowerCase());
      if (col) {
        const md3 = renderColumnMarkdown(t.schema, t.name, col);
        return {
          contents: [{ value: md3 }],
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: wordAtPosition.startColumn,
            endColumn: wordAtPosition.endColumn,
          },
        };
      }
    }
  }

  return null;
}
