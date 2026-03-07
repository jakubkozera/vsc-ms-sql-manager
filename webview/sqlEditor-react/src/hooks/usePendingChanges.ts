import { useReducer, useCallback, useMemo } from 'react';

export interface CellChange {
  rowIndex: number;
  columnName: string;
  originalValue: unknown;
  newValue: unknown;
}

export interface RowChange {
  rowIndex: number;
  originalRow: unknown[];
  changes: Map<string, { original: unknown; new: unknown }>;
  isDeleted: boolean;
}

export interface PendingChangesState {
  /** Map of resultSetIndex -> Map of rowIndex -> RowChange */
  changesByResultSet: Map<number, Map<number, RowChange>>;
  /** Total count of modified rows across all result sets */
  totalChangedRows: number;
  /** Total count of deleted rows across all result sets */
  totalDeletedRows: number;
}

type PendingChangesAction =
  | { type: 'EDIT_CELL'; resultSetIndex: number; rowIndex: number; columnName: string; columnIndex: number; originalRow: unknown[]; originalValue: unknown; newValue: unknown }
  | { type: 'DELETE_ROW'; resultSetIndex: number; rowIndex: number; originalRow: unknown[] }
  | { type: 'RESTORE_ROW'; resultSetIndex: number; rowIndex: number }
  | { type: 'REVERT_CELL'; resultSetIndex: number; rowIndex: number; columnName: string }
  | { type: 'REVERT_ROW'; resultSetIndex: number; rowIndex: number }
  | { type: 'REVERT_ALL'; resultSetIndex?: number }
  | { type: 'COMMIT_SUCCESS'; resultSetIndex?: number };

const initialState: PendingChangesState = {
  changesByResultSet: new Map(),
  totalChangedRows: 0,
  totalDeletedRows: 0,
};

function countTotals(changesByResultSet: Map<number, Map<number, RowChange>>): { changed: number; deleted: number } {
  let changed = 0;
  let deleted = 0;
  
  for (const resultSetChanges of changesByResultSet.values()) {
    for (const rowChange of resultSetChanges.values()) {
      if (rowChange.isDeleted) {
        deleted++;
      } else if (rowChange.changes.size > 0) {
        changed++;
      }
    }
  }
  
  return { changed, deleted };
}

