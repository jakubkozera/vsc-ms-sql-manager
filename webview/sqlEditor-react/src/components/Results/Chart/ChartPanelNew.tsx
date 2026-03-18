import { CanvasWidget } from '../../../types/chart';
import { ChartCanvas } from './ChartCanvas';
import { exportCanvasToHTML } from '../../../services/chartExportService';
import './ChartPanel.css';

interface ChartPanelProps {
  widgets: CanvasWidget[];
  onUpdatePosition: (id: string, position: Partial<{ x: number; y: number; width: number; height: number }>) => void;
  onUpdateTextContent: (id: string, content: string) => void;
  onRemoveWidget: (id: string) => void;
  onBringToFront: (id: string) => void;
  onAddText: () => void;
  onExportHTML: (html: string) => void;
}

export function ChartPanel({
  widgets,
  onUpdatePosition,
  onUpdateTextContent,
  onRemoveWidget,
  onBringToFront,
  onAddText,
  onExportHTML,
}: ChartPanelProps) {
  const handleExportHTML = () => {
    const html = exportCanvasToHTML(widgets);
    onExportHTML(html);
  };

  return (
    <div style={{ height: '100%' }} data-testid="chart-panel">
      <ChartCanvas
        widgets={widgets}
        onUpdatePosition={onUpdatePosition}
        onUpdateTextContent={onUpdateTextContent}
        onRemoveWidget={onRemoveWidget}
        onBringToFront={onBringToFront}
        onAddText={onAddText}
        onExportHTML={handleExportHTML}
      />
    </div>
  );
}
