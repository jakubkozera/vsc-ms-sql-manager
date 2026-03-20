import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ResultSetMetadata, ForeignKeyReference, RelationResultsMessage } from '../../../types/messages';
import { SortConfig, ColumnDef, FilterConfig, ExpandedRowState, getColumnFilterCategory } from '../../../types/grid';
import { useVirtualScroll } from '../../../hooks/useVirtualScroll';
import { useGridSelection } from '../../../hooks/useGridSelection';
import { GridHeader } from './GridHeader';
import { GridRow } from './GridRow';
import { ExpandedRow } from './ExpandedRow';
import { FilterPopup } from './FilterPopup';
import { ContextMenu, ContextMenuItem, ROW_CONTEXT_MENU_ITEMS, buildCellMenuItems, buildColumnMenuItems } from './ContextMenu';
import { ExportMenu } from './ExportMenu';
import { FKQuickPick } from './FKQuickPick';
import { BulkEditPopup } from './BulkEditPopup';
import { exportData, copyToClipboard, getFormatInfo, extractSelectedData, ExportFormat } from '../../../services/exportService';
import { useVSCode } from '../../../context/VSCodeContext';
import './DataGrid.css';

const ROW_HEIGHT = 30; // Match old grid implementation

export interface SelectionInfo {
  values: unknown[];
  rowCount: number;
  columnType?: string;
  sqlType?: string;
}

interface DataGridProps {
  data: any[];
  columns: string[];
  metadata?: ResultSetMetadata;
  resultSetIndex: number;
  isSingleResultSet?: boolean;
  onCellEdit?: (rowIndex: number, columnName: string, value: any) => void;
  onDeleteRow?: (rowIndex: number) => void;
  onRestoreRow?: (rowIndex: number) => void;
  onRevertCell?: (rowIndex: number, columnName: string) => void;
  isRowDeleted?: (rowIndex: number) => boolean;
  isCellModified?: (rowIndex: number, colIndex: number) => boolean;
  getValidationError?: (rowIndex: number, colIndex: number) => string | null;
  onSelectionChange?: (info: SelectionInfo) => void;
  onCreateChart?: (chartData: { columns: string[]; rows: unknown[][]; columnTypes: Record<string, string> }) => void;
}

