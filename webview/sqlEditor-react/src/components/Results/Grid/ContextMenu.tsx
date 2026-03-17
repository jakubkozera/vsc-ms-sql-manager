import { useEffect, useRef, useCallback, type RefObject } from 'react';
import './ContextMenu.css';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  separator?: boolean;
  shortcut?: string;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onSelect: (itemId: string) => void;
  onClose: () => void;
}

export function ContextMenu({ items, position, onSelect, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Keep a stable ref to onClose so document listeners never need to re-register
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Adjust position if menu would go off-screen
  const adjustedPosition = useCallback(() => {
    if (!menuRef.current) return position;
    
    const rect = menuRef.current.getBoundingClientRect();
    let { x, y } = position;
    
    if (x + rect.width > window.innerWidth) {
      x = window.innerWidth - rect.width - 8;
    }
    if (y + rect.height > window.innerHeight) {
      y = window.innerHeight - rect.height - 8;
    }
    
    return { x: Math.max(0, x), y: Math.max(0, y) };
  }, [position]);

  // Close on click outside — registered ONCE, uses ref to always call latest onClose.
  // The 0 ms delay avoids closing immediately from the right-click that opened the menu.
  useEffect(() => {
    const _menuRef: RefObject<HTMLDivElement> = menuRef;
    const handleClickOutside = (e: MouseEvent) => {
      if (_menuRef.current && !_menuRef.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps — registers once on mount, removed on unmount

  // Close on escape — registered ONCE
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on scroll — registered ONCE
  useEffect(() => {
    const handleScroll = () => onCloseRef.current();
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleItemClick = (item: ContextMenuItem) => {
    if (!item.disabled && !item.separator) {
      onSelect(item.id);
      onClose();
    }
  };

  const pos = adjustedPosition();

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: pos.x, top: pos.y }}
      data-testid="context-menu"
    >
      {items.map((item, index) => {
        if (item.separator) {
          return <div key={index} className="context-menu-separator" />;
        }

        return (
          <div
            key={item.id}
            className={`context-menu-item ${item.disabled ? 'disabled' : ''}`}
            onClick={() => handleItemClick(item)}
            data-testid={`context-menu-item-${item.id}`}
          >
            {item.icon && <span className="context-menu-icon">{item.icon}</span>}
            <span className="context-menu-label">{item.label}</span>
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </div>
        );
      })}
    </div>
  );
}

// Predefined menu items for grid context
export const ROW_CONTEXT_MENU_ITEMS: ContextMenuItem[] = [
  { id: 'copyRow', label: 'Copy Selection', shortcut: 'Ctrl+C' },
  { id: 'copyRowAsInsert', label: 'Copy as INSERT' },
  { id: 'separator1', label: '', separator: true },
  { id: 'deleteRow', label: 'Delete Row', shortcut: 'Del' },
  { id: 'separator2', label: '', separator: true },
  { id: 'selectAll', label: 'Select All', shortcut: 'Ctrl+A' },
];

export const COLUMN_CONTEXT_MENU_ITEMS: ContextMenuItem[] = [
  { id: 'sortAsc', label: 'Sort Ascending' },
  { id: 'sortDesc', label: 'Sort Descending' },
  { id: 'clearSort', label: 'Clear Sort' },
  { id: 'separator1', label: '', separator: true },
  { id: 'filter', label: 'Filter...' },
  { id: 'clearFilter', label: 'Clear Filter' },
  { id: 'separator2', label: '', separator: true },
  { id: 'pinColumn', label: 'Pin Column' },
  { id: 'unpinColumn', label: 'Unpin Column' },
  { id: 'separator3', label: '', separator: true },
  { id: 'copyColumn', label: 'Copy Column Values' },
];

export const CELL_CONTEXT_MENU_ITEMS: ContextMenuItem[] = [
  { id: 'copyCell', label: 'Copy Cell', shortcut: 'Ctrl+C' },
  { id: 'copyRow', label: 'Copy Selection' },
  { id: 'separator1', label: '', separator: true },
  { id: 'editCell', label: 'Edit Cell', shortcut: 'F2' },
  { id: 'setNull', label: 'Set to NULL' },
  { id: 'separator2', label: '', separator: true },
  { id: 'openInEditor', label: 'Open in Editor', disabled: true },
  { id: 'expandRelation', label: 'Expand FK Relation', disabled: true },
];

export const SELECTION_CONTEXT_MENU_ITEMS: ContextMenuItem[] = [
  { id: 'copySelection', label: 'Copy Selection', shortcut: 'Ctrl+C' },
  { id: 'copyAsCSV', label: 'Copy as CSV' },
  { id: 'copyAsJSON', label: 'Copy as JSON' },
  { id: 'separator1', label: '', separator: true },
  { id: 'exportSelection', label: 'Export Selection...' },
];

/**
 * Build context menu items for a column header right-click.
 */
export function buildColumnMenuItems(): ContextMenuItem[] {
  return [
    { id: 'copyColumnValues', label: 'Copy values' },
    { id: 'copyColumnValuesWithHeader', label: 'Copy values with header' },
    { id: 'separator1', label: '', separator: true },
    { id: 'selectAll', label: 'Select All', shortcut: 'Ctrl+A' },
  ];
}

/**
 * Build context menu items for a cell right-click.
 * "Set to NULL" is only included when the column is nullable.
 * When selectionSize > 1, bulk actions replace single-cell actions.
 */
export function buildCellMenuItems(options: {
  isEditable: boolean;
  isNullable?: boolean;
  isModified?: boolean;
  /** How many cells are currently selected (default 1 = single cell) */
  selectionSize?: number;
}): ContextMenuItem[] {
  const { isEditable, isNullable, isModified, selectionSize = 1 } = options;
  const hasMultiSelection = selectionSize > 1;

  const items: ContextMenuItem[] = [
    { id: 'copyCell', label: hasMultiSelection ? 'Copy Selection' : 'Copy Cell', shortcut: 'Ctrl+C' },
    // Only show "Copy Row" when it's a single-cell right-click; for multi-selection
    // "copyCell" already copies the whole selection so "copyRow" would be a duplicate.
    ...(!hasMultiSelection ? [{ id: 'copyRow', label: 'Copy Selection' } as ContextMenuItem] : []),
  ];

  if (isEditable) {
    items.push({ id: 'separator1', label: '', separator: true });

    if (hasMultiSelection) {
      // Bulk actions when multiple cells are selected
      items.push({ id: 'bulkEdit', label: `Fill ${selectionSize} cells…` });
      items.push({ id: 'setSelectionNull', label: `Set ${selectionSize} cells to NULL` });
    } else {
      // Single-cell actions
      items.push({ id: 'editCell', label: 'Edit Cell', shortcut: 'F2' });
      if (isNullable === true) {
        items.push({ id: 'setNull', label: 'Set to NULL' });
      }
      if (isModified) {
        items.push({ id: 'revertCell', label: 'Revert Cell' });
      }
    }

    items.push({ id: 'separator_del', label: '', separator: true });
    items.push({ id: 'deleteRow', label: 'Delete Row' });
  }

  items.push({ id: 'separator2', label: '', separator: true });
  items.push({ id: 'selectAll', label: 'Select All', shortcut: 'Ctrl+A' });
  return items;
}
