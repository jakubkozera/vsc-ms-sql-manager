import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../../test/testUtils';
import { ContextMenu, ContextMenuItem } from './ContextMenu';

describe('ContextMenu', () => {
  const mockItems: ContextMenuItem[] = [
    { id: 'copy', label: 'Copy' },
    { id: 'separator1', label: '', separator: true },
    { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V' },
    { id: 'disabled', label: 'Disabled Option', disabled: true },
  ];

  const defaultProps = {
    items: mockItems,
    position: { x: 100, y: 100 },
    onSelect: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders menu items', () => {
    render(<ContextMenu {...defaultProps} />);
    
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Paste')).toBeInTheDocument();
    expect(screen.getByText('Disabled Option')).toBeInTheDocument();
  });

  it('renders separator', () => {
    render(<ContextMenu {...defaultProps} />);
    
    const separators = document.querySelectorAll('.context-menu-separator');
    expect(separators.length).toBeGreaterThan(0);
  });

  it('renders shortcut', () => {
    render(<ContextMenu {...defaultProps} />);
    
    expect(screen.getByText('Ctrl+V')).toBeInTheDocument();
  });

  it('calls onSelect when item clicked', () => {
    render(<ContextMenu {...defaultProps} />);
    
    fireEvent.click(screen.getByText('Copy'));
    
    expect(defaultProps.onSelect).toHaveBeenCalledWith('copy');
  });

  it('does not call onSelect for disabled items', () => {
    render(<ContextMenu {...defaultProps} />);
    
    fireEvent.click(screen.getByText('Disabled Option'));
    
    expect(defaultProps.onSelect).not.toHaveBeenCalled();
  });

  it('applies disabled class to disabled items', () => {
    render(<ContextMenu {...defaultProps} />);
    
    const disabledItem = screen.getByTestId('context-menu-item-disabled');
    expect(disabledItem).toHaveClass('disabled');
  });

  it('closes menu on Escape key', () => {
    render(<ContextMenu {...defaultProps} />);
    
    fireEvent.keyDown(document, { key: 'Escape' });
    
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
