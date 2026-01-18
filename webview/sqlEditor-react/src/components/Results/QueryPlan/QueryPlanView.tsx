import { useState, useMemo } from 'react';
import { PlanNode, parseQueryPlan, calculatePlanStats, ParsedPlanResult } from '../../../services/queryPlanParser';
import { PlanGraph } from './PlanGraph';
import { TopOperations } from './TopOperations';
import './QueryPlanView.css';

interface QueryPlanViewProps {
  planXml: string;
  statementText?: string;
}

type ViewMode = 'graph' | 'tree' | 'xml';

export function QueryPlanView({ planXml, statementText }: QueryPlanViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [selectedNode, setSelectedNode] = useState<PlanNode | null>(null);
  const [showSidePanel, setShowSidePanel] = useState(true);
  
  // Parse the plan XML
  const parseResult = useMemo<ParsedPlanResult>(() => {
    return parseQueryPlan(planXml);
  }, [planXml]);
  
  // Calculate statistics for all plans
  const allStats = useMemo(() => {
    return parseResult.plans.map(plan => ({
      plan,
      stats: calculatePlanStats(plan),
    }));
  }, [parseResult.plans]);
  
  // Currently selected plan (for multi-statement batches)
  const [selectedPlanIndex, setSelectedPlanIndex] = useState(0);
  const currentPlan = parseResult.plans[selectedPlanIndex];
  const currentStats = allStats[selectedPlanIndex]?.stats;
  
  const handleNodeClick = (node: PlanNode) => {
    setSelectedNode(node);
  };
  
  const handleNodeHover = (node: PlanNode | null) => {
    if (node) {
      setSelectedNode(node);
    }
  };
  
  const handleOperationClick = (node: PlanNode) => {
    setSelectedNode(node);
  };
  
  if (parseResult.error || parseResult.parseErrors.length > 0) {
    return (
      <div className="query-plan-error" data-testid="plan-error">
        <div className="error-icon">⚠</div>
        <div className="error-title">Failed to parse execution plan</div>
        <div className="error-message">{parseResult.error || parseResult.parseErrors.join(', ')}</div>
      </div>
    );
  }
  
  if (parseResult.plans.length === 0) {
    return (
      <div className="query-plan-empty" data-testid="plan-empty">
        <div className="empty-icon">📊</div>
        <div className="empty-title">No execution plan available</div>
        <div className="empty-hint">Execute a query with actual or estimated plan enabled</div>
      </div>
    );
  }
  
  return (
    <div className="query-plan-view" data-testid="query-plan-view">
      {/* Header */}
      <div className="plan-header">
        <div className="plan-tabs">
          {parseResult.plans.length > 1 && (
            <div className="statement-tabs">
              {parseResult.plans.map((_, idx) => (
                <button
                  key={idx}
                  className={`statement-tab ${idx === selectedPlanIndex ? 'active' : ''}`}
                  onClick={() => setSelectedPlanIndex(idx)}
                >
                  Query {idx + 1}
                </button>
              ))}
            </div>
          )}
        </div>
        
        <div className="plan-toolbar">
          <div className="view-mode-toggle">
            <button
              className={viewMode === 'graph' ? 'active' : ''}
              onClick={() => setViewMode('graph')}
              title="Graphical View"
            >
              🔀 Graph
            </button>
            <button
              className={viewMode === 'tree' ? 'active' : ''}
              onClick={() => setViewMode('tree')}
              title="Tree View"
            >
              📋 Tree
            </button>
            <button
              className={viewMode === 'xml' ? 'active' : ''}
              onClick={() => setViewMode('xml')}
              title="XML View"
            >
              📄 XML
            </button>
          </div>
          
          <button
            className={`toggle-panel ${showSidePanel ? 'active' : ''}`}
            onClick={() => setShowSidePanel(!showSidePanel)}
            title={showSidePanel ? 'Hide Panel' : 'Show Panel'}
          >
            {showSidePanel ? '◀' : '▶'}
          </button>
        </div>
      </div>
      
      {/* Stats bar */}
      {currentStats && (
        <div className="plan-stats-bar">
          <div className="stat-item">
            <span className="stat-label">Operations:</span>
            <span className="stat-value">{currentStats.totalOperations}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Depth:</span>
            <span className="stat-value">{currentStats.maxDepth}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Est. Rows:</span>
            <span className="stat-value">{formatNumber(currentStats.estimatedTotalRows)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Est. Cost:</span>
            <span className="stat-value">{currentPlan.estimatedTotalCost.toFixed(4)}</span>
          </div>
          {currentStats.hasWarnings && (
            <div className="stat-item warning">
              <span className="stat-label">⚠</span>
              <span className="stat-value">Has warnings</span>
            </div>
          )}
          {currentStats.parallelism && (
            <div className="stat-item">
              <span className="stat-label">⚡</span>
              <span className="stat-value">Parallel</span>
            </div>
          )}
        </div>
      )}
      
      {/* Statement text */}
      {(statementText || currentPlan.statementText) && (
        <div className="plan-statement">
          <code>{statementText || currentPlan.statementText}</code>
        </div>
      )}
      
      {/* Main content */}
      <div className="plan-content">
        <div className={`plan-main ${showSidePanel ? 'with-panel' : ''}`}>
          {viewMode === 'graph' && (
            <PlanGraph
              plan={currentPlan}
              onNodeClick={handleNodeClick}
              onNodeHover={handleNodeHover}
            />
          )}
          
          {viewMode === 'tree' && (
            <PlanTreeView
              plan={currentPlan}
              selectedNode={selectedNode}
              onNodeClick={handleNodeClick}
            />
          )}
          
          {viewMode === 'xml' && (
            <div className="plan-xml">
              <pre><code>{planXml}</code></pre>
            </div>
          )}
        </div>
        
        {showSidePanel && (
          <div className="plan-side-panel">
            <TopOperations
              plan={currentPlan}
              onOperationClick={handleOperationClick}
              selectedNodeId={selectedNode?.id}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Simple tree view for alternative display
interface PlanTreeViewProps {
  plan: { root: PlanNode; estimatedTotalCost: number };
  selectedNode: PlanNode | null;
  onNodeClick: (node: PlanNode) => void;
}

function PlanTreeView({ plan, selectedNode, onNodeClick }: PlanTreeViewProps) {
  const renderNode = (node: PlanNode, depth: number = 0): JSX.Element => {
    const isSelected = selectedNode?.id === node.id;
    const costPercent = (node.estimatedCost / plan.estimatedTotalCost) * 100;
    const hasWarnings = node.warnings && node.warnings.length > 0;
    
    return (
      <div key={node.id} className="tree-node-container">
        <div
          className={`tree-node ${isSelected ? 'selected' : ''} ${hasWarnings ? 'has-warning' : ''}`}
          style={{ marginLeft: depth * 24 }}
          onClick={() => onNodeClick(node)}
        >
          <span className="tree-expand">
            {node.children.length > 0 ? '▼' : '•'}
          </span>
          <span className="tree-icon">{node.physicalOp.substring(0, 2)}</span>
          <span className="tree-name">{node.physicalOp}</span>
          {node.object?.table && (
            <span className="tree-object">[{node.object.table}]</span>
          )}
          <span className={`tree-cost ${costPercent > 20 ? 'high' : ''}`}>
            {costPercent.toFixed(1)}%
          </span>
          <span className="tree-rows">{formatNumber(node.estimatedRows)}</span>
          {hasWarnings && <span className="tree-warning">⚠</span>}
        </div>
        {node.children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };
  
  return (
    <div className="plan-tree-view" data-testid="plan-tree-view">
      {renderNode(plan.root)}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

export { PlanGraph } from './PlanGraph';
export { TopOperations } from './TopOperations';
