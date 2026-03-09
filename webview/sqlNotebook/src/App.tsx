import React, { useCallback, useEffect, useRef, useState } from 'react';
import { postMessage } from './vscode';
import { Notebook, Connection, CellState, TrackedCell, NotebookCell } from './types';
import Toolbar from './components/Toolbar';
import CodeCell from './components/CodeCell';
import MarkdownCell from './components/MarkdownCell';

const PrevIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 6l-6 6l6 6" />
  </svg>
);

const NextIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6l-6 6" />
  </svg>
);

let nextId = 1;
function generateCellId(): string {
  return `cell-${Date.now()}-${nextId++}`;
}

function cellsToTracked(cells: NotebookCell[]): TrackedCell[] {
  return cells.map(cell => ({ id: generateCellId(), cell }));
}

function trackedToNotebook(trackedCells: TrackedCell[], notebook: Notebook): Notebook {
  return {
    ...notebook,
    cells: trackedCells.map(tc => tc.cell),
  };
}

export default function App() {
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [trackedCells, setTrackedCells] = useState<TrackedCell[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnection, setSelectedConnection] = useState('');
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState('');
  const [showDatabaseSelector, setShowDatabaseSelector] = useState(false);
  const [cellStates, setCellStates] = useState<Map<string, CellState>>(
    new Map()
  );
  const [execCounter, setExecCounter] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Tracks newly inserted cell IDs so they start in edit mode (markdown) */
  const [newCellIds, setNewCellIds] = useState<Set<string>>(new Set());

  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackedCellsRef = useRef(trackedCells);
  trackedCellsRef.current = trackedCells;

  const scheduleSave = useCallback((cells: TrackedCell[]) => {
    if (!notebook) return;
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      const nb = trackedToNotebook(cells, notebook);
      postMessage({ type: 'updateNotebook', notebook: nb });
    }, 500);
  }, [notebook]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case 'loadNotebook':
          setNotebook(msg.notebook);
          setTrackedCells(cellsToTracked(msg.notebook.cells ?? []));
          setLoadError(null);
          break;

        case 'connections':
          setConnections(msg.connections);
          if (msg.connections.length > 0 && !selectedConnection) {
            const firstId = msg.connections[0].id;
            setSelectedConnection(firstId);
            postMessage({ type: 'switchConnection', connectionId: firstId });
          }
          break;

        case 'databasesList': {
          setDatabases(msg.databases ?? []);
          if (msg.selectedDatabase) {
            setSelectedDatabase(msg.selectedDatabase);
          } else if (msg.databases?.length > 0) {
            setSelectedDatabase(msg.databases[0]);
          }
          setShowDatabaseSelector(true);
          break;
        }

        case 'noDatabases':
          setDatabases([]);
          setShowDatabaseSelector(false);
          break;

        case 'cellResult': {
          const { cellIndex, result, error } = msg;
          // Find cell id by index
          const cellId = trackedCellsRef.current[cellIndex]?.id;
          if (!cellId) break;
          setCellStates((prev) => {
            const next = new Map(prev);
            next.set(cellId, {
              running: false,
              result,
              error,
              executionCount: prev.get(cellId)?.executionCount,
            });
            return next;
          });
          break;
        }

        case 'error':
          setLoadError(msg.message);
          break;
      }
    };

    window.addEventListener('message', handler);
    postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const executeCell = useCallback(
    (index: number, source: string) => {
      const cellId = trackedCells[index]?.id;
      if (!cellId) return;
      const count = execCounter + 1;
      setExecCounter(count);
      setCellStates((prev) => {
        const next = new Map(prev);
        next.set(cellId, { running: true, executionCount: count });
        return next;
      });
      postMessage({
        type: 'executeCell',
        cellIndex: index,
        source,
        connectionId: selectedConnection,
        database: selectedDatabase || undefined,
      });
    },
    [selectedConnection, selectedDatabase, execCounter, trackedCells]
  );

  const runAll = useCallback(() => {
    trackedCells.forEach((tc, i) => {
      if (tc.cell.cell_type === 'code') {
        const src = Array.isArray(tc.cell.source)
          ? tc.cell.source.join('')
          : tc.cell.source;
        executeCell(i, src);
      }
    });
  }, [trackedCells, executeCell]);

  const handleConnectionChange = useCallback((id: string) => {
    setSelectedConnection(id);
    setDatabases([]);
    setSelectedDatabase('');
    setShowDatabaseSelector(false);
    postMessage({ type: 'switchConnection', connectionId: id });
  }, []);

  const handleDatabaseChange = useCallback(
    (db: string) => {
      setSelectedDatabase(db);
      postMessage({
        type: 'switchDatabase',
        connectionId: selectedConnection,
        database: db,
      });
    },
    [selectedConnection]
  );

  // ── Cell CRUD operations ──

  const addCell = useCallback((type: 'code' | 'markdown', position?: number) => {
    const newCell: NotebookCell = {
      cell_type: type,
      source: '',
      metadata: {},
      ...(type === 'code' ? { outputs: [], execution_count: null } : {}),
    };
    const tracked: TrackedCell = { id: generateCellId(), cell: newCell };
    setNewCellIds(prev => new Set(prev).add(tracked.id));
    setTrackedCells(prev => {
      const next = [...prev];
      if (position !== undefined && position >= 0 && position < next.length) {
        next.splice(position + 1, 0, tracked);
      } else {
        next.push(tracked);
      }
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const deleteCell = useCallback((index: number) => {
    setTrackedCells(prev => {
      const next = [...prev];
      next.splice(index, 1);
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const moveCell = useCallback((index: number, direction: 'up' | 'down') => {
    setTrackedCells(prev => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const updateCellSource = useCallback((index: number, source: string) => {
    setTrackedCells(prev => {
      const next = [...prev];
      if (!next[index]) return prev;
      next[index] = {
        ...next[index],
        cell: { ...next[index].cell, source },
      };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const insertCellBelow = useCallback((index: number, type: 'code' | 'markdown') => {
    addCell(type, index);
  }, [addCell]);

  const clearResult = useCallback((index: number) => {
    const cellId = trackedCells[index]?.id;
    if (!cellId) return;
    setCellStates(prev => {
      const next = new Map(prev);
      next.delete(cellId);
      return next;
    });
  }, [trackedCells]);

  const clearAllResults = useCallback(() => {
    setCellStates(new Map());
  }, []);

  const hasResults = Array.from(cellStates.values()).some(s => s.result || s.error);

  if (loadError) {
    return (
      <div className="empty-state">
        <h2>Error Loading Notebook</h2>
        <p>{loadError}</p>
      </div>
    );
  }

  if (!notebook) {
    return (
      <div className="empty-state">
        <h2>Loading notebook...</h2>
      </div>
    );
  }

  return (
    <>
      <Toolbar
        connections={connections}
        selectedConnection={selectedConnection}
        onConnectionChange={handleConnectionChange}
        databases={databases}
        selectedDatabase={selectedDatabase}
        onDatabaseChange={handleDatabaseChange}
        showDatabaseSelector={showDatabaseSelector}
        onRunAll={runAll}
        onRefreshConnections={() => postMessage({ type: 'refreshConnections' })}
        onManageConnections={() => postMessage({ type: 'manageConnections' })}
        onAddCell={(type) => addCell(type)}
        onClearAllResults={clearAllResults}
        hasResults={hasResults}
        kernelName={notebook.metadata?.kernelspec?.display_name}
      />
      <div className="notebook-container">
        {trackedCells.length === 0 ? (
          <div className="empty-state">
            <h2>Empty Notebook</h2>
            <p>Click <strong>+ Cell</strong> in the toolbar to add a code or text cell.</p>
          </div>
        ) : (
          trackedCells.map((tc, i) => {
            const state = cellStates.get(tc.id);
            const isNew = newCellIds.has(tc.id);
            return tc.cell.cell_type === 'code' ? (
              <CodeCell
                key={tc.id}
                cell={tc.cell}
                index={i}
                running={state?.running ?? false}
                result={state?.result}
                error={state?.error}
                executionCount={state?.executionCount}
                onExecute={executeCell}
                hasConnection={!!selectedConnection}
                onSourceChange={updateCellSource}
                onDeleteCell={deleteCell}
                onMoveCell={moveCell}
                onInsertCellBelow={insertCellBelow}
                onClearResult={clearResult}
                isFirst={i === 0}
                isLast={i === trackedCells.length - 1}
              />
            ) : (
              <MarkdownCell
                key={tc.id}
                cell={tc.cell}
                index={i}
                onSourceChange={updateCellSource}
                onDeleteCell={deleteCell}
                onMoveCell={moveCell}
                onInsertCellBelow={insertCellBelow}
                isFirst={i === 0}
                isLast={i === trackedCells.length - 1}
                startInEditMode={isNew}
              />
            );
          })
        )}
      </div>
      <div className="notebook-nav">
        <button
          className="notebook-nav-btn"
          onClick={() => postMessage({ type: 'navigateNotebook', direction: 'previous' })}
        >
          <PrevIcon /> Previous
        </button>
        <button
          className="notebook-nav-btn"
          onClick={() => postMessage({ type: 'navigateNotebook', direction: 'next' })}
        >
          Next <NextIcon />
        </button>
      </div>
    </>
  );
}
