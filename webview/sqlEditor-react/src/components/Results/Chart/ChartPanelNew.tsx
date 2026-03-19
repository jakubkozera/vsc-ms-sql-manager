import { CanvasWidget } from '../../../types/chart';
import { ChartCanvas } from './ChartCanvas';
import { exportCanvasToHTML, exportCanvasToSVG, exportCanvasToPNG } from '../../../services/chartExportService';
import './ChartPanel.css';

interface ChartPanelProps {
  widgets: CanvasWidget[];
  onUpdatePosition: (id: string, position: Partial<{ x: number; y: number; width: number; height: number }>) => void;
  onUpdateTextContent: (id: string, content: string) => void;
  onUpdateWidgetTitle: (id: string, title: string) => void;
  onRemoveWidget: (id: string) => void;
  onBringToFront: (id: string) => void;
  onAddText: () => void;
  onExportHTML: (html: string) => void;
  onExportSVG: (svg: string) => void;
  onExportPNG: (base64: string) => void;
}

export function ChartPanel({
  widgets,
  onUpdatePosition,
  onUpdateTextContent,
  onUpdateWidgetTitle,
  onRemoveWidget,
  onBringToFront,
  onAddText,
  onExportHTML,
  onExportSVG,
  onExportPNG,
}: ChartPanelProps) {
  const handleExportHTML = () => {
    const html = exportCanvasToHTML(widgets);
    onExportHTML(html);
  };

  const handleExportSVG = async (canvasElements: Map<string, HTMLCanvasElement>) => {
    const svg = await exportCanvasToSVG(widgets, canvasElements);
    onExportSVG(svg);
  };

  const handleExportPNG = async (canvasElements: Map<string, HTMLCanvasElement>) => {
    const base64 = await exportCanvasToPNG(widgets, canvasElements);
    onExportPNG(base64);
  };

  return (
    <div style={{ height: '100%' }} data-testid="chart-panel">
      <ChartCanvas
        widgets={widgets}
        onUpdatePosition={onUpdatePosition}
        onUpdateTextContent={onUpdateTextContent}
        onUpdateWidgetTitle={onUpdateWidgetTitle}
        onRemoveWidget={onRemoveWidget}
        onBringToFront={onBringToFront}
        onAddText={onAddText}
        onExportHTML={handleExportHTML}
        onExportSVG={handleExportSVG}
        onExportPNG={handleExportPNG}
      />
    </div>
  );
}
