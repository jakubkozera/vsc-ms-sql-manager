// Grid Types

export interface ColumnDef {
  field: string;
  headerName: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  width: number;
  pinned: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

export interface SortConfig {
  field: string | null;
  direction: 'asc' | 'desc' | null;
}

export interface FilterConfig {
  type: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'greaterThan' | 'lessThan' | 'between' | 'isNull' | 'isNotNull';
  value: any;
  valueTo?: any; // For 'between' filter
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
