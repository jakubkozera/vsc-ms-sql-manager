import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryPlanView } from './QueryPlanView';
import { PlanGraph } from './PlanGraph';
import { PlanNode, QueryPlan } from '../../../services/queryPlanParser';

// Minimal valid execution plan XML
const SIMPLE_PLAN_XML = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.0">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple StatementText="SELECT * FROM Users" StatementType="SELECT">
          <QueryPlan CachedPlanSize="16">
            <RelOp NodeId="0" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan"
              EstimateRows="100" EstimatedTotalSubtreeCost="0.05" EstimateIO="0.03" EstimateCPU="0.02">
              <OutputList>
                <ColumnReference Database="TestDB" Schema="dbo" Table="Users" Column="Id" />
              </OutputList>
              <IndexScan>
                <Object Database="TestDB" Schema="dbo" Table="Users" Index="PK_Users" />
              </IndexScan>
            </RelOp>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>`;

const PLAN_WITH_CHILDREN_XML = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.0">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple StatementText="SELECT * FROM Users u JOIN Orders o ON u.Id = o.UserId" StatementType="SELECT">
          <QueryPlan CachedPlanSize="32">
            <RelOp NodeId="0" PhysicalOp="Hash Match" LogicalOp="Inner Join"
              EstimateRows="500" EstimatedTotalSubtreeCost="0.5" EstimateIO="0.1" EstimateCPU="0.05">
              <RelOp NodeId="1" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan"
                EstimateRows="100" EstimatedTotalSubtreeCost="0.1" EstimateIO="0.05" EstimateCPU="0.03">
                <IndexScan>
                  <Object Database="TestDB" Schema="dbo" Table="Users" Index="PK_Users" />
                </IndexScan>
              </RelOp>
              <RelOp NodeId="2" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan"
                EstimateRows="1000" EstimatedTotalSubtreeCost="0.3" EstimateIO="0.2" EstimateCPU="0.1">
                <IndexScan>
                  <Object Database="TestDB" Schema="dbo" Table="Orders" Index="PK_Orders" />
                </IndexScan>
              </RelOp>
            </RelOp>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>`;

const createMockNode = (overrides: Partial<PlanNode> = {}): PlanNode => ({
  id: 'node-0',
  nodeId: 0,
  physicalOp: 'Clustered Index Seek',
  logicalOp: 'Clustered Index Seek',
  estimatedRows: 100,
  estimatedCost: 0.05,
  estimatedSubtreeCost: 0.1,
  estimatedIO: 0.03,
  estimatedCPU: 0.02,
  children: [],
  ...overrides,
});

const createMockPlan = (root: PlanNode): QueryPlan => ({
  statementText: 'SELECT * FROM Users',
  statementType: 'SELECT',
  estimatedTotalCost: 1.0,
  root,
  isActual: false,
});

