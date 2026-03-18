import { useState, useRef, useCallback, useEffect } from 'react';
import { Chart, registerables } from 'chart.js';
import { CanvasWidget, CanvasChartWidget, CanvasTextWidget, CHART_TYPE_LABELS } from '../../../types/chart';
import './ChartCanvas.css';

Chart.register(...registerables);

interface ChartCanvasProps {
  widgets: CanvasWidget[];
  onUpdatePosition: (id: string, position: Partial<{ x: number; y: number; width: number; height: number }>) => void;
  onUpdateTextContent: (id: string, content: string) => void;
  onRemoveWidget: (id: string) => void;
  onBringToFront: (id: string) => void;
  onAddText: () => void;
  onExportHTML: () => void;
}

// ─── CanvasChartBody ─────────────────────────────────────────

function CanvasChartBody({ widget }: { widget: CanvasChartWidget }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const getColor = (v: string, fb: string) => {
      if (typeof document === 'undefined') return fb;
      return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fb;
    };
    const textColor = getColor('--vscode-foreground', '#cccccc');
    const gridColor = getColor('--vscode-widget-border', '#454545') + '40';

    const { data, labelColumn, dataColumns, colors } = widget.chart;
    const labelIndex = data.columns.indexOf(labelColumn);
    const labels = labelIndex >= 0
      ? data.rows.map(row => String(row[labelIndex] ?? ''))
      : data.rows.map((_, i) => String(i + 1));

    const isPieType = widget.chart.chartType === 'pie' || widget.chart.chartType === 'doughnut';
    const datasets = dataColumns.map((colName, dsIndex) => {
      const colIndex = data.columns.indexOf(colName);
      const values = colIndex >= 0
        ? data.rows.map(row => { const v = row[colIndex]; return typeof v === 'number' ? v : Number(v) || 0; })
        : [];
      const color = colors[dsIndex % colors.length];
      return {
        label: colName,
        data: values,
        backgroundColor: isPieType ? values.map((_, i) => colors[i % colors.length]) : color + '99',
        borderColor: isPieType ? values.map((_, i) => colors[i % colors.length]) : color,
        borderWidth: isPieType ? 1 : 2,
        tension: widget.chart.chartType === 'line' ? 0.3 : undefined,
        fill: widget.chart.chartType === 'line' ? false : undefined,
      };
    });

    chartRef.current = new Chart(canvasRef.current, {
      type: widget.chart.chartType,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: {
            display: dataColumns.length > 1 || isPieType,
            position: isPieType ? 'right' : 'top',
            labels: { color: textColor, font: { size: 11 } },
          },
          title: { display: false },
        },
        scales: isPieType ? {} : {
          x: { ticks: { color: textColor, font: { size: 11 } }, grid: { color: gridColor } },
          y: { ticks: { color: textColor, font: { size: 11 } }, grid: { color: gridColor }, beginAtZero: true },
        },
      },
    });

    return () => {
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    };
  }, [widget.chart]);

  // Resize chart when widget dimensions change
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.resize();
    }
  }, [widget.position.width, widget.position.height]);

  return (
    <div className="canvas-widget-body chart-body">
      <canvas ref={canvasRef} data-testid={`canvas-chart-${widget.id}`} />
    </div>
  );
}

// ─── CanvasTextBody ──────────────────────────────────────────

function CanvasTextBody({ widget, onContentChange }: { widget: CanvasTextWidget; onContentChange: (content: string) => void }) {
  const handleInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    onContentChange(e.currentTarget.textContent || '');
  }, [onContentChange]);

  return (
    <div className="canvas-widget-body text-body">
      <div
        className="text-widget-content"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onMouseDown={e => e.stopPropagation()}
        style={{
          fontSize: widget.fontSize ?? 14,
          fontWeight: widget.fontWeight ?? 'normal',
          color: widget.color,
        }}
        data-testid={`canvas-text-${widget.id}`}
      >
        {widget.content}
      </div>
    </div>
  );
}

// ─── CanvasWidgetWrapper ──────────────────────────────────────

interface WidgetWrapperProps {
  widget: CanvasWidget;
  index: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onUpdatePosition: ChartCanvasProps['onUpdatePosition'];
  onUpdateTextContent: ChartCanvasProps['onUpdateTextContent'];
  onRemove: (id: string) => void;
  onBringToFront: (id: string) => void;
}

