import { CanvasWidget } from '../types/chart';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the Chart.js config JS for a chart widget.
 */
function buildChartJsConfig(widget: CanvasWidget & { type: 'chart' }): string {
  const { chart } = widget;
  const { data, labelColumn, dataColumns, colors, chartType } = chart;
  const labelIndex = data.columns.indexOf(labelColumn);
  const labels = labelIndex >= 0
    ? data.rows.map(row => String(row[labelIndex] ?? ''))
    : data.rows.map((_, i) => String(i + 1));

  const isPieType = chartType === 'pie' || chartType === 'doughnut';

  const datasets = dataColumns.map((colName, dsIndex) => {
    const colIndex = data.columns.indexOf(colName);
    const values = colIndex >= 0
      ? data.rows.map(row => { const v = row[colIndex]; return typeof v === 'number' ? v : Number(v) || 0; })
      : [];
    const color = colors[dsIndex % colors.length];

    return {
      label: colName,
      data: values,
      backgroundColor: isPieType
        ? values.map((_, i) => colors[i % colors.length])
        : color + '99',
      borderColor: isPieType
        ? values.map((_, i) => colors[i % colors.length])
        : color,
      borderWidth: isPieType ? 1 : 2,
      ...(chartType === 'line' ? { tension: 0.3, fill: false } : {}),
    };
  });

  const config = {
    type: chartType,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: dataColumns.length > 1 || isPieType,
          position: isPieType ? 'right' : 'top',
        },
        title: { display: true, text: chart.title },
      },
      ...(!isPieType ? {
        scales: {
          x: { beginAtZero: true },
          y: { beginAtZero: true },
        },
      } : {}),
    },
  };

  // Escape </ to prevent breaking out of <script> tags (XSS prevention)
  return JSON.stringify(config, null, 2).replace(/<\//g, '<\\/');
}

/**
 * Export the canvas widgets to a standalone HTML file with embedded Chart.js.
 */
export function exportCanvasToHTML(widgets: CanvasWidget[]): string {
  const chartWidgets = widgets.filter(w => w.type === 'chart') as (CanvasWidget & { type: 'chart' })[];
  const textWidgets = widgets.filter(w => w.type === 'text') as (CanvasWidget & { type: 'text' })[];

  const chartConfigs = chartWidgets.map((w, i) => ({
    id: `chart-${i}`,
    config: buildChartJsConfig(w),
    title: w.chart.title,
    position: w.position,
  }));

  const textBlocks = textWidgets.map((w, i) => ({
    id: `text-${i}`,
    content: w.content,
    position: w.position,
    fontSize: w.fontSize ?? 14,
    fontWeight: w.fontWeight ?? 'normal',
    color: w.color ?? '#cccccc',
  }));

  // Canvas size — compute bounding box
  const maxRight = widgets.reduce((max, w) => Math.max(max, w.position.x + w.position.width), 800);
  const maxBottom = widgets.reduce((max, w) => Math.max(max, w.position.y + w.position.height), 600);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Chart Export</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #1e1e1e;
    color: #cccccc;
    min-height: 100vh;
  }
  .canvas-container {
    position: relative;
    width: ${maxRight + 40}px;
    min-height: ${maxBottom + 40}px;
    padding: 20px;
  }
  .widget {
    position: absolute;
    background: #252526;
    border: 1px solid #454545;
    border-radius: 6px;
    overflow: hidden;
  }
  .widget-header {
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 500;
    background: #2d2d2d;
    border-bottom: 1px solid #454545;
  }
  .widget-body {
    padding: 10px;
    height: calc(100% - 32px);
  }
  .widget-body canvas {
    width: 100% !important;
    height: 100% !important;
  }
  .text-widget-body {
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    overflow: auto;
    height: calc(100% - 32px);
    padding: 8px 12px;
  }
