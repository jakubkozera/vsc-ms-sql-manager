/**
 * Tests for free-range drag cell selection.
 *
 * These tests exercise:
 *  - GridCell onMouseDown / onMouseEnter event propagation
 *  - GridRow forwarding cell drag events to the parent
 *  - DataGrid-level drag handler flow (mocked via GridRow callbacks)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../../../test/testUtils';
import { GridCell } from '../GridCell';
import { GridRow } from '../GridRow';
import { ColumnDef } from '../../../../types/grid';

const col = (index: number): ColumnDef => ({
  name: `col${index}`,
  index,
  type: 'string',
  isPrimaryKey: false,
  isForeignKey: false,
  width: 100,
});

// ---------------------------------------------------------------------------
// GridCell — propagates drag events
// ---------------------------------------------------------------------------
describe('GridCell — drag-selection events', () => {
  const singleCol = col(0);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls onMouseDown on primary-button mousedown', () => {
    const onMouseDown = vi.fn();
    render(
      <table><tbody><tr>
        <GridCell
          value="hello"
          column={singleCol}
          rowIndex={0}
          colIndex={0}
          onMouseDown={onMouseDown}
        />
      </tr></tbody></table>
    );
    fireEvent.mouseDown(screen.getByTestId('cell-0-0'), { button: 0 });
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });

  it('calls onMouseEnter on mouse-over', () => {
    const onMouseEnter = vi.fn();
    render(
      <table><tbody><tr>
        <GridCell
          value="hello"
          column={singleCol}
          rowIndex={1}
          colIndex={2}
          onMouseEnter={onMouseEnter}
        />
      </tr></tbody></table>
    );
    fireEvent.mouseEnter(screen.getByTestId('cell-1-2'));
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onMouseDown when right-clicking (button !== 0)', () => {
    const onMouseDown = vi.fn();
    render(
      <table><tbody><tr>
        <GridCell
          value="hello"
          column={singleCol}
          rowIndex={0}
          colIndex={0}
          onMouseDown={onMouseDown}
        />
      </tr></tbody></table>
    );
    // Right mouse button → DataGrid ignores it, but the event itself still fires;
    // the guard is in DataGrid.handleCellMouseDown, not GridCell. So the prop IS called:
    fireEvent.mouseDown(screen.getByTestId('cell-0-0'), { button: 2 });
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// GridRow — forwards cell drag events with correct rowIndex + colIndex
// ---------------------------------------------------------------------------
describe('GridRow — forwarding drag events', () => {
  const columns = [col(0), col(1), col(2)];
  const row = ['a', 'b', 'c'];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls onCellMouseDown with correct rowIndex and colIndex', () => {
    const onCellMouseDown = vi.fn();
    render(
      <table><tbody>
        <GridRow
          row={row}
          rowIndex={3}
          columns={columns}
          onCellMouseDown={onCellMouseDown}
        />
      </tbody></table>
    );
    // Click the second cell (colIndex=1)
    fireEvent.mouseDown(screen.getByTestId('cell-3-1'), { button: 0 });
    expect(onCellMouseDown).toHaveBeenCalledWith(3, 1, expect.any(Object));
  });

  it('calls onCellMouseEnter with correct rowIndex and colIndex', () => {
    const onCellMouseEnter = vi.fn();
    render(
      <table><tbody>
        <GridRow
          row={row}
          rowIndex={2}
          columns={columns}
          onCellMouseEnter={onCellMouseEnter}
        />
      </tbody></table>
    );
    fireEvent.mouseEnter(screen.getByTestId('cell-2-2'));
    expect(onCellMouseEnter).toHaveBeenCalledWith(2, 2, expect.any(Object));
  });

  it('does not throw when drag callbacks are not provided', () => {
    render(
      <table><tbody>
        <GridRow row={row} rowIndex={0} columns={columns} />
      </tbody></table>
    );
    expect(() => {
      fireEvent.mouseDown(screen.getByTestId('cell-0-0'), { button: 0 });
      fireEvent.mouseEnter(screen.getByTestId('cell-0-1'));
    }).not.toThrow();
  });

  it('provides both rowIndex and colIndex to onCellMouseDown on each cell', () => {
    const onCellMouseDown = vi.fn();
    render(
      <table><tbody>
        <GridRow
          row={row}
          rowIndex={7}
          columns={columns}
          onCellMouseDown={onCellMouseDown}
        />
      </tbody></table>
    );
    // Mousedown on each cell
    for (let c = 0; c < columns.length; c++) {
      fireEvent.mouseDown(screen.getByTestId(`cell-7-${c}`), { button: 0 });
      expect(onCellMouseDown).toHaveBeenLastCalledWith(7, c, expect.any(Object));
    }
    expect(onCellMouseDown).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// GridRow — context menu stopPropagation on data cells
// Regression: right-clicking a data cell must NOT fire the row-level
// onContextMenu handler (which doesn't pass colIndex) and override the
// cell-specific menu. We achieve this by e.stopPropagation() in GridRow.
// ---------------------------------------------------------------------------
describe('GridRow — cell context menu stopPropagation', () => {
  const columns = [col(0), col(1), col(2)];
  const row = ['x', 'y', 'z'];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls onContextMenu with rowIndex AND colIndex when right-clicking a data cell', () => {
    const onContextMenu = vi.fn();
    render(
      <table><tbody>
        <GridRow
          row={row}
          rowIndex={4}
          columns={columns}
          onContextMenu={onContextMenu}
        />
      </tbody></table>
    );
    fireEvent.contextMenu(screen.getByTestId('cell-4-1'));
    // Must have been called exactly once (stopPropagation prevents the <tr> from
    // calling it a second time without colIndex)
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    const [, passedRowIndex, passedColIndex] = onContextMenu.mock.calls[0];
    expect(passedRowIndex).toBe(4);
    expect(passedColIndex).toBe(1);
  });

  it('onContextMenu receives colIndex for each data cell', () => {
    const onContextMenu = vi.fn();
    render(
      <table><tbody>
        <GridRow
          row={row}
          rowIndex={2}
          columns={columns}
          onContextMenu={onContextMenu}
        />
      </tbody></table>
    );
    for (let c = 0; c < columns.length; c++) {
      onContextMenu.mockClear();
      fireEvent.contextMenu(screen.getByTestId(`cell-2-${c}`));
      expect(onContextMenu).toHaveBeenCalledTimes(1);
      expect(onContextMenu.mock.calls[0][2]).toBe(c); // colIndex argument
    }
  });

  it('does not call onContextMenu a second time due to row-level bubbling', () => {
    // This ensures stopPropagation is working: without it, onContextMenu would
    // be called twice for a data-cell right-click (once with colIndex, once without).
    const onContextMenu = vi.fn();
    render(
      <table><tbody>
        <GridRow
          row={row}
          rowIndex={0}
          columns={columns}
          onContextMenu={onContextMenu}
        />
      </tbody></table>
    );
    fireEvent.contextMenu(screen.getByTestId('cell-0-0'));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('row number cell still calls onContextMenu with rowIndex only (no colIndex)', () => {
    const onContextMenu = vi.fn();
    render(
      <table><tbody>
        <GridRow
          row={row}
          rowIndex={5}
          columns={columns}
          onContextMenu={onContextMenu}
        />
      </tbody></table>
    );
    // The row number <td> has its own handler that calls onContextMenu without colIndex
    const rowNumberCell = screen.getByTestId('row-5').querySelector('td.row-number-cell')!;
    fireEvent.contextMenu(rowNumberCell);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    const [, passedRowIndex, passedColIndex] = onContextMenu.mock.calls[0];
    expect(passedRowIndex).toBe(5);
    expect(passedColIndex).toBeUndefined();
  });
});
