import React, { useState } from 'react';
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

const CodeChevron: React.FC<{ collapsed: boolean }> = ({ collapsed }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
      transition: 'transform 0.15s ease',
    }}
  >
    <path d="M6 9l6 6l6 -6" />
  </svg>
);

const CopyCellIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z" />
    <path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" />
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

  const trimmed = source.trimStart();
  const startsWithComment = trimmed.startsWith('--');
  const [collapsed, setCollapsed] = useState(startsWithComment);

  const lines = source.split('\n');
  const previewLines = lines.slice(0, 2).join('\n');
  const displaySource = collapsed ? previewLines : source;
  const displayLineCount = collapsed ? Math.min(2, lines.length) : lines.length;
  const editorHeight = Math.max(40, Math.min(displayLineCount * 19 + 12, 400));
  const canCollapse = lines.length > 2;

  const copySourceToClipboard = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(source);
        return;
      }
    } catch {
      // Fallback below for environments where Clipboard API is unavailable.
    }

    const textArea = document.createElement('textarea');
    textArea.value = source;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  };

  const handleEditorMount: OnMount = (editor) => {
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
        vertical: 'auto',
        horizontal: 'auto',
        handleMouseWheel: true,
      },
      contextmenu: false,
      wordWrap: 'off',
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
        <button
          className="copy-cell-btn"
          onClick={() => { void copySourceToClipboard(); }}
          title="Copy cell code"
          aria-label="Copy cell code"
        >
          <CopyCellIcon />
        </button>
        {canCollapse && (
          <button
            className="collapse-code-btn"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expand code' : 'Collapse code'}
          >
            <CodeChevron collapsed={collapsed} />
            {collapsed && (
              <span className="collapse-hint">{lines.length - 2} more lines</span>
            )}
          </button>
        )}
        <span className="cell-index">
          [{executionCount ?? cell.execution_count ?? ' '}]
        </span>
      </div>
      <div className="cell-source" style={{ height: editorHeight }}>
        <Editor
          key={collapsed ? 'preview' : 'full'}
          height="100%"
          language="sql"
          value={displaySource}
          theme="vs-dark"
          onMount={handleEditorMount}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbers: 'on',
            lineNumbersMinChars: 3,
            wordWrap: 'off',
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              handleMouseWheel: true,
            },
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
