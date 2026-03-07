import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../../test/testUtils';
import { FilterPopup } from './FilterPopup';

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

  it('shows text filter options for string columns', () => {
    render(<FilterPopup {...defaultProps} />);
    
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    
    // Check options exist
    expect(screen.getByText('Contains')).toBeInTheDocument();
  });

  it('shows numeric filter options for number columns', () => {
    render(<FilterPopup {...defaultProps} columnType="int" />);
    
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    
    // Check numeric options exist
    expect(screen.getByText('Greater than')).toBeInTheDocument();
  });

  it('calls onApply with filter when Apply clicked', () => {
    render(<FilterPopup {...defaultProps} />);
    
    const input = screen.getByPlaceholderText(/enter value/i);
    fireEvent.change(input, { target: { value: 'test' } });
    
    fireEvent.click(screen.getByText('Apply'));
    
    expect(defaultProps.onApply).toHaveBeenCalledWith({
      type: 'contains',
      value: 'test',
    });
  });

  it('calls onApply with null when Clear clicked', () => {
    render(<FilterPopup {...defaultProps} />);
    
    fireEvent.click(screen.getByText('Clear'));
    
    expect(defaultProps.onApply).toHaveBeenCalledWith(null);
  });

  it('calls onClose when close button clicked', () => {
    render(<FilterPopup {...defaultProps} />);
    
    fireEvent.click(screen.getByText('×'));
    
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows between fields when Between filter selected', () => {
    render(<FilterPopup {...defaultProps} columnType="int" />);
    
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'between' } });
    
    expect(screen.getByText('From:')).toBeInTheDocument();
    expect(screen.getByText('To:')).toBeInTheDocument();
  });

  it('hides value input for isNull filter', () => {
    render(<FilterPopup {...defaultProps} />);
    
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'isNull' } });
    
    expect(screen.queryByPlaceholderText(/enter value/i)).not.toBeInTheDocument();
  });
});
