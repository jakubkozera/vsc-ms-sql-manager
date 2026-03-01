import React, { useCallback, useEffect, useState } from 'react';
import { postMessage } from './vscode';
import { Notebook, Connection, CellState } from './types';
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

export default function App() {
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnection, setSelectedConnection] = useState('');
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState('');
  const [showDatabaseSelector, setShowDatabaseSelector] = useState(false);
  const [cellStates, setCellStates] = useState<Map<number, CellState>>(
    new Map()
  );
  const [execCounter, setExecCounter] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case 'loadNotebook':
          setNotebook(msg.notebook);
          setLoadError(null);
          break;

        case 'connections':
          setConnections(msg.connections);
          if (msg.connections.length > 0 && !selectedConnection) {
            const firstId = msg.connections[0].id;
            setSelectedConnection(firstId);
            // Notify backend so it can send databases for server connections
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
          setCellStates((prev) => {
            const next = new Map(prev);
            next.set(cellIndex, {
              running: false,
              result,
              error,
              executionCount: prev.get(cellIndex)?.executionCount,
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
      const count = execCounter + 1;
      setExecCounter(count);
      setCellStates((prev) => {
        const next = new Map(prev);
        next.set(index, { running: true, executionCount: count });
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
    [selectedConnection, selectedDatabase, execCounter]
  );

  const runAll = useCallback(() => {
    if (!notebook) return;
    notebook.cells.forEach((cell, i) => {
      if (cell.cell_type === 'code') {
        const src = Array.isArray(cell.source)
          ? cell.source.join('')
          : cell.source;
        executeCell(i, src);
      }
    });
  }, [notebook, executeCell]);

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
        kernelName={notebook.metadata?.kernelspec?.display_name}
      />
      <div className="notebook-container">
        {notebook.cells.length === 0 ? (
          <div className="empty-state">
            <h2>Empty Notebook</h2>
            <p>This notebook has no cells.</p>
          </div>
        ) : (
          notebook.cells.map((cell, i) => {
            const state = cellStates.get(i);
            return cell.cell_type === 'code' ? (
              <CodeCell
                key={i}
                cell={cell}
                index={i}
                running={state?.running ?? false}
                result={state?.result}
                error={state?.error}
                executionCount={state?.executionCount}
                onExecute={executeCell}
                hasConnection={!!selectedConnection}
              />
            ) : (
              <MarkdownCell key={i} cell={cell} index={i} />
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
