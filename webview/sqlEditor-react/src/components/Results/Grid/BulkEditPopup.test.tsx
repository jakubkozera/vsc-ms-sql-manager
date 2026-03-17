import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../../test/testUtils';
import { BulkEditPopup } from './BulkEditPopup';

// Helper — returns the info paragraph text content (spans strong tags)
const getInfoText = () =>
  (screen.getByTestId('bulk-edit-popup').querySelector('.bulk-edit-info') as HTMLElement).textContent ?? '';

const defaultProps = {
  cellCount: 6,
  columnCount: 3,
  position: { x: 200, y: 200 },
  onApply: vi.fn(),
  onClose: vi.fn(),
};

describe('BulkEditPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the popup', () => {
    render(<BulkEditPopup {...defaultProps} />);
    expect(screen.getByTestId('bulk-edit-popup')).toBeInTheDocument();
  });

  it('shows the cell count in the info text', () => {
    render(<BulkEditPopup {...defaultProps} cellCount={8} columnCount={2} />);
    expect(getInfoText()).toMatch(/8 cell/i);
  });

  it('shows "across N columns" when columnCount > 1', () => {
    render(<BulkEditPopup {...defaultProps} cellCount={6} columnCount={3} />);
    expect(screen.getByText(/3 columns/i)).toBeInTheDocument();
  });

  it('does not show "across N columns" when columnCount is 1', () => {
    render(<BulkEditPopup {...defaultProps} cellCount={4} columnCount={1} />);
    expect(screen.queryByText(/columns/i)).not.toBeInTheDocument();
  });

  it('shows row count derived from cellCount / columnCount', () => {
    // 6 cells / 3 columns = 2 rows
    render(<BulkEditPopup {...defaultProps} cellCount={6} columnCount={3} />);
    expect(getInfoText()).toMatch(/2 row/i);
  });

  it('renders the text input', () => {
    render(<BulkEditPopup {...defaultProps} />);
    expect(screen.getByTestId('bulk-edit-input')).toBeInTheDocument();
  });

  it('renders Apply and Cancel buttons', () => {
    render(<BulkEditPopup {...defaultProps} />);
    expect(screen.getByTestId('bulk-edit-apply')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-edit-cancel')).toBeInTheDocument();
  });

  it('calls onApply with the typed value when Apply is clicked', () => {
    const onApply = vi.fn();
    render(<BulkEditPopup {...defaultProps} onApply={onApply} />);
    const input = screen.getByTestId('bulk-edit-input');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('bulk-edit-apply'));
    expect(onApply).toHaveBeenCalledWith('hello');
  });

  it('calls onApply with an empty string when Apply is clicked without typing', () => {
    const onApply = vi.fn();
    render(<BulkEditPopup {...defaultProps} onApply={onApply} />);
    fireEvent.click(screen.getByTestId('bulk-edit-apply'));
    expect(onApply).toHaveBeenCalledWith('');
  });

  it('calls onApply on Enter key press', () => {
    const onApply = vi.fn();
    render(<BulkEditPopup {...defaultProps} onApply={onApply} />);
    const input = screen.getByTestId('bulk-edit-input');
    fireEvent.change(input, { target: { value: 'test value' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onApply).toHaveBeenCalledWith('test value');
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<BulkEditPopup {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('bulk-edit-cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when close button (×) is clicked', () => {
    const onClose = vi.fn();
    render(<BulkEditPopup {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('bulk-edit-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape key press inside input', () => {
    const onClose = vi.fn();
    render(<BulkEditPopup {...defaultProps} onClose={onClose} />);
    const input = screen.getByTestId('bulk-edit-input');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onApply on Escape', () => {
    const onApply = vi.fn();
    render(<BulkEditPopup {...defaultProps} onApply={onApply} />);
    fireEvent.keyDown(screen.getByTestId('bulk-edit-input'), { key: 'Escape' });
    expect(onApply).not.toHaveBeenCalled();
  });

  it('does not call onClose on Enter', () => {
    const onClose = vi.fn();
    render(<BulkEditPopup {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId('bulk-edit-input'), { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows singular "cell" when cellCount is 1', () => {
    render(<BulkEditPopup {...defaultProps} cellCount={1} columnCount={1} />);
    const info = getInfoText();
    expect(info).toMatch(/1 cell/i);
    expect(info).not.toMatch(/1 cells/i);
  });

  it('shows plural "cells" when cellCount > 1', () => {
    render(<BulkEditPopup {...defaultProps} cellCount={5} columnCount={1} />);
    expect(getInfoText()).toMatch(/5 cells/i);
  });
});
