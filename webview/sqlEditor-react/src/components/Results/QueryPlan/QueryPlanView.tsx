import './QueryPlanView.css';

interface QueryPlanViewProps {
  planXml: string;
  isEstimated: boolean;
}

export function QueryPlanView({ planXml, isEstimated }: QueryPlanViewProps) {
  // TODO: Implement full D3 visualization in Stage 6
  // For now, show the raw XML in a formatted way

  return (
    <div className="query-plan-view" data-testid="query-plan-view">
      <div className="plan-header">
        <h3>{isEstimated ? 'Estimated' : 'Actual'} Execution Plan</h3>
        <span className="plan-badge">Stage 6: D3 Visualization coming soon</span>
      </div>

      <div className="plan-content">
        <div className="plan-placeholder">
          <div className="placeholder-icon">📊</div>
          <p>Query Plan visualization will be implemented in Stage 6</p>
          <details className="plan-xml-details">
            <summary>View raw XML ({planXml.length} characters)</summary>
            <pre className="plan-xml">{formatXml(planXml)}</pre>
          </details>
        </div>
      </div>
    </div>
  );
}

// Simple XML formatter
function formatXml(xml: string): string {
  try {
    let formatted = '';
    let indent = 0;
    const lines = xml.replace(/></g, '>\n<').split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('</')) {
        indent = Math.max(0, indent - 1);
      }

      formatted += '  '.repeat(indent) + trimmed + '\n';

      if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.endsWith('/>') && !trimmed.includes('</')) {
        indent++;
      }
    }

    return formatted.trim();
  } catch {
    return xml;
  }
}
