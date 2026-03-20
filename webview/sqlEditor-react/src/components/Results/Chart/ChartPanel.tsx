import { ChartConfig } from '../../../types/chart';
import { ChartCard } from './ChartCard';
import './ChartPanel.css';

interface ChartPanelProps {
  charts: ChartConfig[];
  onDeleteChart: (id: string) => void;
}

export function ChartPanel({ charts, onDeleteChart }: ChartPanelProps) {
  if (charts.length === 0) {
    return (
      <div className="chart-panel-empty" data-testid="chart-panel-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="12" width="4" height="9" rx="1" />
          <rect x="10" y="6" width="4" height="15" rx="1" />
          <rect x="17" y="3" width="4" height="18" rx="1" />
        </svg>
        <p>No charts created</p>
        <p className="hint">Select data in the Results grid, right-click and choose "Create Chart" to visualize your data</p>
      </div>
    );
  }

  return (
    <div className="chart-panel" data-testid="chart-panel">
      <div className="chart-panel-grid">
        {charts.map(chart => (
          <ChartCard key={chart.id} config={chart} onDelete={onDeleteChart} />
        ))}
      </div>
    </div>
  );
}
