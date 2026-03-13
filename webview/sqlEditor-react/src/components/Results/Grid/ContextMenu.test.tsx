import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../../test/testUtils';
import { ContextMenu, ContextMenuItem, buildCellMenuItems, buildColumnMenuItems } from './ContextMenu';

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

  it('returns selectAll as last item', () => {
    const items = buildColumnMenuItems();
    const nonSep = items.filter(i => !i.separator);
    expect(nonSep[nonSep.length - 1].id).toBe('selectAll');
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
