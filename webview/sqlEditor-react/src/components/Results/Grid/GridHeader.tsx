import { useState, useRef, useCallback } from 'react';
import { ColumnDef, SortConfig } from '../../../types/grid';
import './GridHeader.css';

interface GridHeaderProps {
  columns: ColumnDef[];
  sortConfig: SortConfig | null;
  onSort: (column: string) => void;
  onResize: (column: string, width: number) => void;
}

export function GridHeader({ columns, sortConfig, onSort, onResize }: GridHeaderProps) {
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeStart = useCallback((e: React.MouseEvent, column: ColumnDef) => {
    e.preventDefault();
    e.stopPropagation();
    
    setResizingColumn(column.name);
    startXRef.current = e.clientX;
    startWidthRef.current = column.width;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const diff = moveEvent.clientX - startXRef.current;
      const newWidth = Math.max(50, startWidthRef.current + diff);
      onResize(column.name, newWidth);
    };

    const handleMouseUp = () => {
      setResizingColumn(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [onResize]);

  const getSortIndicator = (column: string) => {
    if (!sortConfig || sortConfig.column !== column) {
      return null;
    }
    return sortConfig.direction === 'asc' ? '▲' : '▼';
  };

  return (
    <thead className="grid-header">
      <tr>
        {/* Row number column */}
        <th className="grid-header-cell row-number-header" style={{ width: 50 }}>
          #
        </th>

        {columns.map((column) => (
          <th
            key={column.name}
            className={`grid-header-cell ${resizingColumn === column.name ? 'resizing' : ''}`}
            style={{ width: column.width }}
            onClick={() => onSort(column.name)}
            data-testid={`header-${column.name}`}
          >
            <div className="header-content">
              <span className="column-name">
                {column.isPrimaryKey && <span className="key-indicator pk" title="Primary Key">🔑</span>}
                {column.isForeignKey && <span className="key-indicator fk" title="Foreign Key">🔗</span>}
                {column.name}
              </span>
              <span className="sort-indicator">{getSortIndicator(column.name)}</span>
            </div>

            {/* Resize handle */}
            <div
              className="resize-handle"
              onMouseDown={(e) => handleResizeStart(e, column)}
            />
          </th>
        ))}
      </tr>
    </thead>
  );
}
