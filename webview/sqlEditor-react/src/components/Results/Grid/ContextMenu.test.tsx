import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../../test/testUtils';
import { ContextMenu, ContextMenuItem, buildCellMenuItems, buildColumnMenuItems } from './ContextMenu';

// ---------------------------------------------------------------------------
// ContextMenu — outside-click & stable-listener regression tests
// ---------------------------------------------------------------------------
describe('ContextMenu — outside-click closes the menu', () => {
  it('calls onClose when mousedown fires outside the menu', async () => {
    const onClose = vi.fn();
    render(
      <ContextMenu
        items={[{ id: 'copy', label: 'Copy' }]}
        position={{ x: 100, y: 100 }}
        onSelect={vi.fn()}
        onClose={onClose}
      />
    );
    // Wait for the setTimeout(0) to register the listener
    await new Promise(r => setTimeout(r, 10));
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('does NOT call onClose when mousedown fires inside the menu', async () => {
    const onClose = vi.fn();
    render(
      <ContextMenu
        items={[{ id: 'copy', label: 'Copy' }]}
        position={{ x: 100, y: 100 }}
        onSelect={vi.fn()}
        onClose={onClose}
      />
    );
    await new Promise(r => setTimeout(r, 10));
    fireEvent.mouseDown(screen.getByText('Copy'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('always calls the LATEST onClose even after a re-render with a new lambda', async () => {
    // The parent re-renders and passes a new onClose lambda on every render.
    // Because we use a ref internally, the latest callback must always be invoked.
    let callCount = 0;
    const onClose1 = () => { callCount += 1; };
    const { rerender } = render(
      <ContextMenu
        items={[{ id: 'copy', label: 'Copy' }]}
        position={{ x: 100, y: 100 }}
        onSelect={vi.fn()}
        onClose={onClose1}
      />
    );
    const onClose2 = () => { callCount += 10; };
    rerender(
      <ContextMenu
        items={[{ id: 'copy', label: 'Copy' }]}
        position={{ x: 100, y: 100 }}
        onSelect={vi.fn()}
        onClose={onClose2}
      />
    );
    await new Promise(r => setTimeout(r, 10));
    fireEvent.keyDown(document, { key: 'Escape' });
    // onClose2 must have been called (increments by 10), not the stale onClose1
    expect(callCount).toBe(10);
  });
});

describe('ContextMenu', () => {
  const mockItems: ContextMenuItem[] = [
    { id: 'copy', label: 'Copy' },
    { id: 'separator1', label: '', separator: true },
    { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V' },
    { id: 'disabled', label: 'Disabled Option', disabled: true },
  ];

  const defaultProps = {
    items: mockItems,
    position: { x: 100, y: 100 },
    onSelect: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders menu items', () => {
    render(<ContextMenu {...defaultProps} />);
    
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Paste')).toBeInTheDocument();
    expect(screen.getByText('Disabled Option')).toBeInTheDocument();
  });

  it('renders separator', () => {
    render(<ContextMenu {...defaultProps} />);
    
    const separators = document.querySelectorAll('.context-menu-separator');
    expect(separators.length).toBeGreaterThan(0);
  });

  it('renders shortcut', () => {
    render(<ContextMenu {...defaultProps} />);
    
    expect(screen.getByText('Ctrl+V')).toBeInTheDocument();
  });

  it('calls onSelect when item clicked', () => {
    render(<ContextMenu {...defaultProps} />);
    
    fireEvent.click(screen.getByText('Copy'));
    
    expect(defaultProps.onSelect).toHaveBeenCalledWith('copy');
  });

  it('does not call onSelect for disabled items', () => {
    render(<ContextMenu {...defaultProps} />);
    
    fireEvent.click(screen.getByText('Disabled Option'));
    
    expect(defaultProps.onSelect).not.toHaveBeenCalled();
  });

  it('applies disabled class to disabled items', () => {
    render(<ContextMenu {...defaultProps} />);
    
    const disabledItem = screen.getByTestId('context-menu-item-disabled');
    expect(disabledItem).toHaveClass('disabled');
  });

  it('closes menu on Escape key', () => {
    render(<ContextMenu {...defaultProps} />);
    
    fireEvent.keyDown(document, { key: 'Escape' });
    
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});

describe('buildCellMenuItems - Set NULL visibility', () => {
  it('does not include setNull when column is not editable', () => {
    const items = buildCellMenuItems({ isEditable: false, isNullable: true });
    expect(items.find(i => i.id === 'setNull')).toBeUndefined();
  });

  it('does not include setNull when column is editable but not nullable', () => {
    const items = buildCellMenuItems({ isEditable: true, isNullable: false });
    expect(items.find(i => i.id === 'setNull')).toBeUndefined();
  });

  it('includes setNull when column is editable AND nullable', () => {
    const items = buildCellMenuItems({ isEditable: true, isNullable: true });
    expect(items.find(i => i.id === 'setNull')).toBeDefined();
  });

  it('does not include setNull when nullable is undefined (unknown)', () => {
    const items = buildCellMenuItems({ isEditable: true, isNullable: undefined });
    expect(items.find(i => i.id === 'setNull')).toBeUndefined();
  });

  it('always includes copyCell and copyRow regardless of editability', () => {
    const readOnly = buildCellMenuItems({ isEditable: false });
    expect(readOnly.find(i => i.id === 'copyCell')).toBeDefined();
    expect(readOnly.find(i => i.id === 'copyRow')).toBeDefined();

    const editable = buildCellMenuItems({ isEditable: true, isNullable: true });
    expect(editable.find(i => i.id === 'copyCell')).toBeDefined();
    expect(editable.find(i => i.id === 'copyRow')).toBeDefined();
  });

  it('includes editCell and deleteRow when editable, regardless of nullable', () => {
    const items = buildCellMenuItems({ isEditable: true, isNullable: false });
    expect(items.find(i => i.id === 'editCell')).toBeDefined();
    expect(items.find(i => i.id === 'deleteRow')).toBeDefined();
  });

  it('setNull appears between editCell and deleteRow', () => {
    const items = buildCellMenuItems({ isEditable: true, isNullable: true });
    const ids = items.filter(i => !i.separator).map(i => i.id);
    const editIdx = ids.indexOf('editCell');
    const nullIdx = ids.indexOf('setNull');
    const delIdx = ids.indexOf('deleteRow');
    expect(editIdx).toBeLessThan(nullIdx);
    expect(nullIdx).toBeLessThan(delIdx);
  });

  it('includes revertCell when cell is modified', () => {
    const items = buildCellMenuItems({ isEditable: true, isNullable: true, isModified: true });
    expect(items.find(i => i.id === 'revertCell')).toBeDefined();
  });

  it('does not include revertCell when cell is not modified', () => {
    const items = buildCellMenuItems({ isEditable: true, isNullable: true, isModified: false });
    expect(items.find(i => i.id === 'revertCell')).toBeUndefined();
  });

  it('does not include revertCell when not editable', () => {
    const items = buildCellMenuItems({ isEditable: false, isModified: true });
    expect(items.find(i => i.id === 'revertCell')).toBeUndefined();
  });
});

describe('buildColumnMenuItems', () => {
  it('returns copyColumnValues as first item', () => {
    const items = buildColumnMenuItems();
    const nonSep = items.filter(i => !i.separator);
    expect(nonSep[0].id).toBe('copyColumnValues');
    expect(nonSep[0].label).toBe('Copy values');
  });

  it('returns copyColumnValuesWithHeader as second item', () => {
    const items = buildColumnMenuItems();
    const nonSep = items.filter(i => !i.separator);
    expect(nonSep[1].id).toBe('copyColumnValuesWithHeader');
    expect(nonSep[1].label).toBe('Copy values with header');
  });

  it('returns selectAll before createChart', () => {
    const items = buildColumnMenuItems();
    const nonSep = items.filter(i => !i.separator);
    const selectAllIdx = nonSep.findIndex(i => i.id === 'selectAll');
    const createChartIdx = nonSep.findIndex(i => i.id === 'createChart');
    expect(selectAllIdx).toBeGreaterThanOrEqual(0);
    expect(createChartIdx).toBeGreaterThan(selectAllIdx);
  });

  it('does NOT include copyRow, copyRowAsInsert, or deleteRow', () => {
    const items = buildColumnMenuItems();
    const ids = items.map(i => i.id);
    expect(ids).not.toContain('copyRow');
    expect(ids).not.toContain('copyRowAsInsert');
    expect(ids).not.toContain('deleteRow');
  });

  it('has a separator between copy items and selectAll', () => {
    const items = buildColumnMenuItems();
    const sepIdx = items.findIndex(i => i.separator);
    const selectAllIdx = items.findIndex(i => i.id === 'selectAll');
    expect(sepIdx).toBeGreaterThan(0);
    expect(sepIdx).toBeLessThan(selectAllIdx);
  });
});

describe('column menu vs row menu differentiation', () => {
  it('buildCellMenuItems does not include copyColumnValues', () => {
    const items = buildCellMenuItems({ isEditable: false });
    const ids = items.map(i => i.id);
    expect(ids).not.toContain('copyColumnValues');
    expect(ids).not.toContain('copyColumnValuesWithHeader');
  });

  it('buildColumnMenuItems does not include copyCell or editCell', () => {
    const items = buildColumnMenuItems();
    const ids = items.map(i => i.id);
    expect(ids).not.toContain('copyCell');
    expect(ids).not.toContain('editCell');
    expect(ids).not.toContain('setNull');
  });

  it('buildCellMenuItems (editable) includes copyRow and deleteRow, not column copy actions', () => {
    const items = buildCellMenuItems({ isEditable: true, isNullable: false });
    const ids = items.map(i => i.id);
    expect(ids).toContain('copyRow');
    expect(ids).toContain('deleteRow');
    expect(ids).not.toContain('copyColumnValues');
  });
});

// ---------------------------------------------------------------------------
// buildCellMenuItems — bulk-selection actions (selectionSize > 1)
// ---------------------------------------------------------------------------
describe('buildCellMenuItems — bulk selection (selectionSize > 1)', () => {
  it('shows bulkEdit when selectionSize > 1 and grid is editable', () => {
    const items = buildCellMenuItems({ isEditable: true, selectionSize: 6 });
    expect(items.find(i => i.id === 'bulkEdit')).toBeDefined();
  });

  it('shows setSelectionNull when selectionSize > 1 and grid is editable', () => {
    const items = buildCellMenuItems({ isEditable: true, selectionSize: 3 });
    expect(items.find(i => i.id === 'setSelectionNull')).toBeDefined();
  });

  it('does NOT show editCell when selectionSize > 1', () => {
    const items = buildCellMenuItems({ isEditable: true, selectionSize: 4 });
    expect(items.find(i => i.id === 'editCell')).toBeUndefined();
  });

  it('does NOT show setNull (single-cell) when selectionSize > 1', () => {
    const items = buildCellMenuItems({ isEditable: true, isNullable: true, selectionSize: 4 });
    expect(items.find(i => i.id === 'setNull')).toBeUndefined();
  });

  it('does NOT show bulkEdit or setSelectionNull when grid is not editable', () => {
    const items = buildCellMenuItems({ isEditable: false, selectionSize: 5 });
    expect(items.find(i => i.id === 'bulkEdit')).toBeUndefined();
    expect(items.find(i => i.id === 'setSelectionNull')).toBeUndefined();
  });

  it('label of bulkEdit contains the cell count', () => {
    const items = buildCellMenuItems({ isEditable: true, selectionSize: 9 });
    const bulkEditItem = items.find(i => i.id === 'bulkEdit');
    expect(bulkEditItem?.label).toContain('9');
  });

  it('label of setSelectionNull contains the cell count', () => {
    const items = buildCellMenuItems({ isEditable: true, selectionSize: 12 });
    const nullItem = items.find(i => i.id === 'setSelectionNull');
    expect(nullItem?.label).toContain('12');
  });

  it('shows single-cell actions when selectionSize defaults to 1', () => {
    const items = buildCellMenuItems({ isEditable: true, isNullable: true });
    expect(items.find(i => i.id === 'editCell')).toBeDefined();
    expect(items.find(i => i.id === 'bulkEdit')).toBeUndefined();
  });

  it('shows single-cell actions when selectionSize is explicitly 1', () => {
    const items = buildCellMenuItems({ isEditable: true, isNullable: true, selectionSize: 1 });
    expect(items.find(i => i.id === 'editCell')).toBeDefined();
    expect(items.find(i => i.id === 'setNull')).toBeDefined();
    expect(items.find(i => i.id === 'bulkEdit')).toBeUndefined();
  });

  it('copyCell label says "Copy Selection" when selectionSize > 1', () => {
    const items = buildCellMenuItems({ isEditable: false, selectionSize: 5 });
    const copyCell = items.find(i => i.id === 'copyCell');
    expect(copyCell?.label).toBe('Copy Selection');
  });

  it('copyCell label says "Copy Cell" when selectionSize is 1', () => {
    const items = buildCellMenuItems({ isEditable: false, selectionSize: 1 });
    const copyCell = items.find(i => i.id === 'copyCell');
    expect(copyCell?.label).toBe('Copy Cell');
  });
});
