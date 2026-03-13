import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '../../../test/testUtils';
import { FilterPopup } from './FilterPopup';
import { getColumnFilterCategory } from '../../../types/grid';

describe('FilterPopup', () => {
  const defaultProps = {
    columnName: 'name',
    columnType: 'varchar',
    position: { x: 100, y: 100 },
    onApply: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with column name in title', () => {
    render(<FilterPopup {...defaultProps} />);
    expect(screen.getByText(/filter: name/i)).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    render(<FilterPopup {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onApply with null when Clear clicked', () => {
    render(<FilterPopup {...defaultProps} />);
    fireEvent.click(screen.getByText('Clear'));
    expect(defaultProps.onApply).toHaveBeenCalledWith(null);
  });

  // ==================== TEXT FILTERS ====================
  describe('text column filters (varchar/nvarchar/text)', () => {
    it('shows text filter options for varchar columns', () => {
      render(<FilterPopup {...defaultProps} columnType="varchar" />);
      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();
      expect(screen.getByText('Contains')).toBeInTheDocument();
      expect(screen.getByText('Does not contain')).toBeInTheDocument();
      expect(screen.getByText('Equals')).toBeInTheDocument();
      expect(screen.getByText('Not equals')).toBeInTheDocument();
      expect(screen.getByText('Starts with')).toBeInTheDocument();
      expect(screen.getByText('Ends with')).toBeInTheDocument();
      expect(screen.getByText('Regex')).toBeInTheDocument();
      expect(screen.getByText('In (select values)')).toBeInTheDocument();
      expect(screen.getByText('Is NULL')).toBeInTheDocument();
      expect(screen.getByText('Is not NULL')).toBeInTheDocument();
    });

    it('defaults to In for text columns', () => {
      render(<FilterPopup {...defaultProps} columnType="nvarchar" />);
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('in');
    });

    it('applies contains filter with value and caseSensitive flag', () => {
      render(<FilterPopup {...defaultProps} />);
      // switch away from default 'in' to 'contains'
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'contains' } });
      const input = screen.getByPlaceholderText(/enter value/i);
      fireEvent.change(input, { target: { value: 'test' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(defaultProps.onApply).toHaveBeenCalledWith({
        type: 'contains',
        value: 'test',
        caseSensitive: false,
      });
    });

    it('applies not-contains filter', () => {
      render(<FilterPopup {...defaultProps} />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'notContains' } });
      const input = screen.getByPlaceholderText(/enter value/i);
      fireEvent.change(input, { target: { value: 'excluded' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(defaultProps.onApply).toHaveBeenCalledWith({
        type: 'notContains',
        value: 'excluded',
        caseSensitive: false,
      });
    });

    it('applies regex filter', () => {
      render(<FilterPopup {...defaultProps} />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'regex' } });
      const input = screen.getByPlaceholderText(/enter value/i);
      fireEvent.change(input, { target: { value: '^test.*$' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(defaultProps.onApply).toHaveBeenCalledWith({
        type: 'regex',
        value: '^test.*$',
        caseSensitive: false,
      });
    });

    it('shows case sensitive toggle for text filters', () => {
      render(<FilterPopup {...defaultProps} />);
      // switch from default 'in' to 'contains' to reveal toggle
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'contains' } });
      expect(screen.getByText('Case sensitive')).toBeInTheDocument();
    });

    it('applies filter with case sensitive flag', () => {
      render(<FilterPopup {...defaultProps} />);
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'contains' } });
      const input = screen.getByPlaceholderText(/enter value/i);
      fireEvent.change(input, { target: { value: 'Test' } });
      fireEvent.click(screen.getByText('Case sensitive'));
      fireEvent.click(screen.getByText('Apply'));
      expect(defaultProps.onApply).toHaveBeenCalledWith({
        type: 'contains',
        value: 'Test',
        caseSensitive: true,
      });
    });

    it('hides case sensitive toggle for regex filter', () => {
      render(<FilterPopup {...defaultProps} />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'regex' } });
      expect(screen.queryByText('Case sensitive')).not.toBeInTheDocument();
    });

    it('hides value input for isNull filter', () => {
      render(<FilterPopup {...defaultProps} />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'isNull' } });
      expect(screen.queryByPlaceholderText(/enter value/i)).not.toBeInTheDocument();
    });

    it('hides value input for isNotNull filter', () => {
      render(<FilterPopup {...defaultProps} />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'isNotNull' } });
      expect(screen.queryByPlaceholderText(/enter value/i)).not.toBeInTheDocument();
    });

    it('works with nvarchar type', () => {
      render(<FilterPopup {...defaultProps} columnType="nvarchar" />);
      expect(screen.getByText('Contains')).toBeInTheDocument();
      expect(screen.getByText('Regex')).toBeInTheDocument();
    });

    it('works with text type', () => {
      render(<FilterPopup {...defaultProps} columnType="text" />);
      expect(screen.getByText('Contains')).toBeInTheDocument();
    });
  });

  // ==================== NUMBER FILTERS ====================
  describe('number column filters (int/decimal/float)', () => {
    it('shows numeric filter options for int columns', () => {
      render(<FilterPopup {...defaultProps} columnType="int" />);
      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();
      expect(screen.getByText('Equals')).toBeInTheDocument();
      expect(screen.getByText('Not equals')).toBeInTheDocument();
      expect(screen.getByText('Greater than')).toBeInTheDocument();
      expect(screen.getByText('Less than')).toBeInTheDocument();
      expect(screen.getByText('Between')).toBeInTheDocument();
    });

    it('defaults to Equals for number columns', () => {
      render(<FilterPopup {...defaultProps} columnType="int" />);
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('equals');
    });

    it('renders custom numeric input (text + chevrons) for numeric columns', () => {
      render(<FilterPopup {...defaultProps} columnType="int" />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'equals' } });
      const input = screen.getByPlaceholderText('0');
      // custom NumericInput uses type="text" with inputMode="numeric"
      expect(input).toHaveAttribute('type', 'text');
      expect(screen.getByLabelText('Increase')).toBeInTheDocument();
      expect(screen.getByLabelText('Decrease')).toBeInTheDocument();
    });

    it('applies greater than filter with numeric value', () => {
      render(<FilterPopup {...defaultProps} columnType="int" />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'greaterThan' } });
      const input = screen.getByPlaceholderText('0');
      fireEvent.change(input, { target: { value: '42' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(defaultProps.onApply).toHaveBeenCalledWith({
        type: 'greaterThan',
        value: 42,
        caseSensitive: false,
      });
    });

    it('shows between fields when Between selected', () => {
      render(<FilterPopup {...defaultProps} columnType="int" />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'between' } });
      expect(screen.getByText('From:')).toBeInTheDocument();
      expect(screen.getByText('To:')).toBeInTheDocument();
    });

    it('applies between filter with numeric values', () => {
      render(<FilterPopup {...defaultProps} columnType="decimal" />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'between' } });
      const inputs = screen.getAllByPlaceholderText('0');
      fireEvent.change(inputs[0], { target: { value: '10' } });
      fireEvent.change(inputs[1], { target: { value: '100' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(defaultProps.onApply).toHaveBeenCalledWith({
        type: 'between',
        value: 10,
        valueTo: 100,
        caseSensitive: false,
      });
    });

    it('does not show case sensitive toggle for number filters', () => {
      render(<FilterPopup {...defaultProps} columnType="int" />);
      expect(screen.queryByText('Case sensitive')).not.toBeInTheDocument();
    });

    it('works with bigint type', () => {
      render(<FilterPopup {...defaultProps} columnType="bigint" />);
      expect(screen.getByText('Greater than')).toBeInTheDocument();
    });

    it('works with money type', () => {
      render(<FilterPopup {...defaultProps} columnType="money" />);
      expect(screen.getByText('Greater than')).toBeInTheDocument();
    });

    it('works with smallmoney type', () => {
      render(<FilterPopup {...defaultProps} columnType="smallmoney" />);
      expect(screen.getByText('Greater than')).toBeInTheDocument();
    });
  });

  // ==================== DATE FILTERS ====================
  describe('date column filters (datetime/date/datetime2)', () => {
    it('shows date filter options for datetime columns', () => {
      render(<FilterPopup {...defaultProps} columnType="datetime" />);
      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();
      expect(screen.getByText('Equals')).toBeInTheDocument();
      expect(screen.getByText('Before')).toBeInTheDocument();
      expect(screen.getByText('After')).toBeInTheDocument();
      expect(screen.getByText('Between')).toBeInTheDocument();
    });

    it('defaults to after for date columns', () => {
      render(<FilterPopup {...defaultProps} columnType="datetime" />);
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('after');
    });

    it('renders datetime-local input for date columns', () => {
      render(<FilterPopup {...defaultProps} columnType="datetime2" />);
      const input = document.querySelector('input[type="datetime-local"]');
      expect(input).toBeTruthy();
    });

    it('applies before date filter', () => {
      render(<FilterPopup {...defaultProps} columnType="date" />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'before' } });
      const input = document.querySelector('input[type="datetime-local"]')!;
      fireEvent.change(input, { target: { value: '2025-01-01T00:00' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(defaultProps.onApply).toHaveBeenCalledWith({
        type: 'before',
        value: '2025-01-01T00:00',
        caseSensitive: false,
      });
    });

    it('shows between fields for date between filter', () => {
      render(<FilterPopup {...defaultProps} columnType="datetime" />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'dateBetween' } });
      expect(screen.getByText('From:')).toBeInTheDocument();
      expect(screen.getByText('To:')).toBeInTheDocument();
    });

    it('works with datetimeoffset type', () => {
      render(<FilterPopup {...defaultProps} columnType="datetimeoffset" />);
      expect(screen.getByText('Before')).toBeInTheDocument();
      expect(screen.getByText('After')).toBeInTheDocument();
    });

    it('works with smalldatetime type', () => {
      render(<FilterPopup {...defaultProps} columnType="smalldatetime" />);
      expect(screen.getByText('Before')).toBeInTheDocument();
    });
  });

  // ==================== BOOLEAN FILTER ====================
  describe('boolean column filter (bit)', () => {
    it('shows checkboxes for bit column with True/False/NULL options', () => {
      render(<FilterPopup {...defaultProps} columnType="bit" />);
      expect(screen.getByLabelText('True')).toBeInTheDocument();
      expect(screen.getByLabelText('False')).toBeInTheDocument();
      expect(screen.getByLabelText('NULL')).toBeInTheDocument();
    });

    it('True checkbox is checked by default', () => {
      render(<FilterPopup {...defaultProps} columnType="bit" />);
      expect(screen.getByLabelText('True')).toBeChecked();
      expect(screen.getByLabelText('False')).not.toBeChecked();
      expect(screen.getByLabelText('NULL')).not.toBeChecked();
    });

    it('does not show select dropdown for boolean', () => {
      render(<FilterPopup {...defaultProps} columnType="bit" />);
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('applies boolAny filter with True selected', () => {
      render(<FilterPopup {...defaultProps} columnType="bit" />);
      fireEvent.click(screen.getByText('Apply'));
      const call = defaultProps.onApply.mock.calls[0][0];
      expect(call.type).toBe('boolAny');
      expect(call.selectedValues.has('true')).toBe(true);
      expect(call.selectedValues.has('false')).toBe(false);
    });

    it('can select True and NULL simultaneously', () => {
      render(<FilterPopup {...defaultProps} columnType="bit" />);
      fireEvent.click(screen.getByLabelText('NULL'));
      fireEvent.click(screen.getByText('Apply'));
      const call = defaultProps.onApply.mock.calls[0][0];
      expect(call.type).toBe('boolAny');
      expect(call.selectedValues.has('true')).toBe(true);
      expect(call.selectedValues.has('null')).toBe(true);
      expect(call.selectedValues.has('false')).toBe(false);
    });

    it('can select all three boolean options', () => {
      render(<FilterPopup {...defaultProps} columnType="bit" />);
      fireEvent.click(screen.getByLabelText('False'));
      fireEvent.click(screen.getByLabelText('NULL'));
      fireEvent.click(screen.getByText('Apply'));
      const call = defaultProps.onApply.mock.calls[0][0];
      expect(call.type).toBe('boolAny');
      expect(call.selectedValues.has('true')).toBe(true);
      expect(call.selectedValues.has('false')).toBe(true);
      expect(call.selectedValues.has('null')).toBe(true);
    });

    it('deselects True', () => {
      render(<FilterPopup {...defaultProps} columnType="bit" />);
      fireEvent.click(screen.getByLabelText('True')); // deselect
      fireEvent.click(screen.getByLabelText('False'));
      fireEvent.click(screen.getByText('Apply'));
      const call = defaultProps.onApply.mock.calls[0][0];
      expect(call.selectedValues.has('true')).toBe(false);
      expect(call.selectedValues.has('false')).toBe(true);
    });

    it('calls onApply with null when no option selected and Apply clicked', () => {
      render(<FilterPopup {...defaultProps} columnType="bit" />);
      fireEvent.click(screen.getByLabelText('True')); // deselect the default
      fireEvent.click(screen.getByText('Apply'));
      expect(defaultProps.onApply).toHaveBeenCalledWith(null);
    });
  });

  // ==================== GUID FILTER ====================
  describe('guid column filter (uniqueidentifier)', () => {
    it('shows guid-specific filter options', () => {
      render(<FilterPopup {...defaultProps} columnType="uniqueidentifier" />);
      expect(screen.getByText('Equals')).toBeInTheDocument();
      expect(screen.getByText('Not equals')).toBeInTheDocument();
      expect(screen.getByText('Contains')).toBeInTheDocument();
      expect(screen.getByText('In (select values)')).toBeInTheDocument();
      expect(screen.getByText('Is NULL')).toBeInTheDocument();
    });

    it('defaults to In for guid columns', () => {
      render(<FilterPopup {...defaultProps} columnType="uniqueidentifier" />);
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('in');
    });
  });

  // ==================== BINARY FILTER ====================
  describe('binary column filter (varbinary/image/geography)', () => {
    it('shows only null filters for varbinary', () => {
      render(<FilterPopup {...defaultProps} columnType="varbinary" />);
      const select = screen.getByRole('combobox');
      const options = within(select).getAllByRole('option');
      expect(options).toHaveLength(2);
      expect(screen.getByText('Is NULL')).toBeInTheDocument();
      expect(screen.getByText('Is not NULL')).toBeInTheDocument();
    });

    it('shows only null filters for geography', () => {
      render(<FilterPopup {...defaultProps} columnType="geography" />);
      const select = screen.getByRole('combobox');
      const options = within(select).getAllByRole('option');
      expect(options).toHaveLength(2);
    });

    it('shows only null filters for image', () => {
      render(<FilterPopup {...defaultProps} columnType="image" />);
      const select = screen.getByRole('combobox');
      const options = within(select).getAllByRole('option');
      expect(options).toHaveLength(2);
    });

    it('does not show value input for binary columns', () => {
      render(<FilterPopup {...defaultProps} columnType="varbinary" />);
      expect(screen.queryByPlaceholderText(/enter value/i)).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument();
    });
  });

  // ==================== XML/JSON FILTER ====================
  describe('xml/json column filter', () => {
    it('shows only null filters for xml', () => {
      render(<FilterPopup {...defaultProps} columnType="xml" />);
      const select = screen.getByRole('combobox');
      const options = within(select).getAllByRole('option');
      expect(options).toHaveLength(2);
    });

    it('shows only null filters for json', () => {
      render(<FilterPopup {...defaultProps} columnType="json" />);
      const select = screen.getByRole('combobox');
      const options = within(select).getAllByRole('option');
      expect(options).toHaveLength(2);
    });
  });

  // ==================== IN FILTER ====================
  describe('IN filter with distinct values', () => {
    const distinctValues = ['Alice', 'Bob', 'Charlie', '(NULL)'];

    it('shows IN filter section with checkboxes when In selected', () => {
      render(<FilterPopup {...defaultProps} distinctValues={distinctValues} />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'in' } });
      expect(screen.getByTestId('filter-in-section')).toBeInTheDocument();
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Charlie')).toBeInTheDocument();
    });

    it('all values selected by default', () => {
      render(<FilterPopup {...defaultProps} distinctValues={distinctValues} />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'in' } });
      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach(cb => expect(cb).toBeChecked());
    });

    it('can deselect a value', () => {
      render(<FilterPopup {...defaultProps} distinctValues={distinctValues} />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'in' } });
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[1]); // Deselect Bob
      expect(checkboxes[1]).not.toBeChecked();
    });

    it('applies IN filter with selected values', () => {
      render(<FilterPopup {...defaultProps} distinctValues={distinctValues} />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'in' } });
      // Deselect Charlie
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[2]);
      fireEvent.click(screen.getByText('Apply'));
      const call = defaultProps.onApply.mock.calls[0][0];
      expect(call.type).toBe('in');
      expect(call.selectedValues).toBeInstanceOf(Set);
      expect(call.selectedValues.has('Alice')).toBe(true);
      expect(call.selectedValues.has('Bob')).toBe(true);
      expect(call.selectedValues.has('Charlie')).toBe(false);
    });

    it('Deselect all button works', () => {
      render(<FilterPopup {...defaultProps} distinctValues={distinctValues} />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'in' } });
      fireEvent.click(screen.getByText('Deselect all'));
      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach(cb => expect(cb).not.toBeChecked());
    });

    it('Select all button works after deselect', () => {
      render(<FilterPopup {...defaultProps} distinctValues={distinctValues} />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'in' } });
      fireEvent.click(screen.getByText('Deselect all'));
      fireEvent.click(screen.getByText('Select all'));
      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach(cb => expect(cb).toBeChecked());
    });

    it('search filters displayed values', () => {
      render(<FilterPopup {...defaultProps} distinctValues={distinctValues} />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'in' } });
      const searchInput = screen.getByPlaceholderText('Search values...');
      fireEvent.change(searchInput, { target: { value: 'Ali' } });
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    });

    it('shows count of selected values', () => {
      render(<FilterPopup {...defaultProps} distinctValues={distinctValues} />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'in' } });
      expect(screen.getByText('4/4')).toBeInTheDocument();
    });

    it('hides value input when In is selected', () => {
      render(<FilterPopup {...defaultProps} distinctValues={distinctValues} />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'in' } });
      expect(screen.queryByPlaceholderText(/enter value/i)).not.toBeInTheDocument();
    });

    it('shows IN option for guid columns with distinct values', () => {
      render(<FilterPopup {...defaultProps} columnType="uniqueidentifier" distinctValues={['abc-123', 'def-456']} />);
      expect(screen.getByText('In (select values)')).toBeInTheDocument();
    });
  });

  // ==================== CURRENT FILTER RESTORE ====================
  describe('restoring current filter state', () => {
    it('restores text filter state', () => {
      render(
        <FilterPopup
          {...defaultProps}
          currentFilter={{ type: 'startsWith', value: 'hello', caseSensitive: true }}
        />
      );
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('startsWith');
      const input = screen.getByDisplayValue('hello');
      expect(input).toBeInTheDocument();
    });

    it('restores IN filter state', () => {
      render(
        <FilterPopup
          {...defaultProps}
          distinctValues={['Alice', 'Bob', 'Charlie']}
          currentFilter={{ type: 'in', value: null, selectedValues: new Set(['Alice']) }}
        />
      );
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[0]).toBeChecked();     // Alice
      expect(checkboxes[1]).not.toBeChecked(); // Bob
      expect(checkboxes[2]).not.toBeChecked(); // Charlie
    });

    it('restores boolean filter state', () => {
      render(
        <FilterPopup
          {...defaultProps}
          columnType="bit"
          currentFilter={{ type: 'boolAny', value: null, selectedValues: new Set(['false', 'null']) }}
        />
      );
      expect(screen.getByLabelText('True')).not.toBeChecked();
      expect(screen.getByLabelText('False')).toBeChecked();
      expect(screen.getByLabelText('NULL')).toBeChecked();
    });
  });

  // ==================== NUMERIC INPUT ====================
  describe('custom numeric input (number columns)', () => {
    it('renders text input instead of native number input', () => {
      render(<FilterPopup {...defaultProps} columnType="int" />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'equals' } });
      const input = screen.getByPlaceholderText('0');
      expect(input).toHaveAttribute('type', 'text');
    });

    it('increase chevron button increments value', () => {
      render(<FilterPopup {...defaultProps} columnType="int" />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'equals' } });
      const input = screen.getByPlaceholderText('0') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '5' } });
      fireEvent.click(screen.getByLabelText('Increase'));
      expect(input.value).toBe('6');
    });

    it('decrease chevron button decrements value', () => {
      render(<FilterPopup {...defaultProps} columnType="int" />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'equals' } });
      const input = screen.getByPlaceholderText('0') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '10' } });
      fireEvent.click(screen.getByLabelText('Decrease'));
      expect(input.value).toBe('9');
    });

    it('chevrons work on empty input (treats as 0)', () => {
      render(<FilterPopup {...defaultProps} columnType="int" />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'equals' } });
      fireEvent.click(screen.getByLabelText('Increase'));
      const input = screen.getByPlaceholderText('0') as HTMLInputElement;
      expect(input.value).toBe('1');
    });

    it('only accepts numeric characters', () => {
      render(<FilterPopup {...defaultProps} columnType="int" />);
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'equals' } });
      const input = screen.getByPlaceholderText('0') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'abc' } });
      expect(input.value).toBe('');
    });
  });

  // ==================== DATE INPUT ====================
  describe('custom date input (date columns)', () => {
    it('renders calendar icon button', () => {
      render(<FilterPopup {...defaultProps} columnType="datetime" />);
      expect(screen.getByLabelText('Open date picker')).toBeInTheDocument();
    });

    it('date input uses datetime-local type', () => {
      render(<FilterPopup {...defaultProps} columnType="datetime" />);
      const input = document.querySelector('input[type="datetime-local"]');
      expect(input).toBeTruthy();
    });
  });
});

