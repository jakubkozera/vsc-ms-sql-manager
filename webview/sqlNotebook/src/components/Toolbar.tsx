import React from 'react';
import { Connection } from '../types';

interface ToolbarProps {
  connections: Connection[];
  selectedConnection: string;
  onConnectionChange: (id: string) => void;
  databases: string[];
  selectedDatabase: string;
  onDatabaseChange: (db: string) => void;
  showDatabaseSelector: boolean;
  onRunAll: () => void;
  onRefreshConnections: () => void;
  onManageConnections: () => void;
  kernelName?: string;
}

const RunAllIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 4v16l13 -8z" />
  </svg>
);

const RefreshIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" />
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
  </svg>
);

const ConnectIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5z" />
    <path d="M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5z" />
    <path d="M3 21l2.5 -2.5" />
    <path d="M18.5 5.5l2.5 -2.5" />
    <path d="M10 11l-2 2" />
    <path d="M13 14l-2 2" />
  </svg>
);

const ConnectionIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.785 6l8.215 8.215l-2.054 2.054a5.81 5.81 0 1 1 -8.215 -8.215l2.054 -2.054z" />
    <path d="M4 20l3.5 -3.5" />
    <path d="M15 4l-3.5 3.5" />
    <path d="M20 9l-3.5 3.5" />
  </svg>
);

const DatabaseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 6m-8 0a8 3 0 1 0 16 0a8 3 0 1 0 -16 0" />
    <path d="M4 6v6a8 3 0 0 0 16 0v-6" />
    <path d="M4 12v6a8 3 0 0 0 16 0v-6" />
  </svg>
);

const Toolbar: React.FC<ToolbarProps> = ({
  connections,
  selectedConnection,
  onConnectionChange,
  databases,
  selectedDatabase,
  onDatabaseChange,
  showDatabaseSelector,
  onRunAll,
  onRefreshConnections,
  onManageConnections,
  kernelName,
}) => {
  return (
    <div className="notebook-toolbar">
      <button className="toolbar-icon-btn primary" onClick={onRunAll} title="Run All Cells">
        <RunAllIcon />
      </button>

      <div className="toolbar-separator" />

      <ConnectionIcon />
      <select
        className="toolbar-select"
        value={selectedConnection}
        onChange={(e) => onConnectionChange(e.target.value)}
      >
        {connections.length === 0 && (
          <option value="">No active connections</option>
        )}
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {showDatabaseSelector && (
        <>
          <DatabaseIcon />
          <select
            className="toolbar-select"
            value={selectedDatabase}
            onChange={(e) => onDatabaseChange(e.target.value)}
          >
            {databases.length === 0 && (
              <option value="">Loading...</option>
            )}
            {databases.map((db) => (
              <option key={db} value={db}>
                {db}
              </option>
            ))}
          </select>
        </>
      )}

      <button className="toolbar-icon-btn" onClick={onManageConnections} title="Manage Connections">
        <ConnectIcon />
      </button>

      <button className="toolbar-icon-btn" onClick={onRefreshConnections} title="Refresh Connections">
        <RefreshIcon />
      </button>

      {kernelName && (
        <span className="toolbar-kernel" >
          {kernelName}
        </span>
      )}
    </div>
  );
};

export default Toolbar;
