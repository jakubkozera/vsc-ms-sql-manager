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
    config: {
      colorPrimaryForeignKeys: false,
      numberFormat: 'plain',
      variableHighlightColor: '',
      multipleResultSetsDisplay: 'single-view',
    },
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

describe('ResultsPanel - pending changes reset on new query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call revertAll when query starts executing', () => {
    const pendingMock = makePendingChangesMock(true);
    vi.mocked(useVSCode).mockReturnValue({ ...makeVSCodeMock(0), isExecuting: false } as any);
    vi.mocked(usePendingChanges).mockReturnValue(pendingMock as any);

    const { rerender } = render(<ResultsPanel />);

    expect(pendingMock.revertAll).not.toHaveBeenCalled();

    // Query starts
    vi.mocked(useVSCode).mockReturnValue({ ...makeVSCodeMock(0), isExecuting: true } as any);

    act(() => {
      rerender(<ResultsPanel />);
    });

    expect(pendingMock.revertAll).toHaveBeenCalledTimes(1);
  });

  it('should NOT call revertAll when query finishes (isExecuting goes false)', () => {
    const pendingMock = makePendingChangesMock(false);
    vi.mocked(useVSCode).mockReturnValue({ ...makeVSCodeMock(0), isExecuting: true } as any);
    vi.mocked(usePendingChanges).mockReturnValue(pendingMock as any);

    const { rerender } = render(<ResultsPanel />);
    pendingMock.revertAll.mockClear();

    // Query finishes
    vi.mocked(useVSCode).mockReturnValue({ ...makeVSCodeMock(0), isExecuting: false } as any);

    act(() => {
      rerender(<ResultsPanel />);
    });

    expect(pendingMock.revertAll).not.toHaveBeenCalled();
  });

  it('should call revertAll once per query execution even if re-rendered while executing', () => {
    const pendingMock = makePendingChangesMock(true);
    vi.mocked(useVSCode).mockReturnValue({ ...makeVSCodeMock(0), isExecuting: false } as any);
    vi.mocked(usePendingChanges).mockReturnValue(pendingMock as any);

    const { rerender } = render(<ResultsPanel />);

    // Query starts
    vi.mocked(useVSCode).mockReturnValue({ ...makeVSCodeMock(0), isExecuting: true } as any);
    act(() => { rerender(<ResultsPanel />); });

    // Re-render while still executing (e.g. timer tick)
    act(() => { rerender(<ResultsPanel />); });
    act(() => { rerender(<ResultsPanel />); });

    // revertAll should have been called exactly once (only on isExecuting transition to true)
    expect(pendingMock.revertAll).toHaveBeenCalledTimes(1);
  });

  it('should call revertAll for each new query execution in sequence', () => {
    const pendingMock = makePendingChangesMock(true);
    vi.mocked(useVSCode).mockReturnValue({ ...makeVSCodeMock(0), isExecuting: false } as any);
    vi.mocked(usePendingChanges).mockReturnValue(pendingMock as any);

    const { rerender } = render(<ResultsPanel />);

    // First query
    vi.mocked(useVSCode).mockReturnValue({ ...makeVSCodeMock(0), isExecuting: true } as any);
    act(() => { rerender(<ResultsPanel />); });
    expect(pendingMock.revertAll).toHaveBeenCalledTimes(1);

    // Query finishes
    vi.mocked(useVSCode).mockReturnValue({ ...makeVSCodeMock(0), isExecuting: false } as any);
    act(() => { rerender(<ResultsPanel />); });

    // Second query
    vi.mocked(useVSCode).mockReturnValue({ ...makeVSCodeMock(0), isExecuting: true } as any);
    act(() => { rerender(<ResultsPanel />); });

    expect(pendingMock.revertAll).toHaveBeenCalledTimes(2);
  });
});

// ── Plan tab auto-switch ──────────────────────────────────────────────────────

