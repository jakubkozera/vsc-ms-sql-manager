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
  kernelName?: string;
}

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
  kernelName,
}) => {
  return (
    <div className="notebook-toolbar">
      <span className="toolbar-label">Connection</span>
      <select
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
          <span className="toolbar-label" style={{ marginLeft: 8 }}>Database</span>
          <select
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

      <button
        onClick={onRefreshConnections}
        title="Refresh connections"
        style={{
          padding: '4px 8px',
          background: 'transparent',
          color: 'var(--vscode-foreground)',
        }}
      >
        ↻
      </button>
      <button className="run-all-btn" onClick={onRunAll} title="Run All Cells">
        ▶▶ Run All
      </button>
      {kernelName && (
        <span className="toolbar-label" style={{ marginLeft: 'auto' }}>
          {kernelName}
        </span>
      )}
    </div>
  );
};

export default Toolbar;
