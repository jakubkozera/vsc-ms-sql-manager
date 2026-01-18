import { useCallback, useReducer } from 'react';
import { GridSelection, SelectionItem } from '../types/grid';

type SelectionMode = 'single' | 'multi' | 'range';

interface SelectionState extends GridSelection {
  anchorIndex: { rowIndex?: number; columnIndex?: number } | null;
}

type SelectionAction =
  | { type: 'SELECT_ROW'; rowIndex: number; mode: SelectionMode }
  | { type: 'SELECT_COLUMN'; columnIndex: number; mode: SelectionMode }
  | { type: 'SELECT_CELL'; rowIndex: number; columnIndex: number; value: any; mode: SelectionMode }
  | { type: 'SELECT_RANGE'; endRowIndex: number; endColumnIndex: number }
  | { type: 'SELECT_ALL_ROWS'; rowCount: number }
  | { type: 'CLEAR_SELECTION' };

const initialState: SelectionState = {
  type: null,
  selections: [],
  lastClickedIndex: null,
  anchorIndex: null,
};

function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'SELECT_ROW': {
      const { rowIndex, mode } = action;
      const newItem: SelectionItem = { rowIndex };

      if (mode === 'single') {
        return {
          type: 'row',
          selections: [newItem],
          lastClickedIndex: { rowIndex },
          anchorIndex: { rowIndex },
        };
      }

      if (mode === 'multi') {
        // Toggle selection
        const exists = state.selections.some(s => s.rowIndex === rowIndex);
        if (exists) {
          const filtered = state.selections.filter(s => s.rowIndex !== rowIndex);
          return {
            ...state,
            type: filtered.length > 0 ? 'row' : null,
            selections: filtered,
            lastClickedIndex: { rowIndex },
          };
        }
        return {
          type: 'row',
          selections: [...state.selections, newItem],
          lastClickedIndex: { rowIndex },
          anchorIndex: state.anchorIndex || { rowIndex },
        };
      }

      if (mode === 'range' && state.anchorIndex?.rowIndex !== undefined) {
        // Range selection from anchor to current
        const start = Math.min(state.anchorIndex.rowIndex, rowIndex);
        const end = Math.max(state.anchorIndex.rowIndex, rowIndex);
        const rangeSelections: SelectionItem[] = [];
        for (let i = start; i <= end; i++) {
          rangeSelections.push({ rowIndex: i });
        }
        return {
          type: 'row',
          selections: rangeSelections,
          lastClickedIndex: { rowIndex },
          anchorIndex: state.anchorIndex,
        };
      }

      return {
        type: 'row',
        selections: [newItem],
        lastClickedIndex: { rowIndex },
        anchorIndex: { rowIndex },
      };
    }

    case 'SELECT_COLUMN': {
      const { columnIndex, mode } = action;
      const newItem: SelectionItem = { columnIndex };

      if (mode === 'single') {
        return {
          type: 'column',
          selections: [newItem],
          lastClickedIndex: { columnIndex },
          anchorIndex: { columnIndex },
        };
      }

      if (mode === 'multi') {
        const exists = state.selections.some(s => s.columnIndex === columnIndex);
        if (exists) {
          const filtered = state.selections.filter(s => s.columnIndex !== columnIndex);
          return {
            ...state,
            type: filtered.length > 0 ? 'column' : null,
            selections: filtered,
            lastClickedIndex: { columnIndex },
          };
        }
        return {
          type: 'column',
          selections: [...state.selections, newItem],
          lastClickedIndex: { columnIndex },
          anchorIndex: state.anchorIndex || { columnIndex },
        };
      }

      return {
        type: 'column',
        selections: [newItem],
        lastClickedIndex: { columnIndex },
        anchorIndex: { columnIndex },
      };
    }

    case 'SELECT_CELL': {
      const { rowIndex, columnIndex, value, mode } = action;
      const newItem: SelectionItem = { rowIndex, columnIndex, cellValue: value };

      if (mode === 'single') {
        return {
          type: 'cell',
          selections: [newItem],
          lastClickedIndex: { rowIndex, columnIndex },
          anchorIndex: { rowIndex, columnIndex },
        };
      }

      if (mode === 'multi') {
        const exists = state.selections.some(
          s => s.rowIndex === rowIndex && s.columnIndex === columnIndex
        );
        if (exists) {
          const filtered = state.selections.filter(
            s => !(s.rowIndex === rowIndex && s.columnIndex === columnIndex)
          );
          return {
            ...state,
            type: filtered.length > 0 ? 'cell' : null,
            selections: filtered,
            lastClickedIndex: { rowIndex, columnIndex },
          };
        }
        return {
          type: 'cell',
          selections: [...state.selections, newItem],
          lastClickedIndex: { rowIndex, columnIndex },
          anchorIndex: state.anchorIndex || { rowIndex, columnIndex },
        };
      }

      if (mode === 'range' && state.anchorIndex) {
        // Rectangular selection
        const startRow = Math.min(state.anchorIndex.rowIndex ?? rowIndex, rowIndex);
        const endRow = Math.max(state.anchorIndex.rowIndex ?? rowIndex, rowIndex);
        const startCol = Math.min(state.anchorIndex.columnIndex ?? columnIndex, columnIndex);
        const endCol = Math.max(state.anchorIndex.columnIndex ?? columnIndex, columnIndex);

        const rangeSelections: SelectionItem[] = [];
        for (let r = startRow; r <= endRow; r++) {
          for (let c = startCol; c <= endCol; c++) {
            rangeSelections.push({ rowIndex: r, columnIndex: c });
          }
        }
        return {
          type: 'cell',
          selections: rangeSelections,
          lastClickedIndex: { rowIndex, columnIndex },
          anchorIndex: state.anchorIndex,
        };
      }

      return {
        type: 'cell',
        selections: [newItem],
        lastClickedIndex: { rowIndex, columnIndex },
        anchorIndex: { rowIndex, columnIndex },
      };
    }

    case 'SELECT_ALL_ROWS': {
      const { rowCount } = action;
      const selections: SelectionItem[] = [];
      for (let i = 0; i < rowCount; i++) {
        selections.push({ rowIndex: i });
      }
      return {
        type: 'row',
        selections,
        lastClickedIndex: null,
        anchorIndex: null,
      };
    }

    case 'CLEAR_SELECTION':
      return initialState;

    default:
      return state;
  }
}

