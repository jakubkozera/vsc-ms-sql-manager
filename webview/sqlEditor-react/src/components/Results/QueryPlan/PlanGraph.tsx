import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { PlanNode, QueryPlan, getOperationStyle, OperationIconId } from '../../../services/queryPlanParser';
import {
  IconTarget, IconListSearch, IconTable, IconLink, IconRefresh,
  IconGitMerge, IconSortAscending, IconCalculator, IconFilter,
  IconSum, IconBolt, IconKey, IconArrowUp, IconEdit, IconUpload,
  IconSettings, IconZoomIn, IconZoomOut, IconMaximize, IconAlertTriangle,
} from './icons';
import './PlanGraph.css';

interface PlanGraphProps {
  plan: QueryPlan;
  onNodeClick?: (node: PlanNode) => void;
  onNodeHover?: (node: PlanNode | null) => void;
  focusNodeId?: string | null;
}

interface LayoutNode extends PlanNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;
const NODE_MARGIN_X = 40;
const NODE_MARGIN_Y = 30;
const ARROW_SIZE = 8;

function getOperationIcon(iconId: OperationIconId, size = 16) {
  const map: Record<OperationIconId, JSX.Element> = {
    'target': <IconTarget size={size} />,
    'list-search': <IconListSearch size={size} />,
    'table': <IconTable size={size} />,
    'link': <IconLink size={size} />,
    'refresh': <IconRefresh size={size} />,
    'git-merge': <IconGitMerge size={size} />,
    'sort-ascending': <IconSortAscending size={size} />,
    'calculator': <IconCalculator size={size} />,
    'filter': <IconFilter size={size} />,
    'sum': <IconSum size={size} />,
    'bolt': <IconBolt size={size} />,
    'key': <IconKey size={size} />,
    'arrow-up': <IconArrowUp size={size} />,
    'edit': <IconEdit size={size} />,
    'upload': <IconUpload size={size} />,
    'settings': <IconSettings size={size} />,
  };
  return map[iconId];
}

export { getOperationIcon };

/**
 * Calculate tree layout (right-to-left flow like SSMS)
 */
function calculateLayout(root: PlanNode): { nodes: LayoutNode[]; maxX: number; maxY: number } {
  const nodes: LayoutNode[] = [];
  let maxX = 0;
  let maxY = 0;
  
  function processNode(node: PlanNode, depth: number, yOffset: number): { height: number; result: LayoutNode } {
    const x = depth * (NODE_WIDTH + NODE_MARGIN_X);
    let y = yOffset;
    
    // First, layout all children
    let totalChildHeight = 0;
    const childLayouts: { height: number; result: LayoutNode }[] = [];
    
    for (const child of node.children) {
      const childLayout = processNode(child, depth + 1, yOffset + totalChildHeight);
      childLayouts.push(childLayout);
      totalChildHeight += childLayout.height + NODE_MARGIN_Y;
    }
    
    // Remove last margin
    if (totalChildHeight > 0) {
      totalChildHeight -= NODE_MARGIN_Y;
    }
    
    // Center this node vertically among its children
    if (childLayouts.length > 0) {
      const firstChild = childLayouts[0].result;
      const lastChild = childLayouts[childLayouts.length - 1].result;
      y = (firstChild.y + lastChild.y) / 2;
    }
    
    const resultNode: LayoutNode = {
      ...node,
      x,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      children: childLayouts.map(c => c.result),
    };
    
    nodes.push(resultNode);
    
    maxX = Math.max(maxX, x + NODE_WIDTH);
    maxY = Math.max(maxY, y + NODE_HEIGHT);
    
    const height = Math.max(NODE_HEIGHT, totalChildHeight);
    return { height, result: resultNode };
  }
  
  processNode(root, 0, 0);
  
  return { nodes, maxX, maxY };
}

