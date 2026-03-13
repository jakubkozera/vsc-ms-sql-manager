import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGridSelection } from './useGridSelection';

describe('useGridSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with empty selection', () => {
    const { result } = renderHook(() => useGridSelection());

    expect(result.current.selection.type).toBeNull();
    expect(result.current.selection.selections).toEqual([]);
  });

  it('selects a single row', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectRow(5);
    });

    expect(result.current.selection.type).toBe('row');
    expect(result.current.selection.selections).toHaveLength(1);
    expect(result.current.selection.selections[0].rowIndex).toBe(5);
    expect(result.current.isRowSelected(5)).toBe(true);
    expect(result.current.isRowSelected(6)).toBe(false);
  });

  it('selects multiple rows with Ctrl key', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectRow(2);
    });
    act(() => {
      result.current.selectRow(5, true, false); // Ctrl+click
    });
    act(() => {
      result.current.selectRow(8, true, false); // Ctrl+click
    });

    expect(result.current.selection.selections).toHaveLength(3);
    expect(result.current.isRowSelected(2)).toBe(true);
    expect(result.current.isRowSelected(5)).toBe(true);
    expect(result.current.isRowSelected(8)).toBe(true);
  });

  it('toggles row selection with Ctrl key', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectRow(5);
    });
    act(() => {
      result.current.selectRow(5, true, false); // Ctrl+click same row
    });

    expect(result.current.selection.selections).toHaveLength(0);
    expect(result.current.isRowSelected(5)).toBe(false);
  });

  it('selects range of rows with Shift key', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectRow(2);
    });
    act(() => {
      result.current.selectRow(6, false, true); // Shift+click
    });

    expect(result.current.selection.selections).toHaveLength(5);
    expect(result.current.isRowSelected(2)).toBe(true);
    expect(result.current.isRowSelected(3)).toBe(true);
    expect(result.current.isRowSelected(4)).toBe(true);
    expect(result.current.isRowSelected(5)).toBe(true);
    expect(result.current.isRowSelected(6)).toBe(true);
  });

  it('selects a cell', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectCell(3, 2, 'test value');
    });

    expect(result.current.selection.type).toBe('cell');
    expect(result.current.isCellSelected(3, 2)).toBe(true);
    expect(result.current.isCellSelected(3, 1)).toBe(false);
  });

  it('selects all rows', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectAllRows(10);
    });

    expect(result.current.selection.type).toBe('row');
    expect(result.current.selection.selections).toHaveLength(10);
    expect(result.current.getSelectedRowIndices()).toHaveLength(10);
  });

  it('clears selection', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectRow(5);
    });
    act(() => {
      result.current.clearSelection();
    });

    expect(result.current.selection.type).toBeNull();
    expect(result.current.selection.selections).toEqual([]);
  });

  it('returns selected row indices', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectRow(2);
    });
    act(() => {
      result.current.selectRow(5, true);
    });

    const indices = result.current.getSelectedRowIndices();
    expect(indices).toContain(2);
    expect(indices).toContain(5);
    expect(indices).toHaveLength(2);
  });

  it('selects a single column', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectColumn(3);
    });

    expect(result.current.selection.type).toBe('column');
    expect(result.current.selection.selections).toHaveLength(1);
    expect(result.current.selection.selections[0].columnIndex).toBe(3);
    expect(result.current.isColumnSelected(3)).toBe(true);
    expect(result.current.isColumnSelected(0)).toBe(false);
  });

  it('selects multiple columns with Ctrl key', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectColumn(1);
    });
    act(() => {
      result.current.selectColumn(4, true, false); // Ctrl+click
    });

    expect(result.current.selection.type).toBe('column');
    expect(result.current.selection.selections).toHaveLength(2);
    expect(result.current.isColumnSelected(1)).toBe(true);
    expect(result.current.isColumnSelected(4)).toBe(true);
    expect(result.current.isColumnSelected(2)).toBe(false);
  });

  it('toggles column selection with Ctrl key', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectColumn(2);
    });
    act(() => {
      result.current.selectColumn(2, true, false); // Ctrl+click same column
    });

    expect(result.current.isColumnSelected(2)).toBe(false);
  });

  it('selects range of columns with Shift key', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectColumn(1);
    });
    act(() => {
      result.current.selectColumn(4, false, true); // Shift+click
    });

    expect(result.current.selection.type).toBe('column');
    expect(result.current.selection.selections).toHaveLength(4);
    expect(result.current.isColumnSelected(1)).toBe(true);
    expect(result.current.isColumnSelected(2)).toBe(true);
    expect(result.current.isColumnSelected(3)).toBe(true);
    expect(result.current.isColumnSelected(4)).toBe(true);
    expect(result.current.isColumnSelected(0)).toBe(false);
    expect(result.current.isColumnSelected(5)).toBe(false);
  });

  it('selects range of columns with Shift key in reverse order', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectColumn(5);
    });
    act(() => {
      result.current.selectColumn(2, false, true); // Shift+click to the left
    });

    expect(result.current.selection.type).toBe('column');
    expect(result.current.selection.selections).toHaveLength(4);
    expect(result.current.isColumnSelected(2)).toBe(true);
    expect(result.current.isColumnSelected(3)).toBe(true);
    expect(result.current.isColumnSelected(4)).toBe(true);
    expect(result.current.isColumnSelected(5)).toBe(true);
  });

  it('Shift on column without anchor falls back to single selection', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectColumn(3, false, true); // Shift+click with no prior anchor
    });

    expect(result.current.selection.type).toBe('column');
    expect(result.current.selection.selections).toHaveLength(1);
    expect(result.current.isColumnSelected(3)).toBe(true);
  });

  it('isCellSelected returns true for cells in selected column', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectColumn(2);
    });

    // All rows in column 2 should be selected
    expect(result.current.isCellSelected(0, 2)).toBe(true);
    expect(result.current.isCellSelected(5, 2)).toBe(true);
    expect(result.current.isCellSelected(100, 2)).toBe(true);
    // Other columns should not be selected
    expect(result.current.isCellSelected(0, 1)).toBe(false);
    expect(result.current.isCellSelected(0, 3)).toBe(false);
  });

  it('switching from row to column selection clears row selection', () => {
    const { result } = renderHook(() => useGridSelection());

    act(() => {
      result.current.selectRow(5);
    });
    expect(result.current.selection.type).toBe('row');

    act(() => {
      result.current.selectColumn(2);
    });
    expect(result.current.selection.type).toBe('column');
    expect(result.current.isRowSelected(5)).toBe(false);
  });
});
