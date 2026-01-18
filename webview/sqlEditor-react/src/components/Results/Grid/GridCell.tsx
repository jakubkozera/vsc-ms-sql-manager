import { useState, useMemo, useCallback } from 'react';
import { ColumnDef } from '../../../types/grid';
import { InlineCellEditor } from './InlineCellEditor';
import './GridCell.css';

interface GridCellProps {
  value: any;
  column: ColumnDef;
  rowIndex: number;
  colIndex: number;
  isSelected?: boolean;
  isModified?: boolean;
  isDeleted?: boolean;
  isEditable?: boolean;
  isExpanded?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onFKExpand?: (value: any, e: React.MouseEvent) => void;
  onCellEdit?: (newValue: unknown) => void;
}

export function GridCell({ 
  value, 
  column, 
  rowIndex, 
  colIndex,
  isSelected = false,
  isModified = false,
  isDeleted = false,
  isEditable = true,
  isExpanded = false,
  onClick,
  onContextMenu,
  onDoubleClick,
  onFKExpand,
  onCellEdit,
}: GridCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  // Determine cell type and format
  const { displayValue, cellType, isLongText } = useMemo(() => {
    if (value === null || value === undefined) {
      return { displayValue: 'NULL', cellType: 'null', isLongText: false };
    }

    if (typeof value === 'boolean') {
      return { displayValue: value ? 'true' : 'false', cellType: 'boolean', isLongText: false };
    }

    if (typeof value === 'number') {
      return { displayValue: String(value), cellType: 'number', isLongText: false };
    }

    if (value instanceof Date) {
      return { displayValue: value.toISOString(), cellType: 'date', isLongText: false };
    }

    // Check for JSON
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          JSON.parse(trimmed);
          return { displayValue: trimmed, cellType: 'json', isLongText: trimmed.length > 100 };
        } catch {
          // Not valid JSON
        }
      }

      // Check for XML
      if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
        return { displayValue: trimmed, cellType: 'xml', isLongText: trimmed.length > 100 };
      }
    }

    const strValue = String(value);
    return { 
      displayValue: strValue, 
      cellType: 'string', 
      isLongText: strValue.length > 100 
    };
  }, [value]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    onClick?.(e);
  }, [onClick]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onContextMenu?.(e);
  }, [onContextMenu]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (isEditable) {
      e.preventDefault();
      e.stopPropagation();
      setIsEditing(true);
    }
    onDoubleClick?.(e);
  }, [isEditable, onDoubleClick]);

  const handleEditSave = useCallback((newValue: unknown) => {
    setIsEditing(false);
    if (newValue !== value) {
      onCellEdit?.(newValue);
    }
  }, [value, onCellEdit]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleFKClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onFKExpand?.(value, e);
  }, [onFKExpand, value]);

  // Build class names
  const classNames = [
    'grid-cell',
    cellType,
    isLongText && 'long-text',
    isSelected && 'selected',
    isModified && 'modified',
    isDeleted && 'deleted',
    isEditing && 'editing',
    column.isPrimaryKey && 'pk-cell',
    column.isForeignKey && 'fk-cell',
  ].filter(Boolean).join(' ');

  // Render inline editor when editing
  if (isEditing) {
    return (
      <td
        className={classNames}
        style={{ 
          width: `${column.width}px`,
          minWidth: `${column.width}px`,
          maxWidth: `${column.width}px`
        }}
        data-testid={`cell-${rowIndex}-${colIndex}`}
      >
        <InlineCellEditor
          value={value}
          columnName={column.name}
          columnType={column.type}
          onSave={handleEditSave}
          onCancel={handleEditCancel}
        />
      </td>
    );
  }

  return (
    <td
      className={classNames}
      style={{ 
        width: `${column.width}px`,
        minWidth: `${column.width}px`,
        maxWidth: `${column.width}px`
      }}
      title={isLongText ? displayValue : undefined}
      data-testid={`cell-${rowIndex}-${colIndex}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
    >
      <span className="cell-content">{displayValue}</span>
      {isModified && <span className="cell-modified-indicator" title="Modified">●</span>}
      {(column.isForeignKey || column.isPrimaryKey) && value !== null && value !== undefined && (
        <span 
          className={`cell-expand-chevron ${isExpanded ? 'expanded' : ''}`}
          onClick={handleFKClick}
          title={column.isForeignKey ? "Expand foreign key" : "View related rows"}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </span>
      )}
    </td>
  );
}
