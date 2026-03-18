import { describe, it, expect } from 'vitest';
import { exportCanvasToHTML } from '../../../../services/chartExportService';
import { CanvasWidget, DEFAULT_CHART_COLORS } from '../../../../types/chart';

const makeChartWidget = (id: string, title: string): CanvasWidget => ({
  id,
  type: 'chart',
  position: { x: 10, y: 20, width: 600, height: 350 },
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
  fontSize: 16,
  fontWeight: 'bold',
  color: '#ff0000',
});

describe('chartExportService', () => {
  describe('exportCanvasToHTML', () => {
    it('returns a valid HTML document', () => {
      const html = exportCanvasToHTML([]);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
      expect(html).toContain('</html>');
    });

    it('includes Chart.js CDN script', () => {
      const html = exportCanvasToHTML([]);
      expect(html).toContain('chart.js@4');
    });

    it('renders chart widget as canvas element', () => {
      const html = exportCanvasToHTML([makeChartWidget('c1', 'Sales')]);
      expect(html).toContain('<canvas id="chart-0"');
      expect(html).toContain('Sales');
    });

    it('escapes HTML in chart titles', () => {
      const html = exportCanvasToHTML([makeChartWidget('c1', '<script>alert("xss")</script>')]);
      // Title in widget header should be HTML-escaped
      expect(html).toContain('&lt;script&gt;');
      // In JSON config within <script> block, </ should be escaped to <\/ to prevent XSS
      expect(html).toContain('<\\/script>');
      // The raw </script> should not appear in JSON section (would break out of script block)
      const scriptBody = html.split('<script>').pop()!.split('</script>').shift()!;
      expect(scriptBody).not.toContain('</script>');
    });

    it('renders text widget content', () => {
      const html = exportCanvasToHTML([makeTextWidget('t1', 'Hello world')]);
      expect(html).toContain('Hello world');
    });

    it('escapes HTML in text content', () => {
      const html = exportCanvasToHTML([makeTextWidget('t1', '<b>bold</b>')]);
      expect(html).not.toContain('<b>bold</b>');
      expect(html).toContain('&lt;b&gt;');
    });

    it('applies text widget styles', () => {
      const html = exportCanvasToHTML([makeTextWidget('t1', 'styled')]);
      expect(html).toContain('font-size:16px');
      expect(html).toContain('font-weight:bold');
      expect(html).toContain('color:#ff0000');
    });

    it('positions widgets using position data', () => {
      const widget = makeChartWidget('c1', 'Test');
      widget.position = { x: 50, y: 100, width: 400, height: 300 };
      const html = exportCanvasToHTML([widget]);
      // Position is offset by 20px for padding
      expect(html).toContain('left:70px');
      expect(html).toContain('top:120px');
      expect(html).toContain('width:400px');
      expect(html).toContain('height:300px');
    });

    it('generates Chart.js config in script block', () => {
      const html = exportCanvasToHTML([makeChartWidget('c1', 'Test')]);
      // Check for chart config JSON
      expect(html).toContain('"type": "bar"');
      expect(html).toContain('"data":');
      expect(html).toContain('new Chart(ctx,');
    });

    it('renders both chart and text widgets together', () => {
      const widgets = [
        makeChartWidget('c1', 'My Chart'),
        makeTextWidget('t1', 'My Note'),
      ];
      const html = exportCanvasToHTML(widgets);
      expect(html).toContain('My Chart');
      expect(html).toContain('My Note');
      expect(html).toContain('<canvas id="chart-0"');
    });

    it('computes canvas container size from widget bounds', () => {
      const widget = makeChartWidget('c1', 'Wide');
      widget.position = { x: 500, y: 200, width: 800, height: 400 };
      const html = exportCanvasToHTML([widget]);
      // maxRight = 500 + 800 = 1300, + 40 = 1340
      expect(html).toContain('width: 1340px');
    });

    it('handles pie chart type', () => {
      const widget = makeChartWidget('c1', 'Pie');
      if (widget.type === 'chart') {
        widget.chart.chartType = 'pie';
      }
      const html = exportCanvasToHTML([widget]);
      expect(html).toContain('"type": "pie"');
    });

    it('handles multiple data columns', () => {
      const widget: CanvasWidget = {
        id: 'mc',
        type: 'chart',
        position: { x: 0, y: 0, width: 600, height: 350 },
        chart: {
          id: 'mc',
          chartType: 'line',
          title: 'Multi',
          labelColumn: 'Month',
          dataColumns: ['Sales', 'Expenses'],
          data: {
            columns: ['Month', 'Sales', 'Expenses'],
            rows: [['Jan', 100, 80], ['Feb', 120, 90]],
          },
          colors: DEFAULT_CHART_COLORS,
        },
      };
      const html = exportCanvasToHTML([widget]);
      expect(html).toContain('"type": "line"');
      expect(html).toContain('Sales');
      expect(html).toContain('Expenses');
    });
  });
});
