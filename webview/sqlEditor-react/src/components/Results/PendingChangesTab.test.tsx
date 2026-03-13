import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../test/testUtils';
import { PendingChangesTab } from './PendingChangesTab';
import { RowChange } from '../../hooks/usePendingChanges';

describe('PendingChangesTab', () => {
  const sampleColumns = ['id', 'name', 'email'];
  const samplePKColumns = ['id'];
  
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
    schemaName: 'dbo',
    primaryKeyColumns: samplePKColumns,
    onRevertRow: vi.fn(),
    onRevertCell: vi.fn(),
    onRevertAll: vi.fn(),
    onCommit: vi.fn(),
    onCommitRow: vi.fn(),
    onCommitCell: vi.fn(),
    onPreviewSql: vi.fn(),
    generateRowSql: vi.fn(() => 'UPDATE [dbo].[Users]\nSET     [name] = \'Jane\'\nWHERE [id] = 1;'),
  };
  
  it('shows empty state when no changes', () => {
    render(<PendingChangesTab {...defaultProps} />);
    
    expect(screen.getByTestId('pending-changes-empty')).toBeInTheDocument();
    expect(screen.getByText('No pending changes')).toBeInTheDocument();
  });
  
  it('shows modified rows with table name and WHERE clause', () => {
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} />);
    
    expect(screen.getByTestId('pending-changes-tab')).toBeInTheDocument();
    expect(screen.getByText(/dbo\.Users - 1 change - Row WHERE \[id\] = 1/)).toBeInTheDocument();
  });
  
  it('shows deleted rows with WHERE clause', () => {
    const changes: RowChange[] = [
      createRowChange(0, [], true),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} />);
    
    expect(screen.getByTestId('delete-row-0')).toBeInTheDocument();
    expect(screen.getByText(/dbo\.Users - Row WHERE \[id\] = 1/)).toBeInTheDocument();
  });
  
  it('shows single cell change with Column/Old value/New value format', () => {
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} />);
    
    expect(screen.getByText('Column:')).toBeInTheDocument();
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('Old value:')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.getByText('New value:')).toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
  });
  
  it('shows table name with schema in change location', () => {
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} tableName="Customers" schemaName="sales" />);
    
    expect(screen.getByText(/sales\.Customers/)).toBeInTheDocument();
  });
  
  it('shows pending changes count in header', () => {
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
      createRowChange(1, [['email', { original: 'a@a.com', new: 'b@b.com' }]]),
      createRowChange(2, [], true),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} />);
    
    expect(screen.getByText('3 Pending Changes')).toBeInTheDocument();
  });
  
  it('calls onRevertRow when row revert button clicked', () => {
    const onRevertRow = vi.fn();
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} onRevertRow={onRevertRow} />);
    
    fireEvent.click(screen.getByTitle('Revert'));
    
    expect(onRevertRow).toHaveBeenCalledWith(0);
  });
  
  it('calls onRevertAll when Revert All icon button clicked', () => {
    const onRevertAll = vi.fn();
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} onRevertAll={onRevertAll} />);
    
    fireEvent.click(screen.getByTitle('Revert All'));
    
    expect(onRevertAll).toHaveBeenCalled();
  });
  
  it('calls onCommit when Commit All icon button clicked', () => {
    const onCommit = vi.fn();
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} onCommit={onCommit} />);
    
    fireEvent.click(screen.getByTitle('Commit All'));
    
    expect(onCommit).toHaveBeenCalled();
  });
  
  it('shows Restore button for deleted rows', () => {
    const onRevertRow = vi.fn();
    const changes: RowChange[] = [
      createRowChange(0, [], true),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} onRevertRow={onRevertRow} />);
    
    fireEvent.click(screen.getByTitle('Restore'));
    
    expect(onRevertRow).toHaveBeenCalledWith(0);
  });

  it('shows Delete Row button with trash icon for deleted rows', () => {
    const changes: RowChange[] = [
      createRowChange(0, [], true),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} />);
    
    expect(screen.getByTitle('Delete Row')).toBeInTheDocument();
  });

  it('shows Commit button with save icon for modified rows', () => {
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} />);
    
    expect(screen.getByTitle('Commit')).toBeInTheDocument();
  });
  
  it('shows SQL Preview button in header', () => {
    const onPreviewSql = vi.fn();
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} onPreviewSql={onPreviewSql} />);
    
    const previewBtn = screen.getByTitle('Preview SQL');
    expect(previewBtn).toBeInTheDocument();
    fireEvent.click(previewBtn);
    expect(onPreviewSql).toHaveBeenCalled();
  });
  
  it('shows inline SQL preview for each change', () => {
    const generateRowSql = vi.fn(() => 'UPDATE [dbo].[Users]\nSET     [name] = \'Jane\'\nWHERE [id] = 1;');
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} generateRowSql={generateRowSql} />);
    
    expect(generateRowSql).toHaveBeenCalledWith(changes[0]);
    expect(screen.getByText(/UPDATE \[dbo\]\.\[Users\]/)).toBeInTheDocument();
  });
  
  it('shows expand button for rows with multiple changes', () => {
    const changes: RowChange[] = [
      createRowChange(0, [
        ['name', { original: 'John', new: 'Jane' }],
        ['email', { original: 'john@test.com', new: 'jane@test.com' }],
      ]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} />);
    
    expect(screen.getByText(/2 changes/)).toBeInTheDocument();
    expect(screen.getByTestId('expand-0')).toBeInTheDocument();
  });
  
  it('expands details when expand button clicked for multi-change rows', () => {
    const changes: RowChange[] = [
      createRowChange(0, [
        ['name', { original: 'John', new: 'Jane' }],
        ['email', { original: 'john@test.com', new: 'jane@test.com' }],
      ]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} />);
    
    // Details should not be visible initially
    expect(screen.queryByText('Old:')).not.toBeInTheDocument();
    
    // Click expand
    fireEvent.click(screen.getByTestId('expand-0'));
    
    // Now details should be visible
    expect(screen.getAllByText('Old:').length).toBeGreaterThan(0);
    expect(screen.getAllByText('New:').length).toBeGreaterThan(0);
  });

  it('shows commit button per column in expanded multi-change rows', () => {
    const onCommitCell = vi.fn();
    const changes: RowChange[] = [
      createRowChange(0, [
        ['name', { original: 'John', new: 'Jane' }],
        ['email', { original: 'john@test.com', new: 'jane@test.com' }],
      ]),
    ];

    render(<PendingChangesTab {...defaultProps} changes={changes} onCommitCell={onCommitCell} />);

    // Expand the row
    fireEvent.click(screen.getByTestId('expand-0'));

    // Should have "Commit this change" buttons
    const commitBtns = screen.getAllByTitle('Commit this change');
    expect(commitBtns.length).toBe(2); // one per column

    // Click first one (name column, index 0 in expanded list)
    fireEvent.click(commitBtns[0]);
    expect(onCommitCell).toHaveBeenCalledWith(0, 'name');
  });

  it('shows change count text for modified rows', () => {
    const changes: RowChange[] = [
      createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
    ];
    
    render(<PendingChangesTab {...defaultProps} changes={changes} />);

    expect(screen.getByText(/1 change/)).toBeInTheDocument();
  });

  describe('validation errors', () => {
    it('disables Commit All button when hasValidationErrors is true', () => {
      const changes: RowChange[] = [
        createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
      ];

      render(<PendingChangesTab {...defaultProps} changes={changes} hasValidationErrors={true} />);

      const commitAllBtn = screen.getByTitle('Fix validation errors before committing');
      expect(commitAllBtn).toBeDisabled();
    });

    it('enables Commit All button when hasValidationErrors is false', () => {
      const changes: RowChange[] = [
        createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
      ];

      render(<PendingChangesTab {...defaultProps} changes={changes} hasValidationErrors={false} />);

      const commitAllBtn = screen.getByTitle('Commit All');
      expect(commitAllBtn).not.toBeDisabled();
    });

    it('disables per-row commit button when row has validation errors', () => {
      const validationErrors = new Map([['0-name', 'Value must be a whole number for type int']]);
      const changes: RowChange[] = [
        createRowChange(0, [['name', { original: 'John', new: 'abc' }]]),
      ];

      render(<PendingChangesTab {...defaultProps} changes={changes} validationErrors={validationErrors} />);

      const commitBtn = screen.getByTitle('Fix validation errors first');
      expect(commitBtn).toBeDisabled();
    });

    it('enables per-row commit button when row has no validation errors', () => {
      const validationErrors = new Map<string, string>();
      const changes: RowChange[] = [
        createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
      ];

      render(<PendingChangesTab {...defaultProps} changes={changes} validationErrors={validationErrors} />);

      const commitBtn = screen.getByTitle('Commit');
      expect(commitBtn).not.toBeDisabled();
    });

    it('shows validation error message in single-change view', () => {
      const validationErrors = new Map([['0-name', 'Value must be a whole number for type int']]);
      const changes: RowChange[] = [
        createRowChange(0, [['name', { original: '1', new: 'abc' }]]),
      ];

      render(<PendingChangesTab {...defaultProps} changes={changes} validationErrors={validationErrors} />);

      const errorEl = screen.getByTestId('validation-error-0-name');
      expect(errorEl).toBeInTheDocument();
      expect(errorEl).toHaveTextContent('Value must be a whole number for type int');
    });

    it('shows validation error in expanded multi-change view', () => {
      const validationErrors = new Map([['0-name', 'Invalid value']]);
      const changes: RowChange[] = [
        createRowChange(0, [
          ['name', { original: 'John', new: 'abc' }],
          ['email', { original: 'john@test.com', new: 'jane@test.com' }],
        ]),
      ];

      render(<PendingChangesTab {...defaultProps} changes={changes} validationErrors={validationErrors} />);

      // Expand the row
      fireEvent.click(screen.getByTestId('expand-0'));

      const errorEl = screen.getByTestId('validation-error-0-name');
      expect(errorEl).toBeInTheDocument();
      expect(errorEl).toHaveTextContent('Invalid value');

      // email should have no error
      expect(screen.queryByTestId('validation-error-0-email')).not.toBeInTheDocument();
    });

    it('disables per-cell commit button in expanded view when cell has error', () => {
      const validationErrors = new Map([['0-name', 'Invalid value']]);
      const changes: RowChange[] = [
        createRowChange(0, [
          ['name', { original: 'John', new: 'abc' }],
          ['email', { original: 'john@test.com', new: 'jane@test.com' }],
        ]),
      ];

      render(<PendingChangesTab {...defaultProps} changes={changes} validationErrors={validationErrors} />);

      // Expand
      fireEvent.click(screen.getByTestId('expand-0'));

      const commitBtns = screen.getAllByTitle(/Commit this change|Fix validation error first/);
      // name column button should be disabled
      const nameBtn = commitBtns.find(btn => btn.title === 'Fix validation error first');
      expect(nameBtn).toBeDisabled();

      // email column button should be enabled
      const emailBtn = commitBtns.find(btn => btn.title === 'Commit this change');
      expect(emailBtn).not.toBeDisabled();
    });

    it('does not show error elements when validationErrors is empty', () => {
      const validationErrors = new Map<string, string>();
      const changes: RowChange[] = [
        createRowChange(0, [['name', { original: 'John', new: 'Jane' }]]),
      ];

      render(<PendingChangesTab {...defaultProps} changes={changes} validationErrors={validationErrors} />);

      expect(screen.queryByTestId('validation-error-0-name')).not.toBeInTheDocument();
    });
  });
});
