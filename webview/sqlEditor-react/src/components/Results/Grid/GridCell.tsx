import { useMemo } from 'react';
import { ColumnDef } from '../../../types/grid';
import './GridCell.css';

interface GridCellProps {
  value: any;
  column: ColumnDef;
  rowIndex: number;
  colIndex: number;
}

export function GridCell({ value, column, rowIndex, colIndex }: GridCellProps) {
  // Determine cell type and format
  const { displayValue, cellType, isLongText } = useMemo(() => {
    if (value === null || value === undefined) {
      return { displayValue: 'NULL', cellType: 'null', isLongText: false };
    }

    if (typeof value === 'boolean') {
      return { displayValue: value ? 'true' : 'false', cellType: 'boolean', isLongText: false };
    }

    if (typeof value === 'number') {
      return { displayValue: String(value), cellType: 'number', isLongText: false };
    }

    if (value instanceof Date) {
      return { displayValue: value.toISOString(), cellType: 'date', isLongText: false };
    }

    // Check for JSON
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          JSON.parse(trimmed);
          return { displayValue: trimmed, cellType: 'json', isLongText: trimmed.length > 100 };
        } catch {
          // Not valid JSON
        }
      }

      // Check for XML
      if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
        return { displayValue: trimmed, cellType: 'xml', isLongText: trimmed.length > 100 };
      }
    }

    const strValue = String(value);
    return { 
      displayValue: strValue, 
      cellType: 'string', 
      isLongText: strValue.length > 100 
    };
  }, [value]);

  return (
    <td
      className={`grid-cell ${cellType} ${isLongText ? 'long-text' : ''}`}
      style={{ width: column.width }}
      title={isLongText ? displayValue : undefined}
      data-testid={`cell-${rowIndex}-${colIndex}`}
    >
      <span className="cell-content">{displayValue}</span>
    </td>
  );
}
