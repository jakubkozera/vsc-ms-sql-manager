import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../../../test/testUtils';
import { FKQuickPick, FKRelation } from './FKQuickPick';

describe('FKQuickPick', () => {
  const sampleRelations: FKRelation[] = [
    {
      tableName: 'Orders',
      schemaName: 'dbo',
      columnName: 'CustomerId',
      referencedTable: 'Customers',
      referencedSchema: 'dbo',
      referencedColumn: 'Id',
      constraintName: 'FK_Orders_Customers',
    },
    {
      tableName: 'Orders',
      schemaName: 'dbo',
      columnName: 'ProductId',
      referencedTable: 'Products',
      referencedSchema: 'inventory',
      referencedColumn: 'Id',
      constraintName: 'FK_Orders_Products',
    },
  ];
  
  const defaultProps = {
    relations: sampleRelations,
    cellValue: 123,
    position: { x: 100, y: 200 },
    onSelect: vi.fn(),
    onClose: vi.fn(),
  };
  
  it('renders the quick pick modal', () => {
    render(<FKQuickPick {...defaultProps} />);
    
    expect(screen.getByTestId('fk-quick-pick')).toBeInTheDocument();
    expect(screen.getByText('Expand Foreign Key')).toBeInTheDocument();
    expect(screen.getByText('Value: 123')).toBeInTheDocument();
  });
  
  it('displays all relations', () => {
    render(<FKQuickPick {...defaultProps} />);
    
    expect(screen.getByText('dbo.Customers')).toBeInTheDocument();
    expect(screen.getByText('inventory.Products')).toBeInTheDocument();
  });
  
  it('shows relation details', () => {
    render(<FKQuickPick {...defaultProps} />);
    
    expect(screen.getByText('CustomerId → Id')).toBeInTheDocument();
    expect(screen.getByText('ProductId → Id')).toBeInTheDocument();
  });
  
  it('filters relations when typing', () => {
    render(<FKQuickPick {...defaultProps} />);
    
    const input = screen.getByPlaceholderText('Search relations...');
    fireEvent.change(input, { target: { value: 'Cust' } });
    
    expect(screen.getByText('dbo.Customers')).toBeInTheDocument();
    expect(screen.queryByText('inventory.Products')).not.toBeInTheDocument();
  });
  
  it('calls onSelect when clicking a relation', () => {
    const onSelect = vi.fn();
    render(<FKQuickPick {...defaultProps} onSelect={onSelect} />);
    
    fireEvent.click(screen.getByText('dbo.Customers'));
    
    expect(onSelect).toHaveBeenCalledWith(sampleRelations[0]);
  });
  
  it('calls onClose when pressing Escape', () => {
    const onClose = vi.fn();
    render(<FKQuickPick {...defaultProps} onClose={onClose} />);
    
    const input = screen.getByPlaceholderText('Search relations...');
    fireEvent.keyDown(input, { key: 'Escape' });
    
    expect(onClose).toHaveBeenCalled();
  });
  
  it('selects item with Enter key', () => {
    const onSelect = vi.fn();
    render(<FKQuickPick {...defaultProps} onSelect={onSelect} />);
    
    const input = screen.getByPlaceholderText('Search relations...');
    fireEvent.keyDown(input, { key: 'Enter' });
    
    expect(onSelect).toHaveBeenCalledWith(sampleRelations[0]);
  });
  
  it('navigates with arrow keys', () => {
    const onSelect = vi.fn();
    render(<FKQuickPick {...defaultProps} onSelect={onSelect} />);
    
    const input = screen.getByPlaceholderText('Search relations...');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    
    expect(onSelect).toHaveBeenCalledWith(sampleRelations[1]);
  });
  
  it('shows empty state when no matching relations', () => {
    render(<FKQuickPick {...defaultProps} />);
    
    const input = screen.getByPlaceholderText('Search relations...');
    fireEvent.change(input, { target: { value: 'xyz123' } });
    
    expect(screen.getByText('No matching relations')).toBeInTheDocument();
  });
  
  it('truncates long cell values', () => {
    const longValue = 'A'.repeat(50);
    render(<FKQuickPick {...defaultProps} cellValue={longValue} />);
    
    expect(screen.getByText(/Value:.*\.\.\./)).toBeInTheDocument();
  });
  
  it('handles null cell value', () => {
    render(<FKQuickPick {...defaultProps} cellValue={null} />);
    
    expect(screen.getByText('Value: NULL')).toBeInTheDocument();
  });
});
