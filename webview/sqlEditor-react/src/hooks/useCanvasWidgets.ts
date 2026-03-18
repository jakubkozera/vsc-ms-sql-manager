import { useState, useCallback } from 'react';
import { CanvasWidget, CanvasWidgetPosition, ChartConfig } from '../types/chart';

let nextId = 1;
function generateId(): string {
  return `widget-${Date.now()}-${nextId++}`;
}

export function useCanvasWidgets() {
  const [widgets, setWidgets] = useState<CanvasWidget[]>([]);

  const addChart = useCallback((chart: ChartConfig) => {
    const id = generateId();
    // Stack new charts below existing ones
    const maxY = widgets.reduce((max, w) => Math.max(max, w.position.y + w.position.height), 0);
    const widget: CanvasWidget = {
      id,
      type: 'chart',
      position: { x: 0, y: maxY > 0 ? maxY + 16 : 0, width: 600, height: 350 },
      chart: { ...chart, id },
    };
    setWidgets(prev => [...prev, widget]);
    return id;
  }, [widgets]);

  const addText = useCallback((content = 'Double-click to edit') => {
    const id = generateId();
    const maxY = widgets.reduce((max, w) => Math.max(max, w.position.y + w.position.height), 0);
    const widget: CanvasWidget = {
      id,
      type: 'text',
      position: { x: 0, y: maxY > 0 ? maxY + 16 : 0, width: 400, height: 80 },
      content,
      fontSize: 14,
      fontWeight: 'normal',
    };
    setWidgets(prev => [...prev, widget]);
    return id;
  }, [widgets]);

  const updatePosition = useCallback((id: string, position: Partial<CanvasWidgetPosition>) => {
    setWidgets(prev => prev.map(w =>
      w.id === id ? { ...w, position: { ...w.position, ...position } } : w
    ));
  }, []);

  const updateTextContent = useCallback((id: string, content: string) => {
    setWidgets(prev => prev.map(w =>
      w.id === id && w.type === 'text' ? { ...w, content } : w
    ));
  }, []);

  const updateTextStyle = useCallback((id: string, style: { fontSize?: number; fontWeight?: 'normal' | 'bold'; color?: string }) => {
    setWidgets(prev => prev.map(w =>
      w.id === id && w.type === 'text' ? { ...w, ...style } : w
    ));
  }, []);

  const removeWidget = useCallback((id: string) => {
    setWidgets(prev => prev.filter(w => w.id !== id));
  }, []);

  const bringToFront = useCallback((id: string) => {
    setWidgets(prev => {
      const idx = prev.findIndex(w => w.id === id);
      if (idx < 0 || idx === prev.length - 1) return prev;
      const next = [...prev];
      const [widget] = next.splice(idx, 1);
      next.push(widget);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setWidgets([]);
  }, []);

  return {
    widgets,
    addChart,
    addText,
    updatePosition,
    updateTextContent,
    updateTextStyle,
    removeWidget,
    bringToFront,
    clearAll,
  };
}
