import React, { useState } from 'react';
import { CellResult, CellOutput } from '../types';
import ResultTable from './ResultTable';
import OriginalOutput from './OriginalOutput';

const ChevronIcon: React.FC<{ collapsed: boolean }> = ({ collapsed }) => (
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
      flexShrink: 0,
    }}
  >
    <path d="M6 9l6 6l6 -6" />
  </svg>
);

interface CellOutputAreaProps {
  running: boolean;
  result?: CellResult;
  error?: string;
  originalOutputs?: CellOutput[];
}

const CollapsibleResultSet: React.FC<{
  rs: unknown[];
  i: number;
  total: number;
  executionTime: number;
  columns: string[];
}> = ({ rs, i, total, executionTime, columns }) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <div
        className="output-header output-header-clickable"
        onClick={() => setCollapsed(!collapsed)}
      >
        <ChevronIcon collapsed={collapsed} />
        <span>
          Result Set{' '}
          {total > 1 ? `${i + 1} ` : ''}— {(rs as unknown[]).length} row(s)
          {i === 0 && ` in ${executionTime}ms`}
        </span>
      </div>
      {!collapsed && (
        <div className="output-content">
          <ResultTable
            rows={rs as unknown[][]}
            columns={columns}
          />
        </div>
      )}
    </div>
  );
};

const CellOutputArea: React.FC<CellOutputAreaProps> = ({
  running,
  result,
  error,
  originalOutputs,
}) => {
  if (running) {
    return (
      <div className="cell-output">
        <div className="cell-loading">
          <div className="spinner" />
          Executing query...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cell-output">
        <div className="output-error">{error}</div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="cell-output">
        {result.recordsets.map((rs, i) => (
          <CollapsibleResultSet
            key={i}
            rs={rs}
            i={i}
            total={result.recordsets.length}
            executionTime={result.executionTime}
            columns={result.columnNames?.[i] ?? []}
          />
        ))}
        {result.recordsets.length === 0 && result.rowsAffected.length > 0 && (
          <div className="output-success">
            ✓ {result.rowsAffected.reduce((a, b) => a + b, 0)} row(s) affected (
            {result.executionTime}ms)
          </div>
        )}
      </div>
    );
  }

  if (originalOutputs && originalOutputs.length > 0) {
    return (
      <div className="cell-output">
        {originalOutputs.map((out, i) => (
          <OriginalOutput key={i} output={out} />
        ))}
      </div>
    );
  }

  return <div className="cell-output cell-output-empty" />;
};

export default CellOutputArea;
