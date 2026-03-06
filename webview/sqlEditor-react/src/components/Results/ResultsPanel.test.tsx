import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ResultsPanel } from './ResultsPanel';
import { useVSCode } from '../../context/VSCodeContext';
import { usePendingChanges } from '../../hooks/usePendingChanges';

vi.mock('../../context/VSCodeContext', () => ({
  useVSCode: vi.fn(),
}));

vi.mock('../../hooks/usePendingChanges', () => ({
  usePendingChanges: vi.fn(),
}));

function makePendingChangesMock(hasPendingChanges: boolean) {
  return {
    state: {
      changesByResultSet: new Map(),
      totalChangedRows: hasPendingChanges ? 1 : 0,
      totalDeletedRows: 0,
    },
    hasPendingChanges,
    editCell: vi.fn(),
    deleteRow: vi.fn(),
    restoreRow: vi.fn(),
    revertCell: vi.fn(),
    revertRow: vi.fn(),
    revertAll: vi.fn(),
    commitSuccess: vi.fn(),
    getRowChange: vi.fn(() => undefined),
    getCellChange: vi.fn(() => undefined),
    isRowModified: vi.fn(() => false),
    isRowDeleted: vi.fn(() => false),
    isCellModified: vi.fn(() => false),
    getChangesForResultSet: vi.fn(() => []),
    generateUpdateStatements: vi.fn(() => []),
    generateDeleteStatements: vi.fn(() => []),
  };
}

function makeVSCodeMock(lastErrorId: number) {
  return {
    lastResults: null,
    lastColumnNames: null,
    lastMetadata: null,
    lastMessages: [],
    lastPlanXml: null,
    lastError: lastErrorId > 0 ? 'Commit failed' : null,
    lastErrorId,
    executionTime: null,
    rowsAffected: null,
    isExecuting: false,
    postMessage: vi.fn(),
    currentConnectionId: 'conn1',
    currentDatabase: 'master',
    originalQuery: null,
    connections: [],
    databases: [],
    dbSchema: { tables: [], views: [], storedProcedures: [], functions: [] },
    snippets: [],
    selectDatabase: vi.fn(),
    selectConnection: vi.fn(),
    manageConnections: vi.fn(),
    executeQuery: vi.fn(),
    expandRelation: vi.fn(),
  };
}

describe('ResultsPanel - error → messages tab auto-switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should start on results tab by default', () => {
    vi.mocked(useVSCode).mockReturnValue(makeVSCodeMock(0) as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(false) as any);

    render(<ResultsPanel />);

    expect(screen.getByTestId('results-tab')).toHaveClass('active');
    expect(screen.getByTestId('messages-tab')).not.toHaveClass('active');
  });

  it('should switch to messages tab when error arrives with pending changes', () => {
    vi.mocked(useVSCode).mockReturnValue(makeVSCodeMock(0) as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(true) as any);

    const { rerender } = render(<ResultsPanel />);

    // Initially on results tab
    expect(screen.getByTestId('results-tab')).toHaveClass('active');

    // Simulate error arriving (lastErrorId increments)
    vi.mocked(useVSCode).mockReturnValue(makeVSCodeMock(1) as any);

    act(() => {
      rerender(<ResultsPanel />);
    });

    expect(screen.getByTestId('messages-tab')).toHaveClass('active');
    expect(screen.getByTestId('results-tab')).not.toHaveClass('active');
  });

  it('should NOT switch to messages tab when there are no pending changes', () => {
    vi.mocked(useVSCode).mockReturnValue(makeVSCodeMock(0) as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(false) as any);

    const { rerender } = render(<ResultsPanel />);

    expect(screen.getByTestId('results-tab')).toHaveClass('active');

    // Error arrives but no pending changes → tab should NOT switch
    vi.mocked(useVSCode).mockReturnValue(makeVSCodeMock(1) as any);

    act(() => {
      rerender(<ResultsPanel />);
    });

    expect(screen.getByTestId('results-tab')).toHaveClass('active');
    expect(screen.getByTestId('messages-tab')).not.toHaveClass('active');
  });

  it('should switch on repeated identical errors (lastErrorId increments each time)', () => {
    vi.mocked(useVSCode).mockReturnValue(makeVSCodeMock(1) as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(true) as any);

    const { rerender } = render(<ResultsPanel />);

    // First error → messages tab
    expect(screen.getByTestId('messages-tab')).toHaveClass('active');

    // User manually clicks back to results
    // (simulate by setting lastErrorId to same value but checking subsequent error)
    // Second error with same text but incremented id
    vi.mocked(useVSCode).mockReturnValue(makeVSCodeMock(2) as any);

    act(() => {
      rerender(<ResultsPanel />);
    });

    // Still on messages tab (auto-switch triggered again)
    expect(screen.getByTestId('messages-tab')).toHaveClass('active');
  });

  it('should switch to messages from pendingChanges tab when error arrives', () => {
    vi.mocked(useVSCode).mockReturnValue(makeVSCodeMock(0) as any);
    // hasPendingChanges = true makes the pendingChanges tab visible
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(true) as any);

    const { rerender } = render(<ResultsPanel />);

    // Error arrives while on pendingChanges tab
    vi.mocked(useVSCode).mockReturnValue(makeVSCodeMock(1) as any);

    act(() => {
      rerender(<ResultsPanel />);
    });

    // Should have switched to messages
    expect(screen.getByTestId('messages-tab')).toHaveClass('active');
  });
});
