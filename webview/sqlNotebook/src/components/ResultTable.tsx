import React from 'react';

interface ResultTableProps {
  rows: unknown[][];
  columns: string[];
}

const ResultTable: React.FC<ResultTableProps> = ({ rows, columns }) => {
  if (rows.length === 0 && columns.length === 0) {
    return (
      <div className="output-success">
        Query executed successfully. No results returned.
      </div>
    );
  }

  return (
    <div className="result-table-container">
      <table className="result-table">
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={i}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {(row as unknown[]).map((cell, ci) => (
                <td
                  key={ci}
                  className={cell == null ? 'null-value' : ''}
                  title={cell != null ? String(cell) : 'NULL'}
                >
                  {cell == null ? 'NULL' : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ResultTable;
