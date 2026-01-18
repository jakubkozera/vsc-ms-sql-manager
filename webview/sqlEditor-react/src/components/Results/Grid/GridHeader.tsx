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
  onExportClick?: (e: React.MouseEvent) => void;
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
  onExportClick,
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
        {/* Row number column - click for export menu */}
        <th 
          className="grid-header-cell row-number-header" 
          style={{ width: 50 }}
          onClick={onExportClick}
          title="Click to export"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="export-icon">
            <path d="M11.5 1h-7a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zm0 13h-7V2h7v12z"/>
            <path d="M5.5 5h5v1h-5zM5.5 7h5v1h-5zM5.5 9h3v1h-3z"/>
          </svg>
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
                {column.isPrimaryKey && (
                  <span className="key-indicator pk" title="Primary Key">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7 14C5.9 14 5 13.1 5 12C5 10.9 5.9 10 7 10C8.1 10 9 10.9 9 12C9 13.1 8.1 14 7 14M12.6 10C11.8 7.7 9.6 6 7 6C3.7 6 1 8.7 1 12C1 15.3 3.7 18 7 18C9.6 18 11.8 16.3 12.6 14H16V18H20V14H23V10H12.6Z"/>
                    </svg>
                  </span>
                )}
                {column.isForeignKey && (
                  <span className="key-indicator fk" title="Foreign Key">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                  </span>
                )}
                {column.pinned && (
                  <span className="pin-indicator" title="Pinned">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/>
                    </svg>
                  </span>
                )}
                {column.name}
              </span>
              <div className="header-actions">
                {hasFilter(column.name) && (
                  <span className="filter-active-indicator" title="Filter active">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M14,12V19.88C14.04,20.18 13.94,20.5 13.71,20.71C13.32,21.1 12.69,21.1 12.3,20.71L10.29,18.7C10.06,18.47 9.96,18.16 10,17.87V12H9.97L4.21,4.62C3.87,4.19 3.95,3.56 4.38,3.22C4.57,3.08 4.78,3 5,3H19C19.22,3 19.43,3.08 19.62,3.22C20.05,3.56 20.13,4.19 19.79,4.62L14.03,12H14Z"/>
                    </svg>
                  </span>
                )}
                <span className="sort-indicator">{getSortIndicator(column.name)}</span>
                {onFilterClick && (
                  <button
                    className="filter-button"
                    onClick={(e) => onFilterClick(column, e)}
                    title="Filter column"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7 10l5 5 5-5z"/>
                    </svg>
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
