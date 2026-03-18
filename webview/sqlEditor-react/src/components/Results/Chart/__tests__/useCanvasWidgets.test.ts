import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCanvasWidgets } from '../../../../hooks/useCanvasWidgets';
import { ChartConfig, DEFAULT_CHART_COLORS } from '../../../../types/chart';

const sampleChart: ChartConfig = {
  id: 'temp',
  chartType: 'bar',
  title: 'Test Chart',
  labelColumn: 'Name',
  dataColumns: ['Value'],
  data: { columns: ['Name', 'Value'], rows: [['A', 10], ['B', 20]] },
  colors: DEFAULT_CHART_COLORS,
};

describe('useCanvasWidgets', () => {
  it('starts with no widgets', () => {
    const { result } = renderHook(() => useCanvasWidgets());
    expect(result.current.widgets).toEqual([]);
  });

  it('addChart adds a chart widget', () => {
    const { result } = renderHook(() => useCanvasWidgets());
    act(() => { result.current.addChart(sampleChart); });
    expect(result.current.widgets).toHaveLength(1);
    expect(result.current.widgets[0].type).toBe('chart');
    const w = result.current.widgets[0];
    if (w.type === 'chart') {
      expect(w.chart.title).toBe('Test Chart');
      expect(w.chart.chartType).toBe('bar');
    }
  });

  it('addText adds a text widget with defaults', () => {
    const { result } = renderHook(() => useCanvasWidgets());
    act(() => { result.current.addText(); });
    expect(result.current.widgets).toHaveLength(1);
    const w = result.current.widgets[0];
    expect(w.type).toBe('text');
    if (w.type === 'text') {
      expect(w.content).toBe('Double-click to edit');
      expect(w.fontSize).toBe(14);
    }
  });

  it('addText accepts custom content', () => {
    const { result } = renderHook(() => useCanvasWidgets());
    act(() => { result.current.addText('Hello'); });
    const w = result.current.widgets[0];
    if (w.type === 'text') {
      expect(w.content).toBe('Hello');
    }
  });

  it('positions second widget below first', () => {
    const { result } = renderHook(() => useCanvasWidgets());
    act(() => { result.current.addChart(sampleChart); });
    act(() => { result.current.addText('Note'); });
    expect(result.current.widgets).toHaveLength(2);
    const secondY = result.current.widgets[1].position.y;
    const firstBottom = result.current.widgets[0].position.y + result.current.widgets[0].position.height;
    expect(secondY).toBeGreaterThanOrEqual(firstBottom);
  });

  it('updatePosition updates partial position', () => {
    const { result } = renderHook(() => useCanvasWidgets());
    act(() => { result.current.addChart(sampleChart); });
    const id = result.current.widgets[0].id;
    act(() => { result.current.updatePosition(id, { x: 100, y: 50 }); });
    expect(result.current.widgets[0].position.x).toBe(100);
    expect(result.current.widgets[0].position.y).toBe(50);
    // width and height should remain unchanged
    expect(result.current.widgets[0].position.width).toBe(600);
    expect(result.current.widgets[0].position.height).toBe(350);
  });

  it('updatePosition updates width/height', () => {
    const { result } = renderHook(() => useCanvasWidgets());
    act(() => { result.current.addChart(sampleChart); });
    const id = result.current.widgets[0].id;
    act(() => { result.current.updatePosition(id, { width: 800, height: 400 }); });
    expect(result.current.widgets[0].position.width).toBe(800);
    expect(result.current.widgets[0].position.height).toBe(400);
  });

  it('updateTextContent updates only text widgets', () => {
    const { result } = renderHook(() => useCanvasWidgets());
    act(() => { result.current.addText('old'); });
    const id = result.current.widgets[0].id;
    act(() => { result.current.updateTextContent(id, 'new content'); });
    const w = result.current.widgets[0];
    if (w.type === 'text') {
      expect(w.content).toBe('new content');
    }
  });

  it('updateTextContent does nothing for chart widgets', () => {
    const { result } = renderHook(() => useCanvasWidgets());
    act(() => { result.current.addChart(sampleChart); });
    const id = result.current.widgets[0].id;
    act(() => { result.current.updateTextContent(id, 'should not change'); });
    expect(result.current.widgets[0].type).toBe('chart');
  });

  it('updateTextStyle updates font size and weight', () => {
    const { result } = renderHook(() => useCanvasWidgets());
    act(() => { result.current.addText('styled'); });
    const id = result.current.widgets[0].id;
    act(() => { result.current.updateTextStyle(id, { fontSize: 20, fontWeight: 'bold' }); });
    const w = result.current.widgets[0];
    if (w.type === 'text') {
      expect(w.fontSize).toBe(20);
      expect(w.fontWeight).toBe('bold');
    }
  });

  it('removeWidget removes a widget by id', () => {
    const { result } = renderHook(() => useCanvasWidgets());
    act(() => { result.current.addChart(sampleChart); });
    act(() => { result.current.addText('note'); });
    expect(result.current.widgets).toHaveLength(2);
    const id = result.current.widgets[0].id;
    act(() => { result.current.removeWidget(id); });
    expect(result.current.widgets).toHaveLength(1);
    expect(result.current.widgets[0].type).toBe('text');
  });

  it('bringToFront moves a widget to the end of the array', () => {
    const { result } = renderHook(() => useCanvasWidgets());
    act(() => { result.current.addChart(sampleChart); });
    act(() => { result.current.addText('note'); });
    const firstId = result.current.widgets[0].id;
    act(() => { result.current.bringToFront(firstId); });
    expect(result.current.widgets[result.current.widgets.length - 1].id).toBe(firstId);
  });

  it('bringToFront is a no-op if already last', () => {
    const { result } = renderHook(() => useCanvasWidgets());
    act(() => { result.current.addChart(sampleChart); });
    act(() => { result.current.addText('note'); });
    const lastId = result.current.widgets[1].id;
    const before = [...result.current.widgets];
    act(() => { result.current.bringToFront(lastId); });
    expect(result.current.widgets.map(w => w.id)).toEqual(before.map(w => w.id));
  });

  it('clearAll removes all widgets', () => {
    const { result } = renderHook(() => useCanvasWidgets());
    act(() => { result.current.addChart(sampleChart); });
    act(() => { result.current.addText('note'); });
    expect(result.current.widgets).toHaveLength(2);
    act(() => { result.current.clearAll(); });
    expect(result.current.widgets).toHaveLength(0);
  });

  it('each widget gets a unique id', () => {
    const { result } = renderHook(() => useCanvasWidgets());
    act(() => { result.current.addChart(sampleChart); });
    act(() => { result.current.addChart(sampleChart); });
    act(() => { result.current.addText('t'); });
    const ids = result.current.widgets.map(w => w.id);
    expect(new Set(ids).size).toBe(3);
  });
});
