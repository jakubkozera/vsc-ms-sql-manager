import React, { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { marked } from 'marked';
import { NotebookCell } from '../types';
import CellActions from './CellActions';

marked.setOptions({
  gfm: true,
  breaks: true,
});

interface MarkdownCellProps {
  cell: NotebookCell;
  index: number;
  onSourceChange: (index: number, source: string) => void;
  onDeleteCell: (index: number) => void;
  onMoveCell: (index: number, direction: 'up' | 'down') => void;
  onInsertCellBelow: (index: number, type: 'code' | 'markdown') => void;
  isFirst: boolean;
  isLast: boolean;
  startInEditMode?: boolean;
}

interface MarkdownSegment {
  type: 'markdown' | 'code';
  content: string;
  language?: string;
}

function normalizeCodeBlockContent(code: string): string {
  return code.replace(/^\n+/, '').replace(/\n+$/, '');
}

function splitMarkdownIntoSegments(source: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const fenceRegex = /```([\w+-]*)\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(source)) !== null) {
    const fullMatch = match[0];
    const language = (match[1] || '').trim() || 'plaintext';
    const code = normalizeCodeBlockContent(match[2] ?? '');
    const matchIndex = match.index;

    if (matchIndex > lastIndex) {
      segments.push({
        type: 'markdown',
        content: source.slice(lastIndex, matchIndex),
      });
    }

    segments.push({
      type: 'code',
      content: code,
      language,
    });

    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < source.length) {
    segments.push({
      type: 'markdown',
      content: source.slice(lastIndex),
    });
  }

  if (segments.length === 0) {
    segments.push({ type: 'markdown', content: source });
  }

  return segments;
}

const EditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1" />
    <path d="M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415z" />
    <path d="M16 5l3 3" />
  </svg>
);

const PreviewIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
    <path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" />
  </svg>
);

const MarkdownCell: React.FC<MarkdownCellProps> = ({
  cell,
  index,
  onSourceChange,
  onDeleteCell,
  onMoveCell,
  onInsertCellBelow,
  isFirst,
  isLast,
  startInEditMode,
}) => {
  const initialSource = Array.isArray(cell.source)
    ? cell.source.join('')
    : cell.source;

  const [editing, setEditing] = useState(startInEditMode ?? false);
  const [editedSource, setEditedSource] = useState(initialSource);
  const sourceRef = useRef(initialSource);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync when cell source changes externally
  useEffect(() => {
    const newSource = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
    if (newSource !== sourceRef.current) {
      sourceRef.current = newSource;
      setEditedSource(newSource);
    }
  }, [cell.source]);

  const handleSourceChange = useCallback((value: string | undefined) => {
    const newVal = value ?? '';
    setEditedSource(newVal);
    sourceRef.current = newVal;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSourceChange(index, newVal);
    }, 500);
  }, [index, onSourceChange]);

  const switchToPreview = useCallback(() => {
    setEditing(false);
    // Flush any pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    onSourceChange(index, editedSource);
  }, [index, editedSource, onSourceChange]);

  const segments = useMemo(() => splitMarkdownIntoSegments(editedSource), [editedSource]);

  if (editing) {
    const lineCount = editedSource.split('\n').length;
    const editorHeight = Math.max(80, Math.min(lineCount * 19 + 12, 500));

    return (
      <div className="notebook-cell markdown-cell markdown-cell-editing">
        <div className="cell-toolbar markdown-toolbar">
          <button
            className="cell-action-btn preview-btn"
            onClick={switchToPreview}
            title="Preview"
          >
            <PreviewIcon />
          </button>
          <CellActions
            index={index}
            isFirst={isFirst}
            isLast={isLast}
            onDeleteCell={onDeleteCell}
            onMoveCell={onMoveCell}
            onInsertCellBelow={onInsertCellBelow}
          />
        </div>
        <div className="cell-source" style={{ height: editorHeight }}>
          <Editor
            height="100%"
            language="markdown"
            value={editedSource}
            theme="vs-dark"
            onChange={handleSourceChange}
            options={{
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: 'on',
              lineNumbersMinChars: 3,
              wordWrap: 'on',
              scrollbar: {
                vertical: 'auto',
                horizontal: 'hidden',
                handleMouseWheel: true,
              },
              padding: { top: 6, bottom: 6 },
              renderLineHighlight: 'none',
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              overviewRulerBorder: false,
              contextmenu: false,
              folding: false,
              glyphMargin: false,
            }}
          />
        </div>
      </div>
    );
  }

  // Preview mode
  return (
    <div className="notebook-cell markdown-cell" onDoubleClick={() => setEditing(true)}>
      <div className="cell-toolbar markdown-toolbar">
        <button
          className="cell-action-btn edit-btn"
          onClick={() => setEditing(true)}
          title="Edit"
        >
          <EditIcon />
        </button>
        <CellActions
          index={index}
          isFirst={isFirst}
          isLast={isLast}
          onDeleteCell={onDeleteCell}
          onMoveCell={onMoveCell}
          onInsertCellBelow={onInsertCellBelow}
        />
      </div>
      {segments.map((segment, idx) => {
        if (segment.type === 'code') {
          const lineCount = Math.max(1, segment.content.split('\n').length);
          const editorHeight = Math.max(40, lineCount * 19 + 12);

          return (
            <div key={`code-${idx}`} className="markdown-code-block" style={{ height: editorHeight }}>
              <Editor
                height="100%"
                language={segment.language}
                value={segment.content}
                theme="vs-dark"
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  lineNumbers: 'off',
                  lineDecorationsWidth: 0,
                  glyphMargin: false,
                  folding: false,
                  renderLineHighlight: 'none',
                  overviewRulerLanes: 0,
                  hideCursorInOverviewRuler: true,
                  overviewRulerBorder: false,
                  wordWrap: 'on',
                  contextmenu: false,
                  scrollbar: {
                    vertical: 'hidden',
                    horizontal: 'hidden',
                    handleMouseWheel: false,
                  },
                  padding: { top: 6, bottom: 6 },
                }}
              />
            </div>
          );
        }

        const rendered = marked.parse(segment.content) as string;
        return (
          <div
            key={`md-${idx}`}
            className="markdown-content"
            dangerouslySetInnerHTML={{ __html: rendered }}
          />
        );
      })}
    </div>
  );
};

export default MarkdownCell;
