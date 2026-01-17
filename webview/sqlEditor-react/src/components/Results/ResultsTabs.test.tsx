import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../test/testUtils';
import { ResultsTabs, } from './ResultsTabs';

describe('ResultsTabs', () => {
  const defaultProps = {
    activeTab: 'results' as const,
    onTabChange: vi.fn(),
    hasResults: true,
    hasMessages: false,
    hasPlan: false,
    resultSetCount: 1,
    activeResultSet: 0,
    onResultSetChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all three tabs', () => {
    render(<ResultsTabs {...defaultProps} />);
    
    expect(screen.getByTestId('results-tab')).toBeInTheDocument();
    expect(screen.getByTestId('messages-tab')).toBeInTheDocument();
    expect(screen.getByTestId('plan-tab')).toBeInTheDocument();
  });

  it('marks active tab correctly', () => {
    render(<ResultsTabs {...defaultProps} activeTab="messages" />);
    
    expect(screen.getByTestId('messages-tab')).toHaveClass('active');
    expect(screen.getByTestId('results-tab')).not.toHaveClass('active');
  });

  it('calls onTabChange when tab is clicked', () => {
    render(<ResultsTabs {...defaultProps} />);
    
    fireEvent.click(screen.getByTestId('messages-tab'));
    expect(defaultProps.onTabChange).toHaveBeenCalledWith('messages');
  });

  it('shows badge with result count when multiple results', () => {
    render(<ResultsTabs {...defaultProps} resultSetCount={3} />);
    
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows result set selector for multiple result sets', () => {
    render(<ResultsTabs {...defaultProps} resultSetCount={2} />);
    
    expect(screen.getByTestId('result-set-0')).toBeInTheDocument();
    expect(screen.getByTestId('result-set-1')).toBeInTheDocument();
  });

  it('calls onResultSetChange when result set tab clicked', () => {
    render(<ResultsTabs {...defaultProps} resultSetCount={2} />);
    
    fireEvent.click(screen.getByTestId('result-set-1'));
    expect(defaultProps.onResultSetChange).toHaveBeenCalledWith(1);
  });

  it('shows plan indicator when hasPlan is true', () => {
    render(<ResultsTabs {...defaultProps} hasPlan={true} />);
    
    const planTab = screen.getByTestId('plan-tab');
    expect(planTab.querySelector('.tab-indicator')).toBeInTheDocument();
  });
});
