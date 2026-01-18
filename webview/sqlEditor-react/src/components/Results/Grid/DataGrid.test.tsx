import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../../test/testUtils';
import { DataGrid } from './DataGrid';

// Note: Virtual scrolling requires a container with height to render rows.
// In tests, the container has 0 height, so virtualItems is empty.
// We test the toolbar, headers, and other non-virtualized parts here.

describe('DataGrid', () => {
  const sampleData = [
    [1, 'John', 'john@example.com'],
    [2, 'Jane', 'jane@example.com'],
    [3, 'Bob', 'bob@example.com'],
  ];
  const sampleColumns = ['id', 'name', 'email'];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no data', () => {
    render(<DataGrid data={[]} columns={[]} resultSetIndex={0} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it('renders grid container and headers with data', () => {
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

  it('shows row count in toolbar', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    expect(screen.getByText(/3 rows/i)).toBeInTheDocument();
  });

  it('shows export button in toolbar', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    expect(screen.getByTitle('Export data')).toBeInTheDocument();
  });

  it('shows sort indicator after header click', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    // Click name header to sort
    fireEvent.click(screen.getByTestId('header-name'));
    
    // Check sort indicator appears (▲ for asc)
    expect(screen.getByText('▲')).toBeInTheDocument();
  });

  it('toggles sort direction on multiple header clicks', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    const header = screen.getByTestId('header-name');
    
    // First click: ascending
    fireEvent.click(header);
    expect(screen.getByText('▲')).toBeInTheDocument();
    
    // Second click: descending
    fireEvent.click(header);
    // Find sort indicator within the header
    const sortIndicators = document.querySelectorAll('.sort-indicator');
    const hasDescIndicator = Array.from(sortIndicators).some(el => el.textContent === '▼');
    expect(hasDescIndicator).toBe(true);
  });

  it('opens export menu when export button clicked', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    fireEvent.click(screen.getByTitle('Export data'));
    
    expect(screen.getByTestId('export-menu')).toBeInTheDocument();
  });

  it('opens filter popup when filter button clicked', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    // Find and click a filter button
    const filterButtons = screen.getAllByTitle('Filter column');
    fireEvent.click(filterButtons[0]);
    
    expect(screen.getByTestId('filter-popup')).toBeInTheDocument();
  });
});
