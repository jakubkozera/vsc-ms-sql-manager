import { useEffect, useRef } from 'react';
import {
    Chart,
    BarController,
    LineController,
    PieController,
    DoughnutController,
    CategoryScale,
    LinearScale,
    BarElement,
    LineElement,
    PointElement,
    ArcElement,
    Tooltip,
    Legend,
    Filler,
    ChartType as ChartJsType,
    ChartDataset,
} from 'chart.js';
import { Widget, WidgetQueryState } from '../types';

Chart.register(
    BarController, LineController, PieController, DoughnutController,
    CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement,
    Tooltip, Legend, Filler
);

interface Props {
    widget: Widget;
    queryState?: WidgetQueryState;
}

export function ChartWidget({ widget, queryState }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const chartRef = useRef<Chart | null>(null);

    useEffect(() => {
        if (!canvasRef.current) return;
        if (!queryState || queryState.status !== 'success' || queryState.rows.length === 0) {
            chartRef.current?.destroy();
            chartRef.current = null;
            return;
        }

        const { xAxis, yAxis, chartType, color } = widget.chartConfig;
        const columns = queryState.columns;
        const rows = queryState.rows;

        const xIdx = xAxis ? columns.indexOf(xAxis) : 0;
        const yIdx = yAxis ? columns.indexOf(yAxis) : 1;

        const labels = rows.map(r => String(r[xIdx >= 0 ? xIdx : 0] ?? ''));
        const data = rows.map(r => Number(r[yIdx >= 0 ? yIdx : 1] ?? 0));

        const isArea = chartType === 'area';
        const jsChartType: ChartJsType = isArea ? 'line' : chartType as ChartJsType;

        const dataset: ChartDataset = {
            label: yAxis || columns[yIdx >= 0 ? yIdx : 1] || 'Value',
            data,
            backgroundColor: jsChartType === 'line' || isArea ? color + '33' : color,
            borderColor: color,
            borderWidth: 2,
            fill: isArea,
            tension: 0.3,
        };

        chartRef.current?.destroy();

        chartRef.current = new Chart(canvasRef.current, {
            type: jsChartType,
            data: { labels, datasets: [dataset] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: true },
                },
                scales: jsChartType !== 'pie' && jsChartType !== 'doughnut'
                    ? {
                        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'var(--vscode-foreground)' } },
                        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'var(--vscode-foreground)' } },
                    }
                    : undefined,
            },
        });

        return () => {
            chartRef.current?.destroy();
            chartRef.current = null;
        };
    }, [queryState, widget.chartConfig]);

    if (!queryState || queryState.status !== 'success') return null;

    return (
        <div className="chart-container">
            <canvas ref={canvasRef} />
        </div>
    );
}