function pendingChangesReducer(state: PendingChangesState, action: PendingChangesAction): PendingChangesState {
  const newChangesByResultSet = new Map(state.changesByResultSet);
  
  switch (action.type) {
    case 'EDIT_CELL': {
      const { resultSetIndex, rowIndex, columnName, originalRow, originalValue, newValue } = action;
      
      // Get or create result set map
      let resultSetChanges = newChangesByResultSet.get(resultSetIndex);
      if (!resultSetChanges) {
        resultSetChanges = new Map();
        newChangesByResultSet.set(resultSetIndex, resultSetChanges);
      } else {
        resultSetChanges = new Map(resultSetChanges);
        newChangesByResultSet.set(resultSetIndex, resultSetChanges);
      }
      
      // Get or create row change
      let rowChange = resultSetChanges.get(rowIndex);
      if (!rowChange) {
        rowChange = {
          rowIndex,
          originalRow,
          changes: new Map(),
          isDeleted: false,
        };
      } else {
        rowChange = {
          ...rowChange,
          changes: new Map(rowChange.changes),
        };
      }
      
      // If new value equals original, remove the change
      if (newValue === originalValue) {
        rowChange.changes.delete(columnName);
        
        // If no more changes, remove row from tracking
        if (rowChange.changes.size === 0 && !rowChange.isDeleted) {
          resultSetChanges.delete(rowIndex);
        } else {
          resultSetChanges.set(rowIndex, rowChange);
        }
      } else {
        rowChange.changes.set(columnName, { original: originalValue, new: newValue });
        resultSetChanges.set(rowIndex, rowChange);
      }
      
      // Clean up empty result sets
      if (resultSetChanges.size === 0) {
        newChangesByResultSet.delete(resultSetIndex);
      }
      
      const totals = countTotals(newChangesByResultSet);
      return {
        changesByResultSet: newChangesByResultSet,
        totalChangedRows: totals.changed,
        totalDeletedRows: totals.deleted,
      };
    }
    
    case 'DELETE_ROW': {
      const { resultSetIndex, rowIndex, originalRow } = action;
      
      let resultSetChanges = newChangesByResultSet.get(resultSetIndex);
      if (!resultSetChanges) {
        resultSetChanges = new Map();
        newChangesByResultSet.set(resultSetIndex, resultSetChanges);
      } else {
        resultSetChanges = new Map(resultSetChanges);
        newChangesByResultSet.set(resultSetIndex, resultSetChanges);
      }
      
      let rowChange = resultSetChanges.get(rowIndex);
      if (!rowChange) {
        rowChange = {
          rowIndex,
          originalRow,
          changes: new Map(),
          isDeleted: true,
        };
      } else {
        rowChange = { ...rowChange, isDeleted: true };
      }
      
      resultSetChanges.set(rowIndex, rowChange);
      
      const totals = countTotals(newChangesByResultSet);
      return {
        changesByResultSet: newChangesByResultSet,
        totalChangedRows: totals.changed,
        totalDeletedRows: totals.deleted,
      };
    }
    
    case 'RESTORE_ROW': {
      const { resultSetIndex, rowIndex } = action;
      
      const resultSetChanges = newChangesByResultSet.get(resultSetIndex);
      if (!resultSetChanges) return state;
      
      const newResultSetChanges = new Map(resultSetChanges);
      const rowChange = newResultSetChanges.get(rowIndex);
      if (!rowChange) return state;
      
      if (rowChange.changes.size === 0) {
        // No cell changes, just remove the row
        newResultSetChanges.delete(rowIndex);
      } else {
        // Keep cell changes, just unmark as deleted
        newResultSetChanges.set(rowIndex, { ...rowChange, isDeleted: false });
      }
      
      if (newResultSetChanges.size === 0) {
        newChangesByResultSet.delete(resultSetIndex);
      } else {
        newChangesByResultSet.set(resultSetIndex, newResultSetChanges);
      }
      
      const totals = countTotals(newChangesByResultSet);
      return {
        changesByResultSet: newChangesByResultSet,
        totalChangedRows: totals.changed,
        totalDeletedRows: totals.deleted,
      };
    }
    
    case 'REVERT_CELL': {
      const { resultSetIndex, rowIndex, columnName } = action;
      
      const resultSetChanges = newChangesByResultSet.get(resultSetIndex);
      if (!resultSetChanges) return state;
      
      const rowChange = resultSetChanges.get(rowIndex);
      if (!rowChange) return state;
      
      const newChanges = new Map(rowChange.changes);
      newChanges.delete(columnName);
      
      const newResultSetChanges = new Map(resultSetChanges);
      
      if (newChanges.size === 0 && !rowChange.isDeleted) {
        newResultSetChanges.delete(rowIndex);
      } else {
        newResultSetChanges.set(rowIndex, { ...rowChange, changes: newChanges });
      }
      
      if (newResultSetChanges.size === 0) {
        newChangesByResultSet.delete(resultSetIndex);
      } else {
        newChangesByResultSet.set(resultSetIndex, newResultSetChanges);
      }
      
      const totals = countTotals(newChangesByResultSet);
      return {
        changesByResultSet: newChangesByResultSet,
        totalChangedRows: totals.changed,
        totalDeletedRows: totals.deleted,
      };
    }
    
    case 'REVERT_ROW': {
      const { resultSetIndex, rowIndex } = action;
      
      const resultSetChanges = newChangesByResultSet.get(resultSetIndex);
      if (!resultSetChanges) return state;
      
      const newResultSetChanges = new Map(resultSetChanges);
      newResultSetChanges.delete(rowIndex);
      
      if (newResultSetChanges.size === 0) {
        newChangesByResultSet.delete(resultSetIndex);
      } else {
        newChangesByResultSet.set(resultSetIndex, newResultSetChanges);
      }
      
      const totals = countTotals(newChangesByResultSet);
      return {
        changesByResultSet: newChangesByResultSet,
        totalChangedRows: totals.changed,
        totalDeletedRows: totals.deleted,
      };
    }
    
    case 'REVERT_ALL': {
      if (action.resultSetIndex !== undefined) {
        newChangesByResultSet.delete(action.resultSetIndex);
        const totals = countTotals(newChangesByResultSet);
        return {
          changesByResultSet: newChangesByResultSet,
          totalChangedRows: totals.changed,
          totalDeletedRows: totals.deleted,
        };
      }
      
      return initialState;
    }
    
    case 'COMMIT_SUCCESS': {
      if (action.resultSetIndex !== undefined) {
        newChangesByResultSet.delete(action.resultSetIndex);
        const totals = countTotals(newChangesByResultSet);
        return {
          changesByResultSet: newChangesByResultSet,
          totalChangedRows: totals.changed,
          totalDeletedRows: totals.deleted,
        };
      }
      
      return initialState;
    }
    
    default:
      return state;
  }
}

