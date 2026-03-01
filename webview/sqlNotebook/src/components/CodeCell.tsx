import React, { useRef, useEffect, useState } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
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

const RunCellIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 4v16l13 -8z" />
  </svg>
);

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

  const lineCount = source.split('\n').length;
  const editorHeight = Math.max(40, Math.min(lineCount * 19 + 12, 400));

  const handleEditorMount: OnMount = (editor) => {
    // Disable most interactions for read-only display
    editor.updateOptions({
      readOnly: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      glyphMargin: false,
      folding: false,
      renderLineHighlight: 'none',
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollbar: {
        vertical: 'hidden',
        horizontal: 'auto',
        handleMouseWheel: false,
      },
      contextmenu: false,
      wordWrap: 'on',
      padding: { top: 6, bottom: 6 },
    });
  };

  return (
    <div className="notebook-cell code-cell">
      <div className="cell-toolbar">
        <button
          className="run-cell-btn"
          onClick={() => onExecute(index, source)}
          disabled={running || !hasConnection}
          title={hasConnection ? 'Run cell' : 'Select a connection first'}
        >
          {running ? <div className="spinner-small" /> : <RunCellIcon />}
        </button>
        <span className="cell-type-badge sql">SQL</span>
        <span className="cell-index">
          [{executionCount ?? cell.execution_count ?? ' '}]
        </span>
      </div>
      <div className="cell-source" style={{ height: editorHeight }}>
        <Editor
          height="100%"
          language="sql"
          value={source}
          theme="vs-dark"
          onMount={handleEditorMount}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbers: 'on',
            lineNumbersMinChars: 3,
            wordWrap: 'on',
          }}
        />
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
