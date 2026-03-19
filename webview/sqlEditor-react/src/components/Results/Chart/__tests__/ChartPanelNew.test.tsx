import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../../../test/testUtils';
import { ChartPanel } from '../ChartPanelNew';
import { CanvasWidget, DEFAULT_CHART_COLORS } from '../../../../types/chart';

// Mock Chart.js
vi.mock('chart.js', () => {
  class MockChart {
    destroy = vi.fn();
    update = vi.fn();
    resize = vi.fn();
    static register = vi.fn();
  }
  return { Chart: MockChart, registerables: [] };
});

const makeChartWidget = (id: string, title: string): CanvasWidget => ({
  id,
  type: 'chart',
  position: { x: 0, y: 0, width: 600, height: 350 },
  chart: {
    id,
    chartType: 'bar',
    title,
    labelColumn: 'Name',
    dataColumns: ['Value'],
    data: { columns: ['Name', 'Value'], rows: [['A', 10], ['B', 20]] },
    colors: DEFAULT_CHART_COLORS,
  },
});

const makeTextWidget = (id: string, content: string): CanvasWidget => ({
  id,
  type: 'text',
  position: { x: 0, y: 400, width: 400, height: 80 },
  content,
  fontSize: 14,
  fontWeight: 'normal',
});

const noop = () => {};

const defaultProps = {
  onUpdatePosition: noop,
  onUpdateTextContent: noop,
  onUpdateWidgetTitle: noop,
  onRemoveWidget: noop,
  onBringToFront: noop,
  onAddText: noop,
  onExportHTML: noop,
};

describe('ChartPanel (canvas-based)', () => {
  it('renders empty canvas when no widgets', () => {
    render(<ChartPanel widgets={[]} {...defaultProps} />);
    expect(screen.getByTestId('chart-canvas-empty')).toBeInTheDocument();
  });

  it('renders chart widget on canvas', () => {
    const widgets = [makeChartWidget('c1', 'Sales Chart')];
    render(<ChartPanel widgets={widgets} {...defaultProps} />);
    expect(screen.getByTestId('canvas-widget-c1')).toBeInTheDocument();
    expect(screen.getByText('Sales Chart')).toBeInTheDocument();
  });

  it('renders text widget on canvas', () => {
    const widgets = [makeTextWidget('t1', 'Hello world')];
    render(<ChartPanel widgets={widgets} {...defaultProps} />);
    expect(screen.getByTestId('canvas-widget-t1')).toBeInTheDocument();
  });

  it('renders toolbar with Add Text and Export buttons', () => {
    render(<ChartPanel widgets={[]} {...defaultProps} />);
    expect(screen.getByTestId('canvas-add-text-btn')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-export-html-btn')).toBeInTheDocument();
  });

  it('calls onAddText when Add Text button is clicked', () => {
    const onAddText = vi.fn();
    render(<ChartPanel widgets={[]} {...defaultProps} onAddText={onAddText} />);
    fireEvent.click(screen.getByTestId('canvas-add-text-btn'));
    expect(onAddText).toHaveBeenCalledTimes(1);
  });

  it('calls onRemoveWidget when delete button is clicked', () => {
    const onRemove = vi.fn();
    const widgets = [makeChartWidget('c1', 'Test')];
    render(<ChartPanel widgets={widgets} {...defaultProps} onRemoveWidget={onRemove} />);
    fireEvent.click(screen.getByTestId('canvas-widget-delete-c1'));
    expect(onRemove).toHaveBeenCalledWith('c1');
  });

  it('calls onExportHTML when Export HTML is clicked', () => {
    const onExport = vi.fn();
    const widgets = [makeChartWidget('c1', 'Test')];
    render(<ChartPanel widgets={widgets} {...defaultProps} onExportHTML={onExport} />);
    fireEvent.click(screen.getByTestId('canvas-export-html-btn'));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onExport.mock.calls[0][0]).toContain('<!DOCTYPE html>');
  });

  it('renders multiple widgets', () => {
    const widgets = [
      makeChartWidget('c1', 'Chart 1'),
      makeTextWidget('t1', 'Note'),
      makeChartWidget('c2', 'Chart 2'),
    ];
    render(<ChartPanel widgets={widgets} {...defaultProps} />);
    expect(screen.getByTestId('canvas-widget-c1')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-widget-t1')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-widget-c2')).toBeInTheDocument();
  });

  it('shows zoom label in toolbar', () => {
    render(<ChartPanel widgets={[]} {...defaultProps} />);
    expect(screen.getByTestId('canvas-zoom-label')).toHaveTextContent('100%');
  });

  it('has a zoom reset button', () => {
    render(<ChartPanel widgets={[]} {...defaultProps} />);
    expect(screen.getByTestId('canvas-zoom-reset')).toBeInTheDocument();
  });

  it('shows title edit input on double-click and calls onUpdateWidgetTitle on submit', () => {
    const onUpdateTitle = vi.fn();
    const widgets = [makeChartWidget('c1', 'My Chart')];
    render(<ChartPanel widgets={widgets} {...defaultProps} onUpdateWidgetTitle={onUpdateTitle} />);

    // Double-click the title to enter edit mode
    const titleEl = screen.getByText('My Chart');
    fireEvent.doubleClick(titleEl);

    // Should show the input
    const input = screen.getByTestId('canvas-widget-title-input-c1');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('My Chart');

    // Change value and submit
    fireEvent.change(input, { target: { value: 'Renamed Chart' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdateTitle).toHaveBeenCalledWith('c1', 'Renamed Chart');
  });

  it('does not have badge labels on widgets', () => {
    const widgets = [makeChartWidget('c1', 'Test'), makeTextWidget('t1', 'Note')];
    render(<ChartPanel widgets={widgets} {...defaultProps} />);
    // Badge elements should not exist
    const badges = document.querySelectorAll('.canvas-widget-badge');
    expect(badges).toHaveLength(0);
  });

  it('text widget has LTR direction', () => {
    const widgets = [makeTextWidget('t1', 'Hello')];
    render(<ChartPanel widgets={widgets} {...defaultProps} />);
    const textEl = screen.getByTestId('canvas-text-t1');
    expect(textEl.getAttribute('dir')).toBe('ltr');
  });
});
