import { useState, useMemo, useCallback } from 'react';
import { ResultSetMetadata } from '../../../types/messages';
import { SortConfig, ColumnDef } from '../../../types/grid';
import { GridHeader } from './GridHeader';
import { GridRow } from './GridRow';
import './DataGrid.css';

interface DataGridProps {
  data: any[];
  columns: string[];
  metadata?: ResultSetMetadata;
  resultSetIndex: number;
}

export function DataGrid({ data, columns, metadata }: DataGridProps) {
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  // Build column definitions
  const columnDefs: ColumnDef[] = useMemo(() => {
    return columns.map((name, index) => {
      const colMeta = metadata?.columns?.[index];
      return {
        name,
        index,
        type: colMeta?.type || 'string',
        isPrimaryKey: colMeta?.isPrimaryKey || false,
        isForeignKey: colMeta?.isForeignKey || false,
        width: columnWidths[name] || 150,
      };
    });
  }, [columns, metadata, columnWidths]);

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortConfig) return data;

    const { column, direction } = sortConfig;
    const columnIndex = columns.indexOf(column);
    if (columnIndex === -1) return data;

    return [...data].sort((a, b) => {
      const aVal = a[columnIndex];
      const bVal = b[columnIndex];

      // Handle null/undefined
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return direction === 'asc' ? -1 : 1;
      if (bVal == null) return direction === 'asc' ? 1 : -1;

      // Compare
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return direction === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      const comparison = aStr.localeCompare(bStr);
      return direction === 'asc' ? comparison : -comparison;
    });
  }, [data, columns, sortConfig]);

  // Handle sort
  const handleSort = useCallback((column: string) => {
    setSortConfig(current => {
      if (!current || current.column !== column) {
        return { column, direction: 'asc' };
      }
      if (current.direction === 'asc') {
        return { column, direction: 'desc' };
      }
      return null; // Remove sort
    });
  }, []);

  // Handle column resize
  const handleColumnResize = useCallback((column: string, width: number) => {
    setColumnWidths(prev => ({ ...prev, [column]: width }));
  }, []);

  if (!data || data.length === 0) {
    return (
      <div className="data-grid-empty">
        <p>No data</p>
      </div>
    );
  }

  return (
    <div className="data-grid-container" data-testid="data-grid">
      <div className="data-grid-wrapper">
        <table className="data-grid-table">
          <GridHeader
            columns={columnDefs}
            sortConfig={sortConfig}
            onSort={handleSort}
            onResize={handleColumnResize}
          />
          <tbody>
            {sortedData.map((row, rowIndex) => (
              <GridRow
                key={rowIndex}
                row={row}
                rowIndex={rowIndex}
                columns={columnDefs}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