// ==================== getColumnFilterCategory ====================
describe('getColumnFilterCategory', () => {
  it('returns text for varchar', () => expect(getColumnFilterCategory('varchar')).toBe('text'));
  it('returns text for nvarchar', () => expect(getColumnFilterCategory('nvarchar')).toBe('text'));
  it('returns text for ntext', () => expect(getColumnFilterCategory('ntext')).toBe('text'));
  it('returns text for char', () => expect(getColumnFilterCategory('char')).toBe('text'));
  it('returns text for sysname', () => expect(getColumnFilterCategory('sysname')).toBe('text'));

  it('returns number for int', () => expect(getColumnFilterCategory('int')).toBe('number'));
  it('returns number for bigint', () => expect(getColumnFilterCategory('bigint')).toBe('number'));
  it('returns number for smallint', () => expect(getColumnFilterCategory('smallint')).toBe('number'));
  it('returns number for tinyint', () => expect(getColumnFilterCategory('tinyint')).toBe('number'));
  it('returns number for decimal', () => expect(getColumnFilterCategory('decimal')).toBe('number'));
  it('returns number for numeric', () => expect(getColumnFilterCategory('numeric')).toBe('number'));
  it('returns number for money', () => expect(getColumnFilterCategory('money')).toBe('number'));
  it('returns number for smallmoney', () => expect(getColumnFilterCategory('smallmoney')).toBe('number'));
  it('returns number for float', () => expect(getColumnFilterCategory('float')).toBe('number'));
  it('returns number for real', () => expect(getColumnFilterCategory('real')).toBe('number'));

  it('returns date for datetime', () => expect(getColumnFilterCategory('datetime')).toBe('date'));
  it('returns date for datetime2', () => expect(getColumnFilterCategory('datetime2')).toBe('date'));
  it('returns date for date', () => expect(getColumnFilterCategory('date')).toBe('date'));
  it('returns date for datetimeoffset', () => expect(getColumnFilterCategory('datetimeoffset')).toBe('date'));
  it('returns date for smalldatetime', () => expect(getColumnFilterCategory('smalldatetime')).toBe('date'));
  it('returns date for time', () => expect(getColumnFilterCategory('time')).toBe('date'));

  it('returns boolean for bit', () => expect(getColumnFilterCategory('bit')).toBe('boolean'));

  it('returns guid for uniqueidentifier', () => expect(getColumnFilterCategory('uniqueidentifier')).toBe('guid'));

  it('returns binary for varbinary', () => expect(getColumnFilterCategory('varbinary')).toBe('binary'));
  it('returns binary for image', () => expect(getColumnFilterCategory('image')).toBe('binary'));
  it('returns binary for geography', () => expect(getColumnFilterCategory('geography')).toBe('binary'));
  it('returns binary for geometry', () => expect(getColumnFilterCategory('geometry')).toBe('binary'));
  it('returns binary for hierarchyid', () => expect(getColumnFilterCategory('hierarchyid')).toBe('binary'));

  it('returns xml_json for xml', () => expect(getColumnFilterCategory('xml')).toBe('xml_json'));
  it('returns xml_json for json', () => expect(getColumnFilterCategory('json')).toBe('xml_json'));
});
