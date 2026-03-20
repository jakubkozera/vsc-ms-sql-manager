export type ChartType = 'bar' | 'line' | 'pie' | 'doughnut' | 'scatter' | 'radar';

export interface ChartConfig {
  id: string;
  chartType: ChartType;
  title: string;
  labelColumn: string;
  dataColumns: string[];
  data: ChartDataSnapshot;
  colors: string[];
}

export interface ChartDataSnapshot {
  columns: string[];
  rows: unknown[][];
}

export type CanvasWidgetType = 'chart' | 'text';

export interface CanvasWidgetPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasChartWidget {
  id: string;
  type: 'chart';
  position: CanvasWidgetPosition;
  chart: ChartConfig;
}

export interface CanvasTextWidget {
  id: string;
  type: 'text';
  position: CanvasWidgetPosition;
  title?: string;
  content: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  color?: string;
}

export type CanvasWidget = CanvasChartWidget | CanvasTextWidget;

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: 'Bar',
  line: 'Line',
  pie: 'Pie',
  doughnut: 'Doughnut',
  scatter: 'Scatter',
  radar: 'Radar',
};

export const DEFAULT_CHART_COLORS = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2',
  '#59a14f', '#edc948', '#b07aa1', '#ff9da7',
  '#9c755f', '#bab0ac', '#5470c6', '#91cc75',
  '#fac858', '#ee6666', '#73c0de', '#3ba272',
];
