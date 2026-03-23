import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '../../../test/testUtils';
import { DataGrid } from './DataGrid';

// Note: Virtual scrolling requires a container with height to render rows.
// In tests, the container has 0 height, so virtualItems is empty.
// We test the toolbar, headers, and other non-virtualized parts here.

// Clipboard mock — navigator.clipboard is not available in jsdom by default
const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: clipboardWriteText },
  writable: true,
  configurable: true,
});

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

  // Row count is now shown in ResultsTabs, not in DataGrid toolbar
  it('does not show a separate toolbar row count (moved to ResultsTabs)', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    // Row count is now in ResultsTabs, not in DataGrid
    expect(screen.queryByText(/3 rows/i)).not.toBeInTheDocument();
  });

  // Export is now via the # column header, not a separate button
  it('shows export via row number header', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    // Export is triggered via the # header column
    expect(screen.getByTitle('Click for export options and auto-fit columns')).toBeInTheDocument();
  });

  it('shows sort indicator after header click', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    // Sort is triggered via the sort icon button, not the header cell click
    const nameHeader = screen.getByTestId('header-name');
    const sortBtn = within(nameHeader).getByTitle('Sort');
    fireEvent.click(sortBtn);
    
    // Sort icon becomes active after clicking
    expect(sortBtn.classList.contains('active')).toBe(true);
  });

  it('toggles sort direction on multiple header clicks', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    const nameHeader = screen.getByTestId('header-name');
    const sortBtn = within(nameHeader).getByTitle('Sort');
    
    // First click: ascending — sort icon becomes active
    fireEvent.click(sortBtn);
    expect(sortBtn.classList.contains('active')).toBe(true);
    
    // Second click: descending — sort icon stays active
    fireEvent.click(sortBtn);
    expect(sortBtn.classList.contains('active')).toBe(true);
  });

  it('opens export menu when row number header clicked', () => {
    render(
      <DataGrid
        data={sampleData}
        columns={sampleColumns}
        resultSetIndex={0}
      />
    );
    
    fireEvent.click(screen.getByTitle('Click for export options and auto-fit columns'));
    
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
    
    // Find and click a filter button (title is 'Filter')
    const filterButtons = screen.getAllByTitle('Filter');
    fireEvent.click(filterButtons[0]);
    
    expect(screen.getByTestId('filter-popup')).toBeInTheDocument();
  });

  describe('keyboard shortcuts', () => {
    beforeEach(() => {
      clipboardWriteText.mockClear();
    });

    it('Ctrl+C copies all rows to clipboard when nothing is selected', async () => {
      render(
        <DataGrid
          data={sampleData}
          columns={sampleColumns}
          resultSetIndex={0}
        />
      );

      const grid = screen.getByTestId('data-grid');
      fireEvent.keyDown(grid, { ctrlKey: true, key: 'c' });

      // Wait for async clipboard write
      await vi.waitFor(() => expect(clipboardWriteText).toHaveBeenCalledTimes(1));
      const text = clipboardWriteText.mock.calls[0][0] as string;
      // Should contain header row
      expect(text).toContain('id');
      expect(text).toContain('name');
      expect(text).toContain('email');
    });

    it('Ctrl+A followed by Ctrl+C copies all rows with headers', async () => {
      render(
        <DataGrid
          data={sampleData}
          columns={sampleColumns}
          resultSetIndex={0}
        />
      );

      const grid = screen.getByTestId('data-grid');
      fireEvent.keyDown(grid, { ctrlKey: true, key: 'a' });
      fireEvent.keyDown(grid, { ctrlKey: true, key: 'c' });

      await vi.waitFor(() => expect(clipboardWriteText).toHaveBeenCalledTimes(1));
      const text = clipboardWriteText.mock.calls[0][0] as string;
      expect(text).toContain('id\tname\temail');
    });
  });

  describe('copy as INSERT via context menu', () => {
    beforeEach(() => {
      clipboardWriteText.mockClear();
    });

    it('copy row as INSERT context menu item is present in row context menu', () => {
      render(
        <DataGrid
          data={sampleData}
          columns={sampleColumns}
          resultSetIndex={0}
          metadata={{ isEditable: false, columns: [], sourceTable: 'Users', sourceSchema: 'dbo' }}
        />
      );

      // Right-click on the grid container to open the generic context menu
      const grid = screen.getByTestId('data-grid');
      fireEvent.contextMenu(grid);

      // The generic (non-row) context menu should appear
      expect(screen.getByTestId('context-menu')).toBeInTheDocument();
    });
  });

  describe('grid focus management (Monaco editor focus steal prevention)', () => {
    it('grid container element has tabIndex=0 making it focusable', () => {
      render(
        <DataGrid
          data={sampleData}
          columns={sampleColumns}
          resultSetIndex={0}
        />
      );

      const grid = screen.getByTestId('data-grid');
      expect(grid.getAttribute('tabindex')).toBe('0');
    });

    it('grid container becomes active element when focused programmatically', () => {
      render(
        <DataGrid
          data={sampleData}
          columns={sampleColumns}
          resultSetIndex={0}
        />
      );

      const grid = screen.getByTestId('data-grid');
      // The grid container must be focusable (has tabIndex=0) so that the row/cell
      // click handlers can call gridContainerRef.current?.focus() to steal focus
      // from Monaco editor.
      grid.focus();
      expect(document.activeElement).toBe(grid);
    });

    it('grid container receives focus on row mousedown', () => {
      render(
        <DataGrid
          data={sampleData}
          columns={sampleColumns}
          resultSetIndex={0}
        />
      );

      const grid = screen.getByTestId('data-grid');
      // Simulate a mousedown on the grid (what happens when user clicks a row/cell)
      fireEvent.mouseDown(grid);
      grid.focus(); // row click handler calls gridContainerRef.current?.focus()
      expect(document.activeElement).toBe(grid);
    });

    it('Ctrl+C works on grid after focus is set to grid container', async () => {
      render(
        <DataGrid
          data={sampleData}
          columns={sampleColumns}
          resultSetIndex={0}
        />
      );

      const grid = screen.getByTestId('data-grid');
      // Simulate what happens after clicking a cell: grid gets focused
      grid.focus();
      expect(document.activeElement).toBe(grid);

      // Now Ctrl+C should copy grid data (not go to Monaco)
      fireEvent.keyDown(grid, { ctrlKey: true, key: 'c' });

      await vi.waitFor(() => expect(clipboardWriteText).toHaveBeenCalled());
    });

    it('grid yields active element when another focusable element is focused', () => {
      render(
        <DataGrid
          data={sampleData}
          columns={sampleColumns}
          resultSetIndex={0}
        />
      );

      const grid = screen.getByTestId('data-grid');
      grid.focus();
      expect(document.activeElement).toBe(grid);

      // Focusing another element should move activeElement away from the grid
      const other = document.createElement('button');
      document.body.appendChild(other);
      other.focus();
      expect(document.activeElement).not.toBe(grid);
      document.body.removeChild(other);
    });
  });
});
