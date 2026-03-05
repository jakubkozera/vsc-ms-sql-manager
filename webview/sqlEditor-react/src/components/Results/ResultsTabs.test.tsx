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
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all three tabs when plan is available', () => {
    render(<ResultsTabs {...defaultProps} hasPlan={true} />);
    
    expect(screen.getByTestId('results-tab')).toBeInTheDocument();
    expect(screen.getByTestId('messages-tab')).toBeInTheDocument();
    expect(screen.getByTestId('plan-tab')).toBeInTheDocument();
  });

  it('hides Query Plan tab when no plan is available', () => {
    render(<ResultsTabs {...defaultProps} hasPlan={false} />);
    
    expect(screen.getByTestId('results-tab')).toBeInTheDocument();
    expect(screen.getByTestId('messages-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-tab')).not.toBeInTheDocument();
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

  it('shows badge count for multiple result sets', () => {
    render(<ResultsTabs {...defaultProps} resultSetCount={2} />);
    
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows plan indicator when hasPlan is true', () => {
    render(<ResultsTabs {...defaultProps} hasPlan={true} />);
    
    const planTab = screen.getByTestId('plan-tab');
    expect(planTab.querySelector('.tab-indicator')).toBeInTheDocument();
  });

  describe('Pending Changes tab', () => {
    it('does not show pending changes tab when count is 0', () => {
      render(<ResultsTabs {...defaultProps} pendingChangesCount={0} />);
      expect(screen.queryByTestId('pending-changes-tab')).not.toBeInTheDocument();
    });

    it('shows pending changes tab with badge when count > 0', () => {
      render(<ResultsTabs {...defaultProps} pendingChangesCount={3} />);
      
      const tab = screen.getByTestId('pending-changes-tab');
      expect(tab).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(tab.querySelector('.pending-badge')).toBeInTheDocument();
    });

    it('marks pending changes tab as active when selected', () => {
      render(<ResultsTabs {...defaultProps} activeTab="pendingChanges" pendingChangesCount={2} />);
      
      const tab = screen.getByTestId('pending-changes-tab');
      expect(tab).toHaveClass('active');
    });

    it('calls onTabChange with pendingChanges when clicked', () => {
      render(<ResultsTabs {...defaultProps} pendingChangesCount={1} />);
      
      fireEvent.click(screen.getByTestId('pending-changes-tab'));
      expect(defaultProps.onTabChange).toHaveBeenCalledWith('pendingChanges');
    });
  });
});
