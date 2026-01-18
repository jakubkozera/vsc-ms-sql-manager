import { RowChange } from '../../hooks/usePendingChanges';
import './PendingChangesTab.css';

interface PendingChangesTabProps {
  changes: RowChange[];
  columns: string[];
  tableName?: string;
  onRevertRow: (rowIndex: number) => void;
  onRevertCell: (rowIndex: number, columnName: string) => void;
  onRevertAll: () => void;
  onCommit: () => void;
}

export function PendingChangesTab({
  changes,
  columns,
  tableName = 'Unknown',
  onRevertRow,
  onRevertCell,
  onRevertAll,
  onCommit,
}: PendingChangesTabProps) {
  const modifiedRows = changes.filter(c => !c.isDeleted && c.changes.size > 0);
  const deletedRows = changes.filter(c => c.isDeleted);
  
  const hasChanges = modifiedRows.length > 0 || deletedRows.length > 0;
  
  if (!hasChanges) {
    return (
      <div className="pending-changes-tab empty" data-testid="pending-changes-empty">
        <div className="empty-state">
          <span className="empty-icon">✓</span>
          <p>No pending changes</p>
          <p className="empty-hint">Double-click a cell to edit, or use context menu to delete rows</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="pending-changes-tab" data-testid="pending-changes-tab">
      <div className="changes-header">
        <div className="changes-summary">
          <span className="table-name">{tableName}</span>
          <span className="changes-count">
            {modifiedRows.length > 0 && (
              <span className="modified-count">{modifiedRows.length} modified</span>
            )}
            {deletedRows.length > 0 && (
              <span className="deleted-count">{deletedRows.length} deleted</span>
            )}
          </span>
        </div>
        <div className="changes-actions">
          <button 
            className="revert-all-button" 
            onClick={onRevertAll}
            title="Revert all changes"
          >
            Revert All
          </button>
          <button 
            className="commit-button" 
            onClick={onCommit}
            title="Commit changes to database"
          >
            Commit Changes
          </button>
        </div>
      </div>
      
      <div className="changes-list">
        {modifiedRows.map(rowChange => (
          <div key={`mod-${rowChange.rowIndex}`} className="change-item modified" data-testid={`change-row-${rowChange.rowIndex}`}>
            <div className="change-item-header">
              <span className="change-type">UPDATE</span>
              <span className="row-info">Row {rowChange.rowIndex + 1}</span>
              <button 
                className="revert-row-button"
                onClick={() => onRevertRow(rowChange.rowIndex)}
                title="Revert this row"
              >
                Revert
              </button>
            </div>
            <div className="change-details">
              {Array.from(rowChange.changes.entries() as IterableIterator<[string, { original: unknown; new: unknown }]>).map(([colName, { original, new: newVal }]) => (
                <div key={colName} className="cell-change">
                  <span className="column-name">{colName}:</span>
                  <span className="old-value" title={formatValue(original)}>
                    {formatDisplayValue(original)}
                  </span>
                  <span className="change-arrow">→</span>
                  <span className="new-value" title={formatValue(newVal)}>
                    {formatDisplayValue(newVal)}
                  </span>
                  <button
                    className="revert-cell-button"
                    onClick={() => onRevertCell(rowChange.rowIndex, colName)}
                    title="Revert this change"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
        
        {deletedRows.map(rowChange => (
          <div key={`del-${rowChange.rowIndex}`} className="change-item deleted" data-testid={`delete-row-${rowChange.rowIndex}`}>
            <div className="change-item-header">
              <span className="change-type">DELETE</span>
              <span className="row-info">Row {rowChange.rowIndex + 1}</span>
              <button 
                className="revert-row-button"
                onClick={() => onRevertRow(rowChange.rowIndex)}
                title="Restore this row"
              >
                Restore
              </button>
            </div>
            <div className="change-details">
              <div className="deleted-row-preview">
                {columns.slice(0, 5).map((col, idx) => (
                  <span key={col} className="deleted-value">
                    {col}: {formatDisplayValue(rowChange.originalRow[idx])}
                  </span>
                ))}
                {columns.length > 5 && <span className="more-columns">...</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      <div className="sql-preview">
        <div className="sql-preview-header">
          <span>SQL Preview</span>
        </div>
        <pre className="sql-code">
          {generateSqlPreview(modifiedRows, deletedRows, tableName, columns)}
        </pre>
      </div>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatDisplayValue(value: unknown): string {
  const str = formatValue(value);
  if (str.length > 30) {
    return str.substring(0, 27) + '...';
  }
  return str;
}

function formatSqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function generateSqlPreview(
  modifiedRows: RowChange[],
  deletedRows: RowChange[],
  tableName: string,
  columns: string[]
): string {
  const statements: string[] = [];
  
  // Generate UPDATE statements
  for (const rowChange of modifiedRows) {
    const setClauses = Array.from(rowChange.changes.entries() as IterableIterator<[string, { original: unknown; new: unknown }]>)
      .map(([col, { new: newVal }]) => `[${col}] = ${formatSqlValue(newVal)}`)
      .join(', ');
    
    // Use first column as a simple WHERE (in real usage, would use PK)
    const firstCol = columns[0];
    const firstVal = rowChange.originalRow[0];
    
    statements.push(`UPDATE [${tableName}] SET ${setClauses} WHERE [${firstCol}] = ${formatSqlValue(firstVal)};`);
  }
  
  // Generate DELETE statements
  for (const rowChange of deletedRows) {
    const firstCol = columns[0];
    const firstVal = rowChange.originalRow[0];
    
    statements.push(`DELETE FROM [${tableName}] WHERE [${firstCol}] = ${formatSqlValue(firstVal)};`);
  }
  
  return statements.join('\n') || '-- No changes to commit';
}
