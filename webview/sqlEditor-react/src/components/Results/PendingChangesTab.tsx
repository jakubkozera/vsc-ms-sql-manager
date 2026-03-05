import { useState } from 'react';
import { RowChange } from '../../hooks/usePendingChanges';
import './PendingChangesTab.css';

interface PendingChangesTabProps {
  changes: RowChange[];
  columns: string[];
  tableName?: string;
  schemaName?: string;
  primaryKeyColumns?: string[];
  onRevertRow: (rowIndex: number) => void;
  onRevertCell: (rowIndex: number, columnName: string) => void;
  onRevertAll: () => void;
  onCommit: () => void;
  onCommitRow?: (rowIndex: number) => void;
  onCommitCell?: (rowIndex: number, columnName: string) => void;
  onPreviewSql?: () => void;
  generateRowSql?: (rowChange: RowChange) => string;
}

function sqlEscape(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  const strValue = String(value);
  const trimmed = strValue.trim();
  if (trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === "'null'") return 'NULL';
  return `'${strValue.replace(/'/g, "''")}'`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'object') return JSON.stringify(value);
  const str = String(value);
  if (str.length > 50) return str.substring(0, 47) + '...';
  return str;
}

export function PendingChangesTab({
  changes,
  columns,
  tableName = 'Unknown',
  schemaName = 'dbo',
  primaryKeyColumns = [],
  onRevertRow,
  onRevertCell,
  onRevertAll,
  onCommit,
  onCommitRow,
  onCommitCell,
  onPreviewSql,
  generateRowSql,
}: PendingChangesTabProps) {
  const modifiedRows = changes.filter(c => !c.isDeleted && c.changes.size > 0);
  const deletedRows = changes.filter(c => c.isDeleted);
  
  const totalChanges = modifiedRows.length + deletedRows.length;
  const fullTableName = `${schemaName}.${tableName}`;

  // Build WHERE clause from PK values for a row
  const buildWhereClause = (rowChange: RowChange): string => {
    if (primaryKeyColumns.length === 0) return '';
    return primaryKeyColumns
      .map(pk => {
        const colIdx = columns.indexOf(pk);
        if (colIdx < 0) return '';
        return `[${pk}] = ${sqlEscape(rowChange.originalRow[colIdx])}`;
      })
      .filter(Boolean)
      .join(' AND ');
  };

  // Track expanded row groups (for rows with multiple changes)
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const toggleExpand = (rowIndex: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  };
  
  if (totalChanges === 0) {
    return (
      <div className="pending-changes-tab" data-testid="pending-changes-empty">
        <div className="no-pending-changes">No pending changes</div>
      </div>
    );
  }
  
  return (
    <div className="pending-changes-tab" data-testid="pending-changes-tab">
      <div id="pendingChangesContent">
        <div className="pending-changes-header">
          <div className="pending-changes-actions">
            <button className="icon-button" onClick={onCommit} title="Commit All">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2" />
                <path d="M12 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
                <path d="M14 4l0 4l-6 0l0 -4" />
              </svg>
            </button>
            <button className="icon-button" onClick={onRevertAll} title="Revert All">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 14l-4 -4l4 -4" />
                <path d="M8 14l-4 -4l4 -4" />
                <path d="M9 10h7a4 4 0 1 1 0 8h-1" />
              </svg>
            </button>
            {onPreviewSql && (
              <button className="icon-button" onClick={onPreviewSql} title="Preview SQL">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                  <path d="M5 20.25c0 .414 .336 .75 .75 .75h1.25a1 1 0 0 0 1 -1v-1a1 1 0 0 0 -1 -1h-1a1 1 0 0 1 -1 -1v-1a1 1 0 0 1 1 -1h1.25a.75 .75 0 0 1 .75 .75" />
                  <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
                  <path d="M18 15v6h2" />
                  <path d="M13 15a2 2 0 0 1 2 2v2a2 2 0 1 1 -4 0v-2a2 2 0 0 1 2 -2z" />
                  <path d="M14 20l1.5 1.5" />
                </svg>
              </button>
            )}
          </div>
          <div className="pending-changes-title">
            {totalChanges} Pending Change{totalChanges !== 1 ? 's' : ''}
          </div>
        </div>

        <div className="pending-changes-list">
          {modifiedRows.map(rowChange => {
            const whereClause = buildWhereClause(rowChange);
            const changeCount = rowChange.changes.size;
            const hasMultipleChanges = changeCount > 1;
            const isExpanded = expandedRows.has(rowChange.rowIndex);
            const sql = generateRowSql ? generateRowSql(rowChange) : '';

            return (
              <div key={`mod-${rowChange.rowIndex}`} className="change-item" data-testid={`change-row-${rowChange.rowIndex}`}>
                <div className="change-header">
                  <div className="change-location">
                    {hasMultipleChanges && (
                      <button
                        className="change-expand-btn"
                        onClick={() => toggleExpand(rowChange.rowIndex)}
                        data-testid={`expand-${rowChange.rowIndex}`}
                      >
                        <svg
                          className={`change-expand-icon ${isExpanded ? 'expanded' : ''}`}
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="var(--vscode-foreground)"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M6 9l6 6l6 -6" />
                        </svg>
                      </button>
                    )}
                    <div className="change-row-actions">
                      <button className="change-commit" onClick={() => onCommitRow ? onCommitRow(rowChange.rowIndex) : onCommit()} title="Commit">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2" />
                          <path d="M12 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
                          <path d="M14 4l0 4l-6 0l0 -4" />
                        </svg>
                      </button>
                      <button className="change-revert" onClick={() => onRevertRow(rowChange.rowIndex)} title="Revert">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 14l-4 -4l4 -4" />
                          <path d="M5 10h11a4 4 0 1 1 0 8h-1" />
                        </svg>
                      </button>
                    </div>
                    <span>{fullTableName} - {changeCount} change{changeCount > 1 ? 's' : ''} - Row WHERE {whereClause}</span>
                  </div>
                </div>

                {hasMultipleChanges ? (
                  isExpanded && (
                    <div className="change-details-expanded">
                      {Array.from(rowChange.changes.entries() as IterableIterator<[string, { original: unknown; new: unknown }]>).map(([colName, { original, new: newVal }]) => (
                        <div key={colName} className="change-detail-item">
                          <div className="change-detail-item-header">
                            <div className="change-detail-item-actions">
                              {onCommitCell && (
                                <button className="change-commit" onClick={() => onCommitCell(rowChange.rowIndex, colName)} title="Commit this change" style={{ padding: '4px' }}>
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2" />
                                    <path d="M12 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
                                    <path d="M14 4l0 4l-6 0l0 -4" />
                                  </svg>
                                </button>
                              )}
                              <button className="change-revert" onClick={() => onRevertCell(rowChange.rowIndex, colName)} title="Revert this change" style={{ padding: '4px' }}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M9 14l-4 -4l4 -4" />
                                  <path d="M5 10h11a4 4 0 1 1 0 8h-1" />
                                </svg>
                              </button>
                            </div>
                            <div className="change-detail-item-col">{colName}</div>
                          </div>
                          <div className="change-detail-item-values">
                            <div className="change-detail-label">Old:</div>
                            <div className="change-value-old">{formatValue(original)}</div>
                            <div className="change-detail-label">New:</div>
                            <div className="change-value-new">{formatValue(newVal)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="change-details">
                    {Array.from(rowChange.changes.entries() as IterableIterator<[string, { original: unknown; new: unknown }]>).map(([colName, { original, new: newVal }]) => (
                      <div key={colName} className="change-detail-row">
                        <span className="change-label">Column:</span>
                        <div className="change-value">{colName}</div>
                        <span className="change-label">Old value:</span>
                        <div className="change-value change-value-old">{formatValue(original)}</div>
                        <span className="change-label">New value:</span>
                        <div className="change-value change-value-new">{formatValue(newVal)}</div>
                      </div>
                    ))}
                  </div>
                )}

                {sql && <div className="change-sql">{sql}</div>}
              </div>
            );
          })}

          {deletedRows.map(rowChange => {
            const whereClause = buildWhereClause(rowChange);
            const sql = generateRowSql ? generateRowSql(rowChange) : '';

            return (
              <div key={`del-${rowChange.rowIndex}`} className="change-item change-item-delete" data-testid={`delete-row-${rowChange.rowIndex}`}>
                <div className="change-header">
                  <div className="change-location">
                    <div className="change-row-actions">
                      <button className="change-commit" onClick={() => onCommitRow ? onCommitRow(rowChange.rowIndex) : onCommit()} title="Delete Row">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 7l16 0" />
                          <path d="M10 11l0 6" />
                          <path d="M14 11l0 6" />
                          <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
                          <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
                        </svg>
                      </button>
                      <button className="change-revert" onClick={() => onRevertRow(rowChange.rowIndex)} title="Restore">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 14l-4 -4l4 -4" />
                          <path d="M5 10h11a4 4 0 1 1 0 8h-1" />
                        </svg>
                      </button>
                    </div>
                    <span>{fullTableName} - Row WHERE {whereClause}</span>
                  </div>
                </div>
                {sql && <div className="change-sql">{sql}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
