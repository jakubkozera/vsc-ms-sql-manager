import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { ChartConfig, CHART_TYPE_LABELS } from '../../../types/chart';
import './ChartCard.css';

Chart.register(...registerables);

interface ChartCardProps {
  config: ChartConfig;
  onDelete: (id: string) => void;
}

function getComputedVSCodeColor(varName: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallback;
}

function buildChartData(config: ChartConfig) {
  const { data, labelColumn, dataColumns, colors } = config;
  const labelIndex = data.columns.indexOf(labelColumn);
  const labels = labelIndex >= 0
    ? data.rows.map(row => String(row[labelIndex] ?? ''))
    : data.rows.map((_, i) => String(i + 1));

  const datasets = dataColumns.map((colName, dsIndex) => {
    const colIndex = data.columns.indexOf(colName);
    const values = colIndex >= 0
      ? data.rows.map(row => {
          const v = row[colIndex];
          return typeof v === 'number' ? v : Number(v) || 0;
        })
      : [];

    const color = colors[dsIndex % colors.length];
    const isPieType = config.chartType === 'pie' || config.chartType === 'doughnut';

    return {
      label: colName,
      data: values,
      backgroundColor: isPieType
        ? values.map((_, i) => colors[i % colors.length])
        : color + '99',
      borderColor: isPieType
        ? values.map((_, i) => colors[i % colors.length])
        : color,
      borderWidth: isPieType ? 1 : 2,
      tension: config.chartType === 'line' ? 0.3 : undefined,
      fill: config.chartType === 'line' ? false : undefined,
    };
  });

  return { labels, datasets };
}

export function ChartCard({ config, onDelete }: ChartCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Destroy previous chart instance
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const textColor = getComputedVSCodeColor('--vscode-foreground', '#cccccc');
    const gridColor = getComputedVSCodeColor('--vscode-widget-border', '#454545') + '40';
    const chartData = buildChartData(config);
    const isPieType = config.chartType === 'pie' || config.chartType === 'doughnut';

    chartRef.current = new Chart(canvasRef.current, {
      type: config.chartType,
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: config.dataColumns.length > 1 || isPieType,
            position: isPieType ? 'right' : 'top',
            labels: { color: textColor, font: { size: 11 } },
          },
          title: {
            display: false,
          },
          tooltip: {
            enabled: true,
          },
        },
        scales: isPieType ? {} : {
          x: {
            ticks: { color: textColor, font: { size: 11 } },
            grid: { color: gridColor },
          },
          y: {
            ticks: { color: textColor, font: { size: 11 } },
            grid: { color: gridColor },
            beginAtZero: true,
          },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [config]);

  return (
    <div className="chart-card" data-testid={`chart-card-${config.id}`}>
      <div className="chart-card-header">
        <span className="chart-card-title">{config.title}</span>
        <span className="chart-card-type-badge">{CHART_TYPE_LABELS[config.chartType]}</span>
        <button
          className="chart-card-delete"
          onClick={() => onDelete(config.id)}
          title="Remove chart"
          data-testid={`chart-delete-${config.id}`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm2.646 4.646L8.707 7.585l1.939 1.939-.707.707-1.939-1.939-1.939 1.939-.707-.707L7.293 7.585 5.354 5.646l.707-.707L8 6.878l1.939-1.939.707.707z" />
          </svg>
        </button>
      </div>
      <div className="chart-card-body">
        <canvas ref={canvasRef} data-testid={`chart-canvas-${config.id}`} />
      </div>
    </div>
  );
}
