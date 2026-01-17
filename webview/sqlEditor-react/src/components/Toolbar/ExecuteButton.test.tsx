import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../test/testUtils';
import { ExecuteButton } from '../Toolbar/ExecuteButton';

describe('ExecuteButton', () => {
  const defaultProps = {
    onExecute: vi.fn(),
    onCancel: vi.fn(),
    isExecuting: false,
    disabled: false,
    includeActualPlan: false,
    onToggleActualPlan: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Run button when not executing', () => {
    render(<ExecuteButton {...defaultProps} />);
    expect(screen.getByRole('button', { name: /run/i })).toBeInTheDocument();
  });

  it('renders Cancel button when executing', () => {
    render(<ExecuteButton {...defaultProps} isExecuting={true} />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onExecute when Run button is clicked', () => {
    render(<ExecuteButton {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(defaultProps.onExecute).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel button is clicked', () => {
    render(<ExecuteButton {...defaultProps} isExecuting={true} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables Run button when disabled prop is true', () => {
    render(<ExecuteButton {...defaultProps} disabled={true} />);
    expect(screen.getByRole('button', { name: /run/i })).toBeDisabled();
  });

  it('opens dropdown when dropdown toggle is clicked', () => {
    render(<ExecuteButton {...defaultProps} />);
    const dropdownToggle = screen.getAllByRole('button')[1]; // Second button is the dropdown toggle
    fireEvent.click(dropdownToggle);
    expect(screen.getByText(/with execution plan/i)).toBeInTheDocument();
  });

  it('toggles includeActualPlan when checkbox is changed', () => {
    render(<ExecuteButton {...defaultProps} />);
    const dropdownToggle = screen.getAllByRole('button')[1];
    fireEvent.click(dropdownToggle);
    
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(defaultProps.onToggleActualPlan).toHaveBeenCalledWith(true);
  });
});
