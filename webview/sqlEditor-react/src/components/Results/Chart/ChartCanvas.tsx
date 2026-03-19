import { useState, useRef, useCallback, useEffect } from 'react';
import { Chart, registerables } from 'chart.js';
import { CanvasWidget, CanvasChartWidget, CanvasTextWidget } from '../../../types/chart';
import './ChartCanvas.css';

Chart.register(...registerables);

interface ChartCanvasProps {
  widgets: CanvasWidget[];
  onUpdatePosition: (id: string, position: Partial<{ x: number; y: number; width: number; height: number }>) => void;
  onUpdateTextContent: (id: string, content: string) => void;
  onUpdateWidgetTitle: (id: string, title: string) => void;
  onRemoveWidget: (id: string) => void;
  onBringToFront: (id: string) => void;
  onAddText: () => void;
  onExportHTML: () => void;
  onExportSVG: (canvasElements: Map<string, HTMLCanvasElement>) => void;
  onExportPNG: (canvasElements: Map<string, HTMLCanvasElement>) => void;
}

type ResizeDirection = 'e' | 's' | 'se';

const MIN_WIDGET_WIDTH = 200;
const MIN_WIDGET_HEIGHT = 60;

// ─── CanvasChartBody ─────────────────────────────────────────

function CanvasChartBody({ widget, onCanvasRef }: { widget: CanvasChartWidget; onCanvasRef?: (id: string, el: HTMLCanvasElement | null) => void }) {
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

  // Register/unregister canvas element for SVG export
  useEffect(() => {
    if (onCanvasRef) {
      onCanvasRef(widget.id, canvasRef.current);
      return () => { onCanvasRef(widget.id, null); };
    }
  }, [widget.id, onCanvasRef]);

  return (
    <div className="canvas-widget-body chart-body">
      <canvas ref={canvasRef} data-testid={`canvas-chart-${widget.id}`} />
    </div>
  );
}

// ─── CanvasTextBody ──────────────────────────────────────────

function CanvasTextBody({ widget, onContentChange }: { widget: CanvasTextWidget; onContentChange: (content: string) => void }) {
  const divRef = useRef<HTMLDivElement>(null);

  // Set content via ref only — never pass children so React never clobbers the DOM and moves the caret
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    // Only overwrite when the source-of-truth changed externally (not from the user typing)
    if (el.textContent !== widget.content) {
      el.textContent = widget.content;
    }
  }, [widget.content]);

  const handleInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    onContentChange(e.currentTarget.textContent || '');
  }, [onContentChange]);

  return (
    <div className="canvas-widget-body text-body">
      <div
        ref={divRef}
        className="text-widget-content"
        contentEditable
        suppressContentEditableWarning
        dir="ltr"
        onInput={handleInput}
        onMouseDown={e => e.stopPropagation()}
        style={{
          fontSize: widget.fontSize ?? 14,
          fontWeight: widget.fontWeight ?? 'normal',
          color: widget.color,
          direction: 'ltr',
          textAlign: 'left',
        }}
        data-testid={`canvas-text-${widget.id}`}
      />
    </div>
  );
}

// ─── CanvasWidgetWrapper ──────────────────────────────────────

interface WidgetWrapperProps {
  widget: CanvasWidget;
  index: number;
  zoom: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onUpdatePosition: ChartCanvasProps['onUpdatePosition'];
  onUpdateTextContent: ChartCanvasProps['onUpdateTextContent'];
  onUpdateWidgetTitle: ChartCanvasProps['onUpdateWidgetTitle'];
  onRemove: (id: string) => void;
  onBringToFront: (id: string) => void;
  onCanvasRef?: (id: string, el: HTMLCanvasElement | null) => void;
}

