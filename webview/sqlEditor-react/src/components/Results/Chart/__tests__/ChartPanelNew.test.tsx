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

describe('ChartPanel (canvas-based)', () => {
  it('renders empty canvas when no widgets', () => {
    render(
      <ChartPanel
        widgets={[]}
        onUpdatePosition={noop}
        onUpdateTextContent={noop}
        onRemoveWidget={noop}
        onBringToFront={noop}
        onAddText={noop}
        onExportHTML={noop}
      />
    );
    expect(screen.getByTestId('chart-canvas-empty')).toBeInTheDocument();
  });

  it('renders chart widget on canvas', () => {
    const widgets = [makeChartWidget('c1', 'Sales Chart')];
    render(
      <ChartPanel
        widgets={widgets}
        onUpdatePosition={noop}
        onUpdateTextContent={noop}
        onRemoveWidget={noop}
        onBringToFront={noop}
        onAddText={noop}
        onExportHTML={noop}
      />
    );
    expect(screen.getByTestId('canvas-widget-c1')).toBeInTheDocument();
    expect(screen.getByText('Sales Chart')).toBeInTheDocument();
  });

  it('renders text widget on canvas', () => {
    const widgets = [makeTextWidget('t1', 'Hello world')];
    render(
      <ChartPanel
        widgets={widgets}
        onUpdatePosition={noop}
        onUpdateTextContent={noop}
        onRemoveWidget={noop}
        onBringToFront={noop}
        onAddText={noop}
        onExportHTML={noop}
      />
    );
    expect(screen.getByTestId('canvas-widget-t1')).toBeInTheDocument();
  });

  it('renders toolbar with Add Text and Export buttons', () => {
    render(
      <ChartPanel
        widgets={[]}
        onUpdatePosition={noop}
        onUpdateTextContent={noop}
        onRemoveWidget={noop}
        onBringToFront={noop}
        onAddText={noop}
        onExportHTML={noop}
      />
    );
    expect(screen.getByTestId('canvas-add-text-btn')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-export-html-btn')).toBeInTheDocument();
  });

  it('calls onAddText when Add Text button is clicked', () => {
    const onAddText = vi.fn();
    render(
      <ChartPanel
        widgets={[]}
        onUpdatePosition={noop}
        onUpdateTextContent={noop}
        onRemoveWidget={noop}
        onBringToFront={noop}
        onAddText={onAddText}
        onExportHTML={noop}
      />
    );
    fireEvent.click(screen.getByTestId('canvas-add-text-btn'));
    expect(onAddText).toHaveBeenCalledTimes(1);
  });

  it('calls onRemoveWidget when delete button is clicked', () => {
    const onRemove = vi.fn();
    const widgets = [makeChartWidget('c1', 'Test')];
    render(
      <ChartPanel
        widgets={widgets}
        onUpdatePosition={noop}
        onUpdateTextContent={noop}
        onRemoveWidget={onRemove}
        onBringToFront={noop}
        onAddText={noop}
        onExportHTML={noop}
      />
    );
    fireEvent.click(screen.getByTestId('canvas-widget-delete-c1'));
    expect(onRemove).toHaveBeenCalledWith('c1');
  });

  it('calls onExportHTML when Export HTML is clicked', () => {
    const onExport = vi.fn();
    const widgets = [makeChartWidget('c1', 'Test')];
    render(
      <ChartPanel
        widgets={widgets}
        onUpdatePosition={noop}
        onUpdateTextContent={noop}
        onRemoveWidget={noop}
        onBringToFront={noop}
        onAddText={noop}
        onExportHTML={onExport}
      />
    );
    fireEvent.click(screen.getByTestId('canvas-export-html-btn'));
    expect(onExport).toHaveBeenCalledTimes(1);
    // Should receive HTML string
    expect(onExport.mock.calls[0][0]).toContain('<!DOCTYPE html>');
  });

  it('renders multiple widgets', () => {
    const widgets = [
      makeChartWidget('c1', 'Chart 1'),
      makeTextWidget('t1', 'Note'),
      makeChartWidget('c2', 'Chart 2'),
    ];
    render(
      <ChartPanel
        widgets={widgets}
        onUpdatePosition={noop}
        onUpdateTextContent={noop}
        onRemoveWidget={noop}
        onBringToFront={noop}
        onAddText={noop}
        onExportHTML={noop}
      />
    );
    expect(screen.getByTestId('canvas-widget-c1')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-widget-t1')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-widget-c2')).toBeInTheDocument();
  });
});
