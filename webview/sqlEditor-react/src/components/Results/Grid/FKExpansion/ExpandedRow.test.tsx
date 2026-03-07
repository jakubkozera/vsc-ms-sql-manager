import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../../../test/testUtils';
import { ExpandedRow } from './ExpandedRow';
import { FKRelation } from './FKQuickPick';

describe('ExpandedRow', () => {
  const sampleRelation: FKRelation = {
    tableName: 'Orders',
    schemaName: 'dbo',
    columnName: 'CustomerId',
    referencedTable: 'Customers',
    referencedSchema: 'dbo',
    referencedColumn: 'Id',
    constraintName: 'FK_Orders_Customers',
  };
  
  const sampleData = [
    [1, 'John', 'john@example.com'],
    [2, 'Jane', 'jane@example.com'],
  ];
  
  const sampleColumns = ['Id', 'Name', 'Email'];
  
  const defaultProps = {
    parentRowIndex: 0,
    relation: sampleRelation,
    data: sampleData,
    columns: sampleColumns,
    isLoading: false,
    onClose: vi.fn(),
  };
  
  // Wrap in table for proper rendering
  const renderInTable = (component: React.ReactElement) => {
    return render(
      <table>
        <tbody>
          {component}
        </tbody>
      </table>
    );
  };
  
  it('renders the expanded row', () => {
    renderInTable(<ExpandedRow {...defaultProps} />);
    
    expect(screen.getByTestId('expanded-row-0')).toBeInTheDocument();
    expect(screen.getByText('dbo.Customers')).toBeInTheDocument();
  });
  
  it('shows relation info', () => {
    renderInTable(<ExpandedRow {...defaultProps} />);
    
    expect(screen.getByText('(CustomerId → Id)')).toBeInTheDocument();
  });
  
  it('renders data rows', () => {
    renderInTable(<ExpandedRow {...defaultProps} />);
    
    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
  });
  
  it('shows row count', () => {
    renderInTable(<ExpandedRow {...defaultProps} />);
    
    expect(screen.getByText('2 rows')).toBeInTheDocument();
  });
  
  it('shows loading state', () => {
    renderInTable(<ExpandedRow {...defaultProps} isLoading={true} data={[]} />);
    
    expect(screen.getByText(/Loading related data/)).toBeInTheDocument();
  });
  
  it('shows error state', () => {
    renderInTable(
      <ExpandedRow {...defaultProps} error="Failed to load data" data={[]} />
    );
    
    expect(screen.getByText('Failed to load data')).toBeInTheDocument();
  });
  
  it('shows empty state', () => {
    renderInTable(<ExpandedRow {...defaultProps} data={[]} />);
    
    expect(screen.getByText('No related records found')).toBeInTheDocument();
  });
  
  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    renderInTable(<ExpandedRow {...defaultProps} onClose={onClose} />);
    
    fireEvent.click(screen.getByTitle('Close'));
    
    expect(onClose).toHaveBeenCalled();
  });
  
  it('sorts data when header clicked', () => {
    renderInTable(<ExpandedRow {...defaultProps} />);
    
    // Click Name header to sort
    fireEvent.click(screen.getByText('Name'));
    
    // Check sort indicator appears
    expect(screen.getByText('▲')).toBeInTheDocument();
  });
  
  it('handles NULL values in data', () => {
    const dataWithNull = [[1, null, 'test@example.com']];
    renderInTable(<ExpandedRow {...defaultProps} data={dataWithNull} />);
    
    expect(screen.getByText('NULL')).toBeInTheDocument();
  });
  
  it('truncates long values', () => {
    const longValue = 'A'.repeat(150);
    const dataWithLong = [[1, longValue, 'test@example.com']];
    renderInTable(<ExpandedRow {...defaultProps} data={dataWithLong} />);
    
    // Should show truncated value with ...
    expect(screen.getByText(/A+\.\.\./)).toBeInTheDocument();
  });
  
  it('handles object values in cells', () => {
    const dataWithObject = [[1, { nested: 'value' }, 'test@example.com']];
    renderInTable(<ExpandedRow {...defaultProps} data={dataWithObject} />);
    
    expect(screen.getByText(/nested.*value/)).toBeInTheDocument();
  });
});