describe('QueryPlanView', () => {
  describe('View mode tabs', () => {
    it('renders Graph, Tree, and XML tabs on the left', () => {
      render(<QueryPlanView planXml={SIMPLE_PLAN_XML} />);
      
      const viewTabs = screen.getByTestId('plan-view-tabs');
      expect(viewTabs).toBeInTheDocument();
      
      expect(screen.getByTestId('plan-tab-graph')).toBeInTheDocument();
      expect(screen.getByTestId('plan-tab-tree')).toBeInTheDocument();
      expect(screen.getByTestId('plan-tab-xml')).toBeInTheDocument();
    });

    it('shows Graph tab as active by default', () => {
      render(<QueryPlanView planXml={SIMPLE_PLAN_XML} />);
      expect(screen.getByTestId('plan-tab-graph')).toHaveClass('active');
      expect(screen.getByTestId('plan-tab-tree')).not.toHaveClass('active');
    });

    it('switches to Tree view when Tree tab is clicked', () => {
      render(<QueryPlanView planXml={SIMPLE_PLAN_XML} />);
      
      fireEvent.click(screen.getByTestId('plan-tab-tree'));
      
      expect(screen.getByTestId('plan-tab-tree')).toHaveClass('active');
      expect(screen.getByTestId('plan-tab-graph')).not.toHaveClass('active');
      expect(screen.getByTestId('plan-tree-view')).toBeInTheDocument();
    });

    it('switches to XML view when XML tab is clicked', () => {
      render(<QueryPlanView planXml={SIMPLE_PLAN_XML} />);
      
      fireEvent.click(screen.getByTestId('plan-tab-xml'));
      
      expect(screen.getByTestId('plan-tab-xml')).toHaveClass('active');
    });
  });

  describe('Side panel toggle', () => {
    it('renders sidebar toggle button', () => {
      render(<QueryPlanView planXml={SIMPLE_PLAN_XML} />);
      expect(screen.getByTestId('toggle-panel-btn')).toBeInTheDocument();
    });

    it('shows operations panel by default', () => {
      render(<QueryPlanView planXml={SIMPLE_PLAN_XML} />);
      expect(screen.getByTestId('top-operations')).toBeInTheDocument();
    });

    it('hides operations panel when toggle is clicked', () => {
      render(<QueryPlanView planXml={SIMPLE_PLAN_XML} />);
      
      fireEvent.click(screen.getByTestId('toggle-panel-btn'));
      
      expect(screen.queryByTestId('top-operations')).not.toBeInTheDocument();
    });

    it('shows all operations (not just top 10)', () => {
      render(<QueryPlanView planXml={PLAN_WITH_CHILDREN_XML} />);
      
      const header = screen.getByText(/All Operations by Cost/);
      expect(header).toBeInTheDocument();
    });
  });

  describe('Error and empty states use SVG icons', () => {
    it('error state uses SVG icon not emoji', () => {
      render(<QueryPlanView planXml="<invalid>" />);
      
      const errorIcon = screen.getByTestId('plan-error').querySelector('.error-icon svg');
      expect(errorIcon).toBeInTheDocument();
    });

    it('empty state uses SVG icon not emoji', () => {
      render(<QueryPlanView planXml='<?xml version="1.0"?><ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan"><BatchSequence><Batch><Statements></Statements></Batch></BatchSequence></ShowPlanXML>' />);
      
      const emptyIcon = screen.getByTestId('plan-empty').querySelector('.empty-icon svg');
      expect(emptyIcon).toBeInTheDocument();
    });
  });
});

describe('QueryPlanView - Tree view', () => {
  describe('Collapsible sections', () => {
    it('renders collapsible chevron for nodes with children', () => {
      render(<QueryPlanView planXml={PLAN_WITH_CHILDREN_XML} />);
      
      // Switch to tree view
      fireEvent.click(screen.getByTestId('plan-tab-tree'));
      
      // The root node (Hash Match) should have a toggle button
      const treeView = screen.getByTestId('plan-tree-view');
      const chevrons = treeView.querySelectorAll('.tree-expand.clickable');
      expect(chevrons.length).toBeGreaterThan(0);
    });

    it('collapses children when chevron is clicked', () => {
      render(<QueryPlanView planXml={PLAN_WITH_CHILDREN_XML} />);
      
      // Switch to tree view
      fireEvent.click(screen.getByTestId('plan-tab-tree'));
      
      const treeView = screen.getByTestId('plan-tree-view');
      
      // Find the first clickable chevron (root node with children)
      const chevron = treeView.querySelector('.tree-expand.clickable');
      expect(chevron).toBeInTheDocument();
      
      // Count nodes before collapse
      const nodesBefore = treeView.querySelectorAll('.tree-node').length;
      expect(nodesBefore).toBeGreaterThan(1);
      
      // Click to collapse
      fireEvent.click(chevron!);
      
      // After collapse, children should be hidden
      const nodesAfter = treeView.querySelectorAll('.tree-node').length;
      expect(nodesAfter).toBeLessThan(nodesBefore);
    });

    it('expands children back when chevron is clicked again', () => {
      render(<QueryPlanView planXml={PLAN_WITH_CHILDREN_XML} />);
      
      fireEvent.click(screen.getByTestId('plan-tab-tree'));
      
      const treeView = screen.getByTestId('plan-tree-view');
      const chevron = treeView.querySelector('.tree-expand.clickable');
      
      const nodesBefore = treeView.querySelectorAll('.tree-node').length;
      
      // Collapse
      fireEvent.click(chevron!);
      // Expand
      fireEvent.click(chevron!);
      
      const nodesAfterReopen = treeView.querySelectorAll('.tree-node').length;
      expect(nodesAfterReopen).toBe(nodesBefore);
    });

    it('uses SVG chevron icons (not text characters)', () => {
      render(<QueryPlanView planXml={PLAN_WITH_CHILDREN_XML} />);
      
      fireEvent.click(screen.getByTestId('plan-tab-tree'));
      
      const treeView = screen.getByTestId('plan-tree-view');
      const chevron = treeView.querySelector('.tree-expand.clickable svg');
      expect(chevron).toBeInTheDocument();
    });
  });

  describe('Tree icons', () => {
    it('uses SVG operation icons in tree nodes', () => {
      render(<QueryPlanView planXml={SIMPLE_PLAN_XML} />);
      
      fireEvent.click(screen.getByTestId('plan-tab-tree'));
      
      const treeView = screen.getByTestId('plan-tree-view');
      const icon = treeView.querySelector('.tree-icon svg');
      expect(icon).toBeInTheDocument();
    });

    it('shows leaf dot for nodes without children', () => {
      render(<QueryPlanView planXml={SIMPLE_PLAN_XML} />);
      
      fireEvent.click(screen.getByTestId('plan-tab-tree'));
      
      const treeView = screen.getByTestId('plan-tree-view');
      const leafDot = treeView.querySelector('.tree-leaf-dot');
      expect(leafDot).toBeInTheDocument();
    });
  });
});

