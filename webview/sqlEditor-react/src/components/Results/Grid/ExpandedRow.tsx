import { useMemo, useState, useCallback } from 'react';
import { ResultSetMetadata } from '../../../types/messages';
import { ColumnDef } from '../../../types/grid';
import { GridHeader } from './GridHeader';
import { GridRow } from './GridRow';
import './ExpandedRow.css';

interface ExpandedRowProps {
  data: any[];
  metadata?: ResultSetMetadata;
  columnNames?: string[];
  isLoading: boolean;
  error?: string;
  onColumnResize?: (columnName: string, newWidth: number) => void;
}

export function ExpandedRow({ data, metadata, columnNames, isLoading, error, onColumnResize }: ExpandedRowProps) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  
  // Handle column resize for nested table
  const handleColumnResize = useCallback((columnName: string, newWidth: number) => {
    setColumnWidths(prev => ({ ...prev, [columnName]: newWidth }));
    onColumnResize?.(columnName, newWidth);
  }, [onColumnResize]);
  
  // Build column definitions for nested table
  const columns = useMemo(() => {
    if (columnNames && columnNames.length > 0) {
      return columnNames;
    }
    if (data.length > 0) {
      // Check if data is array of arrays or array of objects
      if (Array.isArray(data[0])) {
        // Array format - use indices as column names or metadata
        if (metadata?.columns) {
          return metadata.columns.map(col => col.name);
        }
        // Fallback to column indices
        return data[0].map((_, idx) => `Column ${idx + 1}`);
      } else {
        // Object format
        return Object.keys(data[0]);
      }
    }
    return [];
  }, [data, columnNames, metadata]);

  const columnDefs: ColumnDef[] = useMemo(() => {
    return columns.map((name, index) => {
      const colMeta = metadata?.columns?.[index];
      const width = columnWidths[name] || 150;
      return {
        name,
        index,
        type: colMeta?.type || 'string',
        width,
        isPrimaryKey: colMeta?.isPrimaryKey || false,
        isForeignKey: colMeta?.isForeignKey || false,
        pinned: false,
      };
    });
  }, [columns, metadata, columnWidths]);

  // Calculate dynamic height based on row count (max 5 rows)
  const rowHeight = 30;
  const headerHeight = 40;
  const maxVisibleRows = 5;
  const calculatedHeight = Math.min(
    (Math.min(data.length, maxVisibleRows) * rowHeight) + headerHeight,
    400
  );

  if (isLoading) {
    return (
      <div className="expanded-row-content loading">
        <div className="loader-spinner"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="expanded-row-content error">
        <span>Error: {error}</span>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="expanded-row-content empty">
        <span>No related data found</span>
      </div>
    );
  }

  // Calculate total table width
  const totalTableWidth = columnDefs.reduce((sum, col) => sum + col.width, 0) + 50;

  return (
    <div className="expanded-row-content" style={{ height: `${calculatedHeight}px` }}>
      <div className="nested-table-container">
        <table className="nested-table" style={{ width: `${totalTableWidth}px` }}>
          <GridHeader
            columns={columnDefs}
            sortConfig={null}
            filters={{}}
            onSort={() => {}}
            onResize={handleColumnResize}
            onFilterClick={() => {}}
            onPinColumn={() => {}}
            onExportClick={() => {}}
          />
          <tbody>
            {data.map((row, rowIndex) => (
              <GridRow
                key={rowIndex}
                row={row}
                rowIndex={rowIndex}
                columns={columnDefs}
                isSelected={false}
                isCellSelected={() => false}
                onClick={() => {}}
                onCellClick={() => {}}
                onContextMenu={() => {}}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
