import React, { useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { marked } from 'marked';
import { NotebookCell } from '../types';

marked.setOptions({
  gfm: true,
  breaks: true,
});

interface MarkdownCellProps {
  cell: NotebookCell;
  index: number;
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

const MarkdownCell: React.FC<MarkdownCellProps> = ({ cell }) => {
  const source = Array.isArray(cell.source)
    ? cell.source.join('')
    : cell.source;

  const segments = useMemo(() => splitMarkdownIntoSegments(source), [source]);

  return (
    <div className="notebook-cell markdown-cell">
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
