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
