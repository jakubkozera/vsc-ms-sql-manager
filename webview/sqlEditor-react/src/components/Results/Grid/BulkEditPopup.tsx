import { useState, useEffect, useRef, useCallback } from 'react';
import './BulkEditPopup.css';

interface BulkEditPopupProps {
  /** Number of cells in the current selection */
  cellCount: number;
  /** Number of distinct columns covered by the selection */
  columnCount: number;
  position: { x: number; y: number };
  onApply: (value: string) => void;
  onClose: () => void;
}

export function BulkEditPopup({ cellCount, columnCount, position, onApply, onClose }: BulkEditPopupProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Adjust position if popup would go off screen
  const adjustedPos = useCallback(() => {
    if (!popupRef.current) return position;
    const rect = popupRef.current.getBoundingClientRect();
    let { x, y } = position;
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
    return { x: Math.max(0, x), y: Math.max(0, y) };
  }, [position]);

  // Close on outside click
  useEffect(() => {
    const id = setTimeout(() => {
      const handler = (e: MouseEvent) => {
        if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
          onClose();
        }
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, 0);
    return () => clearTimeout(id);
  }, [onClose]);

  // Close on Escape, apply on Enter
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onApply(value);
    }
  }, [value, onApply, onClose]);

  const pos = adjustedPos();

  const rowCount = Math.ceil(cellCount / columnCount);

  return (
    <div
      ref={popupRef}
      className="bulk-edit-popup"
      style={{ left: pos.x, top: pos.y }}
      data-testid="bulk-edit-popup"
    >
      <div className="bulk-edit-header">
        <span className="bulk-edit-title">Bulk Edit Cells</span>
        <button
          type="button"
          className="bulk-edit-close"
          onClick={onClose}
          aria-label="Close"
          data-testid="bulk-edit-close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6l-12 12" /><path d="M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="bulk-edit-content">
        <p className="bulk-edit-info">
          Apply a value to <strong>{cellCount}</strong> cell{cellCount !== 1 ? 's' : ''}
          {columnCount > 1 ? ` across ${columnCount} columns` : ''} in <strong>{rowCount}</strong> row{rowCount !== 1 ? 's' : ''}.
        </p>
        <input
          ref={inputRef}
          type="text"
          className="bulk-edit-input"
          placeholder="New value…"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          data-testid="bulk-edit-input"
          aria-label="New value for selected cells"
        />
        <div className="bulk-edit-actions">
          <button
            type="button"
            className="bulk-edit-btn bulk-edit-btn-cancel"
            onClick={onClose}
            data-testid="bulk-edit-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className="bulk-edit-btn bulk-edit-btn-apply"
            onClick={() => onApply(value)}
            data-testid="bulk-edit-apply"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
