import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoryInfoPanel } from './HistoryInfoPanel';
import { useVSCode } from '../../context/VSCodeContext';

vi.mock('../../context/VSCodeContext', () => ({
  useVSCode: vi.fn(),
}));

describe('HistoryInfoPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders query history metadata when present', () => {
    vi.mocked(useVSCode).mockReturnValue({
      historyInfo: {
        executedAt: '2026-03-13 10:15:00',
        connectionName: 'Local SQL',
        server: 'localhost',
        database: 'master',
        resultSetCount: 2,
        rowCountsStr: '(3, 5 rows)',
        duration: 2500,
      },
      dismissHistoryInfo: vi.fn(),
    } as any);

    render(<HistoryInfoPanel />);

    expect(screen.getByTestId('history-info-panel')).toBeInTheDocument();
    expect(screen.getByText(/Executed:/)).toBeInTheDocument();
    expect(screen.getByText(/Local SQL/)).toBeInTheDocument();
    expect(screen.getByText(/localhost\/master/)).toBeInTheDocument();
    expect(screen.getByText(/2 \(3, 5 rows\)/)).toBeInTheDocument();
    expect(screen.getByText(/2.50s/)).toBeInTheDocument();
    expect(screen.getByTestId('history-info-icon-executed')).toBeInTheDocument();
    expect(screen.getByTestId('history-info-icon-connection')).toBeInTheDocument();
    expect(screen.getByTestId('history-info-icon-results')).toBeInTheDocument();
    expect(screen.getByTestId('history-info-icon-duration')).toBeInTheDocument();
  });

  it('dismisses the panel when close is clicked', () => {
    const dismissHistoryInfo = vi.fn();
    vi.mocked(useVSCode).mockReturnValue({
      historyInfo: {
        executedAt: '2026-03-13 10:15:00',
        connectionName: 'Local SQL',
        server: 'localhost',
        database: 'master',
        resultSetCount: 1,
        rowCountsStr: '(1 rows)',
      },
      dismissHistoryInfo,
    } as any);

    render(<HistoryInfoPanel />);

    fireEvent.click(screen.getByTestId('history-info-close'));
    expect(dismissHistoryInfo).toHaveBeenCalledOnce();
  });

  it('renders nothing when no history info is available', () => {
    vi.mocked(useVSCode).mockReturnValue({
      historyInfo: null,
      dismissHistoryInfo: vi.fn(),
    } as any);

    const { container } = render(<HistoryInfoPanel />);
    expect(container.firstChild).toBeNull();
  });
});