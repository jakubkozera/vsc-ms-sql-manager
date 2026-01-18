import { useMemo } from 'react';
import { PlanNode, QueryPlan, getTopOperations, getOperationStyle } from '../../../services/queryPlanParser';
import './TopOperations.css';

interface TopOperationsProps {
  plan: QueryPlan;
  limit?: number;
  onOperationClick?: (node: PlanNode) => void;
  selectedNodeId?: string;
}

export function TopOperations({ plan, limit = 10, onOperationClick, selectedNodeId }: TopOperationsProps) {
  const topOps = useMemo(() => {
    return getTopOperations(plan, limit);
  }, [plan, limit]);
  
  if (topOps.length === 0) {
    return (
      <div className="top-operations-empty" data-testid="top-operations-empty">
        No operations in plan
      </div>
    );
  }
  
  const maxCost = topOps[0]?.estimatedCost || 1;
  
  return (
    <div className="top-operations" data-testid="top-operations">
      <div className="top-operations-header">
        <span className="header-label">Top {topOps.length} Operations by Cost</span>
        <span className="header-total">Total: {plan.estimatedTotalCost.toFixed(4)}</span>
      </div>
      
      <div className="operations-list">
        {topOps.map((node, index) => {
          const style = getOperationStyle(node.physicalOp);
          const costPercent = (node.estimatedCost / plan.estimatedTotalCost) * 100;
          const barWidth = (node.estimatedCost / maxCost) * 100;
          const isSelected = selectedNodeId === node.id;
          const hasWarnings = node.warnings && node.warnings.length > 0;
          
          return (
            <div
              key={node.id}
              className={`operation-item ${isSelected ? 'selected' : ''} ${hasWarnings ? 'has-warning' : ''}`}
              onClick={() => onOperationClick?.(node)}
              data-testid={`operation-${index}`}
            >
              <div className="operation-rank">#{index + 1}</div>
              
              <div className="operation-icon" style={{ color: style.color }}>
                {style.icon}
              </div>
              
              <div className="operation-info">
                <div className="operation-name">
                  {node.physicalOp}
                  {hasWarnings && <span className="warning-badge">⚠</span>}
                </div>
                <div className="operation-object">
                  {node.object ? (
                    <>
                      {node.object.table && <span className="object-table">{node.object.table}</span>}
                      {node.object.index && <span className="object-index">[{node.object.index}]</span>}
                    </>
                  ) : (
                    <span className="no-object">{node.logicalOp}</span>
                  )}
                </div>
                <div className="operation-cost-bar">
                  <div 
                    className="cost-bar-fill" 
                    style={{ 
                      width: `${barWidth}%`,
                      backgroundColor: style.color,
                    }} 
                  />
                </div>
              </div>
              
              <div className="operation-stats">
                <div className="stat-cost">
                  <span className={`cost-value ${costPercent > 20 ? 'high-cost' : ''}`}>
                    {costPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="stat-rows">
                  {formatNumber(node.estimatedRows)} rows
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}