</style>
</head>
<body>
<div class="canvas-container">
${chartConfigs.map(c => `  <div class="widget" style="left:${c.position.x + 20}px;top:${c.position.y + 20}px;width:${c.position.width}px;height:${c.position.height}px;">
    <div class="widget-header">${escapeHtml(c.title)}</div>
    <div class="widget-body"><canvas id="${c.id}"></canvas></div>
  </div>`).join('\n')}
${textBlocks.map(t => `  <div class="widget" style="left:${t.position.x + 20}px;top:${t.position.y + 20}px;width:${t.position.width}px;height:${t.position.height}px;">
    <div class="widget-header">Text</div>
    <div class="text-widget-body" style="font-size:${t.fontSize}px;font-weight:${t.fontWeight};color:${t.color};">${escapeHtml(t.content)}</div>
  </div>`).join('\n')}
</div>
<script>
${chartConfigs.map(c => `(function() {
  var ctx = document.getElementById('${c.id}');
  new Chart(ctx, ${c.config});
})();`).join('\n')}
</script>
</body>
</html>`;
}

/**
 * Export the canvas widgets to an SVG with embedded chart images.
 * Chart.js charts are rendered as base64 PNG images inside the SVG.
 */
export async function exportCanvasToSVG(widgets: CanvasWidget[], canvasElements: Map<string, HTMLCanvasElement>): Promise<string> {
  const maxRight = widgets.reduce((max, w) => Math.max(max, w.position.x + w.position.width), 800);
  const maxBottom = widgets.reduce((max, w) => Math.max(max, w.position.y + w.position.height), 600);

  let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxRight + 40}" height="${maxBottom + 40}" viewBox="0 0 ${maxRight + 40} ${maxBottom + 40}">
  <rect width="100%" height="100%" fill="#1e1e1e"/>`;

  for (const widget of widgets) {
    const { x, y, width, height } = widget.position;

    // Widget container
    svgContent += `
  <rect x="${x + 20}" y="${y + 20}" width="${width}" height="${height}" rx="6" fill="#252526" stroke="#454545" stroke-width="1"/>
  <rect x="${x + 20}" y="${y + 20}" width="${width}" height="28" rx="6" fill="#2d2d2d"/>
  <rect x="${x + 20}" y="${y + 42}" width="${width}" height="6" fill="#2d2d2d"/>
  <line x1="${x + 20}" y1="${y + 48}" x2="${x + 20 + width}" y2="${y + 48}" stroke="#454545" stroke-width="1"/>`;

    if (widget.type === 'chart') {
      // Header text
      svgContent += `
  <text x="${x + 30}" y="${y + 39}" font-family="sans-serif" font-size="12" fill="#cccccc">${escapeHtml(widget.chart.title)}</text>`;

      // Try to get canvas as image
      const canvasEl = canvasElements.get(widget.id);
      if (canvasEl) {
        try {
          const dataUrl = canvasEl.toDataURL('image/png');
          svgContent += `
  <image x="${x + 28}" y="${y + 56}" width="${width - 16}" height="${height - 44}" href="${dataUrl}"/>`;
        } catch {
          svgContent += `
  <text x="${x + 30}" y="${y + 80}" font-family="sans-serif" font-size="12" fill="#999">[Chart image unavailable]</text>`;
        }
      }
    } else if (widget.type === 'text') {
      svgContent += `
  <text x="${x + 30}" y="${y + 39}" font-family="sans-serif" font-size="12" fill="#cccccc">Text</text>`;

      // Render text content
      const lines = widget.content.split('\n');
      const fontSize = widget.fontSize ?? 14;
      lines.forEach((line, i) => {
        if (y + 56 + i * (fontSize * 1.5) < y + height) {
          svgContent += `
  <text x="${x + 32}" y="${y + 56 + fontSize + i * (fontSize * 1.5)}" font-family="sans-serif" font-size="${fontSize}" font-weight="${widget.fontWeight ?? 'normal'}" fill="${widget.color ?? '#cccccc'}">${escapeHtml(line)}</text>`;
        }
      });
    }
  }

  svgContent += '\n</svg>';
  return svgContent;
}