describe('PlanGraph', () => {
  describe('Toolbar uses SVG icons', () => {
    it('renders SVG icons for zoom buttons', () => {
      const plan = createMockPlan(createMockNode());
      render(<PlanGraph plan={plan} />);
      
      const toolbar = screen.getByTestId('plan-graph').querySelector('.plan-graph-toolbar');
      expect(toolbar).toBeInTheDocument();
      
      const buttons = toolbar!.querySelectorAll('button');
      expect(buttons.length).toBe(3);
      
      // Each button should contain an SVG icon
      buttons.forEach(btn => {
        expect(btn.querySelector('svg')).toBeInTheDocument();
      });
    });
  });

  describe('Tooltip click-to-toggle', () => {
    it('shows tooltip on node click (pin)', () => {
      const plan = createMockPlan(createMockNode());
      render(<PlanGraph plan={plan} />);
      
      const node = screen.getByTestId('plan-graph').querySelector('.plan-node');
      expect(node).toBeInTheDocument();
      
      fireEvent.click(node!);
      
      const tooltip = screen.getByTestId('plan-node-tooltip');
      expect(tooltip).toBeInTheDocument();
      expect(tooltip).toHaveClass('pinned');
    });

    it('hides pinned tooltip when same node is clicked again', () => {
      const plan = createMockPlan(createMockNode());
      render(<PlanGraph plan={plan} />);
      
      const node = screen.getByTestId('plan-graph').querySelector('.plan-node');
      
      // Pin
      fireEvent.click(node!);
      expect(screen.getByTestId('plan-node-tooltip')).toBeInTheDocument();
      
      // Unpin
      fireEvent.click(node!);
      expect(screen.queryByTestId('plan-node-tooltip')).not.toBeInTheDocument();
    });
  });

  describe('Uniform edge sizes', () => {
    it('renders edges with uniform stroke width', () => {
      const childNode = createMockNode({
        id: 'node-1',
        nodeId: 1,
        physicalOp: 'Index Scan',
        estimatedRows: 100000, // Large row count should NOT affect line width
        estimatedCost: 0.3,
        estimatedSubtreeCost: 0.3,
      });
      
      const rootNode = createMockNode({
        physicalOp: 'Hash Match',
        estimatedCost: 0.2,
        estimatedSubtreeCost: 0.5,
        children: [childNode],
      });

      const plan = createMockPlan(rootNode);
      render(<PlanGraph plan={plan} />);

      const paths = screen.getByTestId('plan-graph').querySelectorAll('path[stroke-width]');
      const strokeWidths = Array.from(paths).map(p => p.getAttribute('stroke-width'));
      
      // All edge stroke widths should be the same (1.5)
      strokeWidths.forEach(w => {
        expect(w).toBe('1.5');
      });
    });
  });

  describe('SVG icons in nodes', () => {
    it('uses foreignObject with SVG for operation icons', () => {
      const plan = createMockPlan(createMockNode());
      render(<PlanGraph plan={plan} />);
      
      const foreignObject = screen.getByTestId('plan-graph').querySelector('.plan-node foreignObject');
      expect(foreignObject).toBeInTheDocument();
      
      const svg = foreignObject!.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('Focus on node', () => {
    it('accepts focusNodeId prop', () => {
      const plan = createMockPlan(createMockNode({ id: 'focus-me' }));
      
      // Should not throw
      render(<PlanGraph plan={plan} focusNodeId="focus-me" />);
      
      expect(screen.getByTestId('plan-graph')).toBeInTheDocument();
    });
  });
});
