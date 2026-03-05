import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../../../test/testUtils';
import { GridCell } from '../GridCell';
import { GridRow } from '../GridRow';
import { ColumnDef } from '../../../../types/grid';

describe('Inline Cell Editing', () => {
  const defaultColumn: ColumnDef = {
    name: 'name',
    index: 1,
    type: 'string',
    isPrimaryKey: false,
    isForeignKey: false,
    width: 150,
  };

  const numericColumn: ColumnDef = {
    name: 'age',
    index: 2,
    type: 'int',
    isPrimaryKey: false,
    isForeignKey: false,
    width: 100,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GridCell editing', () => {
    it('enters edit mode on double-click when editable', () => {
      const onCellEdit = vi.fn();
      render(
        <table><tbody><tr>
          <GridCell
            value="John"
            column={defaultColumn}
            rowIndex={0}
            colIndex={1}
            isEditable={true}
            onCellEdit={onCellEdit}
          />
        </tr></tbody></table>
      );

      const cell = screen.getByTestId('cell-0-1');
      fireEvent.doubleClick(cell);

      expect(screen.getByTestId('inline-cell-editor')).toBeInTheDocument();
    });

    it('does not enter edit mode when not editable', () => {
      render(
        <table><tbody><tr>
          <GridCell
            value="John"
            column={defaultColumn}
            rowIndex={0}
            colIndex={1}
            isEditable={false}
          />
        </tr></tbody></table>
      );

      const cell = screen.getByTestId('cell-0-1');
      fireEvent.doubleClick(cell);

      expect(screen.queryByTestId('inline-cell-editor')).not.toBeInTheDocument();
    });

    it('saves value on Enter and calls onCellEdit', () => {
      const onCellEdit = vi.fn();
      render(
        <table><tbody><tr>
          <GridCell
            value="John"
            column={defaultColumn}
            rowIndex={0}
            colIndex={1}
            isEditable={true}
            onCellEdit={onCellEdit}
          />
        </tr></tbody></table>
      );

      fireEvent.doubleClick(screen.getByTestId('cell-0-1'));
      const input = screen.getByTestId('inline-cell-editor');
      
      fireEvent.change(input, { target: { value: 'Jane' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onCellEdit).toHaveBeenCalledWith('Jane');
    });

    it('cancels editing on Escape without saving', () => {
      const onCellEdit = vi.fn();
      render(
        <table><tbody><tr>
          <GridCell
            value="John"
            column={defaultColumn}
            rowIndex={0}
            colIndex={1}
            isEditable={true}
            onCellEdit={onCellEdit}
          />
        </tr></tbody></table>
      );

      fireEvent.doubleClick(screen.getByTestId('cell-0-1'));
      const input = screen.getByTestId('inline-cell-editor');
      
      fireEvent.change(input, { target: { value: 'Jane' } });
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(onCellEdit).not.toHaveBeenCalled();
      expect(screen.queryByTestId('inline-cell-editor')).not.toBeInTheDocument();
    });

    it('saves on blur', () => {
      const onCellEdit = vi.fn();
      render(
        <table><tbody><tr>
          <GridCell
            value="John"
            column={defaultColumn}
            rowIndex={0}
            colIndex={1}
            isEditable={true}
            onCellEdit={onCellEdit}
          />
        </tr></tbody></table>
      );

      fireEvent.doubleClick(screen.getByTestId('cell-0-1'));
      const input = screen.getByTestId('inline-cell-editor');
      
      fireEvent.change(input, { target: { value: 'Jane' } });
      fireEvent.blur(input);

      expect(onCellEdit).toHaveBeenCalledWith('Jane');
    });

    it('does not call onCellEdit when value unchanged', () => {
      const onCellEdit = vi.fn();
      render(
        <table><tbody><tr>
          <GridCell
            value="John"
            column={defaultColumn}
            rowIndex={0}
            colIndex={1}
            isEditable={true}
            onCellEdit={onCellEdit}
          />
        </tr></tbody></table>
      );

      fireEvent.doubleClick(screen.getByTestId('cell-0-1'));
      const input = screen.getByTestId('inline-cell-editor');
      fireEvent.keyDown(input, { key: 'Enter' });

      // Value was "John" and still "John", no change
      expect(onCellEdit).not.toHaveBeenCalled();
    });

    it('parses numeric values for int columns', () => {
      const onCellEdit = vi.fn();
      render(
        <table><tbody><tr>
          <GridCell
            value={25}
            column={numericColumn}
            rowIndex={0}
            colIndex={2}
            isEditable={true}
            onCellEdit={onCellEdit}
          />
        </tr></tbody></table>
      );

      fireEvent.doubleClick(screen.getByTestId('cell-0-2'));
      const input = screen.getByTestId('inline-cell-editor');
      
      fireEvent.change(input, { target: { value: '30' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onCellEdit).toHaveBeenCalledWith(30);
    });

    it('sets NULL when empty string entered', () => {
      const onCellEdit = vi.fn();
      render(
        <table><tbody><tr>
          <GridCell
            value="John"
            column={defaultColumn}
            rowIndex={0}
            colIndex={1}
            isEditable={true}
            onCellEdit={onCellEdit}
          />
        </tr></tbody></table>
      );

      fireEvent.doubleClick(screen.getByTestId('cell-0-1'));
      const input = screen.getByTestId('inline-cell-editor');
      
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onCellEdit).toHaveBeenCalledWith(null);
    });

    it('sets NULL when "null" typed', () => {
      const onCellEdit = vi.fn();
      render(
        <table><tbody><tr>
          <GridCell
            value="John"
            column={defaultColumn}
            rowIndex={0}
            colIndex={1}
            isEditable={true}
            onCellEdit={onCellEdit}
          />
        </tr></tbody></table>
      );

      fireEvent.doubleClick(screen.getByTestId('cell-0-1'));
      const input = screen.getByTestId('inline-cell-editor');
      
      fireEvent.change(input, { target: { value: 'null' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onCellEdit).toHaveBeenCalledWith(null);
    });

    it('enters edit mode via forceEdit prop', () => {
      const onCellEdit = vi.fn();
      const onForceEditComplete = vi.fn();
      render(
        <table><tbody><tr>
          <GridCell
            value="John"
            column={defaultColumn}
            rowIndex={0}
            colIndex={1}
            isEditable={true}
            forceEdit={true}
            onForceEditComplete={onForceEditComplete}
            onCellEdit={onCellEdit}
          />
        </tr></tbody></table>
      );

      expect(screen.getByTestId('inline-cell-editor')).toBeInTheDocument();
      expect(onForceEditComplete).toHaveBeenCalled();
    });

    it('shows modified indicator when cell is modified', () => {
      render(
        <table><tbody><tr>
          <GridCell
            value="Jane"
            column={defaultColumn}
            rowIndex={0}
            colIndex={1}
            isModified={true}
          />
        </tr></tbody></table>
      );

      const cell = screen.getByTestId('cell-0-1');
      expect(cell).toHaveClass('modified');
      expect(screen.getByTitle('Modified')).toBeInTheDocument();
    });

    it('shows deleted styling when row is deleted', () => {
      render(
        <table><tbody><tr>
          <GridCell
            value="John"
            column={defaultColumn}
            rowIndex={0}
            colIndex={1}
            isDeleted={true}
            isEditable={false}
          />
        </tr></tbody></table>
      );

      const cell = screen.getByTestId('cell-0-1');
      expect(cell).toHaveClass('deleted');
    });
  });

  describe('GridRow editing integration', () => {
    const columns: ColumnDef[] = [
      { name: 'id', index: 0, type: 'number', isPrimaryKey: true, isForeignKey: false, width: 80 },
      { name: 'name', index: 1, type: 'string', isPrimaryKey: false, isForeignKey: false, width: 150 },
      { name: 'email', index: 2, type: 'string', isPrimaryKey: false, isForeignKey: false, width: 200 },
    ];
    const row = [1, 'John', 'john@example.com'];

    it('passes onCellEdit to cells and relays with row info', () => {
      const onCellEdit = vi.fn();
      render(
        <table><tbody>
          <GridRow
            row={row}
            rowIndex={0}
            columns={columns}
            onCellEdit={onCellEdit}
          />
        </tbody></table>
      );

      // Double-click the name cell
      fireEvent.doubleClick(screen.getByTestId('cell-0-1'));
      const input = screen.getByTestId('inline-cell-editor');
      
      fireEvent.change(input, { target: { value: 'Jane' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onCellEdit).toHaveBeenCalledWith(0, 1, 'name', 'Jane');
    });

    it('shows row as deleted with strikethrough', () => {
      render(
        <table><tbody>
          <GridRow
            row={row}
            rowIndex={0}
            columns={columns}
            isRowDeleted={true}
          />
        </tbody></table>
      );

      const tr = screen.getByTestId('row-0');
      expect(tr).toHaveClass('marked-for-deletion');
    });

    it('opens row context menu on row number right-click', () => {
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

      // Find the row-number-cell specifically (not the data cell with value 1)
      const rowNumberCell = screen.getByTestId('row-0').querySelector('.row-number-cell')!;
      fireEvent.contextMenu(rowNumberCell);

      // The context menu callback gets (event, rowIndex, colIndex) — row number has no colIndex
      expect(onContextMenu).toHaveBeenCalled();
      const call = onContextMenu.mock.calls[0];
      expect(call[1]).toBe(0); // rowIndex
      expect(call[2]).toBeUndefined(); // colIndex - row-level context
    });

    it('opens cell context menu on cell right-click', () => {
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

      fireEvent.contextMenu(screen.getByTestId('cell-0-1'));

      expect(onContextMenu).toHaveBeenCalled();
      const call = onContextMenu.mock.calls[0];
      expect(call[1]).toBe(0); // rowIndex
      expect(call[2]).toBe(1); // colIndex
    });

    it('marks individual cells as modified', () => {
      const isCellModified = vi.fn((_rowIdx: number, colIdx: number) => colIdx === 1);
      render(
        <table><tbody>
          <GridRow
            row={row}
            rowIndex={0}
            columns={columns}
            isCellModified={isCellModified}
          />
        </tbody></table>
      );

      const nameCell = screen.getByTestId('cell-0-1');
      expect(nameCell).toHaveClass('modified');

      const emailCell = screen.getByTestId('cell-0-2');
      expect(emailCell).not.toHaveClass('modified');
    });
  });
});
