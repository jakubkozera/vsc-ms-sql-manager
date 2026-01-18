import { CSSProperties, useCallback } from 'react';
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
  style?: CSSProperties;
  onClick?: (rowIndex: number, e: React.MouseEvent) => void;
  onCellClick?: (rowIndex: number, colIndex: number, value: any, e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent, rowIndex?: number, colIndex?: number) => void;
  onCellEdit?: (rowIndex: number, colIndex: number, columnName: string, newValue: unknown) => void;
  onFKExpand?: (rowIndex: number, colIndex: number, columnName: string) => void;
}

export function GridRow({ 
  row, 
  rowIndex, 
  columns,
  isSelected = false,
  isCellSelected,
  isCellModified,
  isRowDeleted = false,
  style,
  onClick,
  onCellClick,
  onContextMenu,
  onCellEdit,
  onFKExpand,
}: GridRowProps) {
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

  const handleFKExpand = useCallback((colIndex: number, columnName: string) => {
    onFKExpand?.(rowIndex, colIndex, columnName);
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
            onClick={(e) => handleCellClick(colIndex, row[colIndex], e)}
            onContextMenu={(e) => handleContextMenu(e, colIndex)}
            onCellEdit={onCellEdit ? (newValue) => handleCellEdit(colIndex, column.name, newValue) : undefined}
            onFKExpand={onFKExpand ? () => handleFKExpand(colIndex, column.name) : undefined}
          />
        );
      })}
    </tr>
  );
}
