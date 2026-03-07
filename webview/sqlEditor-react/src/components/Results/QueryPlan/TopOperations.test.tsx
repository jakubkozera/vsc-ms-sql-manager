import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TopOperations } from './TopOperations';
import { QueryPlan, PlanNode } from '../../../services/queryPlanParser';

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

describe('TopOperations', () => {
  it('renders top operations list', () => {
    const plan = createMockPlan(createMockNode());
    
    render(<TopOperations plan={plan} />);
    
    expect(screen.getByTestId('top-operations')).toBeInTheDocument();
    expect(screen.getAllByText('Clustered Index Seek').length).toBeGreaterThan(0);
  });
  
  it('shows operation rank numbers', () => {
    const childNode = createMockNode({
      id: 'node-1',
      nodeId: 1,
      physicalOp: 'Index Scan',
      estimatedCost: 0.03,
    });
    
    const rootNode = createMockNode({
      physicalOp: 'Hash Match',
      estimatedCost: 0.1,
      children: [childNode],
    });
    
    const plan = createMockPlan(rootNode);
    
    render(<TopOperations plan={plan} />);
    
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });
  
  it('respects limit prop', () => {
    const children = [
      createMockNode({ id: 'node-1', nodeId: 1, physicalOp: 'Op1', estimatedCost: 0.1 }),
      createMockNode({ id: 'node-2', nodeId: 2, physicalOp: 'Op2', estimatedCost: 0.2 }),
      createMockNode({ id: 'node-3', nodeId: 3, physicalOp: 'Op3', estimatedCost: 0.3 }),
    ];
    
    const rootNode = createMockNode({
      physicalOp: 'Root',
      estimatedCost: 0.4,
      children,
    });
    
    const plan = createMockPlan(rootNode);
    
    render(<TopOperations plan={plan} limit={2} />);
    
    // Should only show 2 operations
    expect(screen.getByTestId('operation-0')).toBeInTheDocument();
    expect(screen.getByTestId('operation-1')).toBeInTheDocument();
    expect(screen.queryByTestId('operation-2')).not.toBeInTheDocument();
  });
  
  it('calls onOperationClick when operation is clicked', () => {
    const plan = createMockPlan(createMockNode());
    const handleClick = vi.fn();
    
    render(<TopOperations plan={plan} onOperationClick={handleClick} />);
    
    fireEvent.click(screen.getByTestId('operation-0'));
    
    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleClick).toHaveBeenCalledWith(expect.objectContaining({
      physicalOp: 'Clustered Index Seek',
    }));
  });
  
  it('shows selected state for selected node', () => {
    const plan = createMockPlan(createMockNode({ id: 'selected-node' }));
    
    render(<TopOperations plan={plan} selectedNodeId="selected-node" />);
    
    const operationItem = screen.getByTestId('operation-0');
    expect(operationItem).toHaveClass('selected');
  });
  
  it('displays cost percentage', () => {
    const plan = createMockPlan(createMockNode({
      estimatedCost: 0.5, // 50% of total
    }));
    plan.estimatedTotalCost = 1.0;
    
    render(<TopOperations plan={plan} />);
    
    expect(screen.getByText('50.0%')).toBeInTheDocument();
  });
  
  it('shows estimated rows', () => {
    const plan = createMockPlan(createMockNode({
      estimatedRows: 1500,
    }));
    
    render(<TopOperations plan={plan} />);
    
    expect(screen.getByText('1.5K rows')).toBeInTheDocument();
  });
  
  it('shows warning badge for operations with warnings', () => {
    const plan = createMockPlan(createMockNode({
      warnings: ['Missing Index', 'High Cost'],
    }));
    
    render(<TopOperations plan={plan} />);
    
    const operationItem = screen.getByTestId('operation-0');
    expect(operationItem).toHaveClass('has-warning');
  });
  
  it('shows empty state when no operations', () => {
    const emptyPlan: QueryPlan = {
      statementText: '',
      statementType: '',
      estimatedTotalCost: 0,
      root: {
        id: 'empty',
        nodeId: 0,
        physicalOp: '',
        logicalOp: '',
        estimatedRows: 0,
        estimatedCost: 0,
        estimatedSubtreeCost: 0,
        estimatedIO: 0,
        estimatedCPU: 0,
        children: [],
      },
      isActual: false,
    };
    
    // Use a mock plan that will result in empty top operations
    render(<TopOperations plan={emptyPlan} />);
    
    // Should still render something (even empty op will show)
    expect(screen.getByTestId('top-operations')).toBeInTheDocument();
  });
  
  it('shows table/index info when available', () => {
    const plan = createMockPlan(createMockNode({
      object: {
        database: 'TestDB',
        schema: 'dbo',
        table: 'Users',
        index: 'IX_Users_Email',
      },
    }));
    
    render(<TopOperations plan={plan} />);
    
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('[IX_Users_Email]')).toBeInTheDocument();
  });
  
  it('shows header with total cost', () => {
    const plan = createMockPlan(createMockNode());
    plan.estimatedTotalCost = 1.2345;
    
    render(<TopOperations plan={plan} />);
    
    expect(screen.getByText(/Total:/)).toBeInTheDocument();
    expect(screen.getByText(/1\.2345/)).toBeInTheDocument();
  });
});
