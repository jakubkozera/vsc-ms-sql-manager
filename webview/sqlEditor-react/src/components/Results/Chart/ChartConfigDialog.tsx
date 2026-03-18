import { useState, useMemo, useEffect, useRef } from 'react';
import { ChartType, ChartDataSnapshot, CHART_TYPE_LABELS } from '../../../types/chart';
import { getColumnFilterCategory } from '../../../types/grid';
import './ChartConfigDialog.css';

interface ChartConfigDialogProps {
  data: ChartDataSnapshot;
  columnTypes?: Record<string, string>;
  onCreate: (config: { chartType: ChartType; title: string; labelColumn: string; dataColumns: string[] }) => void;
  onCancel: () => void;
}

const CHART_TYPE_ICONS: Record<ChartType, JSX.Element> = {
  bar: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="12" width="4" height="9" rx="1" />
      <rect x="10" y="6" width="4" height="15" rx="1" />
      <rect x="17" y="3" width="4" height="18" rx="1" />
    </svg>
  ),
  line: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 18 8 10 13 14 21 4" />
    </svg>
  ),
  pie: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2a10 10 0 0 1 0 20 10 10 0 0 1 0-20zm0 2v8h8a8 8 0 0 0-8-8z" />
    </svg>
  ),
  doughnut: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" opacity="0.4" />
    </svg>
  ),
  scatter: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="6" cy="16" r="2" />
      <circle cx="10" cy="10" r="2" />
      <circle cx="15" cy="14" r="2" />
      <circle cx="18" cy="7" r="2" />
      <circle cx="8" cy="6" r="2" />
    </svg>
  ),
  radar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polygon points="12,2 21,9 18,19 6,19 3,9" />
      <polygon points="12,7 17,11 15,17 9,17 7,11" opacity="0.5" />
    </svg>
  ),
};

function isNumericColumn(sqlType?: string): boolean {
  if (!sqlType) return false;
  return getColumnFilterCategory(sqlType) === 'number';
}

/**
 * Fallback numeric detection by inspecting actual data values.
 * Used when column metadata type is unknown/missing (e.g. COUNT(*), SUM()).
 */
function isNumericFromData(rows: unknown[][], colIndex: number): boolean {
  if (rows.length === 0) return false;
  const sample = rows.slice(0, 50);
  let numericCount = 0;
  let nonNullCount = 0;
  for (const row of sample) {
    const val = row[colIndex];
    if (val === null || val === undefined) continue;
    nonNullCount++;
    if (typeof val === 'number') {
      numericCount++;
    }
  }
  return nonNullCount > 0 && numericCount >= nonNullCount * 0.8;
}

function isColumnNumeric(col: string, colIndex: number, columnTypes?: Record<string, string>, rows?: unknown[][]): boolean {
  const sqlType = columnTypes?.[col];
  if (sqlType && isNumericColumn(sqlType)) return true;
  // Fallback: inspect data values when type is unknown/string
  if (rows && (!sqlType || sqlType === 'string' || sqlType === 'unknown')) {
    return isNumericFromData(rows, colIndex);
  }
  return false;
}

export function ChartConfigDialog({ data, columnTypes, onCreate, onCancel }: ChartConfigDialogProps) {
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [title, setTitle] = useState('');
  const [labelColumn, setLabelColumn] = useState('');
  const [dataColumns, setDataColumns] = useState<string[]>([]);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const numericColumns = useMemo(
    () => data.columns.filter((col, idx) => isColumnNumeric(col, idx, columnTypes, data.rows)),
    [data.columns, columnTypes, data.rows]
  );

  // Auto-select first non-numeric column as label, numeric columns as data
  useEffect(() => {
    const firstNonNumeric = data.columns.find((col, idx) => !isColumnNumeric(col, idx, columnTypes, data.rows));
    setLabelColumn(firstNonNumeric || data.columns[0] || '');
    setDataColumns(numericColumns.length > 0 ? [numericColumns[0]] : []);
  }, [data.columns, columnTypes, numericColumns, data.rows]);

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  const toggleDataColumn = (col: string) => {
    setDataColumns(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  };

  const canCreate = labelColumn && dataColumns.length > 0;

  const handleCreate = () => {
    if (!canCreate) return;
    onCreate({
      chartType,
      title: title || `${CHART_TYPE_LABELS[chartType]} Chart`,
      labelColumn,
      dataColumns,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
    if (e.key === 'Enter' && canCreate) handleCreate();
  };

  return (
    <div className="chart-config-overlay" onMouseDown={onCancel} data-testid="chart-config-overlay">
      <div
        className="chart-config-dialog"
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        data-testid="chart-config-dialog"
      >
        <h3>Create Chart</h3>

        <div className="chart-config-field">
          <label>Chart Type</label>
          <div className="chart-type-grid" data-testid="chart-type-grid">
            {(Object.keys(CHART_TYPE_LABELS) as ChartType[]).map(type => (
              <button
                key={type}
                className={`chart-type-option ${chartType === type ? 'selected' : ''}`}
                onClick={() => setChartType(type)}
                data-testid={`chart-type-${type}`}
              >
                {CHART_TYPE_ICONS[type]}
                {CHART_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>

        <div className="chart-config-field">
          <label>Title</label>
          <input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={`${CHART_TYPE_LABELS[chartType]} Chart`}
            data-testid="chart-title-input"
          />
        </div>

        <div className="chart-config-field">
          <label>Labels (X-Axis / Categories)</label>
          <select
            value={labelColumn}
            onChange={e => setLabelColumn(e.target.value)}
            data-testid="chart-label-select"
          >
            {data.columns.map(col => (
              <option key={col} value={col}>{col}</option>
            ))}
          </select>
        </div>

        <div className="chart-config-field">
          <label>Data Columns (Values)</label>
          <div className="chart-data-columns" data-testid="chart-data-columns">
            {data.columns
              .filter(col => col !== labelColumn)
              .map(col => (
                <label key={col} className="chart-data-column-item">
                  <input
                    type="checkbox"
                    checked={dataColumns.includes(col)}
                    onChange={() => toggleDataColumn(col)}
                    data-testid={`chart-data-col-${col}`}
                  />
                  {col}
                  {columnTypes?.[col] && (
                    <span className="col-type">{columnTypes[col]}</span>
                  )}
                </label>
              ))}
          </div>
        </div>

        <div className="chart-config-actions">
          <button className="btn-secondary" onClick={onCancel} data-testid="chart-cancel-btn">
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={!canCreate}
            data-testid="chart-create-btn"
          >
            Create Chart
          </button>
        </div>
      </div>
    </div>
  );
}
