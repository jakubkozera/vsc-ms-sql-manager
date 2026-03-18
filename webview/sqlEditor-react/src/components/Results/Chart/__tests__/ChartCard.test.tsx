import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../../../test/testUtils';
import { ChartCard } from '../ChartCard';
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

const makeConfig = (overrides?: Partial<ChartConfig>): ChartConfig => ({
  id: 'test-1',
  chartType: 'bar',
  title: 'Sales by Region',
  labelColumn: 'Region',
  dataColumns: ['Sales'],
  data: {
    columns: ['Region', 'Sales'],
    rows: [
      ['EU', 100],
      ['US', 200],
    ],
  },
  colors: DEFAULT_CHART_COLORS,
  ...overrides,
});

describe('ChartCard', () => {
  it('renders chart title', () => {
    render(<ChartCard config={makeConfig()} onDelete={vi.fn()} />);
    expect(screen.getByText('Sales by Region')).toBeInTheDocument();
  });

  it('renders chart type badge', () => {
    render(<ChartCard config={makeConfig()} onDelete={vi.fn()} />);
    expect(screen.getByText('Bar')).toBeInTheDocument();
  });

  it('renders delete button', () => {
    render(<ChartCard config={makeConfig()} onDelete={vi.fn()} />);
    expect(screen.getByTestId('chart-delete-test-1')).toBeInTheDocument();
  });

  it('calls onDelete with chart id when delete button is clicked', () => {
    const onDelete = vi.fn();
    render(<ChartCard config={makeConfig()} onDelete={onDelete} />);

    fireEvent.click(screen.getByTestId('chart-delete-test-1'));
    expect(onDelete).toHaveBeenCalledWith('test-1');
  });

  it('renders canvas element', () => {
    render(<ChartCard config={makeConfig()} onDelete={vi.fn()} />);
    expect(screen.getByTestId('chart-canvas-test-1')).toBeInTheDocument();
  });

  it('renders correct badge for pie chart', () => {
    render(<ChartCard config={makeConfig({ chartType: 'pie' })} onDelete={vi.fn()} />);
    expect(screen.getByText('Pie')).toBeInTheDocument();
  });
});
