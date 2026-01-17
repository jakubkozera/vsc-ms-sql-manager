import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '../../../test/testUtils';
import { DataGrid } from './DataGrid';

describe('DataGrid', () => {
  const sampleData = [
    [1, 'John', 'john@example.com'],
    [2, 'Jane', 'jane@example.com'],
    [3, 'Bob', 'bob@example.com'],
  ];
  const sampleColumns = ['id', 'name', 'email'];

  it('renders empty state when no data', () => {
    render(<DataGrid data={[]} columns={[]} resultSetIndex={0} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it('renders grid with data', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    expect(screen.getByTestId('data-grid')).toBeInTheDocument();
    expect(screen.getByTestId('header-id')).toBeInTheDocument();
    expect(screen.getByTestId('header-name')).toBeInTheDocument();
    expect(screen.getByTestId('header-email')).toBeInTheDocument();
  });

  it('renders all rows', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    expect(screen.getByTestId('row-0')).toBeInTheDocument();
    expect(screen.getByTestId('row-1')).toBeInTheDocument();
    expect(screen.getByTestId('row-2')).toBeInTheDocument();
  });

  it('renders cell values correctly', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });

  it('sorts data when header is clicked', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    // Click name header to sort
    fireEvent.click(screen.getByTestId('header-name'));
    
    // Check sort indicator appears
    expect(screen.getByText('▲')).toBeInTheDocument();
    
    // Click again to reverse sort
    fireEvent.click(screen.getByTestId('header-name'));
    expect(screen.getByText('▼')).toBeInTheDocument();
  });

  it('shows row numbers', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    // Check row number cells exist - they have the row-number-cell class
    const rowNumberCells = document.querySelectorAll('.row-number-cell');
    expect(rowNumberCells).toHaveLength(3);
    expect(rowNumberCells[0].textContent).toBe('1');
    expect(rowNumberCells[1].textContent).toBe('2');
    expect(rowNumberCells[2].textContent).toBe('3');
  });
});
