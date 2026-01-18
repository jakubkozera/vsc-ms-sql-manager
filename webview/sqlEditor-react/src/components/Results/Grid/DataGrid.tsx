import { useState, useMemo, useCallback } from 'react';
import { ResultSetMetadata } from '../../../types/messages';
import { SortConfig, ColumnDef, FilterConfig } from '../../../types/grid';
import { useVirtualScroll } from '../../../hooks/useVirtualScroll';
import { useGridSelection } from '../../../hooks/useGridSelection';
import { GridHeader } from './GridHeader';
import { GridRow } from './GridRow';
import { FilterPopup } from './FilterPopup';
import { ContextMenu, ContextMenuItem, CELL_CONTEXT_MENU_ITEMS, ROW_CONTEXT_MENU_ITEMS } from './ContextMenu';
import { ExportMenu } from './ExportMenu';
import { exportData, copyToClipboard, downloadFile, getFormatInfo, extractSelectedData, ExportFormat } from '../../../services/exportService';
import './DataGrid.css';

const ROW_HEIGHT = 30; // Match old grid implementation

interface DataGridProps {
  data: any[];
  columns: string[];
  metadata?: ResultSetMetadata;
  resultSetIndex: number;
  isSingleResultSet?: boolean;
  onCellEdit?: (rowIndex: number, columnName: string, value: any) => void;
}

