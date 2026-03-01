import React from 'react';
import { CellResult, CellOutput } from '../types';
import ResultTable from './ResultTable';
import OriginalOutput from './OriginalOutput';

interface CellOutputAreaProps {
  running: boolean;
  result?: CellResult;
  error?: string;
  originalOutputs?: CellOutput[];
}

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
          <div key={i}>
            <div className="output-header">
              Result Set{' '}
              {result.recordsets.length > 1 ? `${i + 1}` : ''}— {rs.length}{' '}
              row(s)
              {i === 0 && ` in ${result.executionTime}ms`}
            </div>
            <div className="output-content">
              <ResultTable
                rows={rs as unknown[][]}
                columns={result.columnNames?.[i] ?? []}
              />
            </div>
          </div>
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
