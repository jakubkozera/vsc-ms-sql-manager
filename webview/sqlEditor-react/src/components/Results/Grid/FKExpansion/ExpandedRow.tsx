import { useState } from 'react';
import { FKRelation } from './FKQuickPick';
import './ExpandedRow.css';

interface ExpandedRowProps {
  parentRowIndex: number;
  relation: FKRelation;
  data: unknown[][];
  columns: string[];
  isLoading: boolean;
  error?: string;
  onClose: () => void;
  onRowClick?: (rowIndex: number) => void;
}

export function ExpandedRow({
  parentRowIndex,
  relation,
  data,
  columns,
  isLoading,
  error,
  onClose,
  onRowClick,
}: ExpandedRowProps) {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };
  
  const sortedData = sortColumn
    ? [...data].sort((a, b) => {
        const colIndex = columns.indexOf(sortColumn);
        if (colIndex < 0) return 0;
        
        const aVal = a[colIndex];
        const bVal = b[colIndex];
        
        if (aVal === null) return sortDirection === 'asc' ? -1 : 1;
        if (bVal === null) return sortDirection === 'asc' ? 1 : -1;
        
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        }
        
        const aStr = String(aVal);
        const bStr = String(bVal);
        return sortDirection === 'asc' 
          ? aStr.localeCompare(bStr)
          : bStr.localeCompare(aStr);
      })
    : data;
  
  return (
    <tr className="expanded-row" data-testid={`expanded-row-${parentRowIndex}`}>
      <td colSpan={columns.length + 1}>
        <div className="expanded-content">
          <div className="expanded-header">
            <div className="expanded-title">
              <span className="expanded-icon">🔗</span>
              <span className="expanded-table-name">
                {relation.referencedSchema}.{relation.referencedTable}
              </span>
              <span className="expanded-relation-info">
                ({relation.columnName} → {relation.referencedColumn})
              </span>
            </div>
            <button className="expanded-close" onClick={onClose} title="Close">×</button>
          </div>
          
          {isLoading && (
            <div className="expanded-loading">
              <span className="loading-spinner" />
              Loading related data...
            </div>
          )}
          
          {error && (
            <div className="expanded-error">
              <span className="error-icon">⚠</span>
              {error}
            </div>
          )}
          
          {!isLoading && !error && data.length === 0 && (
            <div className="expanded-empty">No related records found</div>
          )}
          
          {!isLoading && !error && data.length > 0 && (
            <div className="expanded-table-container">
              <table className="expanded-table">
                <thead>
                  <tr>
                    <th className="row-number-header">#</th>
                    {columns.map(col => (
                      <th 
                        key={col} 
                        className="expanded-header-cell"
                        onClick={() => handleSort(col)}
                      >
                        <span className="header-text">{col}</span>
                        {sortColumn === col && (
                          <span className="sort-indicator">
                            {sortDirection === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedData.map((row, rowIdx) => (
                    <tr 
                      key={rowIdx}
                      className="expanded-data-row"
                      onClick={() => onRowClick?.(rowIdx)}
                    >
                      <td className="row-number-cell">{rowIdx + 1}</td>
                      {row.map((cell, cellIdx) => (
                        <td key={cellIdx} className="expanded-data-cell">
                          {formatCellValue(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          
          <div className="expanded-footer">
            <span className="row-count">{data.length} row{data.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </td>
    </tr>
  );
}

function formatCellValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="null-value">NULL</span>;
  }
  
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  
  if (typeof value === 'object') {
    try {
      const str = JSON.stringify(value);
      return str.length > 50 ? str.substring(0, 47) + '...' : str;
    } catch {
      return '[Object]';
    }
  }
  
  const str = String(value);
  return str.length > 100 ? str.substring(0, 97) + '...' : str;
}
