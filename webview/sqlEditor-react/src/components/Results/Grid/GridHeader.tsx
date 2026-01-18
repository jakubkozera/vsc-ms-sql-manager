import { useState, useRef, useCallback } from 'react';
import { ColumnDef, SortConfig, FilterConfig } from '../../../types/grid';
import './GridHeader.css';

interface GridHeaderProps {
  columns: ColumnDef[];
  sortConfig: SortConfig | null;
  filters?: Record<string, FilterConfig>;
  onSort: (column: string) => void;
  onResize: (column: string, width: number) => void;
  onFilterClick?: (column: ColumnDef, e: React.MouseEvent) => void;
  onPinColumn?: (column: string) => void;
}

export function GridHeader({ 
  columns, 
  sortConfig, 
  filters = {},
  onSort, 
  onResize,
  onFilterClick,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onPinColumn: _onPinColumn,
}: GridHeaderProps) {
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

  const hasFilter = (column: string) => {
    return column in filters;
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
            className={`grid-header-cell ${resizingColumn === column.name ? 'resizing' : ''} ${column.pinned ? 'pinned' : ''} ${hasFilter(column.name) ? 'has-filter' : ''}`}
            style={{ width: column.width }}
            onClick={() => onSort(column.name)}
            data-testid={`header-${column.name}`}
          >
            <div className="header-content">
              <span className="column-name">
                {column.isPrimaryKey && <span className="key-indicator pk" title="Primary Key">🔑</span>}
                {column.isForeignKey && <span className="key-indicator fk" title="Foreign Key">🔗</span>}
                {column.pinned && <span className="pin-indicator" title="Pinned">📌</span>}
                {column.name}
              </span>
              <div className="header-actions">
                {hasFilter(column.name) && (
                  <span className="filter-active-indicator" title="Filter active">🔍</span>
                )}
                <span className="sort-indicator">{getSortIndicator(column.name)}</span>
                {onFilterClick && (
                  <button
                    className="filter-button"
                    onClick={(e) => onFilterClick(column, e)}
                    title="Filter column"
                  >
                    ▼
                  </button>
                )}
              </div>
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