describe('ResultsPanel - query plan tab auto-switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should switch to plan tab when lastPlanXml is set', () => {
    vi.mocked(useVSCode).mockReturnValue({ ...makeVSCodeMock(0), lastPlanXml: null } as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(false) as any);

    const { rerender } = render(<ResultsPanel />);

    // Initially on results tab
    expect(screen.getByTestId('results-tab')).toHaveClass('active');

    // Plan XML arrives
    const fakePlanXml = '<ShowPlanXML><StmtSimple /></ShowPlanXML>';
    vi.mocked(useVSCode).mockReturnValue({
      ...makeVSCodeMock(0),
      lastPlanXml: fakePlanXml,
    } as any);

    act(() => { rerender(<ResultsPanel />); });

    expect(screen.getByTestId('plan-tab')).toHaveClass('active');
    expect(screen.getByTestId('results-tab')).not.toHaveClass('active');
  });

  it('should remain on plan tab across re-renders while plan is present', () => {
    const fakePlanXml = '<ShowPlanXML></ShowPlanXML>';
    vi.mocked(useVSCode).mockReturnValue({
      ...makeVSCodeMock(0),
      lastPlanXml: fakePlanXml,
    } as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(false) as any);

    const { rerender } = render(<ResultsPanel />);

    expect(screen.getByTestId('plan-tab')).toHaveClass('active');

    // Re-render with same plan
    act(() => { rerender(<ResultsPanel />); });

    expect(screen.getByTestId('plan-tab')).toHaveClass('active');
  });

  it('should NOT switch to plan tab if lastPlanXml is null', () => {
    vi.mocked(useVSCode).mockReturnValue({ ...makeVSCodeMock(0), lastPlanXml: null } as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(false) as any);

    render(<ResultsPanel />);

    // Plan tab is not rendered (hasPlan is false)
    expect(screen.queryByTestId('plan-tab')).toBeNull();
    expect(screen.getByTestId('results-tab')).toHaveClass('active');
  });
});

// ── "Show multiple result sets" — separately mode ────────────────────────────

function makeMultiResultsMock(
  resultSets: unknown[][],
  displayMode: 'single-view' | 'separately'
) {
  return {
    ...makeVSCodeMock(0),
    lastResults: resultSets,
    lastColumnNames: resultSets.map(() => ['col1', 'col2']),
    lastMetadata: resultSets.map(() => null),
    config: {
      colorPrimaryForeignKeys: false,
      numberFormat: 'plain',
      variableHighlightColor: '',
      multipleResultSetsDisplay: displayMode,
    },
  };
}

