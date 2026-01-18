import { useEffect, useRef, useCallback } from 'react';
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

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Use setTimeout to avoid immediate close from the right-click that opened the menu
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Close on scroll
  useEffect(() => {
    const handleScroll = () => onClose();
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [onClose]);

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
  { id: 'copyRow', label: 'Copy Row', shortcut: 'Ctrl+C' },
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
  { id: 'copyRow', label: 'Copy Row' },
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