function CanvasWidgetWrapper({
  widget, index, zoom, isSelected, onSelect, onUpdatePosition, onUpdateTextContent, onUpdateWidgetTitle, onRemove, onBringToFront, onCanvasRef,
}: WidgetWrapperProps) {
  const dragStart = useRef<{ x: number; y: number; wx: number; wy: number } | null>(null);
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number; dir: ResizeDirection } | null>(null);
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
  const handleResizeStart = useCallback((e: React.MouseEvent, dir: ResizeDirection) => {
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
        const dx = (e.clientX - dragStart.current.x) / zoom;
        const dy = (e.clientY - dragStart.current.y) / zoom;
        onUpdatePosition(widget.id, {
          x: Math.max(0, dragStart.current.wx + dx),
          y: Math.max(0, dragStart.current.wy + dy),
        });
      }
      if (resizeStart.current) {
        const dx = (e.clientX - resizeStart.current.x) / zoom;
        const dy = (e.clientY - resizeStart.current.y) / zoom;
        const { dir, w, h } = resizeStart.current;
        const newPos: Partial<{ width: number; height: number }> = {};
        if (dir.includes('e')) newPos.width = Math.max(MIN_WIDGET_WIDTH, w + dx);
        if (dir.includes('s')) newPos.height = Math.max(MIN_WIDGET_HEIGHT, h + dy);
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
  }, [widget.id, zoom, onUpdatePosition]);

  const title = widget.type === 'chart' ? widget.chart.title : (widget.type === 'text' ? (widget.title || widget.content.slice(0, 30) || 'Text') : 'Widget');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(title);

  const handleTitleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTitle(title);
    setIsEditingTitle(true);
  }, [title]);

  const handleTitleSubmit = useCallback(() => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== title) {
      onUpdateWidgetTitle(widget.id, trimmed);
    }
    setIsEditingTitle(false);
  }, [editTitle, title, widget.id, onUpdateWidgetTitle]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleTitleSubmit(); }
    if (e.key === 'Escape') { setIsEditingTitle(false); }
  }, [handleTitleSubmit]);

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
        {isEditingTitle ? (
          <input
            className="canvas-widget-title-input"
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={handleTitleKeyDown}
            onMouseDown={e => e.stopPropagation()}
            autoFocus
            data-testid={`canvas-widget-title-input-${widget.id}`}
          />
        ) : (
          <span className="canvas-widget-title" onDoubleClick={handleTitleDoubleClick} title="Double-click to rename">{title}</span>
        )}
        <button
          className="canvas-widget-btn delete"
          onClick={() => onRemove(widget.id)}
          title="Remove"
          data-testid={`canvas-widget-delete-${widget.id}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6l-12 12" />
            <path d="M6 6l12 12" />
          </svg>
        </button>
      </div>

      {widget.type === 'chart' && <CanvasChartBody widget={widget} onCanvasRef={onCanvasRef} />}
      {widget.type === 'text' && (
        <CanvasTextBody widget={widget} onContentChange={(c) => onUpdateTextContent(widget.id, c)} />
      )}

      {/* Resize handles — wrapped in pointer-events:none overlay so they always
          sit above body content regardless of stacking context */}
      <div className="resize-handles-overlay">
        <div
          className="resize-handle resize-handle-se"
          data-testid={`resize-handle-se-${widget.id}`}
          onMouseDown={e => handleResizeStart(e, 'se')}
        />
        <div
          className="resize-handle resize-handle-e"
          data-testid={`resize-handle-e-${widget.id}`}
          onMouseDown={e => handleResizeStart(e, 'e')}
        />
        <div
          className="resize-handle resize-handle-s"
          data-testid={`resize-handle-s-${widget.id}`}
          onMouseDown={e => handleResizeStart(e, 's')}
        />
      </div>
    </div>
  );
}

// ─── ChartCanvas ──────────────────────────────────────────────

export function ChartCanvas({ widgets, onUpdatePosition, onUpdateTextContent, onUpdateWidgetTitle, onRemoveWidget, onBringToFront, onAddText, onExportHTML, onExportSVG, onExportPNG }: ChartCanvasProps) {
  const [selectedWidget, setSelectedWidget] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const panXRef = useRef(0);
  const panYRef = useRef(0);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const canvasElementsRef = useRef<Map<string, HTMLCanvasElement>>(new Map());

  const handleCanvasRef = useCallback((id: string, el: HTMLCanvasElement | null) => {
    if (el) {
      canvasElementsRef.current.set(id, el);
    } else {
      canvasElementsRef.current.delete(id);
    }
  }, []);

  const handleExportSVG = useCallback(() => {
    onExportSVG(canvasElementsRef.current);
    setExportMenuOpen(false);
  }, [onExportSVG]);

  const handleExportPNG = useCallback(() => {
    onExportPNG(canvasElementsRef.current);
    setExportMenuOpen(false);
  }, [onExportPNG]);

  const handleExportHTMLClick = useCallback(() => {
    onExportHTML();
    setExportMenuOpen(false);
  }, [onExportHTML]);

  // Close export menu when clicking outside
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [exportMenuOpen]);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panXRef.current = panX; }, [panX]);
  useEffect(() => { panYRef.current = panY; }, [panY]);

  // Deselect when clicking empty canvas
  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setSelectedWidget(null);
  }, []);

  // Ctrl+Scroll → zoom toward cursor; plain scroll → pan
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const el = canvasRef.current;
    if (!el) return;

    if (e.ctrlKey) {
      const prevZoom = zoomRef.current;
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const nextZoom = Math.min(3, Math.max(0.25, Math.round((prevZoom + delta) * 100) / 100));
      if (nextZoom === prevZoom) return;

      const rect = el.getBoundingClientRect();
      const vx = e.clientX - rect.left;
      const vy = e.clientY - rect.top;
      const ratio = nextZoom / prevZoom;
      // Keep the content point under the cursor fixed after zoom:
      // new_panX = vx - ratio * (vx - panX)
      const newPanX = vx - ratio * (vx - panXRef.current);
      const newPanY = vy - ratio * (vy - panYRef.current);

      zoomRef.current = nextZoom;
      panXRef.current = newPanX;
      panYRef.current = newPanY;
      setZoom(nextZoom);
      setPanX(newPanX);
      setPanY(newPanY);
    } else {
      // Plain scroll → pan the canvas
      const newPanX = panXRef.current - e.deltaX;
      const newPanY = panYRef.current - e.deltaY;
      panXRef.current = newPanX;
      panYRef.current = newPanY;
      setPanX(newPanX);
      setPanY(newPanY);
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 1) return;
    e.preventDefault();
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: panXRef.current,
      panY: panYRef.current,
    };
    setIsPanning(true);
  }, []);

  const handleAuxClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  }, []);

  useEffect(() => {
    if (!isPanning) return;

    const handleMouseMove = (e: MouseEvent) => {
      const start = panStartRef.current;
      if (!start) return;

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const newPanX = start.panX + dx;
      const newPanY = start.panY + dy;
      panXRef.current = newPanX;
      panYRef.current = newPanY;
      setPanX(newPanX);
      setPanY(newPanY);
    };

    const handleMouseUp = () => {
      panStartRef.current = null;
      setIsPanning(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPanning]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  return (
    <div className="chart-canvas-container" style={{ height: '100%' }}>
      <div className="canvas-overlay-controls canvas-overlay-controls-top-left" data-testid="chart-canvas-controls-top-left">
        <button className="canvas-control-btn" onClick={onAddText} data-testid="canvas-add-text-btn" title="Add text block">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 16v-6a2 2 0 1 1 4 0v6" />
            <path d="M3 13h4" />
            <path d="M10 8v6a2 2 0 1 0 4 0v-1a2 2 0 1 0 -4 0v1" />
            <path d="M20.732 12a2 2 0 0 0 -3.732 1v1a2 2 0 0 0 3.726 1.01" />
          </svg>
          Add Text
        </button>
        <div className="canvas-export-dropdown" ref={exportMenuRef} data-testid="canvas-export-dropdown">
          <button className="canvas-control-btn" onClick={() => setExportMenuOpen(o => !o)} data-testid="canvas-export-btn" title="Export">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
              <path d="M11 13l9 -9" />
              <path d="M15 4h5v5" />
            </svg>
            Export
          </button>
          {exportMenuOpen && (
            <div className="canvas-export-menu" data-testid="canvas-export-menu">
              <button className="canvas-export-menu-item" onClick={handleExportHTMLClick} data-testid="canvas-export-html-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                  <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
                  <path d="M2 21v-6" />
                  <path d="M5 15v6" />
                  <path d="M2 18h3" />
                  <path d="M20 15v6h2" />
                  <path d="M13 21v-6l2 3l2 -3v6" />
                  <path d="M7.5 15h3" />
                  <path d="M9 15v6" />
                </svg>
                HTML
              </button>
              <button className="canvas-export-menu-item" onClick={handleExportSVG} data-testid="canvas-export-svg-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                  <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
                  <path d="M4 20.25c0 .414.336.75.75.75h2.5a.75.75 0 0 0 .75-.75v-1.5a.75.75 0 0 0-.75-.75h-1.5v-1.5h1.5a.75.75 0 0 0 0-1.5h-2.5a.75.75 0 0 0-.75.75v1.5c0 .414.336.75.75.75h1.5v1.5h-1.5a.75.75 0 0 0-.75.75z" />
                  <path d="M11 15l1.5 6l1.5 -6" />
                  <path d="M17 21v-2.5a2 2 0 1 1 4 0v2.5" />
                  <path d="M17 19h4" />
                </svg>
                SVG
              </button>
              <button className="canvas-export-menu-item" onClick={handleExportPNG} data-testid="canvas-export-png-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 8h.01" />
                  <path d="M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12z" />
                  <path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5" />
                  <path d="M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3" />
                </svg>
                PNG
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="canvas-overlay-controls canvas-overlay-controls-bottom-right" data-testid="chart-canvas-controls-bottom-right">
        <span className="zoom-label" data-testid="canvas-zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom(1)}
          className="zoom-reset-btn"
          data-testid="canvas-zoom-reset"
          title="Reset zoom"
          aria-label="Reset zoom"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 21l-6 -6" />
            <path d="M3.268 12.043a7.017 7.017 0 0 0 6.634 4.957a7.012 7.012 0 0 0 7.043 -6.131a7 7 0 0 0 -5.314 -7.672a7.021 7.021 0 0 0 -8.241 4.403" />
            <path d="M3 4v4h4" />
          </svg>
        </button>
      </div>

      <div
        className={`chart-canvas ${isPanning ? 'is-panning' : ''}`}
        ref={canvasRef}
        onClick={handleCanvasClick}
        onMouseDown={handleMouseDown}
        onAuxClick={handleAuxClick}
        data-testid="chart-canvas"
      >
        <div className="chart-canvas-inner" style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})`, transformOrigin: '0 0' }}>
        {widgets.map((widget, index) => (
          <CanvasWidgetWrapper
            key={widget.id}
            widget={widget}
            index={index}
            zoom={zoom}
            isSelected={selectedWidget === widget.id}
            onSelect={setSelectedWidget}
            onUpdatePosition={onUpdatePosition}
            onUpdateTextContent={onUpdateTextContent}
            onUpdateWidgetTitle={onUpdateWidgetTitle}
            onRemove={onRemoveWidget}
            onBringToFront={onBringToFront}
            onCanvasRef={handleCanvasRef}
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
    </div>
  );
}
