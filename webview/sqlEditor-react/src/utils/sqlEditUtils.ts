import type { ResultSetMetadata } from '../types/messages';

/**
 * Returns the source table and schema for a specific column in a result set.
 * Falls back to the result set's sourceTable when column-level info is not available.
 * This correctly handles JOIN queries where each column may come from a different table
 * and the result-set-level sourceTable is undefined.
 */
export function getColumnSourceInfo(
  meta: ResultSetMetadata,
  columns: string[],
  colName: string
): { tableName: string; schemaName: string } {
  const colIdx = columns.indexOf(colName);
  const colMeta = colIdx >= 0 ? meta.columns?.[colIdx] : undefined;
  return {
    tableName: colMeta?.sourceTable || meta.sourceTable || '',
    schemaName: colMeta?.sourceSchema || meta.sourceSchema || 'dbo',
  };
}

/**
 * Returns the primary key column names for a specific source table.
 * When the result set contains columns from multiple tables (JOIN), each table may have its
 * own set of PKs — this function finds the PKs that belong to the given table.
 * Falls back to the supplied global PKs when no table-specific PKs are found.
 */
export function getTableSpecificPks(
  meta: ResultSetMetadata,
  fallbackPkColumns: string[],
  tableName: string,
  schemaName: string
): string[] {
  const tablePks = (meta.columns || [])
    .filter(c => c.isPrimaryKey && c.sourceTable === tableName && c.sourceSchema === schemaName)
    .map(c => c.name);
  return tablePks.length > 0 ? tablePks : fallbackPkColumns;
}