function CanvasWidgetWrapper({
  widget, index, isSelected, onSelect, onUpdatePosition, onUpdateTextContent, onRemove, onBringToFront,
}: WidgetWrapperProps) {
  const dragStart = useRef<{ x: number; y: number; wx: number; wy: number } | null>(null);
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number; dir: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Drag handling
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Don't start drag from resize handles or buttons
    if ((e.target as HTMLElement).closest('.resize-handle, .canvas-widget-btn, .text-widget-content')) return;
    e.preventDefault();
    onSelect(widget.id);
    onBringToFront(widget.id);
    dragStart.current = { x: e.clientX, y: e.clientY, wx: widget.position.x, wy: widget.position.y };
    setIsDragging(true);
  }, [widget.id, widget.position.x, widget.position.y, onSelect, onBringToFront]);

  // Resize handling
  const handleResizeStart = useCallback((e: React.MouseEvent, dir: string) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(widget.id);
    resizeStart.current = {
      x: e.clientX, y: e.clientY,
      w: widget.position.width, h: widget.position.height,
      dir,
    };
  }, [widget.id, widget.position.width, widget.position.height, onSelect]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragStart.current) {
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        onUpdatePosition(widget.id, {
          x: Math.max(0, dragStart.current.wx + dx),
          y: Math.max(0, dragStart.current.wy + dy),
        });
      }
      if (resizeStart.current) {
        const dx = e.clientX - resizeStart.current.x;
        const dy = e.clientY - resizeStart.current.y;
        const { dir, w, h } = resizeStart.current;
        const newPos: Partial<{ width: number; height: number }> = {};
        if (dir.includes('e')) newPos.width = Math.max(200, w + dx);
        if (dir.includes('s')) newPos.height = Math.max(60, h + dy);
        onUpdatePosition(widget.id, newPos);
      }
    };

    const handleMouseUp = () => {
      dragStart.current = null;
      resizeStart.current = null;
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [widget.id, onUpdatePosition]);

  const title = widget.type === 'chart' ? widget.chart.title : 'Text';
  const badge = widget.type === 'chart' ? CHART_TYPE_LABELS[widget.chart.chartType] : 'Text';

  return (
    <div
      className={`canvas-widget ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{
        left: widget.position.x,
        top: widget.position.y,
        width: widget.position.width,
        height: widget.position.height,
        zIndex: index + 1,
      }}
      onMouseDown={handleDragStart}
      data-testid={`canvas-widget-${widget.id}`}
    >
      <div className="canvas-widget-header">
        <span className="canvas-widget-title">{title}</span>
        <span className="canvas-widget-badge">{badge}</span>
        <button
          className="canvas-widget-btn delete"
          onClick={() => onRemove(widget.id)}
          title="Remove"
          data-testid={`canvas-widget-delete-${widget.id}`}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm2.646 4.646L8.707 7.585l1.939 1.939-.707.707-1.939-1.939-1.939 1.939-.707-.707L7.293 7.585 5.354 5.646l.707-.707L8 6.878l1.939-1.939.707.707z" />
          </svg>
        </button>
      </div>

      {widget.type === 'chart' && <CanvasChartBody widget={widget} />}
      {widget.type === 'text' && (
        <CanvasTextBody widget={widget} onContentChange={(c) => onUpdateTextContent(widget.id, c)} />
      )}

      {/* Resize handles */}
      <div className="resize-handle resize-handle-se" onMouseDown={e => handleResizeStart(e, 'se')} />
      <div className="resize-handle resize-handle-e" onMouseDown={e => handleResizeStart(e, 'e')} />
      <div className="resize-handle resize-handle-s" onMouseDown={e => handleResizeStart(e, 's')} />
    </div>
  );
}

// ─── ChartCanvas ──────────────────────────────────────────────

export function ChartCanvas({ widgets, onUpdatePosition, onUpdateTextContent, onRemoveWidget, onBringToFront, onAddText, onExportHTML }: ChartCanvasProps) {
  const [selectedWidget, setSelectedWidget] = useState<string | null>(null);

  // Deselect when clicking empty canvas
  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setSelectedWidget(null);
  }, []);

  return (
    <div className="chart-canvas-container" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="chart-canvas-toolbar" data-testid="chart-canvas-toolbar">
        <button onClick={onAddText} data-testid="canvas-add-text-btn" title="Add text block">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 3h12v2H9v8H7V5H2V3z" />
          </svg>
          Add Text
        </button>
        <div className="separator" />
        <button onClick={onExportHTML} data-testid="canvas-export-html-btn" title="Export as HTML">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 1h8l3 3v9a2 2 0 01-2 2H3a2 2 0 01-2-2V3a2 2 0 012-2h1zm7.5 1H4v12h8V4.5L11.5 2zM6 7h4v1H6V7zm0 2h4v1H6V9z" />
          </svg>
          Export HTML
        </button>
      </div>

      <div className="chart-canvas" onClick={handleCanvasClick} data-testid="chart-canvas">
        {widgets.map((widget, index) => (
          <CanvasWidgetWrapper
            key={widget.id}
            widget={widget}
            index={index}
            isSelected={selectedWidget === widget.id}
            onSelect={setSelectedWidget}
            onUpdatePosition={onUpdatePosition}
            onUpdateTextContent={onUpdateTextContent}
            onRemove={onRemoveWidget}
            onBringToFront={onBringToFront}
          />
        ))}

        {widgets.length === 0 && (
          <div className="chart-panel-empty" data-testid="chart-canvas-empty" style={{ position: 'absolute', inset: 0 }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="12" width="4" height="9" rx="1" />
              <rect x="10" y="6" width="4" height="15" rx="1" />
              <rect x="17" y="3" width="4" height="18" rx="1" />
            </svg>
            <p>No charts created</p>
            <p className="hint">Select data in the Results grid, right-click and choose "Create Chart" to visualize your data</p>
            <p className="hint">Use "Add Text" in the toolbar to add annotations</p>
          </div>
        )}
      </div>
    </div>
  );
}
