import { useVSCode } from '../../context/VSCodeContext';
import { ExecuteButton } from './ExecuteButton';
import { ConnectionDropdown } from './ConnectionDropdown';
import { DatabaseDropdown } from './DatabaseDropdown';
import { FormatButton } from './FormatButton';
import './Toolbar.css';

interface ToolbarProps {
  onExecute: () => void;
  onFormat: () => void;
  isExecuting: boolean;
  includeActualPlan: boolean;
  onToggleActualPlan: (enabled: boolean) => void;
}

export function Toolbar({
  onExecute,
  onFormat,
  isExecuting,
  includeActualPlan,
  onToggleActualPlan,
}: ToolbarProps) {
  const {
    isConnected,
    cancelQuery,
    manageConnections,
  } = useVSCode();

  return (
    <div id="toolbar">
      {/* Execute Button with dropdown */}
      <ExecuteButton
        onExecute={onExecute}
        onCancel={cancelQuery}
        isExecuting={isExecuting}
        disabled={!isConnected}
        includeActualPlan={includeActualPlan}
        onToggleActualPlan={onToggleActualPlan}
      />

      <div className="toolbar-separator" />

      {/* Connection icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ verticalAlign: 'middle' }}
      >
        <path d="M9.785 6l8.215 8.215l-2.054 2.054a5.81 5.81 0 1 1 -8.215 -8.215l2.054 -2.054z" />
        <path d="M4 20l3.5 -3.5" />
        <path d="M15 4l-3.5 3.5" />
        <path d="M20 9l-3.5 3.5" />
      </svg>

      {/* Connection Dropdown */}
      <ConnectionDropdown />



      {/* Database Dropdown */}
      <DatabaseDropdown />

      {/* Connect Button (always visible) */}
      <button
        className="toolbar-button secondary"
        id="connectButton"
        title="Manage Connections"
        onClick={() => manageConnections()}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5z" />
          <path d="M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5z" />
          <path d="M3 21l2.5 -2.5" />
          <path d="M18.5 5.5l2.5 -2.5" />
          <path d="M10 11l-2 2" />
          <path d="M13 14l-2 2" />
        </svg>
        Connect
      </button>

      <FormatButton onFormat={onFormat} />

      <div className="toolbar-separator" />

      {/* Status */}
      <span id="statusLabel">
        {isExecuting ? 'Executing...' : isConnected ? 'Ready' : 'Not Connected'}
      </span>
    </div>
  );
}
