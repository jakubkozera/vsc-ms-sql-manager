import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../test/testUtils';
import { FormatButton } from '../Toolbar/FormatButton';

describe('FormatButton', () => {
  const defaultProps = {
    onFormat: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders format button', () => {
    render(<FormatButton {...defaultProps} />);
    expect(screen.getByTitle(/format sql/i)).toBeInTheDocument();
  });

  it('calls onFormat when format button is clicked', () => {
    render(<FormatButton {...defaultProps} />);
    fireEvent.click(screen.getByTitle(/format sql/i));
    expect(defaultProps.onFormat).toHaveBeenCalledTimes(1);
  });

  it('opens options popup when options button is clicked', () => {
    render(<FormatButton {...defaultProps} />);
    fireEvent.click(screen.getByTitle(/formatting options/i));
    expect(screen.getByText(/formatting options/i)).toBeInTheDocument();
  });

  it('shows all formatting options in popup', () => {
    render(<FormatButton {...defaultProps} />);
    fireEvent.click(screen.getByTitle(/formatting options/i));
    
    expect(screen.getByLabelText(/^indent:$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/keyword case/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/data type case/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/function case/i)).toBeInTheDocument();
  });

  it('closes popup when Apply & Format is clicked', () => {
    render(<FormatButton {...defaultProps} />);
    fireEvent.click(screen.getByTitle(/formatting options/i));
    fireEvent.click(screen.getByText(/apply & format/i));
    
    expect(defaultProps.onFormat).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/formatting options/i)).not.toBeInTheDocument();
  });

  it('saves options to localStorage', () => {
    render(<FormatButton {...defaultProps} />);
    fireEvent.click(screen.getByTitle(/formatting options/i));
    
    const indentInput = screen.getByLabelText(/^indent:$/i);
    fireEvent.change(indentInput, { target: { value: '4' } });
    
    const saved = localStorage.getItem('sqlFormattingOptions');
    expect(saved).toBeTruthy();
    expect(JSON.parse(saved!).tabWidth).toBe(4);
  });
});