export function PlanGraph({ plan, onNodeClick, onNodeHover, focusNodeId }: PlanGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 20, y: 20, scale: 1 });
  const [hoveredNode, setHoveredNode] = useState<LayoutNode | null>(null);
  const [pinnedNode, setPinnedNode] = useState<LayoutNode | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  // The node whose tooltip is currently visible (pinned takes priority)
  const activeTooltipNode = pinnedNode || hoveredNode;
  
  // Calculate layout
  const layout = useMemo(() => {
    return calculateLayout(plan.root);
  }, [plan.root]);
  
  // Fit to container on first render
  useEffect(() => {
    if (containerRef.current && layout.maxX > 0) {
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;
      
      const scaleX = (containerWidth - 40) / (layout.maxX + 40);
      const scaleY = (containerHeight - 40) / (layout.maxY + 40);
      const scale = Math.min(scaleX, scaleY, 1);
      
      setTransform({ x: 20, y: 20, scale });
    }
  }, [layout]);

  // Focus on a specific node (zoom + pan)
  const focusOnNode = useCallback((nodeId: string) => {
    if (!containerRef.current) return;
    const targetNode = layout.nodes.find(n => n.id === nodeId);
    if (!targetNode) return;

    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight;
    const scale = 1;
    const x = containerWidth / 2 - (targetNode.x + NODE_WIDTH / 2) * scale;
    const y = containerHeight / 2 - (targetNode.y + NODE_HEIGHT / 2) * scale;
    setTransform({ x, y, scale });
  }, [layout.nodes]);

  // React to focusNodeId changes
  useEffect(() => {
    if (focusNodeId) {
      focusOnNode(focusNodeId);
      const target = layout.nodes.find(n => n.id === focusNodeId);
      if (target) {
        setPinnedNode(prev => prev?.id === target.id ? null : target);
      }
    }
  }, [focusNodeId, focusOnNode, layout.nodes]);
  
  // Pan handling
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
    }
  };
  
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setTransform(prev => ({
        ...prev,
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      }));
    }
  };
  
  const handleMouseUp = () => {
    setIsDragging(false);
  };
  
  // Zoom handling
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = containerRef.current.getBoundingClientRect();
    // Cursor position relative to the container
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    setTransform(prev => {
      const newScale = Math.min(Math.max(prev.scale * delta, 0.1), 3);
      // Adjust translation so the point under the cursor stays fixed
      const scaleRatio = newScale / prev.scale;
      return {
        x: mouseX - (mouseX - prev.x) * scaleRatio,
        y: mouseY - (mouseY - prev.y) * scaleRatio,
        scale: newScale,
      };
    });
  };
  
  const handleNodeClick = (node: LayoutNode) => {
    // Toggle pin on click: if same node is pinned, unpin; otherwise pin this one
    setPinnedNode(prev => prev?.id === node.id ? null : node);
    onNodeClick?.(node);
  };

  // Click on background dismisses pinned tooltip
  const handleBackgroundClick = (e: React.MouseEvent) => {
    if ((e.target as SVGElement).tagName === 'svg' || (e.target as SVGElement).tagName === 'rect') {
      // Only dismiss if click is on the SVG background, not on a node
      const target = e.target as SVGElement;
      if (!target.closest('.plan-node')) {
        setPinnedNode(null);
      }
    }
  };
  
  const handleNodeHover = (node: LayoutNode | null) => {
    setHoveredNode(node);
    onNodeHover?.(node);
  };
  
  const handleZoomIn = () => {
    setTransform(prev => ({ ...prev, scale: Math.min(prev.scale * 1.2, 3) }));
  };
  
  const handleZoomOut = () => {
    setTransform(prev => ({ ...prev, scale: Math.max(prev.scale / 1.2, 0.1) }));
  };
  
  const handleZoomFit = () => {
    if (containerRef.current && layout.maxX > 0) {
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;
      
      const scaleX = (containerWidth - 40) / (layout.maxX + 40);
      const scaleY = (containerHeight - 40) / (layout.maxY + 40);
      const scale = Math.min(scaleX, scaleY, 1);
      
      setTransform({ x: 20, y: 20, scale });
    }
  };
  
  // Render edges (uniform thin lines)
  const renderEdges = () => {
    const edges: JSX.Element[] = [];
    
    function renderNodeEdges(node: LayoutNode) {
      for (const child of node.children as LayoutNode[]) {
        const startX = node.x + NODE_WIDTH;
        const startY = node.y + NODE_HEIGHT / 2;
        const endX = child.x;
        const endY = child.y + NODE_HEIGHT / 2;
        
        // Curved path
        const midX = (startX + endX) / 2;
        const path = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
        
        edges.push(
          <g key={`edge-${node.id}-${child.id}`}>
            <path
              d={path}
              fill="none"
              stroke="var(--vscode-foreground)"
              strokeWidth={1.5}
              strokeOpacity={0.3}
              markerEnd="url(#arrowhead)"
            />
            {/* Row count label */}
            <text
              x={midX}
              y={(startY + endY) / 2 - 5}
              textAnchor="middle"
              fontSize="10"
              fill="var(--vscode-descriptionForeground)"
            >
              {formatNumber(child.estimatedRows)}
            </text>
          </g>
        );
        
        renderNodeEdges(child);
      }
    }
    
    renderNodeEdges(layout.nodes.find(n => n.id === plan.root.id) as LayoutNode);
    
    return edges;
  };
  
  // Render nodes
  const renderNodes = () => {
    return layout.nodes.map(node => {
      const style = getOperationStyle(node.physicalOp);
      const isPinned = pinnedNode?.id === node.id;
      const isHovered = hoveredNode?.id === node.id;
      const isHighlighted = isPinned || isHovered;
      const costPercent = (node.estimatedCost / plan.estimatedTotalCost) * 100;
      const hasWarnings = node.warnings && node.warnings.length > 0;
      
      return (
        <g
          key={node.id}
          transform={`translate(${node.x}, ${node.y})`}
          className={`plan-node ${isHighlighted ? 'hovered' : ''} ${isPinned ? 'pinned' : ''}`}
          onClick={(e) => { e.stopPropagation(); handleNodeClick(node); }}
          onMouseEnter={() => handleNodeHover(node)}
          onMouseLeave={() => handleNodeHover(null)}
          style={{ cursor: 'pointer' }}
        >
          {/* Node background */}
          <rect
            width={NODE_WIDTH}
            height={NODE_HEIGHT}
            rx={6}
            fill="var(--vscode-editor-background)"
            stroke={isHighlighted ? 'var(--vscode-focusBorder)' : style.color}
            strokeWidth={isHighlighted ? 2 : 1}
          />
          
          {/* Cost bar */}
          <rect
            x={0}
            y={NODE_HEIGHT - 4}
            width={(NODE_WIDTH * Math.min(costPercent, 100)) / 100}
            height={4}
            rx={0}
            fill={style.color}
            opacity={0.7}
          />
          
          {/* Icon */}
          <foreignObject x={8} y={12} width={20} height={20}>
            <div style={{ color: style.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {getOperationIcon(style.icon, 16)}
            </div>
          </foreignObject>
          
          {/* Operation name */}
          <text
            x={34}
            y={24}
            fontSize="12"
            fontWeight="600"
            fill="var(--vscode-foreground)"
          >
            {truncateText(node.physicalOp, 18)}
          </text>
          
          {/* Object name */}
          {node.object && (
            <text
              x={34}
              y={40}
              fontSize="10"
              fill="var(--vscode-descriptionForeground)"
            >
              {truncateText(node.object.table || node.object.index || '', 20)}
            </text>
          )}
          
          {/* Cost percentage */}
          <text
            x={NODE_WIDTH - 8}
            y={24}
            textAnchor="end"
            fontSize="11"
            fontWeight="500"
            fill={costPercent > 20 ? '#f44336' : 'var(--vscode-foreground)'}
          >
            {costPercent.toFixed(0)}%
          </text>
          
          {/* Estimated rows */}
          <text
            x={12}
            y={NODE_HEIGHT - 12}
            fontSize="10"
            fill="var(--vscode-descriptionForeground)"
          >
            Est: {formatNumber(node.estimatedRows)}
          </text>
          
          {/* Actual rows (if available) */}
          {node.actualRows !== undefined && (
            <text
              x={NODE_WIDTH / 2}
              y={NODE_HEIGHT - 12}
              fontSize="10"
              fill="var(--vscode-descriptionForeground)"
            >
              Act: {formatNumber(node.actualRows)}
            </text>
          )}
          
          {/* Warning indicator */}
          {hasWarnings && (
            <foreignObject x={NODE_WIDTH - 24} y={2} width={20} height={20}>
              <div style={{ color: '#ff9800', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconAlertTriangle size={14} />
              </div>
            </foreignObject>
          )}
        </g>
      );
    });
  };
  
  return (
    <div 
      ref={containerRef}
      className="plan-graph-container"
      data-testid="plan-graph"
    >
      {/* Toolbar */}
      <div className="plan-graph-toolbar">
        <button onClick={handleZoomIn} title="Zoom In"><IconZoomIn size={16} /></button>
        <button onClick={handleZoomOut} title="Zoom Out"><IconZoomOut size={16} /></button>
        <button onClick={handleZoomFit} title="Fit to View"><IconMaximize size={16} /></button>
        <span className="zoom-level">{Math.round(transform.scale * 100)}%</span>
      </div>
      
      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onClick={handleBackgroundClick}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth={ARROW_SIZE}
            markerHeight={ARROW_SIZE}
            refX={ARROW_SIZE - 2}
            refY={ARROW_SIZE / 2}
            orient="auto"
          >
            <polygon
              points={`0 0, ${ARROW_SIZE} ${ARROW_SIZE / 2}, 0 ${ARROW_SIZE}`}
              fill="var(--vscode-foreground)"
              opacity={0.5}
            />
          </marker>
        </defs>
        
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {renderEdges()}
          {renderNodes()}
        </g>
      </svg>
      
      {/* Tooltip - shown for pinned or hovered node */}
      {activeTooltipNode && (
        <div
          className={`plan-node-tooltip ${pinnedNode ? 'pinned' : ''}`}
          data-testid="plan-node-tooltip"
          style={{
            left: (activeTooltipNode.x + NODE_WIDTH) * transform.scale + transform.x + 10,
            top: activeTooltipNode.y * transform.scale + transform.y,
          }}
          onMouseEnter={() => {
            // Keep tooltip visible when mouse enters it (for hover mode)
            if (!pinnedNode) {
              setHoveredNode(activeTooltipNode);
            }
          }}
          onMouseLeave={() => {
            // Hide tooltip when mouse leaves it (for hover mode only)
            if (!pinnedNode) {
              setHoveredNode(null);
            }
          }}
        >
          <div className="tooltip-header">{activeTooltipNode.physicalOp}</div>
          <div className="tooltip-row">
            <span>Logical Op:</span>
            <span>{activeTooltipNode.logicalOp}</span>
          </div>
          <div className="tooltip-row">
            <span>Est. Rows:</span>
            <span>{formatNumber(activeTooltipNode.estimatedRows)}</span>
          </div>
          {activeTooltipNode.actualRows !== undefined && (
            <div className="tooltip-row">
              <span>Actual Rows:</span>
              <span>{formatNumber(activeTooltipNode.actualRows)}</span>
            </div>
          )}
          <div className="tooltip-row">
            <span>Est. I/O:</span>
            <span>{activeTooltipNode.estimatedIO.toFixed(6)}</span>
          </div>
          <div className="tooltip-row">
            <span>Est. CPU:</span>
            <span>{activeTooltipNode.estimatedCPU.toFixed(6)}</span>
          </div>
          <div className="tooltip-row">
            <span>Subtree Cost:</span>
            <span>{activeTooltipNode.estimatedSubtreeCost.toFixed(6)}</span>
          </div>
          {activeTooltipNode.object && (
            <div className="tooltip-row">
              <span>Object:</span>
              <span>{[activeTooltipNode.object.schema, activeTooltipNode.object.table].filter(Boolean).join('.')}</span>
            </div>
          )}
          {activeTooltipNode.object?.index && (
            <div className="tooltip-row">
              <span>Index:</span>
              <span>{activeTooltipNode.object.index}</span>
            </div>
          )}
          {activeTooltipNode.predicate && (
            <div className="tooltip-row full-width">
              <span>Predicate:</span>
              <span className="predicate-text">{activeTooltipNode.predicate}</span>
            </div>
          )}
          {activeTooltipNode.warnings && activeTooltipNode.warnings.length > 0 && (
            <div className="tooltip-warnings">
              {activeTooltipNode.warnings.map((w, i) => (
                <div key={i} className="warning-item">
                  <IconAlertTriangle size={12} /> {w}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? text.substring(0, maxLength - 1) + '…' : text;
}
