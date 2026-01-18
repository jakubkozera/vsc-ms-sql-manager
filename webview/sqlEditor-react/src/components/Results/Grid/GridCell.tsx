import { useMemo, useCallback } from 'react';
import { ColumnDef } from '../../../types/grid';
import './GridCell.css';

interface GridCellProps {
  value: any;
  column: ColumnDef;
  rowIndex: number;
  colIndex: number;
  isSelected?: boolean;
  isModified?: boolean;
  isDeleted?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onFKExpand?: (e: React.MouseEvent) => void;
}

export function GridCell({ 
  value, 
  column, 
  rowIndex, 
  colIndex,
  isSelected = false,
  isModified = false,
  isDeleted = false,
  onClick,
  onContextMenu,
  onDoubleClick,
  onFKExpand,
}: GridCellProps) {
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
    onDoubleClick?.(e);
  }, [onDoubleClick]);

  const handleFKClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onFKExpand?.(e);
  }, [onFKExpand]);

  // Build class names
  const classNames = [
    'grid-cell',
    cellType,
    isLongText && 'long-text',
    isSelected && 'selected',
    isModified && 'modified',
    isDeleted && 'deleted',
    column.isPrimaryKey && 'pk-cell',
    column.isForeignKey && 'fk-cell',
  ].filter(Boolean).join(' ');

  return (
    <td
      className={classNames}
      style={{ width: column.width }}
      title={isLongText ? displayValue : undefined}
      data-testid={`cell-${rowIndex}-${colIndex}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
    >
      <span className="cell-content">{displayValue}</span>
      {isModified && <span className="cell-modified-indicator" title="Modified">●</span>}
      {column.isForeignKey && value !== null && value !== undefined && (
        <button 
          className="fk-expand-button" 
          onClick={handleFKClick}
          title="Expand foreign key"
        >
          🔗
        </button>
      )}
    </td>
  );
}
