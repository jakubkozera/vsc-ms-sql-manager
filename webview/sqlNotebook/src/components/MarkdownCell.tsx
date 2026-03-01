import React, { useMemo } from 'react';
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

const MarkdownCell: React.FC<MarkdownCellProps> = ({ cell }) => {
  const source = Array.isArray(cell.source)
    ? cell.source.join('')
    : cell.source;

  const rendered = useMemo(() => marked.parse(source) as string, [source]);

  return (
    <div className="notebook-cell markdown-cell">
      <div
        className="markdown-content"
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    </div>
  );
};

export default MarkdownCell;