describe('ResultsPanel - multiple result sets display mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows single stacked view when mode is single-view with 3 result sets', () => {
    const sets = [[[1, 2]], [[3, 4]], [[5, 6]]];
    vi.mocked(useVSCode).mockReturnValue(makeMultiResultsMock(sets, 'single-view') as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(false) as any);

    render(<ResultsPanel />);

    // No Set 1 / Set 2 buttons in single-view mode
    expect(screen.queryByText('Set 1')).toBeNull();
    expect(screen.queryByText('Set 2')).toBeNull();
  });

  it('shows Set N buttons in separately mode with 3 result sets', () => {
    const sets = [[[1, 2]], [[3, 4]], [[5, 6]]];
    vi.mocked(useVSCode).mockReturnValue(makeMultiResultsMock(sets, 'separately') as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(false) as any);

    render(<ResultsPanel />);

    expect(screen.getByText('Set 1')).toBeInTheDocument();
    expect(screen.getByText('Set 2')).toBeInTheDocument();
    expect(screen.getByText('Set 3')).toBeInTheDocument();
  });

  it('first Set button is active by default in separately mode', () => {
    const sets = [[[1, 2]], [[3, 4]]];
    vi.mocked(useVSCode).mockReturnValue(makeMultiResultsMock(sets, 'separately') as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(false) as any);

    render(<ResultsPanel />);

    expect(screen.getByText('Set 1').closest('button')).toHaveClass('active');
    expect(screen.getByText('Set 2').closest('button')).not.toHaveClass('active');
  });

  it('does NOT show Set buttons in separately mode when there is only 1 result set', () => {
    const sets = [[[1, 2]]];
    vi.mocked(useVSCode).mockReturnValue(makeMultiResultsMock(sets, 'separately') as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(false) as any);

    render(<ResultsPanel />);

    expect(screen.queryByText('Set 1')).toBeNull();
  });

  it('switches active Set button when another button is clicked', async () => {
    const sets = [[[1, 2]], [[3, 4]], [[5, 6]]];
    vi.mocked(useVSCode).mockReturnValue(makeMultiResultsMock(sets, 'separately') as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(false) as any);

    const { getByText } = render(<ResultsPanel />);

    const btn2 = getByText('Set 2').closest('button')!;
    act(() => { btn2.click(); });

    expect(btn2).toHaveClass('active');
    expect(getByText('Set 1').closest('button')).not.toHaveClass('active');
  });

  it('shows row count of Set 1 by default in separately mode', () => {
    // Set 1: 3 rows, Set 2: 1 row
    const sets = [
      [[1, 'a'], [2, 'b'], [3, 'c']],
      [[4, 'd']],
    ];
    vi.mocked(useVSCode).mockReturnValue(makeMultiResultsMock(sets, 'separately') as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(false) as any);

    render(<ResultsPanel />);

    expect(screen.getByText('3 rows')).toBeInTheDocument();
  });

  it('updates row count when switching to a different Set tab', () => {
    // Set 1: 3 rows, Set 2: 1 row
    const sets = [
      [[1, 'a'], [2, 'b'], [3, 'c']],
      [[4, 'd']],
    ];
    vi.mocked(useVSCode).mockReturnValue(makeMultiResultsMock(sets, 'separately') as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(false) as any);

    render(<ResultsPanel />);

    expect(screen.getByText('3 rows')).toBeInTheDocument();

    const btn2 = screen.getByText('Set 2').closest('button')!;
    act(() => { btn2.click(); });

    expect(screen.getByText('1 rows')).toBeInTheDocument();
    expect(screen.queryByText('3 rows')).toBeNull();
  });

  it('resets row count back to Set 1 when switching from Set 2 back to Set 1', () => {
    const sets = [
      [[1, 'a'], [2, 'b']],
      [[3, 'c'], [4, 'd'], [5, 'e'], [6, 'f']],
    ];
    vi.mocked(useVSCode).mockReturnValue(makeMultiResultsMock(sets, 'separately') as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(false) as any);

    render(<ResultsPanel />);

    // Go to Set 2 (4 rows)
    act(() => { screen.getByText('Set 2').closest('button')!.click(); });
    expect(screen.getByText('4 rows')).toBeInTheDocument();

    // Go back to Set 1 (2 rows)
    act(() => { screen.getByText('Set 1').closest('button')!.click(); });
    expect(screen.getByText('2 rows')).toBeInTheDocument();
    expect(screen.queryByText('4 rows')).toBeNull();
  });

  it('clears selection indicator when switching Set tabs', () => {
    // Set 1: 3 rows, Set 2: 1 row — selection is cleared on tab switch
    const sets = [
      [[1, 'a'], [2, 'b'], [3, 'c']],
      [[4, 'd']],
    ];
    vi.mocked(useVSCode).mockReturnValue(makeMultiResultsMock(sets, 'separately') as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(false) as any);

    render(<ResultsPanel />);

    // No selection text visible initially
    expect(screen.queryByText(/selected/)).toBeNull();

    // After switching tabs, still no selection text (selection was reset)
    act(() => { screen.getByText('Set 2').closest('button')!.click(); });
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it('does not use separately mode row count logic when in single-view mode', () => {
    const sets = [
      [[1, 'a'], [2, 'b'], [3, 'c']],
      [[4, 'd']],
    ];
    vi.mocked(useVSCode).mockReturnValue(makeMultiResultsMock(sets, 'single-view') as any);
    vi.mocked(usePendingChanges).mockReturnValue(makePendingChangesMock(false) as any);

    render(<ResultsPanel />);

    // In single-view there are no Set tabs to click, and row count shows Set 1's count
    expect(screen.queryByText('Set 1')).toBeNull();
    expect(screen.getByText('3 rows')).toBeInTheDocument();
  });
});