export function useGridSelection() {
  const [state, dispatch] = useReducer(selectionReducer, initialState);

  const selectRow = useCallback((rowIndex: number, ctrlKey = false, shiftKey = false) => {
    const mode: SelectionMode = shiftKey ? 'range' : ctrlKey ? 'multi' : 'single';
    dispatch({ type: 'SELECT_ROW', rowIndex, mode });
  }, []);

  const selectColumn = useCallback((columnIndex: number, ctrlKey = false, shiftKey = false) => {
    const mode: SelectionMode = shiftKey ? 'range' : ctrlKey ? 'multi' : 'single';
    dispatch({ type: 'SELECT_COLUMN', columnIndex, mode });
  }, []);

  const selectCell = useCallback(
    (rowIndex: number, columnIndex: number, value: any, ctrlKey = false, shiftKey = false) => {
      const mode: SelectionMode = shiftKey ? 'range' : ctrlKey ? 'multi' : 'single';
      dispatch({ type: 'SELECT_CELL', rowIndex, columnIndex, value, mode });
    },
    []
  );

  const selectAllRows = useCallback((rowCount: number) => {
    dispatch({ type: 'SELECT_ALL_ROWS', rowCount });
  }, []);

  const clearSelection = useCallback(() => {
    dispatch({ type: 'CLEAR_SELECTION' });
  }, []);

  const isRowSelected = useCallback(
    (rowIndex: number) => {
      if (state.type === 'row') {
        return state.selections.some(s => s.rowIndex === rowIndex);
      }
      return false;
    },
    [state]
  );

  const isColumnSelected = useCallback(
    (columnIndex: number) => {
      if (state.type === 'column') {
        return state.selections.some(s => s.columnIndex === columnIndex);
      }
      return false;
    },
    [state]
  );

  const isCellSelected = useCallback(
    (rowIndex: number, columnIndex: number) => {
      if (state.type === 'cell') {
        return state.selections.some(
          s => s.rowIndex === rowIndex && s.columnIndex === columnIndex
        );
      }
      // Also selected if whole row or column is selected
      if (state.type === 'row') {
        return state.selections.some(s => s.rowIndex === rowIndex);
      }
      if (state.type === 'column') {
        return state.selections.some(s => s.columnIndex === columnIndex);
      }
      return false;
    },
    [state]
  );

  const getSelectedValues = useCallback(() => {
    return state.selections.map(s => s.cellValue).filter(v => v !== undefined);
  }, [state]);

  const getSelectedRowIndices = useCallback(() => {
    if (state.type === 'row') {
      return state.selections.map(s => s.rowIndex!).filter((v): v is number => v !== undefined);
    }
    if (state.type === 'cell') {
      const uniqueRows = new Set(state.selections.map(s => s.rowIndex));
      return Array.from(uniqueRows).filter((v): v is number => v !== undefined);
    }
    return [];
  }, [state]);

  return {
    selection: state as GridSelection,
    selectRow,
    selectColumn,
    selectCell,
    selectAllRows,
    clearSelection,
    isRowSelected,
    isColumnSelected,
    isCellSelected,
    getSelectedValues,
    getSelectedRowIndices,
  };
}
