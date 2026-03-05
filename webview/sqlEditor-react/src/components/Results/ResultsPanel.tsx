import { useState, useCallback, useEffect, useMemo } from 'react';
import { useVSCode } from '../../context/VSCodeContext';
import { usePendingChanges } from '../../hooks/usePendingChanges';
import { PendingChange } from '../../types/messages';
import { ResultsTabs } from './ResultsTabs';
import { MessagesTab } from './MessagesTab';
import { PendingChangesTab } from './PendingChangesTab';
import { DataGrid, SelectionInfo } from './Grid/DataGrid';
import { AggregationBar } from './Grid/AggregationBar';
import { QueryPlanView } from './QueryPlan/QueryPlanView';
import './ResultsPanel.css';

export type TabId = 'results' | 'messages' | 'plan' | 'pendingChanges';

function sqlEscape(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  const strValue = String(value);
  const trimmed = strValue.trim();
  if (trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === "'null'") return 'NULL';
  return `'${strValue.replace(/'/g, "''")}'`;
}

export function ResultsPanel() {
  const {
    lastResults,
    lastColumnNames,
    lastMetadata,
    lastMessages,
    lastPlanXml,
    lastError,
    lastErrorId,
    executionTime,
    rowsAffected,
    isExecuting,
    postMessage,
    currentConnectionId,
    currentDatabase,
    originalQuery,
  } = useVSCode();

  const [activeTab, setActiveTab] = useState<TabId>('results');

  // Pending changes
  const pendingChanges = usePendingChanges();

  // Listen for commitSuccess from extension
  useEffect(() => {
    const handleCommitSuccess = () => {
      pendingChanges.commitSuccess();
    };
    window.addEventListener('commitSuccess', handleCommitSuccess);
    return () => window.removeEventListener('commitSuccess', handleCommitSuccess);
  }, [pendingChanges.commitSuccess]);

  // Auto-show pending changes tab when changes exist
  useEffect(() => {
    // When changes are cleared (committed/reverted), switch back to results
    if (!pendingChanges.hasPendingChanges && activeTab === 'pendingChanges') {
      setActiveTab('results');
    }
  }, [pendingChanges.hasPendingChanges, activeTab]);

  // Auto-switch to messages when a commit fails:
  // If an error arrives while pending changes still exist, the commit failed → go to messages
  useEffect(() => {
    if (lastErrorId > 0 && pendingChanges.hasPendingChanges) {
      setActiveTab('messages');
    }
  }, [lastErrorId]);

  // Selection aggregation state
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo>({ values: [], rowCount: 0 });
  const handleSelectionChange = useCallback((info: SelectionInfo) => {
    setSelectionInfo(info);
  }, []);

  // Loading timer state
  const [loadingTime, setLoadingTime] = useState('00:00');
  const loadingStartRef = useState<number | null>(null);

  // Manage timer when executing
  useEffect(() => {
    let interval: any | null = null;
    if (isExecuting) {
      const start = Date.now();
      // store start in ref-like state to avoid lint warnings
      (loadingStartRef as any)[0] = start;
      interval = setInterval(() => {
        const elapsed = Date.now() - start;
        const seconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        const milliseconds = Math.floor((elapsed % 1000) / 100);
        setLoadingTime(`${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds}`);
      }, 100);
    } else {
      setLoadingTime('00:00');
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isExecuting]);

  // Handle cell edit from DataGrid
  const handleCellEdit = useCallback((resultSetIndex: number, rowIndex: number, columnName: string, columnIndex: number, originalRow: unknown[], originalValue: unknown, newValue: unknown) => {
    pendingChanges.editCell(resultSetIndex, rowIndex, columnName, columnIndex, originalRow, originalValue, newValue);
  }, [pendingChanges.editCell]);

  // Handle row delete from DataGrid
  const handleDeleteRow = useCallback((resultSetIndex: number, rowIndex: number, originalRow: unknown[]) => {
    pendingChanges.deleteRow(resultSetIndex, rowIndex, originalRow);
  }, [pendingChanges.deleteRow]);

  // Handle restore row
  const handleRestoreRow = useCallback((resultSetIndex: number, rowIndex: number) => {
    pendingChanges.restoreRow(resultSetIndex, rowIndex);
  }, [pendingChanges.restoreRow]);

  // Generate SQL statements from pending changes for a result set
  const generateSqlStatements = useCallback((resultSetIndex: number): string[] => {
    const meta = lastMetadata?.[resultSetIndex];
    if (!meta) return [];

    const columns = lastColumnNames?.[resultSetIndex] || [];
    const pkColumns = meta.primaryKeyColumns || [];
    const tableName = meta.sourceTable || '';
    const schemaName = meta.sourceSchema || 'dbo';
    const rowChanges = pendingChanges.getChangesForResultSet(resultSetIndex);
    const statements: string[] = [];

    for (const rowChange of rowChanges) {
      const pkValues: Record<string, any> = {};
      for (const pk of pkColumns) {
        const colIdx = columns.indexOf(pk);
        if (colIdx >= 0) {
          pkValues[pk] = rowChange.originalRow[colIdx];
        }
      }
      const whereClause = Object.entries(pkValues)
        .map(([col, val]) => `[${col}] = ${sqlEscape(val)}`)
        .join(' AND ');

      if (rowChange.isDeleted) {
        statements.push(`DELETE FROM [${schemaName}].[${tableName}] WHERE ${whereClause};`);
      } else if (rowChange.changes.size > 0) {
        const setClauses = Array.from(rowChange.changes.entries())
          .map(([col, vals]) => `    [${col}] = ${sqlEscape((vals as { original: unknown; new: unknown }).new)}`)
          .join(',\n');
        statements.push(`UPDATE [${schemaName}].[${tableName}]\nSET ${setClauses}\nWHERE ${whereClause};`);
      }
    }
    return statements;
  }, [lastMetadata, lastColumnNames, pendingChanges.getChangesForResultSet]);

  // Generate SQL for a single row change
  const generateRowSql = useCallback((resultSetIndex: number, rowChange: import('../../hooks/usePendingChanges').RowChange): string => {
    const meta = lastMetadata?.[resultSetIndex];
    if (!meta) return '';

    const columns = lastColumnNames?.[resultSetIndex] || [];
    const pkColumns = meta.primaryKeyColumns || [];
    const tableName = meta.sourceTable || '';
    const schemaName = meta.sourceSchema || 'dbo';

    const pkValues: Record<string, any> = {};
    for (const pk of pkColumns) {
      const colIdx = columns.indexOf(pk);
      if (colIdx >= 0) {
        pkValues[pk] = rowChange.originalRow[colIdx];
      }
    }
    const whereClause = Object.entries(pkValues)
      .map(([col, val]) => `[${col}] = ${sqlEscape(val)}`)
      .join(' AND ');

    if (rowChange.isDeleted) {
      return `DELETE FROM [${schemaName}].[${tableName}] WHERE ${whereClause};`;
    } else if (rowChange.changes.size > 0) {
      const setClauses = Array.from(rowChange.changes.entries())
        .map(([col, vals]) => `    [${col}] = ${sqlEscape((vals as { original: unknown; new: unknown }).new)}`)
        .join(',\n');
      return `UPDATE [${schemaName}].[${tableName}]\nSET ${setClauses}\nWHERE ${whereClause};`;
    }
    return '';
  }, [lastMetadata, lastColumnNames]);

  // Commit a single cell change
  const handleCommitCell = useCallback((resultSetIndex: number, rowIndex: number, columnName: string) => {
    const meta = lastMetadata?.[resultSetIndex];
    if (!meta || !currentConnectionId || !currentDatabase) return;

    const columns = lastColumnNames?.[resultSetIndex] || [];
    const pkColumns = meta.primaryKeyColumns || [];
    const tableName = meta.sourceTable || '';
    const schemaName = meta.sourceSchema || 'dbo';

    const rowChanges = pendingChanges.getChangesForResultSet(resultSetIndex);
    const rowChange = rowChanges.find(r => r.rowIndex === rowIndex);
    if (!rowChange) return;

    const cellChange = rowChange.changes.get(columnName);
    if (!cellChange) return;

    const pkValues: Record<string, any> = {};
    for (const pk of pkColumns) {
      const colIdx = columns.indexOf(pk);
      if (colIdx >= 0) pkValues[pk] = rowChange.originalRow[colIdx];
    }

    const whereClause = Object.entries(pkValues)
      .map(([col, val]) => `[${col}] = ${sqlEscape(val)}`)
      .join(' AND ');
    const statement = `UPDATE [${schemaName}].[${tableName}]\nSET     [${columnName}] = ${sqlEscape(cellChange.new)}\nWHERE ${whereClause};`;

    const changeMap: Record<string, { oldValue: any; newValue: any }> = {
      [columnName]: { oldValue: cellChange.original, newValue: cellChange.new },
    };

    postMessage({
      type: 'commitChanges',
      changes: [{ type: 'UPDATE', tableName, schemaName, primaryKeyValues: pkValues, changes: changeMap, rowIndex }],
      statements: [statement],
      connectionId: currentConnectionId,
      databaseName: currentDatabase,
      originalQuery: originalQuery || undefined,
    });
  }, [lastMetadata, lastColumnNames, currentConnectionId, currentDatabase, originalQuery, pendingChanges.getChangesForResultSet, postMessage]);

  // Preview SQL in new editor
  const handlePreviewSql = useCallback((resultSetIndex: number) => {
    const statements = generateSqlStatements(resultSetIndex);
    if (statements.length > 0) {
      postMessage({
        type: 'openInNewEditor',
        content: statements.join('\n\n'),
        language: 'sql',
      });
    }
  }, [generateSqlStatements, postMessage]);

  // Commit changes
  const handleCommit = useCallback((resultSetIndex: number) => {
    const meta = lastMetadata?.[resultSetIndex];
    if (!meta || !currentConnectionId || !currentDatabase) return;

    const columns = lastColumnNames?.[resultSetIndex] || [];
    const pkColumns = meta.primaryKeyColumns || [];
    const tableName = meta.sourceTable || '';
    const schemaName = meta.sourceSchema || 'dbo';

    const changes: PendingChange[] = [];
    const rowChanges = pendingChanges.getChangesForResultSet(resultSetIndex);
    const statements = generateSqlStatements(resultSetIndex);

    for (const rowChange of rowChanges) {
      if (rowChange.isDeleted) {
        const pkValues: Record<string, any> = {};
        for (const pk of pkColumns) {
          const colIdx = columns.indexOf(pk);
          if (colIdx >= 0) {
            pkValues[pk] = rowChange.originalRow[colIdx];
          }
        }
        changes.push({
          type: 'DELETE',
          tableName,
          schemaName,
          primaryKeyValues: pkValues,
          rowIndex: rowChange.rowIndex,
        });
      } else if (rowChange.changes.size > 0) {
        const pkValues: Record<string, any> = {};
        for (const pk of pkColumns) {
          const colIdx = columns.indexOf(pk);
          if (colIdx >= 0) {
            pkValues[pk] = rowChange.originalRow[colIdx];
          }
        }
        const changeMap: Record<string, { oldValue: any; newValue: any }> = {};
        for (const [colName, vals] of rowChange.changes) {
          changeMap[colName] = { oldValue: vals.original, newValue: vals.new };
        }
        changes.push({
          type: 'UPDATE',
          tableName,
          schemaName,
          primaryKeyValues: pkValues,
          changes: changeMap,
          rowIndex: rowChange.rowIndex,
        });
      }
    }

    if (changes.length > 0) {
      postMessage({
        type: 'commitChanges',
        changes,
        statements,
        connectionId: currentConnectionId,
        databaseName: currentDatabase,
        originalQuery: originalQuery || undefined,
      });
    }
  }, [lastMetadata, lastColumnNames, currentConnectionId, currentDatabase, originalQuery, pendingChanges.getChangesForResultSet, postMessage, generateSqlStatements]);

  // Determine which tabs have content
  const hasResults = lastResults && lastResults.length > 0;
  const hasMessages = lastMessages.length > 0 || !!lastError;
  const hasPlan = !!lastPlanXml;

  // Auto-switch to messages tab on error
  const handleTabChange = useCallback((tabId: TabId) => {
    setActiveTab(tabId);
  }, []);

  // Compute total row count from first result set
  const totalRowCount = hasResults ? lastResults![0].length : 0;

  const DATETIME_TYPES = ['date', 'datetime', 'datetime2', 'smalldatetime', 'time', 'datetimeoffset'];
  const isDatetimeSelection = !!selectionInfo.sqlType && DATETIME_TYPES.includes(selectionInfo.sqlType.toLowerCase());
  const hasSelection = selectionInfo.values.length > 0;

  // Helper to get the first editable result set index for pending changes tab
  const firstEditableIndex = useMemo(() => {
    if (!lastMetadata) return 0;
    return lastMetadata.findIndex(m => m.isEditable) ?? 0;
  }, [lastMetadata]);

  const pendingChangesCount = pendingChanges.state.totalChangedRows + pendingChanges.state.totalDeletedRows;

  return (
    <div className="results-panel">
      <AggregationBar
        selectedValues={selectionInfo.values}
        visible={isDatetimeSelection && hasSelection && activeTab === 'results'}
        columnType={selectionInfo.sqlType}
        rightAlign
      />
      <ResultsTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        hasResults={!!hasResults}
        hasMessages={hasMessages}
        hasPlan={hasPlan}
        resultSetCount={lastResults?.length || 0}
        rowCount={totalRowCount}
        selectedRowCount={selectionInfo.rowCount}
        selectedValues={selectionInfo.values}
        showInlineAggregation={hasSelection && !isDatetimeSelection}
        columnType={selectionInfo.sqlType}
        pendingChangesCount={pendingChangesCount}
        onQuickSave={pendingChangesCount > 0 ? () => handleCommit(firstEditableIndex) : undefined}
        sqlPreview={pendingChangesCount > 0 ? generateSqlStatements(firstEditableIndex).join('\n') : undefined}
      />

      <div className="results-content">
        {isExecuting && (
          <div className="loading">
            <div className="loading-spinner"></div>
            <div>Executing query...</div>
            <div className="loading-timer">{loadingTime}</div>
          </div>
        )}

        {activeTab === 'results' && hasResults && (
          <div className={`results-grids-container ${lastResults.length === 1 ? 'single-result' : ''}`}>
            {lastResults.map((data, index) => (
              <div key={index} className={`result-set-wrapper ${lastResults.length === 1 ? 'single-result' : ''}`}>
                <DataGrid
                  data={data}
                  columns={lastColumnNames?.[index] || []}
                  metadata={lastMetadata?.[index]}
                  resultSetIndex={index}
                  isSingleResultSet={lastResults.length === 1}
                  onSelectionChange={handleSelectionChange}
                  onCellEdit={(rowIndex, columnName, newValue) => {
                    const colIdx = (lastColumnNames?.[index] || []).indexOf(columnName);
                    const row = data[rowIndex];
                    const originalValue = row?.[colIdx];
                    handleCellEdit(index, rowIndex, columnName, colIdx, row, originalValue, newValue);
                    // Update data in place so the grid shows the new value
                    if (colIdx >= 0 && row) {
                      row[colIdx] = newValue;
                    }
                  }}
                  onDeleteRow={(rowIndex) => {
                    const row = data[rowIndex];
                    handleDeleteRow(index, rowIndex, row);
                  }}
                  onRestoreRow={(rowIndex) => {
                    handleRestoreRow(index, rowIndex);
                  }}
                  isRowDeleted={(rowIndex) => pendingChanges.isRowDeleted(index, rowIndex)}
                  isCellModified={(rowIndex, colIndex) => {
                    const colName = lastColumnNames?.[index]?.[colIndex];
                    return colName ? pendingChanges.isCellModified(index, rowIndex, colName) : false;
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {activeTab === 'results' && !hasResults && !isExecuting && (
          <div className="results-empty">
            <svg className="empty-icon-svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="3" y1="9" x2="21" y2="9"></line>
              <line x1="9" y1="21" x2="9" y2="9"></line>
            </svg>
            <p>Execute a query to see results</p>
            <p className="hint">Press F5 or Ctrl+Shift+E to run</p>
          </div>
        )}

        {activeTab === 'messages' && (
          <MessagesTab
            messages={lastMessages}
            error={lastError}
            executionTime={executionTime}
            rowsAffected={rowsAffected}
          />
        )}

        {activeTab === 'pendingChanges' && (
          <PendingChangesTab
            changes={pendingChanges.getChangesForResultSet(firstEditableIndex)}
            columns={lastColumnNames?.[firstEditableIndex] || []}
            tableName={lastMetadata?.[firstEditableIndex]?.sourceTable}
            schemaName={lastMetadata?.[firstEditableIndex]?.sourceSchema}
            primaryKeyColumns={lastMetadata?.[firstEditableIndex]?.primaryKeyColumns}
            onRevertRow={(rowIndex) => {
              // Restore original values in data array before reverting state
              const data = lastResults?.[firstEditableIndex];
              const columns = lastColumnNames?.[firstEditableIndex] || [];
              const rowChanges = pendingChanges.getChangesForResultSet(firstEditableIndex);
              const rc = rowChanges.find(c => c.rowIndex === rowIndex);
              if (rc && data?.[rowIndex]) {
                for (const [colName, vals] of rc.changes) {
                  const colIdx = columns.indexOf(colName);
                  if (colIdx >= 0) {
                    data[rowIndex][colIdx] = vals.original;
                  }
                }
              }
              pendingChanges.revertRow(firstEditableIndex, rowIndex);
            }}
            onRevertCell={(rowIndex, colName) => {
              // Restore original value in data array before reverting state
              const data = lastResults?.[firstEditableIndex];
              const columns = lastColumnNames?.[firstEditableIndex] || [];
              const rowChanges = pendingChanges.getChangesForResultSet(firstEditableIndex);
              const rc = rowChanges.find(c => c.rowIndex === rowIndex);
              if (rc && data?.[rowIndex]) {
                const change = rc.changes.get(colName);
                if (change) {
                  const colIdx = columns.indexOf(colName);
                  if (colIdx >= 0) {
                    data[rowIndex][colIdx] = change.original;
                  }
                }
              }
              pendingChanges.revertCell(firstEditableIndex, rowIndex, colName);
            }}
            onRevertAll={() => {
              // Restore all original values in data array before reverting state
              const data = lastResults?.[firstEditableIndex];
              const columns = lastColumnNames?.[firstEditableIndex] || [];
              const rowChanges = pendingChanges.getChangesForResultSet(firstEditableIndex);
              for (const rc of rowChanges) {
                if (data?.[rc.rowIndex]) {
                  for (const [colName, vals] of rc.changes) {
                    const colIdx = columns.indexOf(colName);
                    if (colIdx >= 0) {
                      data[rc.rowIndex][colIdx] = vals.original;
                    }
                  }
                }
              }
              pendingChanges.revertAll(firstEditableIndex);
            }}
            onCommit={() => handleCommit(firstEditableIndex)}
            onCommitRow={(_rowIndex) => handleCommit(firstEditableIndex)}
            onCommitCell={(rowIndex, columnName) => handleCommitCell(firstEditableIndex, rowIndex, columnName)}
            onPreviewSql={() => handlePreviewSql(firstEditableIndex)}
            generateRowSql={(rowChange) => generateRowSql(firstEditableIndex, rowChange)}
          />
        )}

        {activeTab === 'plan' && hasPlan && (
          <QueryPlanView planXml={lastPlanXml} />
        )}

        {activeTab === 'plan' && !hasPlan && (
          <div className="results-empty">
            <svg className="empty-icon-svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
            <p>No execution plan available</p>
            <p className="hint">Enable "With execution plan" before running</p>
          </div>
        )}
      </div>
    </div>
  );
}
