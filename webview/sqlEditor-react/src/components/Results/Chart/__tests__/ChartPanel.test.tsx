import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../../../test/testUtils';
import { ChartPanel } from '../ChartPanel';
import { ChartConfig, DEFAULT_CHART_COLORS } from '../../../../types/chart';

// Mock Chart.js since canvas is not available in jsdom
vi.mock('chart.js', () => {
  class MockChart {
    destroy = vi.fn();
    update = vi.fn();
    static register = vi.fn();
  }
  return {
    Chart: MockChart,
    registerables: [],
  };
});

const makeChart = (id: string, title: string): ChartConfig => ({
  id,
  chartType: 'bar',
  title,
  labelColumn: 'Name',
  dataColumns: ['Value'],
  data: {
    columns: ['Name', 'Value'],
    rows: [['A', 10], ['B', 20]],
  },
  colors: DEFAULT_CHART_COLORS,
});

describe('ChartPanel', () => {
  it('shows empty state when no charts', () => {
    render(<ChartPanel charts={[]} onDeleteChart={vi.fn()} />);
    expect(screen.getByTestId('chart-panel-empty')).toBeInTheDocument();
    expect(screen.getByText('No charts created')).toBeInTheDocument();
  });

  it('renders multiple chart cards', () => {
    const charts = [
      makeChart('c1', 'Chart One'),
      makeChart('c2', 'Chart Two'),
    ];
    render(<ChartPanel charts={charts} onDeleteChart={vi.fn()} />);

    expect(screen.getByTestId('chart-panel')).toBeInTheDocument();
    expect(screen.getByText('Chart One')).toBeInTheDocument();
    expect(screen.getByText('Chart Two')).toBeInTheDocument();
  });

  it('calls onDeleteChart when delete button is clicked', () => {
    const onDelete = vi.fn();
    const charts = [makeChart('c1', 'Chart One')];
    render(<ChartPanel charts={charts} onDeleteChart={onDelete} />);

    fireEvent.click(screen.getByTestId('chart-delete-c1'));
    expect(onDelete).toHaveBeenCalledWith('c1');
  });
});
