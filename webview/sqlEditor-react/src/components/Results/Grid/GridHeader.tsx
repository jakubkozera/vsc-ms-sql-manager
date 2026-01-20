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
  onColumnSelect?: (column: string, e: MouseEvent) => void;
  calculatePinnedOffset?: (colIndex: number) => number;
}

export function GridHeader({ 
  columns, 
  sortConfig, 
  filters = {},
  onSort, 
  onResize,
  onFilterClick,
  onPinColumn,
  onExportClick,
  onColumnSelect,
  calculatePinnedOffset,
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
          title="Click for export options and auto-fit columns"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="export-icon"
          >
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            <path d="M7 9l5-5l5 5" />
            <path d="M12 4v12" />
          </svg>
        </th>

        {columns.map((column, colIndex) => {
          const isSorted = sortConfig?.column === column.name;
          const isFiltered = hasFilter(column.name);
          const pinnedOffset = column.pinned && calculatePinnedOffset ? calculatePinnedOffset(colIndex) : undefined;
          
          return (
            <th
              key={column.name}
              className={`grid-header-cell ${resizingColumn === column.name ? 'resizing' : ''} ${column.pinned ? 'pinned' : ''}`}
              style={{ 
                width: `${column.width}px`,
                minWidth: `${column.width}px`,
                maxWidth: `${column.width}px`,
                ...(column.pinned && pinnedOffset !== undefined ? { left: `${pinnedOffset}px` } : {}),
              }}
              data-testid={`header-${column.name}`}
            >
              <div className="header-content">
                <span 
                  className="column-name"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Column click should select the column, not sort
                    if (onColumnSelect) {
                      onColumnSelect(column.name, e.nativeEvent);
                    }
                  }}
                  title={column.name}
                >
                  {column.name}
                </span>

                {/* Sort icon - right: 44px */}
                <span
                  className={`header-action-icon sort-icon ${isSorted ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSort(column.name);
                  }}
                  title="Sort"
                >
                  {isSorted ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--vscode-button-background, #0e639c)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: sortConfig?.direction === 'desc' ? 'rotate(180deg)' : 'none' }}>
                      <path d="M6 15l6 -6l6 6" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 9l4 -4l4 4m-4 -4v14" />
                      <path d="M21 15l-4 4l-4 -4m4 4v-14" />
                    </svg>
                  )}
                </span>

                {/* Pin icon - right: 24px */}
                <span
                  className={`header-action-icon pin-icon ${column.pinned ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onPinColumn) {
                      onPinColumn(column.name);
                    }
                  }}
                  title="Pin column"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={column.pinned ? 'var(--vscode-button-background, #0e639c)' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4" />
                    <path d="M9 15l-4.5 4.5" />
                    <path d="M14.5 4l5.5 5.5" />
                  </svg>
                </span>

                {/* Filter icon - right: 4px */}
                {onFilterClick && (
                  <span
                    className={`header-action-icon filter-icon ${isFiltered ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onFilterClick(column, e);
                    }}
                    title="Filter"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isFiltered ? 'var(--vscode-button-background, #0e639c)' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227z" />
                    </svg>
                  </span>
                )}
              </div>

              {/* Resize handle */}
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, column)}
              />
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