export interface UsePendingChangesReturn {
  state: PendingChangesState;
  hasPendingChanges: boolean;
  
  // Actions
  editCell: (resultSetIndex: number, rowIndex: number, columnName: string, columnIndex: number, originalRow: unknown[], originalValue: unknown, newValue: unknown) => void;
  deleteRow: (resultSetIndex: number, rowIndex: number, originalRow: unknown[]) => void;
  restoreRow: (resultSetIndex: number, rowIndex: number) => void;
  revertCell: (resultSetIndex: number, rowIndex: number, columnName: string) => void;
  revertRow: (resultSetIndex: number, rowIndex: number) => void;
  revertAll: (resultSetIndex?: number) => void;
  commitSuccess: (resultSetIndex?: number) => void;
  
  // Queries
  getRowChange: (resultSetIndex: number, rowIndex: number) => RowChange | undefined;
  getCellChange: (resultSetIndex: number, rowIndex: number, columnName: string) => { original: unknown; new: unknown } | undefined;
  isRowModified: (resultSetIndex: number, rowIndex: number) => boolean;
  isRowDeleted: (resultSetIndex: number, rowIndex: number) => boolean;
  isCellModified: (resultSetIndex: number, rowIndex: number, columnName: string) => boolean;
  getChangesForResultSet: (resultSetIndex: number) => RowChange[];
  
  // SQL Generation
  generateUpdateStatements: (resultSetIndex: number, tableName: string, columns: string[], pkColumns: string[]) => string[];
  generateDeleteStatements: (resultSetIndex: number, tableName: string, columns: string[], pkColumns: string[]) => string[];
}

