// Grid Types

export interface ColumnDef {
  name: string;
  index: number;
  type: string;
  width: number;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  pinned?: boolean;
}

export interface SortConfig {
  column: string;
  direction: 'asc' | 'desc';
}

export type FilterType =
  // Text filters
  | 'contains' | 'notContains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith' | 'regex'
  // Number filters
  | 'greaterThan' | 'lessThan' | 'between'
  // Date filters
  | 'before' | 'after' | 'dateBetween' | 'dateEquals'
  // Null filters
  | 'isNull' | 'isNotNull'
  // Multi-select
  | 'in'
  // Boolean
  | 'boolTrue' | 'boolFalse' | 'boolAny';

export type ColumnFilterCategory = 'text' | 'number' | 'date' | 'boolean' | 'guid' | 'binary' | 'xml_json';

export interface FilterConfig {
  type: FilterType;
  value: any;
  valueTo?: any;
  caseSensitive?: boolean;
  selectedValues?: Set<string>;
}

export function getColumnFilterCategory(sqlType: string): ColumnFilterCategory {
  const t = sqlType.toLowerCase();
  if (['bit'].includes(t)) return 'boolean';
  if (['date', 'datetime', 'datetime2', 'datetimeoffset', 'smalldatetime', 'time'].some(d => t.includes(d))) return 'date';
  if (['int', 'bigint', 'smallint', 'tinyint', 'real', 'float', 'decimal', 'numeric', 'money', 'smallmoney', 'number'].some(n => t.includes(n))) return 'number';
  if (['uniqueidentifier', 'uuid'].some(g => t.includes(g))) return 'guid';
  if (['varbinary', 'binary', 'image', 'geography', 'geometry', 'hierarchyid'].some(b => t.includes(b))) return 'binary';
  if (['xml', 'json'].some(x => t === x)) return 'xml_json';
  return 'text';
}

export interface GridSelection {
  type: 'row' | 'column' | 'cell' | null;
  selections: SelectionItem[];
  lastClickedIndex: { rowIndex?: number; columnIndex?: number } | null;
}

export interface SelectionItem {
  rowIndex?: number;
  columnIndex?: number;
  cellValue?: any;
}

export interface CellChange {
  resultSetIndex: number;
  rowIndex: number;
  columnName: string;
  oldValue: any;
  newValue: any;
}

export interface ExpandedRowState {
  key: string; // `${tableId}-${rowIndex}-${columnName}`
  expansionId: string;
  sourceRowIndex: number;
  columnName: string;
  isLoading: boolean;
  data?: any[];
  metadata?: any;
  columnNames?: string[];
  error?: string;
}

export interface AggregationResult {
  sum: number | null;
  avg: number | null;
  count: number;
  min: number | string | null;
  max: number | string | null;
  distinctCount: number;
}