export function DataGrid({ data, columns, metadata, resultSetIndex, isSingleResultSet = false, onCellEdit }: DataGridProps) {
  // State
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [filters, setFilters] = useState<Record<string, FilterConfig>>({});
  const [pinnedColumns, setPinnedColumns] = useState<Set<string>>(new Set());
  
  // Popups
  const [filterPopup, setFilterPopup] = useState<{ column: ColumnDef; position: { x: number; y: number } } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ items: ContextMenuItem[]; position: { x: number; y: number }; rowIndex?: number; colIndex?: number } | null>(null);
  const [exportMenu, setExportMenu] = useState<{ position: { x: number; y: number } } | null>(null);

  // Selection
  const {
    selectRow,
    selectCell,
    clearSelection,
    isRowSelected,
    isCellSelected,
    getSelectedRowIndices,
    selectAllRows,
  } = useGridSelection();

  // Computed selection count
  const selectedRowCount = useMemo(() => getSelectedRowIndices().length, [getSelectedRowIndices]);

  // Calculate optimal column width based on content
  const calculateOptimalWidth = useCallback((columnName: string, columnData: any[], type: string): number => {
    // Create temporary canvas for text measurement
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return 150;
    
    context.font = '13px var(--vscode-font-family, "Segoe UI", sans-serif)';
    
    // Measure header width
    const headerWidth = context.measureText(columnName).width;
    
    // Find longest content (sample up to 100 rows)
    let maxContentWidth = 0;
    const sampleSize = Math.min(100, columnData.length);
    const step = Math.max(1, Math.floor(columnData.length / sampleSize));
    
    for (let i = 0; i < columnData.length; i += step) {
      const value = columnData[i];
      let displayValue = '';
      
      if (value === null || value === undefined) {
        displayValue = 'NULL';
      } else if (type === 'boolean') {
        displayValue = value ? '✓' : '✗';
      } else if (type === 'number') {
        displayValue = typeof value === 'number' ? value.toLocaleString() : String(value);
      } else {
        displayValue = String(value);
      }
      
      const contentWidth = context.measureText(displayValue).width;
      if (contentWidth > maxContentWidth) {
        maxContentWidth = contentWidth;
      }
    }
    
    // Calculate optimal width with padding and icon space
    const padding = 32;
    const iconSpace = 80;
    const optimalWidth = Math.max(headerWidth + iconSpace, maxContentWidth + padding);
    
    // Set min/max bounds
    const minWidth = 80;
    const maxWidth = 450;
    const finalWidth = Math.min(Math.max(optimalWidth, minWidth), maxWidth);
    
    return Math.round(finalWidth);
  }, []);

  // Build column definitions
  const columnDefs: ColumnDef[] = useMemo(() => {
    return columns.map((name, index) => {
      const colMeta = metadata?.columns?.[index];
      const type = colMeta?.type || 'string';
      
      // Calculate width if not manually resized
      let width = columnWidths[name];
      if (!width && data.length > 0) {
        const columnData = data.map(row => row[index]);
        width = calculateOptimalWidth(name, columnData, type);
      }
      
      return {
        name,
        index,
        type,
        isPrimaryKey: colMeta?.isPrimaryKey || false,
        isForeignKey: colMeta?.isForeignKey || false,
        width: width || 150,
        pinned: pinnedColumns.has(name),
      };
    });
  }, [columns, metadata, columnWidths, pinnedColumns, data, calculateOptimalWidth]);

  // Apply filters to data
  const filteredData = useMemo(() => {
    if (Object.keys(filters).length === 0) return data;

    return data.filter(row => {
      return Object.entries(filters).every(([columnName, filter]) => {
        const colIndex = columns.indexOf(columnName);
        if (colIndex === -1) return true;
        
        const value = row[colIndex];
        return applyFilter(value, filter);
      });
    });
  }, [data, filters, columns]);

  // Sort filtered data
  const sortedData = useMemo(() => {
    if (!sortConfig) return filteredData;

    const { column, direction } = sortConfig;
    const columnIndex = columns.indexOf(column);
    if (columnIndex === -1) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aVal = a[columnIndex];
      const bVal = b[columnIndex];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return direction === 'asc' ? -1 : 1;
      if (bVal == null) return direction === 'asc' ? 1 : -1;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return direction === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      const comparison = aStr.localeCompare(bStr);
      return direction === 'asc' ? comparison : -comparison;
    });
  }, [filteredData, columns, sortConfig]);

  // Virtual scrolling
  const { containerRef: virtualContainerRef, virtualItems, totalHeight } = useVirtualScroll({
    itemCount: sortedData.length,
    itemHeight: ROW_HEIGHT,
    overscan: 10,
  });

  // Handlers
  const handleSort = useCallback((column: string) => {
    setSortConfig(current => {
      if (!current || current.column !== column) {
        return { column, direction: 'asc' };
      }
      if (current.direction === 'asc') {
        return { column, direction: 'desc' };
      }
      return null;
    });
  }, []);

  const handleColumnResize = useCallback((column: string, width: number) => {
    setColumnWidths(prev => ({ ...prev, [column]: width }));
  }, []);

  const handleFilterClick = useCallback((column: ColumnDef, e: React.MouseEvent) => {
    e.stopPropagation();
    setFilterPopup({
      column,
      position: { x: e.clientX, y: e.clientY },
    });
  }, []);

  const handleFilterApply = useCallback((filter: FilterConfig | null) => {
    if (!filterPopup) return;
    
    const columnName = filterPopup.column.name;
    setFilters(prev => {
      if (filter === null) {
        const { [columnName]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [columnName]: filter };
    });
    setFilterPopup(null);
  }, [filterPopup]);

  const handlePinColumn = useCallback((columnName: string) => {
    setPinnedColumns(prev => {
      const next = new Set(prev);
      if (next.has(columnName)) {
        next.delete(columnName);
      } else {
        next.add(columnName);
      }
      return next;
    });
  }, []);

  const handleRowClick = useCallback((rowIndex: number, e: React.MouseEvent) => {
    selectRow(rowIndex, e.ctrlKey || e.metaKey, e.shiftKey);
  }, [selectRow]);

  const handleCellClick = useCallback((rowIndex: number, colIndex: number, value: any, e: React.MouseEvent) => {
    selectCell(rowIndex, colIndex, value, e.ctrlKey || e.metaKey, e.shiftKey);
  }, [selectCell]);

  const handleCellEditInternal = useCallback((rowIndex: number, _: number, columnName: string, newValue: unknown) => {
    onCellEdit?.(rowIndex, columnName, newValue);
  }, [onCellEdit]);
  const handleFKExpand = useCallback((rowIndex: number, colIndex: number, columnName: string) => {
    // TODO: Implement FK expansion with FKQuickPick
    console.log('FK expand clicked:', { rowIndex, colIndex, columnName });
  }, []);
  const handleContextMenu = useCallback((e: React.MouseEvent, rowIndex?: number, colIndex?: number) => {
    e.preventDefault();
    
    const items = rowIndex !== undefined ? 
      (colIndex !== undefined ? CELL_CONTEXT_MENU_ITEMS : ROW_CONTEXT_MENU_ITEMS) :
      ROW_CONTEXT_MENU_ITEMS;
    
    setContextMenu({
      items,
      position: { x: e.clientX, y: e.clientY },
      rowIndex,
      colIndex,
    });
  }, []);

  const handleContextMenuSelect = useCallback((itemId: string) => {
    switch (itemId) {
      case 'copyCell':
      case 'copyRow':
      case 'copySelection':
        handleCopy();
        break;
      case 'copyAsCSV':
        handleExport('csv', true);
        break;
      case 'copyAsJSON':
        handleExport('json', true);
        break;
      case 'selectAll':
        selectAllRows(sortedData.length);
        break;
      case 'deleteRow':
        // TODO: Implement delete
        break;
      case 'editCell':
        // TODO: Implement inline edit
        break;
    }
  }, [sortedData.length, selectAllRows]);

  const handleCopy = useCallback(async () => {
    const selectedIndices = getSelectedRowIndices();
    const { data: selectedData, columns: selectedCols } = extractSelectedData(
      sortedData,
      columnDefs,
      selectedIndices.length > 0 ? selectedIndices : sortedData.map((_, i) => i)
    );
    
    const text = exportData(selectedData, selectedCols, { format: 'clipboard', includeHeaders: true });
    await copyToClipboard(text);
  }, [sortedData, columnDefs, getSelectedRowIndices]);

  const handleExport = useCallback((format: ExportFormat, includeHeaders: boolean) => {
    const selectedIndices = getSelectedRowIndices();
    const hasSelection = selectedIndices.length > 0;
    
    const { data: exportDataSet, columns: exportCols } = extractSelectedData(
      sortedData,
      columnDefs,
      hasSelection ? selectedIndices : sortedData.map((_, i) => i)
    );
    
    const content = exportData(exportDataSet, exportCols, { format, includeHeaders });
    
    if (format === 'clipboard') {
      copyToClipboard(content);
    } else {
      const { extension, mimeType } = getFormatInfo(format);
      const filename = `export_${resultSetIndex}_${new Date().toISOString().slice(0, 10)}.${extension}`;
      downloadFile(content, filename, mimeType);
    }
    
    setExportMenu(null);
  }, [sortedData, columnDefs, getSelectedRowIndices, resultSetIndex]);

  const handleExportButtonClick = useCallback((e: React.MouseEvent) => {
    setExportMenu({
      position: { x: e.clientX, y: e.clientY },
    });
  }, []);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'c') {
        e.preventDefault();
        handleCopy();
      } else if (e.key === 'a') {
        e.preventDefault();
        selectAllRows(sortedData.length);
      }
    } else if (e.key === 'Escape') {
      clearSelection();
    }
  }, [handleCopy, selectAllRows, sortedData.length, clearSelection]);

  // Empty state
  if (!data || data.length === 0) {
    return (
      <div className="data-grid-empty">
        <p>No data</p>
      </div>
    );
  }

  // Calculate total table width (all columns + row number column)
  const totalTableWidth = columnDefs.reduce((sum, col) => sum + col.width, 0) + 50;

  return (
    <div 
      className="data-grid-container" 
      data-testid="data-grid"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => handleContextMenu(e)}
    >
      {/* Grid */}
      <div 
        className={`data-grid-scroll-container ${isSingleResultSet ? 'full-height' : ''}`}
        ref={(el) => {
          // Merge refs
          (virtualContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }}
      >
        <table 
          className="data-grid-table"
          style={{
            width: `${totalTableWidth}px`,
            minWidth: `${totalTableWidth}px`
          }}
        >
          <GridHeader
            columns={columnDefs}
            sortConfig={sortConfig}
            filters={filters}
            onSort={handleSort}
            onResize={handleColumnResize}
            onFilterClick={handleFilterClick}
            onPinColumn={handlePinColumn}
            onExportClick={handleExportButtonClick}
          />
          <tbody style={{ position: 'relative', height: totalHeight }}>
            {virtualItems.map((virtualRow) => {
              const rowData = sortedData[virtualRow.index];
              const isSelected = isRowSelected(virtualRow.index);
              
              return (
                <GridRow
                  key={virtualRow.index}
                  row={rowData}
                  rowIndex={virtualRow.index}
                  columns={columnDefs}
                  isSelected={isSelected}
                  isCellSelected={isCellSelected}
                  style={{
                    position: 'absolute',
                    top: virtualRow.start,
                    height: virtualRow.size,
                    width: `${totalTableWidth}px`,
                  }}
                  onClick={handleRowClick}
                  onCellClick={handleCellClick}
                  onContextMenu={handleContextMenu}
                  onCellEdit={onCellEdit ? handleCellEditInternal : undefined}
                  onFKExpand={handleFKExpand}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Popups */}
      {filterPopup && (
        <FilterPopup
          columnName={filterPopup.column.name}
          columnType={filterPopup.column.type}
          currentFilter={filters[filterPopup.column.name]}
          position={filterPopup.position}
          onApply={handleFilterApply}
          onClose={() => setFilterPopup(null)}
        />
      )}

      {contextMenu && (
        <ContextMenu
          items={contextMenu.items}
          position={contextMenu.position}
          onSelect={handleContextMenuSelect}
          onClose={() => setContextMenu(null)}
        />
      )}

      {exportMenu && (
        <ExportMenu
          position={exportMenu.position}
          hasSelection={selectedRowCount > 0}
          onExport={handleExport}
          onClose={() => setExportMenu(null)}
        />
      )}
    </div>
  );
}

/**
 * Apply a filter to a value
 */
function applyFilter(value: any, filter: FilterConfig): boolean {
  const { type, value: filterValue, valueTo } = filter;

  switch (type) {
    case 'isNull':
      return value === null || value === undefined;
    case 'isNotNull':
      return value !== null && value !== undefined;
    case 'equals':
      return value == filterValue;
    case 'contains':
      return String(value).toLowerCase().includes(String(filterValue).toLowerCase());
    case 'startsWith':
      return String(value).toLowerCase().startsWith(String(filterValue).toLowerCase());
    case 'endsWith':
      return String(value).toLowerCase().endsWith(String(filterValue).toLowerCase());
    case 'greaterThan':
      return Number(value) > Number(filterValue);
    case 'lessThan':
      return Number(value) < Number(filterValue);
    case 'between':
      return Number(value) >= Number(filterValue) && Number(value) <= Number(valueTo);
    default:
      return true;
  }
}
