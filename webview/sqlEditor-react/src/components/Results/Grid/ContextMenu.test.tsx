import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../../test/testUtils';
import { ContextMenu, ContextMenuItem, buildCellMenuItems } from './ContextMenu';

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
});