export function DataGrid({ data, columns, metadata, resultSetIndex, isSingleResultSet = false, onCellEdit, onDeleteRow, onRestoreRow, onRevertCell, isRowDeleted, isCellModified, getValidationError, onSelectionChange, onCreateChart }: DataGridProps) {
  // State
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [filters, setFilters] = useState<Record<string, FilterConfig>>({});
  const [pinnedColumns, setPinnedColumns] = useState<Set<string>>(new Set());
  
  // Popups
  const [filterPopup, setFilterPopup] = useState<{ column: ColumnDef; position: { x: number; y: number } } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ items: ContextMenuItem[]; position: { x: number; y: number }; rowIndex?: number; colIndex?: number; isColumnHeader?: boolean } | null>(null);
  const [exportMenu, setExportMenu] = useState<{ position: { x: number; y: number } } | null>(null);
  const [bulkEditPopup, setBulkEditPopup] = useState<{ position: { x: number; y: number } } | null>(null);
  const [fkQuickPick, setFkQuickPick] = useState<{ 
    relations: ForeignKeyReference[]; 
    keyValue: any;
    rowIndex: number;
    colIndex: number;
    columnName: string;
  } | null>(null);
  const [expandedRows, setExpandedRows] = useState<Map<string, ExpandedRowState>>(new Map());
  const [isGridActive, setIsGridActive] = useState(false);

  // VS Code context
  const { 
    currentConnectionId, 
    currentDatabase, 
    dbSchema,
    postMessage,
    pendingExpansions,
  } = useVSCode();

  // Selection
  const {
    selection,
    selectRow,
    selectColumn,
    selectCell,
    extendToCell,
    clearSelection,
    isRowSelected,
    isColumnSelected,
    isCellSelected,
    getSelectedRowIndices,
    selectAllRows,
  } = useGridSelection();

  // Always-fresh ref to selection — avoids stale closures in event handlers
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // Drag-selection state
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

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
      
      // Derive isForeignKey from metadata's foreignKeyReferences
      const hasForeignKeyRefs = (colMeta?.foreignKeyReferences && colMeta.foreignKeyReferences.length > 0) || false;
      
      // Also check dbSchema.foreignKeys (like old grid.js) for FK relationships
      // when the column metadata has source table info
      let hasSchemaFKRef = false;
      if (!hasForeignKeyRefs && colMeta?.sourceTable && colMeta?.sourceSchema && dbSchema?.foreignKeys) {
        hasSchemaFKRef = dbSchema.foreignKeys.some(
          (fk: any) => fk.fromTable === colMeta.sourceTable && 
                       fk.fromSchema === colMeta.sourceSchema && 
                       fk.fromColumn === name
        );
      }
      
      return {
        name,
        index,
        type,
        isPrimaryKey: colMeta?.isPrimaryKey || false,
        isForeignKey: colMeta?.isForeignKey || hasForeignKeyRefs || hasSchemaFKRef,
        width: width || 150,
        pinned: pinnedColumns.has(name),
      };
    });
  }, [columns, metadata, columnWidths, pinnedColumns, data, calculateOptimalWidth, dbSchema]);

  // Calculate left offset for pinned columns
  const calculatePinnedOffset = useCallback((colIndex: number): number => {
    let offset = 50; // Start after row number column
    for (let i = 0; i < colIndex; i++) {
      if (columnDefs[i].pinned) {
        offset += columnDefs[i].width;
      }
    }
    return offset;
  }, [columnDefs]);

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

  // Calculate total height including expanded rows
  const calculateTotalHeight = useCallback(() => {
    let height = sortedData.length * ROW_HEIGHT;
    expandedRows.forEach((expanded) => {
      if (!expanded.isLoading && !expanded.error) {
        const dataLength = expanded.data?.length || 0;
        const expandedHeight = dataLength > 0 
          ? Math.min((Math.min(dataLength, 5) * 30) + 40, 400)
          : 60;
        height += expandedHeight;
      } else {
        height += 60; // Loading or error state height
      }
    });
    return height;
  }, [sortedData.length, expandedRows]);

  // Calculate offset for a row based on expanded rows above it
  const getRowOffset = useCallback((rowIndex: number) => {
    let offset = rowIndex * ROW_HEIGHT;
    expandedRows.forEach((expanded) => {
      if (expanded.sourceRowIndex < rowIndex) {
        const dataLength = expanded.data?.length || 0;
        const expandedHeight = dataLength > 0 && !expanded.isLoading && !expanded.error
          ? Math.min((Math.min(dataLength, 5) * 30) + 40, 400)
          : 60;
        offset += expandedHeight;
      }
    });
    return offset;
  }, [expandedRows]);

  // Virtual scrolling (overscan 5 = 5 rows above + 5 below, matching old BUFFER_ROWS behavior)
  const { containerRef: virtualContainerRef, virtualItems } = useVirtualScroll({
    itemCount: sortedData.length,
    itemHeight: ROW_HEIGHT,
    overscan: 5,
  });

  const totalHeight = calculateTotalHeight();

  // Notify parent about selection changes for aggregation bar
  useEffect(() => {
    if (!onSelectionChange) return;

    if (!selection.type || selection.selections.length === 0) {
      onSelectionChange({ values: [], rowCount: 0 });
      return;
    }

    const values: unknown[] = [];
    let columnType: string | undefined;
    let sqlType: string | undefined;

    if (selection.type === 'column') {
      for (const sel of selection.selections) {
        if (sel.columnIndex === undefined) continue;
        if (!columnType) {
          const colMeta = metadata?.columns?.[sel.columnIndex];
          columnType = colMeta?.type || 'string';
          sqlType = colMeta?.type;
        }
        for (const row of sortedData) {
          values.push(Array.isArray(row) ? row[sel.columnIndex!] : row[columns[sel.columnIndex!]]);
        }
      }
      onSelectionChange({ values, rowCount: sortedData.length, columnType, sqlType });
    } else if (selection.type === 'cell') {
      for (const sel of selection.selections) {
        if (sel.cellValue !== undefined) {
          values.push(sel.cellValue);
        } else if (sel.rowIndex !== undefined && sel.columnIndex !== undefined) {
          const row = sortedData[sel.rowIndex];
          values.push(Array.isArray(row) ? row[sel.columnIndex] : row[columns[sel.columnIndex]]);
        }
      }
      onSelectionChange({ values, rowCount: selection.selections.length });
    } else if (selection.type === 'row') {
      const indices = getSelectedRowIndices();
      for (const idx of indices) {
        const row = sortedData[idx];
        if (row) {
          const rowValues = Array.isArray(row) ? row : columns.map(c => row[c]);
          values.push(...rowValues);
        }
      }
      onSelectionChange({ values, rowCount: indices.length });
    }
  }, [selection, sortedData, columns, metadata, onSelectionChange, getSelectedRowIndices]);

  // DIAGNOSTIC LOG: Check render frequency and virtual items (only in development or when DEBUG_GRID is set)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' || (window as any).DEBUG_GRID) {
      console.log('[DataGrid RENDER]', {
        resultSetIndex,
        totalRows: sortedData.length,
        virtualItemsCount: virtualItems.length,
        virtualRange: virtualItems.length > 0 ? `${virtualItems[0].index}-${virtualItems[virtualItems.length - 1].index}` : 'none',
        expandedRowsCount: expandedRows.size,
        filtersCount: Object.keys(filters).length,
        timestamp: Date.now()
      });
    }
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
    setContextMenu(null);
    selectRow(rowIndex, e.ctrlKey || e.metaKey, e.shiftKey);
  }, [selectRow]);

  const handleCellClick = useCallback((rowIndex: number, colIndex: number, value: any, e: React.MouseEvent) => {
    setContextMenu(null);
    selectCell(rowIndex, colIndex, value, e.ctrlKey || e.metaKey, e.shiftKey);
  }, [selectCell]);

  const handleCellMouseDown = useCallback((rowIndex: number, colIndex: number, e: React.MouseEvent) => {
    // Only start drag on primary button, not on right-click
    if (e.button !== 0) return;
    // If modifier keys are held let click handler handle it; drag is plain-mouse only
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault(); // prevent browser text selection during drag
    setContextMenu(null);
    isDraggingRef.current = true;
    setIsDragging(true);
    selectCell(rowIndex, colIndex, sortedData[rowIndex]?.[colIndex], false, false);
  }, [selectCell, sortedData]);

  const handleCellMouseEnter = useCallback((rowIndex: number, colIndex: number, _e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    extendToCell(rowIndex, colIndex);
  }, [extendToCell]);

  const handleCellEditInternal = useCallback((rowIndex: number, _: number, columnName: string, newValue: unknown) => {
    onCellEdit?.(rowIndex, columnName, newValue);
  }, [onCellEdit]);

  const handleFKExpand = useCallback((rowIndex: number, colIndex: number, columnName: string, value: any) => {
    const expandKey = `${resultSetIndex}-${rowIndex}-${columnName}`;
    
    // Check if already expanded - if so, collapse it
    if (expandedRows.has(expandKey)) {
      setExpandedRows(prev => {
        const next = new Map(prev);
        next.delete(expandKey);
        return next;
      });
      return;
    }

    // Get column metadata
    const colMeta = metadata?.columns?.[colIndex];
    console.log('[FK Expand] Column metadata:', { columnName, colIndex, colMeta, allMetadata: metadata });
    
    // Collect FK references from column metadata
    let fkRefs = colMeta?.foreignKeyReferences;
    
    // Fallback: check dbSchema.foreignKeys if column metadata has no FK refs
    if ((!fkRefs || fkRefs.length === 0) && colMeta?.sourceTable && colMeta?.sourceSchema && dbSchema?.foreignKeys) {
      const schemaFKs = dbSchema.foreignKeys
        .filter((fk: any) => fk.fromTable === colMeta.sourceTable && 
                             fk.fromSchema === colMeta.sourceSchema && 
                             fk.fromColumn === columnName)
        .map((fk: any) => ({
          schema: fk.toSchema,
          table: fk.toTable,
          column: fk.toColumn,
          isComposite: false,
          constraintName: fk.constraintName || '',
        }));
      if (schemaFKs.length > 0) {
        fkRefs = schemaFKs;
      }
    }
    
    if (!fkRefs || fkRefs.length === 0) {
      console.warn('[FK Expand] No FK references found for column:', columnName, 'colMeta:', colMeta);
      return;
    }

    console.log('[FK Expand] Found FK references:', fkRefs);

    // If only one FK reference, expand directly
    if (fkRefs.length === 1) {
      const relation = fkRefs[0];
      executeRelationExpansion(relation, value, rowIndex, columnName);
    } else {
      // Show quick pick for multiple relations
      setFkQuickPick({
        relations: fkRefs,
        keyValue: value,
        rowIndex,
        colIndex,
        columnName,
      });
    }
  }, [metadata, expandedRows, resultSetIndex, dbSchema]);

  const executeRelationExpansion = useCallback((
    relation: ForeignKeyReference,
    keyValue: any,
    rowIndex: number,
    columnName: string
  ) => {
    const expansionId = `exp_${Date.now()}_${Math.random()}`;
    const expandKey = `${resultSetIndex}-${rowIndex}-${columnName}`;
    
    // Build connection ID with database context
    const connId = currentConnectionId || '';
    const dbName = currentDatabase;
    
    let fullConnectionId = connId;
    if (connId && dbName && !connId.includes('::')) {
      fullConnectionId = `${connId}::${dbName}`;
    }

    // Add to expanded rows with loading state
    setExpandedRows(prev => {
      const next = new Map(prev);
      next.set(expandKey, {
        key: expandKey,
        expansionId,
        sourceRowIndex: rowIndex,
        columnName,
        isLoading: true,
      });
      return next;
    });

    // Send expansion request
    postMessage({
      type: 'expandRelation',
      expansionId,
      keyValue,
      schema: relation.schema,
      table: relation.table,
      column: relation.column,
      connectionId: fullConnectionId,
    });

    console.log('[FK Expansion] Requested:', { relation, keyValue, rowIndex, columnName });
  }, [currentConnectionId, currentDatabase, postMessage, resultSetIndex]);

  const handleFKQuickPickSelect = useCallback((relation: ForeignKeyReference) => {
    if (!fkQuickPick) return;
    
    setFkQuickPick(null);
    executeRelationExpansion(
      relation,
      fkQuickPick.keyValue,
      fkQuickPick.rowIndex,
      fkQuickPick.columnName
    );
  }, [fkQuickPick, executeRelationExpansion]);

  const handleFKQuickPickOpenQuery = useCallback((query: string) => {
    const connId = currentConnectionId || '';
    const dbName = currentDatabase;

    postMessage({
      type: 'openNewQuery',
      query,
      connectionId: connId,
      database: dbName || undefined,
    });

    setFkQuickPick(null);
  }, [currentConnectionId, currentDatabase, postMessage]);

  // Handle expansion results from extension
  useEffect(() => {
    if (!pendingExpansions) return;

    // Check for new expansion results
    pendingExpansions.forEach((result: RelationResultsMessage, expansionId: string) => {
      // Find the expanded row with this expansionId
      setExpandedRows(prev => {
        const next = new Map(prev);
        let foundKey: string | null = null;
        
        // Find which expanded row has this expansionId
        prev.forEach((expandedRow, key) => {
          if (expandedRow.expansionId === expansionId && expandedRow.isLoading) {
            foundKey = key;
          }
        });

        if (foundKey) {
          const existingRow = next.get(foundKey);
          if (existingRow) {
            next.set(foundKey, {
              ...existingRow,
              isLoading: false,
              data: result.resultSets?.[0] || [],
              metadata: result.metadata?.[0],
              columnNames: result.columnNames?.[0],
              error: result.error,
            });
          }
        }

        return next;
      });
    });
  }, [pendingExpansions]);

  // Selection-aware copy: respects cell / column / row selection types
  const handleCopy = useCallback(async () => {
    if (selection.type === 'cell' && selection.selections.length > 0) {
      // Collect unique rows and columns involved
      const rowIndices = [...new Set(selection.selections.map(s => s.rowIndex!))].sort((a, b) => a - b);
      const colIndices = [...new Set(selection.selections.map(s => s.columnIndex!))].sort((a, b) => a - b);
      // Build a 2-D text block: rows × cols, tab-separated
      const lines = rowIndices.map(r => {
        const row = sortedData[r];
        return colIndices.map(c => {
          const val = row?.[c];
          return val === null || val === undefined ? '' : String(val);
        }).join('\t');
      });
      await copyToClipboard(lines.join('\n'));
      return;
    }

    if (selection.type === 'column' && selection.selections.length > 0) {
      const colIndices = [...new Set(selection.selections.map(s => s.columnIndex!))].sort((a, b) => a - b);
      const { data: selectedData, columns: selectedCols } = extractSelectedData(
        sortedData,
        columnDefs,
        sortedData.map((_, i) => i),
        colIndices
      );
      const text = exportData(selectedData, selectedCols, { format: 'clipboard', includeHeaders: true });
      await copyToClipboard(text);
      return;
    }

    // Row selection or no selection → copy selected rows (fallback: all rows)
    const selectedIndices = getSelectedRowIndices();
    const { data: selectedData, columns: selectedCols } = extractSelectedData(
      sortedData,
      columnDefs,
      selectedIndices.length > 0 ? selectedIndices : sortedData.map((_, i) => i)
    );
    const text = exportData(selectedData, selectedCols, { format: 'clipboard', includeHeaders: true });
    await copyToClipboard(text);
  }, [sortedData, columnDefs, selection, getSelectedRowIndices]);

  // Copy a single cell value to clipboard
  const handleCopyCell = useCallback(async (rowIndex: number, colIndex: number) => {
    const row = sortedData[rowIndex];
    if (!row) return;
    const val = row[colIndex];
    const text = val === null || val === undefined ? '' : String(val);
    await copyToClipboard(text);
  }, [sortedData]);

  // Copy a single row as an INSERT statement
  const handleCopyRowAsInsert = useCallback(async (rowIndex: number) => {
    const row = sortedData[rowIndex];
    if (!row) return;
    const tableName = metadata?.sourceTable || 'TableName';
    const text = exportData([row], columnDefs, { format: 'insert', tableName });
    await copyToClipboard(text);
  }, [sortedData, columnDefs, metadata]);

  // Copy all values of a column (optionally with header)
  const handleCopyColumnValues = useCallback(async (colIndex: number, includeHeader: boolean) => {
    const colDef = columnDefs[colIndex];
    if (!colDef) return;
    const values = sortedData.map(row => {
      const val = row[colIndex];
      return val === null || val === undefined ? '' : String(val);
    });
    const text = includeHeader ? [colDef.name, ...values].join('\n') : values.join('\n');
    await copyToClipboard(text);
  }, [sortedData, columnDefs]);

  const handleExport = useCallback((format: ExportFormat, includeHeaders: boolean) => {
    const selectedIndices = getSelectedRowIndices();
    const hasRowSelection = selectedIndices.length > 0;

    // For cell-range selections also restrict to the selected columns
    let selectedColumnIndices: number[] | undefined;
    if (selection.type === 'cell' && selection.selections.length > 0) {
      const colSet = new Set(selection.selections.map(s => s.columnIndex!));
      selectedColumnIndices = Array.from(colSet).sort((a, b) => a - b);
    }
    
    const { data: exportDataSet, columns: exportCols } = extractSelectedData(
      sortedData,
      columnDefs,
      hasRowSelection ? selectedIndices : sortedData.map((_, i) => i),
      selectedColumnIndices,
    );
    
    const content = exportData(exportDataSet, exportCols, { format, includeHeaders });
    
    if (format === 'clipboard') {
      copyToClipboard(content);
    } else {
      const { extension } = getFormatInfo(format);
      const filename = `results.${extension}`;
      
      let fileType = 'Text';
      switch (format) {
        case 'json':
          fileType = 'JSON';
          break;
        case 'csv':
          fileType = 'CSV';
          break;
        case 'insert':
          fileType = 'SQL';
          break;
        case 'tsv':
          fileType = 'TSV';
          break;
        case 'markdown':
          fileType = 'Markdown';
          break;
        case 'xml':
          fileType = 'XML';
          break;
        case 'html':
          fileType = 'HTML';
          break;
      }
      
      postMessage({
        type: 'saveFile',
        content,
        defaultFileName: filename,
        fileType,
      });
    }
    
    setExportMenu(null);
  }, [sortedData, columnDefs, getSelectedRowIndices, postMessage]);

  // Build context menu items dynamically based on editability
  const isEditable = metadata?.isEditable ?? false;

  const buildRowContextMenuItems = useCallback((rowIdx: number): ContextMenuItem[] => {
    const isDeleted = isRowDeleted?.(rowIdx) ?? false;
    const items: ContextMenuItem[] = [
      { id: 'copyRow', label: 'Copy Selection', shortcut: 'Ctrl+C' },
      { id: 'copyRowAsInsert', label: 'Copy as INSERT' },
    ];

    if (isEditable) {
      items.push({ id: 'separator1', label: '', separator: true });
      if (isDeleted) {
        items.push({ id: 'restoreRow', label: 'Restore Row' });
      } else {
        items.push({ id: 'deleteRow', label: 'Delete Row', shortcut: 'Del' });
      }
    }

    items.push({ id: 'separator2', label: '', separator: true });
    items.push({ id: 'selectAll', label: 'Select All', shortcut: 'Ctrl+A' });
    items.push({ id: 'separator_chart', label: '', separator: true });
    items.push({ id: 'createChart', label: 'Create Chart…' });
    return items;
  }, [isEditable, isRowDeleted]);

  const buildCellContextMenuItems = useCallback((rowIndex?: number, colIndex?: number, selectionSize: number = 1): ContextMenuItem[] => {
    const colMeta = colIndex !== undefined ? metadata?.columns?.[colIndex] : undefined;
    const modified = (rowIndex !== undefined && colIndex !== undefined) ? (isCellModified?.(rowIndex, colIndex) ?? false) : false;
    return buildCellMenuItems({ isEditable, isNullable: colMeta?.isNullable, isModified: modified, selectionSize });
  }, [isEditable, metadata, isCellModified]);

  const handleColumnHeaderContextMenu = useCallback((colIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      items: buildColumnMenuItems(),
      position: { x: e.clientX, y: e.clientY },
      colIndex,
      isColumnHeader: true,
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, rowIndex?: number, colIndex?: number) => {
    e.preventDefault();

    // Read selection from ref — always has latest state, immune to stale closures
    const sel = selectionRef.current;
    const cellSelectionSize = sel.type === 'cell' ? sel.selections.length : 1;

    console.log('[ContextMenu] selection from ref:', {
      type: sel.type,
      selectionsLength: sel.selections.length,
      cellSelectionSize,
      rowIndex,
      colIndex,
    });

    let items: ContextMenuItem[];
    if (rowIndex !== undefined) {
      items = colIndex !== undefined ? buildCellContextMenuItems(rowIndex, colIndex, cellSelectionSize) : buildRowContextMenuItems(rowIndex);
    } else {
      items = ROW_CONTEXT_MENU_ITEMS;
    }
    
    setContextMenu({
      items,
      position: { x: e.clientX, y: e.clientY },
      rowIndex,
      colIndex,
    });
  }, [buildCellContextMenuItems, buildRowContextMenuItems]);

  // Track which cell to start editing via context menu
  const [editingCellFromMenu, setEditingCellFromMenu] = useState<{ rowIndex: number; colIndex: number } | null>(null);

  const handleContextMenuSelect = useCallback((itemId: string) => {
    const ctx = contextMenu;
    switch (itemId) {
      case 'copyCell': {
        if (ctx?.rowIndex !== undefined && ctx?.colIndex !== undefined) {
          handleCopyCell(ctx.rowIndex, ctx.colIndex);
        } else {
          handleCopy();
        }
        break;
      }
      case 'copyRow':
      case 'copySelection':
        handleCopy();
        break;
      case 'copyRowAsInsert': {
        if (ctx?.rowIndex !== undefined) {
          handleCopyRowAsInsert(ctx.rowIndex);
        } else {
          handleCopy();
        }
        break;
      }
      case 'copyAsCSV':
        handleExport('csv', true);
        break;
      case 'copyAsJSON':
        handleExport('json', true);
        break;
      case 'copyColumnValues': {
        if (ctx?.colIndex !== undefined) {
          handleCopyColumnValues(ctx.colIndex, false);
        }
        break;
      }
      case 'copyColumnValuesWithHeader': {
        if (ctx?.colIndex !== undefined) {
          handleCopyColumnValues(ctx.colIndex, true);
        }
        break;
      }
      case 'selectAll':
        selectAllRows(sortedData.length);
        break;
      case 'deleteRow': {
        if (ctx?.rowIndex !== undefined) {
          // Delete all selected rows if the clicked row is selected, otherwise just the clicked row
          const selectedIndices = getSelectedRowIndices();
          if (selectedIndices.includes(ctx.rowIndex) && selectedIndices.length > 1) {
            selectedIndices.forEach(idx => onDeleteRow?.(idx));
          } else {
            onDeleteRow?.(ctx.rowIndex);
          }
        }
        break;
      }
      case 'restoreRow': {
        if (ctx?.rowIndex !== undefined) {
          onRestoreRow?.(ctx.rowIndex);
        }
        break;
      }
      case 'editCell': {
        if (ctx?.rowIndex !== undefined && ctx?.colIndex !== undefined) {
          setEditingCellFromMenu({ rowIndex: ctx.rowIndex, colIndex: ctx.colIndex });
        }
        break;
      }
      case 'setNull': {
        if (ctx?.rowIndex !== undefined && ctx?.colIndex !== undefined) {
          const colName = columnDefs[ctx.colIndex]?.name;
          if (colName) {
            onCellEdit?.(ctx.rowIndex, colName, null);
          }
        }
        break;
      }
      case 'revertCell': {
        if (ctx?.rowIndex !== undefined && ctx?.colIndex !== undefined) {
          const colName = columnDefs[ctx.colIndex]?.name;
          if (colName) {
            onRevertCell?.(ctx.rowIndex, colName);
          }
        }
        break;
      }
      case 'setSelectionNull': {
        // Set all selected cells to NULL
        if (selection.type === 'cell') {
          for (const sel of selection.selections) {
            if (sel.rowIndex !== undefined && sel.columnIndex !== undefined) {
              const colName = columnDefs[sel.columnIndex]?.name;
              if (colName) onCellEdit?.(sel.rowIndex, colName, null);
            }
          }
        }
        break;
      }
      case 'bulkEdit': {
        // Open bulk-edit popup at the context menu position
        if (ctx) {
          setBulkEditPopup({ position: ctx.position });
        }
        break;
      }
      case 'createChart': {
        if (onCreateChart) {
          // Build column type map
          const columnTypes: Record<string, string> = {};
          for (const colDef of columnDefs) {
            columnTypes[colDef.name] = colDef.type;
          }

          // Use selected rows if available, otherwise all sorted data
          const selectedIndices = getSelectedRowIndices();
          const rows = selectedIndices.length > 0
            ? selectedIndices.map(idx => sortedData[idx]).filter(Boolean)
            : sortedData;

          onCreateChart({
            columns: columnDefs.map(c => c.name),
            rows: rows.map(row => [...row]),
            columnTypes,
          });
        }
        break;
      }
    }
    setContextMenu(null);
  }, [contextMenu, sortedData.length, selectAllRows, getSelectedRowIndices, onDeleteRow, onRestoreRow, onRevertCell, onCellEdit, columnDefs, handleCopy, handleCopyCell, handleCopyRowAsInsert, handleCopyColumnValues, handleExport, selection, onCreateChart, sortedData]);

  // Apply the bulk-edit value to all selected cells
  const handleBulkEditApply = useCallback((value: string) => {
    if (selection.type === 'cell') {
      for (const sel of selection.selections) {
        if (sel.rowIndex !== undefined && sel.columnIndex !== undefined) {
          const colName = columnDefs[sel.columnIndex]?.name;
          if (colName) onCellEdit?.(sel.rowIndex, colName, value);
        }
      }
    }
    setBulkEditPopup(null);
  }, [selection, columnDefs, onCellEdit]);

  // End drag on mouseup (document-level so we catch release outside grid)
  useEffect(() => {
    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
      }
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // Global keyboard shortcuts when grid is active
  useEffect(() => {
    if (!isGridActive) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;

      // Don't intercept when Monaco editor has focus
      if (activeElement) {
        let el: Element | null = activeElement;
        while (el) {
          if (el.classList.contains('monaco-editor') ||
              el.classList.contains('monaco-editor-background') ||
              el.id === 'editor-container') {
            return;
          }
          el = el.parentElement;
        }
      }

      // Don't intercept when a text input / inline editor has focus
      if (activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        (activeElement as HTMLElement).isContentEditable
      )) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'c') {
          e.preventDefault();
          handleCopy();
        } else if (e.key === 'a') {
          e.preventDefault();
          selectAllRows(sortedData.length);
        }
      } else if (e.key === 'F2') {
        // F2 → start editing the last clicked / selected cell
        if (isEditable && selection.lastClickedIndex?.rowIndex !== undefined &&
            selection.lastClickedIndex?.columnIndex !== undefined) {
          e.preventDefault();
          setEditingCellFromMenu({
            rowIndex: selection.lastClickedIndex.rowIndex,
            colIndex: selection.lastClickedIndex.columnIndex,
          });
        }
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isGridActive, handleCopy, selectAllRows, sortedData.length, isEditable, selection.lastClickedIndex]);

  const handleExportButtonClick = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setExportMenu({
      position: { x: rect.left, y: rect.bottom },
    });
  }, []);

  // Auto-fit all columns
  const handleAutoFit = useCallback(() => {
    // Reset all column widths to auto-calculated values
    const newWidths: Record<string, number> = {};
    columns.forEach((name, index) => {
      const columnData = sortedData.map(row => row[index]);
      const colMeta = metadata?.columns?.[index];
      const type = colMeta?.type || 'string';
      newWidths[name] = calculateOptimalWidth(name, columnData, type);
    });
    setColumnWidths(newWidths);
  }, [columns, sortedData, metadata, calculateOptimalWidth]);

  // Handle column selection (clicking on column header)
  const handleColumnSelect = useCallback((columnName: string, event: MouseEvent) => {
    const colIndex = columnDefs.findIndex(c => c.name === columnName);
    if (colIndex < 0) return;
    selectColumn(colIndex, event.ctrlKey || event.metaKey, event.shiftKey);
  }, [columnDefs, selectColumn]);

  // Keyboard shortcuts on the grid div itself
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
    } else if (e.key === 'F2') {
      if (isEditable && selection.lastClickedIndex?.rowIndex !== undefined &&
          selection.lastClickedIndex?.columnIndex !== undefined) {
        e.preventDefault();
        setEditingCellFromMenu({
          rowIndex: selection.lastClickedIndex.rowIndex,
          colIndex: selection.lastClickedIndex.columnIndex,
        });
      }
    }
  }, [handleCopy, selectAllRows, sortedData.length, clearSelection, isEditable, selection.lastClickedIndex]);

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
      className={`data-grid-container ${isSingleResultSet ? 'full-height' : ''} ${isDragging ? 'dragging-selection' : ''}`}
      data-testid="data-grid"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => handleContextMenu(e)}
      onClick={() => setIsGridActive(true)}
      onFocus={() => setIsGridActive(true)}
      onBlur={(e) => {
        // Only deactivate if focus is leaving the grid container entirely
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsGridActive(false);
        }
      }}
    >
      {/* Grid */}
      <div 
        className={`data-grid-scroll-container ${isSingleResultSet ? 'full-height' : ''}`}
        ref={virtualContainerRef}
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
            tableWidth={totalTableWidth}
            onSort={handleSort}
            onResize={handleColumnResize}
            onFilterClick={handleFilterClick}
            onPinColumn={handlePinColumn}
            onExportClick={handleExportButtonClick}
            onColumnSelect={handleColumnSelect}
            isColumnSelected={isColumnSelected}
            calculatePinnedOffset={calculatePinnedOffset}
            onColumnContextMenu={handleColumnHeaderContextMenu}
          />
          <tbody style={{ position: 'relative', height: totalHeight }}>
            {virtualItems.map((virtualRow) => {
              const rowData = sortedData[virtualRow.index];
              const isSelected = isRowSelected(virtualRow.index);
              const adjustedTop = getRowOffset(virtualRow.index);
              
              // Check if any column in this row is expanded
              const expandedForRow: string[] = [];
              expandedRows.forEach((_, key) => {
                if (key.startsWith(`${resultSetIndex}-${virtualRow.index}-`)) {
                  expandedForRow.push(key);
                }
              });
              
              const rowDeleted = isRowDeleted?.(virtualRow.index) ?? false;
              // Check if a cell in this row should start editing (from context menu)
              const editingCol = editingCellFromMenu?.rowIndex === virtualRow.index ? editingCellFromMenu.colIndex : undefined;
              
              return (
                <>
                  <GridRow
                    key={virtualRow.index}
                    row={rowData}
                    rowIndex={virtualRow.index}
                    columns={columnDefs}
                    isSelected={isSelected}
                    isCellSelected={isCellSelected}
                    isCellModified={isCellModified}
                    getValidationError={getValidationError}
                    isRowDeleted={rowDeleted}
                    expandedColumns={expandedForRow.map(k => k.split('-')[2])}
                    calculatePinnedOffset={calculatePinnedOffset}
                    editingColIndex={editingCol}
                    onEditingComplete={() => setEditingCellFromMenu(null)}
                    style={{
                      position: 'absolute',
                      top: adjustedTop,
                      height: virtualRow.size,
                      width: `${totalTableWidth}px`,
                    }}
                    onClick={handleRowClick}
                    onCellClick={handleCellClick}
                    onCellMouseDown={handleCellMouseDown}
                    onCellMouseEnter={handleCellMouseEnter}
                    onContextMenu={handleContextMenu}
                    onCellEdit={onCellEdit ? handleCellEditInternal : undefined}
                    onFKExpand={handleFKExpand}
                  />
                  {expandedForRow.map(expandKey => {
                    const expanded = expandedRows.get(expandKey);
                    if (!expanded) return null;
                    
                    return (
                      <tr 
                        key={expandKey}
                        className="expanded-row-container"
                        style={{
                          position: 'absolute',
                          top: adjustedTop + ROW_HEIGHT,
                          left: 0,
                          right: 0,
                          width: '100%',
                        }}
                      >
                        <td 
                          colSpan={columnDefs.length + 1} 
                          className="expanded-row-cell"
                          style={{ width: `${totalTableWidth}px` }}
                        >
                          <ExpandedRow
                            data={expanded.data || []}
                            metadata={expanded.metadata}
                            columnNames={expanded.columnNames}
                            isLoading={expanded.isLoading}
                            error={expanded.error}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </>
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
          distinctValues={(() => {
            const cat = getColumnFilterCategory(filterPopup.column.type);
            if (cat !== 'text' && cat !== 'guid') return undefined;
            const colIdx = columns.indexOf(filterPopup.column.name);
            if (colIdx === -1) return undefined;
            const vals = new Set<string>();
            const limit = 500;
            for (let i = 0; i < data.length && vals.size < limit; i++) {
              const v = data[i][colIdx];
              vals.add(v == null ? '(NULL)' : String(v));
            }
            return Array.from(vals).sort((a, b) => {
              if (a === '(NULL)') return -1;
              if (b === '(NULL)') return 1;
              return a.localeCompare(b);
            });
          })()}
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
          onAutoFit={handleAutoFit}
        />
      )}

      {bulkEditPopup && selection.type === 'cell' && (
        <BulkEditPopup
          cellCount={selection.selections.length}
          columnCount={new Set(selection.selections.map(s => s.columnIndex)).size}
          position={bulkEditPopup.position}
          onApply={handleBulkEditApply}
          onClose={() => setBulkEditPopup(null)}
        />
      )}

      {fkQuickPick && (
        <FKQuickPick
          relations={fkQuickPick.relations}
          keyValue={fkQuickPick.keyValue}
          dbSchema={dbSchema}
          onSelect={handleFKQuickPickSelect}
          onCancel={() => setFkQuickPick(null)}
          onOpenQuery={handleFKQuickPickOpenQuery}
        />
      )}
    </div>
  );
}

/**
 * Apply a filter to a value
 */
function applyFilter(value: any, filter: FilterConfig): boolean {
  const { type, value: filterValue, valueTo, caseSensitive, selectedValues } = filter;

  switch (type) {
    case 'isNull':
      return value === null || value === undefined;
    case 'isNotNull':
      return value !== null && value !== undefined;
    case 'equals':
      if (caseSensitive) return String(value) === String(filterValue);
      return String(value).toLowerCase() === String(filterValue).toLowerCase();
    case 'notEquals':
      if (caseSensitive) return String(value) !== String(filterValue);
      return String(value).toLowerCase() !== String(filterValue).toLowerCase();
    case 'contains': {
      const str = caseSensitive ? String(value) : String(value).toLowerCase();
      const search = caseSensitive ? String(filterValue) : String(filterValue).toLowerCase();
      return str.includes(search);
    }
    case 'notContains': {
      const str = caseSensitive ? String(value) : String(value).toLowerCase();
      const search = caseSensitive ? String(filterValue) : String(filterValue).toLowerCase();
      return !str.includes(search);
    }
    case 'startsWith': {
      const str = caseSensitive ? String(value) : String(value).toLowerCase();
      const search = caseSensitive ? String(filterValue) : String(filterValue).toLowerCase();
      return str.startsWith(search);
    }
    case 'endsWith': {
      const str = caseSensitive ? String(value) : String(value).toLowerCase();
      const search = caseSensitive ? String(filterValue) : String(filterValue).toLowerCase();
      return str.endsWith(search);
    }
    case 'regex':
      try {
        return new RegExp(String(filterValue), 'i').test(String(value));
      } catch {
        return true;
      }
    case 'greaterThan':
      return Number(value) > Number(filterValue);
    case 'lessThan':
      return Number(value) < Number(filterValue);
    case 'between':
      return Number(value) >= Number(filterValue) && Number(value) <= Number(valueTo);
    case 'dateEquals': {
      if (value == null) return false;
      const d = new Date(value);
      const fd = new Date(String(filterValue));
      return d.toDateString() === fd.toDateString();
    }
    case 'before': {
      if (value == null) return false;
      return new Date(value) < new Date(String(filterValue));
    }
    case 'after': {
      if (value == null) return false;
      return new Date(value) > new Date(String(filterValue));
    }
    case 'dateBetween': {
      if (value == null) return false;
      const dv = new Date(value);
      return dv >= new Date(String(filterValue)) && dv <= new Date(String(valueTo));
    }
    case 'boolTrue':
      return value === true || value === 1 || String(value).toLowerCase() === 'true';
    case 'boolFalse':
      return value === false || value === 0 || String(value).toLowerCase() === 'false';
    case 'boolAny': {
      if (!selectedValues || selectedValues.size === 0) return false;
      if (value === null || value === undefined) return selectedValues.has('null');
      const isTrue = value === true || value === 1 || String(value).toLowerCase() === 'true';
      return isTrue ? selectedValues.has('true') : selectedValues.has('false');
    }
    case 'in': {
      if (!selectedValues || selectedValues.size === 0) return false;
      const strVal = value == null ? '(NULL)' : String(value);
      return selectedValues.has(strVal);
    }
    default:
      return true;
  }
}