export function usePendingChanges(): UsePendingChangesReturn {
  const [state, dispatch] = useReducer(pendingChangesReducer, initialState);
  
  const hasPendingChanges = useMemo(() => {
    return state.totalChangedRows > 0 || state.totalDeletedRows > 0;
  }, [state.totalChangedRows, state.totalDeletedRows]);
  
  // Actions
  const editCell = useCallback((
    resultSetIndex: number,
    rowIndex: number,
    columnName: string,
    columnIndex: number,
    originalRow: unknown[],
    originalValue: unknown,
    newValue: unknown
  ) => {
    dispatch({
      type: 'EDIT_CELL',
      resultSetIndex,
      rowIndex,
      columnName,
      columnIndex,
      originalRow,
      originalValue,
      newValue,
    });
  }, []);
  
  const deleteRow = useCallback((resultSetIndex: number, rowIndex: number, originalRow: unknown[]) => {
    dispatch({ type: 'DELETE_ROW', resultSetIndex, rowIndex, originalRow });
  }, []);
  
  const restoreRow = useCallback((resultSetIndex: number, rowIndex: number) => {
    dispatch({ type: 'RESTORE_ROW', resultSetIndex, rowIndex });
  }, []);
  
  const revertCell = useCallback((resultSetIndex: number, rowIndex: number, columnName: string) => {
    dispatch({ type: 'REVERT_CELL', resultSetIndex, rowIndex, columnName });
  }, []);
  
  const revertRow = useCallback((resultSetIndex: number, rowIndex: number) => {
    dispatch({ type: 'REVERT_ROW', resultSetIndex, rowIndex });
  }, []);
  
  const revertAll = useCallback((resultSetIndex?: number) => {
    dispatch({ type: 'REVERT_ALL', resultSetIndex });
  }, []);
  
  const commitSuccess = useCallback((resultSetIndex?: number) => {
    dispatch({ type: 'COMMIT_SUCCESS', resultSetIndex });
  }, []);
  
  // Queries
  const getRowChange = useCallback((resultSetIndex: number, rowIndex: number): RowChange | undefined => {
    return state.changesByResultSet.get(resultSetIndex)?.get(rowIndex);
  }, [state.changesByResultSet]);
  
  const getCellChange = useCallback((resultSetIndex: number, rowIndex: number, columnName: string) => {
    return state.changesByResultSet.get(resultSetIndex)?.get(rowIndex)?.changes.get(columnName);
  }, [state.changesByResultSet]);
  
  const isRowModified = useCallback((resultSetIndex: number, rowIndex: number): boolean => {
    const rowChange = state.changesByResultSet.get(resultSetIndex)?.get(rowIndex);
    return rowChange ? rowChange.changes.size > 0 || rowChange.isDeleted : false;
  }, [state.changesByResultSet]);
  
  const isRowDeleted = useCallback((resultSetIndex: number, rowIndex: number): boolean => {
    return state.changesByResultSet.get(resultSetIndex)?.get(rowIndex)?.isDeleted ?? false;
  }, [state.changesByResultSet]);
  
  const isCellModified = useCallback((resultSetIndex: number, rowIndex: number, columnName: string): boolean => {
    return state.changesByResultSet.get(resultSetIndex)?.get(rowIndex)?.changes.has(columnName) ?? false;
  }, [state.changesByResultSet]);
  
  const getChangesForResultSet = useCallback((resultSetIndex: number): RowChange[] => {
    const changes = state.changesByResultSet.get(resultSetIndex);
    return changes ? Array.from(changes.values()) : [];
  }, [state.changesByResultSet]);
  
  // SQL Generation
  const generateUpdateStatements = useCallback((
    resultSetIndex: number,
    tableName: string,
    columns: string[],
    pkColumns: string[]
  ): string[] => {
    const changes = state.changesByResultSet.get(resultSetIndex);
    if (!changes) return [];
    
    const statements: string[] = [];
    
    for (const rowChange of changes.values()) {
      if (rowChange.isDeleted || rowChange.changes.size === 0) continue;
      
      const setClauses: string[] = [];
      for (const [columnName, { new: newValue }] of rowChange.changes) {
        setClauses.push(`[${columnName}] = ${formatSqlValue(newValue)}`);
      }
      
      const whereClauses = pkColumns.map(pkCol => {
        const colIndex = columns.indexOf(pkCol);
        const value = colIndex >= 0 ? rowChange.originalRow[colIndex] : null;
        return `[${pkCol}] = ${formatSqlValue(value)}`;
      });
      
      if (setClauses.length > 0 && whereClauses.length > 0) {
        statements.push(
          `UPDATE [${tableName}] SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')};`
        );
      }
    }
    
    return statements;
  }, [state.changesByResultSet]);
  
  const generateDeleteStatements = useCallback((
    resultSetIndex: number,
    tableName: string,
    columns: string[],
    pkColumns: string[]
  ): string[] => {
    const changes = state.changesByResultSet.get(resultSetIndex);
    if (!changes) return [];
    
    const statements: string[] = [];
    
    for (const rowChange of changes.values()) {
      if (!rowChange.isDeleted) continue;
      
      const whereClauses = pkColumns.map(pkCol => {
        const colIndex = columns.indexOf(pkCol);
        const value = colIndex >= 0 ? rowChange.originalRow[colIndex] : null;
        return `[${pkCol}] = ${formatSqlValue(value)}`;
      });
      
      if (whereClauses.length > 0) {
        statements.push(
          `DELETE FROM [${tableName}] WHERE ${whereClauses.join(' AND ')};`
        );
      }
    }
    
    return statements;
  }, [state.changesByResultSet]);
  
  return {
    state,
    hasPendingChanges,
    editCell,
    deleteRow,
    restoreRow,
    revertCell,
    revertRow,
    revertAll,
    commitSuccess,
    getRowChange,
    getCellChange,
    isRowModified,
    isRowDeleted,
    isCellModified,
    getChangesForResultSet,
    generateUpdateStatements,
    generateDeleteStatements,
  };
}

function formatSqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  // String - escape single quotes
  return `'${String(value).replace(/'/g, "''")}'`;
}
