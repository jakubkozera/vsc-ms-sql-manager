import { CSSProperties, useCallback, memo, useEffect } from 'react';
import { ColumnDef } from '../../../types/grid';
import { GridCell } from './GridCell';
import './GridRow.css';

interface GridRowProps {
  row: any[];
  rowIndex: number;
  columns: ColumnDef[];
  isSelected?: boolean;
  isCellSelected?: (rowIndex: number, colIndex: number) => boolean;
  isCellModified?: (rowIndex: number, colIndex: number) => boolean;
  isRowDeleted?: boolean;
  expandedColumns?: string[]; // Column names that are currently expanded
  calculatePinnedOffset?: (colIndex: number) => number;
  style?: CSSProperties;
  onClick?: (rowIndex: number, e: React.MouseEvent) => void;
  onCellClick?: (rowIndex: number, colIndex: number, value: any, e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent, rowIndex?: number, colIndex?: number) => void;
  onCellEdit?: (rowIndex: number, colIndex: number, columnName: string, newValue: unknown) => void;
  onFKExpand?: (rowIndex: number, colIndex: number, columnName: string, value: any) => void;
}

function GridRowComponent({ 
  row, 
  rowIndex, 
  columns,
  isSelected = false,
  isCellSelected,
  isCellModified,
  isRowDeleted = false,
  expandedColumns = [],
  calculatePinnedOffset,
  style,
  onClick,
  onCellClick,
  onContextMenu,
  onCellEdit,
  onFKExpand,
}: GridRowProps) {
  // DIAGNOSTIC LOG - only log first few rows when debugging
  useEffect(() => {
    if ((process.env.NODE_ENV === 'development' || (window as any).DEBUG_GRID) && rowIndex < 5) { // Only log first 5 rows to avoid console spam
      console.log('[GridRow RENDER]', { rowIndex, isSelected, columnsCount: columns.length, expandedColumnsCount: expandedColumns.length });
    }
  });

  const handleRowClick = useCallback((e: React.MouseEvent) => {
    onClick?.(rowIndex, e);
  }, [onClick, rowIndex]);

  const handleCellClick = useCallback((colIndex: number, value: any, e: React.MouseEvent) => {
    e.stopPropagation();
    onCellClick?.(rowIndex, colIndex, value, e);
  }, [onCellClick, rowIndex]);

  const handleContextMenu = useCallback((e: React.MouseEvent, colIndex?: number) => {
    onContextMenu?.(e, rowIndex, colIndex);
  }, [onContextMenu, rowIndex]);

  const handleCellEdit = useCallback((colIndex: number, columnName: string, newValue: unknown) => {
    onCellEdit?.(rowIndex, colIndex, columnName, newValue);
  }, [onCellEdit, rowIndex]);

  const handleFKExpand = useCallback((colIndex: number, columnName: string, value: any) => {
    onFKExpand?.(rowIndex, colIndex, columnName, value);
  }, [onFKExpand, rowIndex]);

  const rowClassName = [
    'grid-row',
    isSelected && 'selected',
    isRowDeleted && 'marked-for-deletion',
  ].filter(Boolean).join(' ');

  return (
    <tr 
      className={rowClassName} 
      data-testid={`row-${rowIndex}`}
      style={style}
      onClick={handleRowClick}
      onContextMenu={(e) => handleContextMenu(e)}
    >
      {/* Row number cell */}
      <td className="grid-cell row-number-cell">
        {rowIndex + 1}
      </td>

      {columns.map((column, colIndex) => {
        const cellSelected = isCellSelected?.(rowIndex, colIndex) || false;
        const cellModified = isCellModified?.(rowIndex, colIndex) || false;
        const isExpanded = expandedColumns.includes(column.name);
        const pinnedOffset = column.pinned && calculatePinnedOffset ? calculatePinnedOffset(colIndex) : undefined;
        
        return (
          <GridCell
            key={column.name}
            value={row[colIndex]}
            column={column}
            rowIndex={rowIndex}
            colIndex={colIndex}
            isSelected={cellSelected}
            isModified={cellModified}
            isDeleted={isRowDeleted}
            isEditable={!isRowDeleted}
            isExpanded={isExpanded}
            pinnedOffset={pinnedOffset}
            onClick={(e) => handleCellClick(colIndex, row[colIndex], e)}
            onContextMenu={(e) => handleContextMenu(e, colIndex)}
            onCellEdit={onCellEdit ? (newValue) => handleCellEdit(colIndex, column.name, newValue) : undefined}
            onFKExpand={onFKExpand ? (value) => handleFKExpand(colIndex, column.name, value) : undefined}
          />
        );
      })}
    </tr>
  );
}

// Custom comparison to prevent unnecessary re-renders
function arePropsEqual(prev: GridRowProps, next: GridRowProps): boolean {
  // Check if row data changed
  if (prev.rowIndex !== next.rowIndex) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.isRowDeleted !== next.isRowDeleted) return false;
  
  // Check if row values changed (shallow comparison)
  if (prev.row.length !== next.row.length) return false;
  for (let i = 0; i < prev.row.length; i++) {
    if (prev.row[i] !== next.row[i]) return false;
  }
  
  // Check if columns changed (just length and widths)
  if (prev.columns.length !== next.columns.length) return false;
  for (let i = 0; i < prev.columns.length; i++) {
    if (prev.columns[i].width !== next.columns[i].width) return false;
    if (prev.columns[i].pinned !== next.columns[i].pinned) return false;
  }
  
  // Check expanded columns
  if (prev.expandedColumns?.length !== next.expandedColumns?.length) return false;
  if (prev.expandedColumns && next.expandedColumns) {
    for (let i = 0; i < prev.expandedColumns.length; i++) {
      if (prev.expandedColumns[i] !== next.expandedColumns[i]) return false;
    }
  }
  
  // Style changes (top position is critical for virtual scrolling)
  if (prev.style?.top !== next.style?.top) return false;
  if (prev.style?.height !== next.style?.height) return false;
  
  return true;
}

export const GridRow = memo(GridRowComponent, arePropsEqual);
