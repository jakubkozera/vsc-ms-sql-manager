import React from 'react';
import { NotebookCell, CellResult } from '../types';
import CellOutputArea from './CellOutputArea';

interface CodeCellProps {
  cell: NotebookCell;
  index: number;
  running: boolean;
  result?: CellResult;
  error?: string;
  executionCount?: number;
  onExecute: (index: number, source: string) => void;
  hasConnection: boolean;
}

const CodeCell: React.FC<CodeCellProps> = ({
  cell,
  index,
  running,
  result,
  error,
  executionCount,
  onExecute,
  hasConnection,
}) => {
  const source = Array.isArray(cell.source)
    ? cell.source.join('')
    : cell.source;

  return (
    <div className="notebook-cell code-cell">
      <div className="cell-toolbar">
        <span className="cell-type-badge sql">SQL</span>
        <button
          className="run-btn"
          onClick={() => onExecute(index, source)}
          disabled={running || !hasConnection}
          title={hasConnection ? 'Run cell' : 'Select a connection first'}
        >
          {running ? '⏳' : '▶'} Run
        </button>
        <span className="cell-index">
          [{executionCount ?? cell.execution_count ?? ' '}]
        </span>
      </div>
      <div className="cell-source">
        <pre>{source}</pre>
      </div>
      <CellOutputArea
        running={running}
        result={result}
        error={error}
        originalOutputs={cell.outputs}
      />
    </div>
  );
};

export default CodeCell;
