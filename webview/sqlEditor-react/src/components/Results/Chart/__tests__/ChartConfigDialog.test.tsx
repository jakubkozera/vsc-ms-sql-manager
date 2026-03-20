import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../../../test/testUtils';
import { ChartConfigDialog } from '../ChartConfigDialog';
import { ChartDataSnapshot } from '../../../../types/chart';

const sampleData: ChartDataSnapshot = {
  columns: ['Name', 'Sales', 'Revenue', 'Region'],
  rows: [
    ['Alice', 100, 5000, 'EU'],
    ['Bob', 200, 8000, 'US'],
    ['Carol', 150, 6500, 'EU'],
  ],
};

const columnTypes: Record<string, string> = {
  Name: 'nvarchar',
  Sales: 'int',
  Revenue: 'decimal',
  Region: 'nvarchar',
};

describe('ChartConfigDialog', () => {
  let onCreate: ReturnType<typeof vi.fn<(config: { chartType: string; title: string; labelColumn: string; dataColumns: string[] }) => void>>;
  let onCancel: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    onCreate = vi.fn<(config: { chartType: string; title: string; labelColumn: string; dataColumns: string[] }) => void>();
    onCancel = vi.fn<() => void>();
  });

  it('renders the dialog with chart type options', () => {
    render(
      <ChartConfigDialog
        data={sampleData}
        columnTypes={columnTypes}
        onCreate={onCreate}
        onCancel={onCancel}
      />
    );

    expect(screen.getByTestId('chart-config-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('chart-type-bar')).toBeInTheDocument();
    expect(screen.getByTestId('chart-type-line')).toBeInTheDocument();
    expect(screen.getByTestId('chart-type-pie')).toBeInTheDocument();
  });

  it('auto-selects first non-numeric column as label', () => {
    render(
      <ChartConfigDialog
        data={sampleData}
        columnTypes={columnTypes}
        onCreate={onCreate}
        onCancel={onCancel}
      />
    );

    const select = screen.getByTestId('chart-label-select') as HTMLSelectElement;
    expect(select.value).toBe('Name');
  });

  it('auto-selects first numeric column as data column', () => {
    render(
      <ChartConfigDialog
        data={sampleData}
        columnTypes={columnTypes}
        onCreate={onCreate}
        onCancel={onCancel}
      />
    );

    const salesCheckbox = screen.getByTestId('chart-data-col-Sales') as HTMLInputElement;
    expect(salesCheckbox.checked).toBe(true);
  });

  it('calls onCreate with correct config when Create is clicked', () => {
    render(
      <ChartConfigDialog
        data={sampleData}
        columnTypes={columnTypes}
        onCreate={onCreate}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByTestId('chart-create-btn'));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        chartType: 'bar',
        labelColumn: 'Name',
        dataColumns: ['Sales'],
      })
    );
  });

  it('calls onCancel when Cancel is clicked', () => {
    render(
      <ChartConfigDialog
        data={sampleData}
        columnTypes={columnTypes}
        onCreate={onCreate}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByTestId('chart-cancel-btn'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when overlay is clicked', () => {
    render(
      <ChartConfigDialog
        data={sampleData}
        columnTypes={columnTypes}
        onCreate={onCreate}
        onCancel={onCancel}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('chart-config-overlay'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables Create button when no data columns selected', () => {
    render(
      <ChartConfigDialog
        data={sampleData}
        columnTypes={columnTypes}
        onCreate={onCreate}
        onCancel={onCancel}
      />
    );

    // Uncheck the auto-selected column
    fireEvent.click(screen.getByTestId('chart-data-col-Sales'));

    const createBtn = screen.getByTestId('chart-create-btn') as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
  });

  it('allows selecting a different chart type', () => {
    render(
      <ChartConfigDialog
        data={sampleData}
        columnTypes={columnTypes}
        onCreate={onCreate}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByTestId('chart-type-pie'));
    fireEvent.click(screen.getByTestId('chart-create-btn'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ chartType: 'pie' })
    );
  });

  it('uses default title when none provided', () => {
    render(
      <ChartConfigDialog
        data={sampleData}
        columnTypes={columnTypes}
        onCreate={onCreate}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByTestId('chart-create-btn'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Bar Chart' })
    );
  });

  it('uses custom title when provided', () => {
    render(
      <ChartConfigDialog
        data={sampleData}
        columnTypes={columnTypes}
        onCreate={onCreate}
        onCancel={onCancel}
      />
    );

    fireEvent.change(screen.getByTestId('chart-title-input'), {
      target: { value: 'My Custom Chart' },
    });
    fireEvent.click(screen.getByTestId('chart-create-btn'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'My Custom Chart' })
    );
  });

  it('allows toggling multiple data columns', () => {
    render(
      <ChartConfigDialog
        data={sampleData}
        columnTypes={columnTypes}
        onCreate={onCreate}
        onCancel={onCancel}
      />
    );

    // Also select Revenue
    fireEvent.click(screen.getByTestId('chart-data-col-Revenue'));
    fireEvent.click(screen.getByTestId('chart-create-btn'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ dataColumns: ['Sales', 'Revenue'] })
    );
  });

  describe('aggregated columns (COUNT, SUM, etc.)', () => {
    // Simulates: SELECT COUNT(*) as Packages, p2.Name FROM ... GROUP BY p2.Name
    const aggregatedData: ChartDataSnapshot = {
      columns: ['Packages', 'Name'],
      rows: [
        [3, 'Data Prime'],
        [4, 'Portfolio'],
        [4, 'Strategy'],
        [9, 'Prime AI'],
        [11, 'Power WITH ENVIR'],
      ],
    };

    // COUNT(*) has no source table, so type arrives as 'string' or 'unknown'
    const aggregatedColumnTypes: Record<string, string> = {
      Packages: 'string',  // metadata can't resolve type for computed column
      Name: 'nvarchar',
    };

    it('detects numeric columns from data values when metadata type is unknown', () => {
      render(
        <ChartConfigDialog
          data={aggregatedData}
          columnTypes={aggregatedColumnTypes}
          onCreate={onCreate}
          onCancel={onCancel}
        />
      );

      // "Name" should be auto-selected as label (non-numeric)
      const labelSelect = screen.getByTestId('chart-label-select') as HTMLSelectElement;
      expect(labelSelect.value).toBe('Name');

      // "Packages" should be auto-selected as data column (detected numeric from values)
      const packagesCheckbox = screen.getByTestId('chart-data-col-Packages') as HTMLInputElement;
      expect(packagesCheckbox.checked).toBe(true);
    });

    it('creates chart correctly with data-detected numeric columns', () => {
      render(
        <ChartConfigDialog
          data={aggregatedData}
          columnTypes={aggregatedColumnTypes}
          onCreate={onCreate}
          onCancel={onCancel}
        />
      );

      fireEvent.click(screen.getByTestId('chart-create-btn'));

      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          labelColumn: 'Name',
          dataColumns: ['Packages'],
        })
      );
    });

    it('handles columns with no type info at all', () => {
      render(
        <ChartConfigDialog
          data={aggregatedData}
          columnTypes={{}}
          onCreate={onCreate}
          onCancel={onCancel}
        />
      );

      // Should still detect Packages as numeric from data values
      const labelSelect = screen.getByTestId('chart-label-select') as HTMLSelectElement;
      expect(labelSelect.value).toBe('Name');
    });

    it('handles undefined columnTypes', () => {
      render(
        <ChartConfigDialog
          data={aggregatedData}
          onCreate={onCreate}
          onCancel={onCancel}
        />
      );

      // Should detect from data values
      const labelSelect = screen.getByTestId('chart-label-select') as HTMLSelectElement;
      expect(labelSelect.value).toBe('Name');
    });

    it('handles all-numeric columns (picks first as label)', () => {
      const allNumericData: ChartDataSnapshot = {
        columns: ['Count', 'Total'],
        rows: [[10, 100], [20, 200]],
      };
      render(
        <ChartConfigDialog
          data={allNumericData}
          columnTypes={{}}
          onCreate={onCreate}
          onCancel={onCancel}
        />
      );

      // When all columns are numeric, first column should be used as label
      const labelSelect = screen.getByTestId('chart-label-select') as HTMLSelectElement;
      expect(labelSelect.value).toBe('Count');
    });
  });
});
