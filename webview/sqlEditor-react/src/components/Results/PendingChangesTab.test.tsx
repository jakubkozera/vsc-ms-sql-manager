import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '../../test/testUtils';
import { PendingChangesTab } from './PendingChangesTab';
import { RowChange } from '../../hooks/usePendingChanges';

describe('PendingChangesTab', () => {
  const sampleColumns = ['id', 'name', 'email'];
  
  const createRowChange = (
    rowIndex: number, 
    changes: [string, { original: unknown; new: unknown }][],
    isDeleted = false
  ): RowChange => ({
    rowIndex,
    originalRow: [rowIndex + 1, `User${rowIndex + 1}`, `user${rowIndex + 1}@example.com`],
    changes: new Map(changes),
    isDeleted,
  });
  
  const defaultProps = {
    changes: [],
    columns: sampleColumns,
    tableName: 'Users',
    onRevertRow: vi.fn(),
    onRevertCell: vi.fn(),
    onRevertAll: vi.fn(),
    onCommit: vi.fn(),
  };
  
  it('shows empty state when no changes', () => {
    render(<PendingChangesTab {...defaultProps} />);
    
    expect(screen.getByTestId('pending-changes-empty')).toBeInTheDocument();
    expect(screen.getByText('No pending changes')).toBeInTheDocument();
  });
  
  it('shows modified rows', () => {
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} />);
    
    expect(screen.getByTestId('pending-changes-tab')).toBeInTheDocument();
    expect(screen.getByText('UPDATE')).toBeInTheDocument();
    expect(screen.getByText('Row 1')).toBeInTheDocument();
  });
  
  it('shows deleted rows', () => {
    const changes: RowChange[] = [
      createRowChange(0, [], true),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} />);
    
    expect(screen.getByText('DELETE')).toBeInTheDocument();
    expect(screen.getByTestId('delete-row-0')).toBeInTheDocument();
  });
  
  it('shows cell change details', () => {
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} />);
    
    expect(screen.getByText('name:')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('→')).toBeInTheDocument();
  });
  
  it('shows table name', () => {
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} tableName="Customers" />);
    
    expect(screen.getByText('Customers')).toBeInTheDocument();
  });
  
  it('shows change counts', () => {
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
      createRowChange(1, [['email', { original: 'a@a.com', new: 'b@b.com' }]]),
      createRowChange(2, [], true),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} />);
    
    expect(screen.getByText('2 modified')).toBeInTheDocument();
    expect(screen.getByText('1 deleted')).toBeInTheDocument();
  });
  
  it('shows SQL preview', () => {
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} />);
    
    expect(screen.getByText('SQL Preview')).toBeInTheDocument();
    expect(screen.getByText(/UPDATE \[Users\]/)).toBeInTheDocument();
  });
  
  it('calls onRevertRow when Revert button clicked', () => {
    const onRevertRow = vi.fn();
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} onRevertRow={onRevertRow} />);
    
    screen.getByText('Revert').click();
    
    expect(onRevertRow).toHaveBeenCalledWith(0);
  });
  
  it('calls onRevertAll when Revert All button clicked', () => {
    const onRevertAll = vi.fn();
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} onRevertAll={onRevertAll} />);
    
    screen.getByText('Revert All').click();
    
    expect(onRevertAll).toHaveBeenCalled();
  });
  
  it('calls onCommit when Commit Changes button clicked', () => {
    const onCommit = vi.fn();
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} onCommit={onCommit} />);
    
    screen.getByText('Commit Changes').click();
    
    expect(onCommit).toHaveBeenCalled();
  });
  
  it('shows Restore button for deleted rows', () => {
    const onRevertRow = vi.fn();
    const changes: RowChange[] = [
      createRowChange(0, [], true),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} onRevertRow={onRevertRow} />);
    
    screen.getByText('Restore').click();
    
    expect(onRevertRow).toHaveBeenCalledWith(0);
  });
});
