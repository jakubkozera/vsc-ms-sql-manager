import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';
import { useVSCode } from './context/VSCodeContext';

vi.mock('./context/VSCodeContext', () => ({
  useVSCode: vi.fn(),
}));

vi.mock('./hooks/useLocalStorage', () => ({
  useLocalStorage: (_key: string, initialValue: unknown) => [initialValue, vi.fn()],
}));

vi.mock('./hooks/useGlobalKeyboardShortcuts', () => ({
  useGlobalKeyboardShortcuts: vi.fn(),
}));

vi.mock('./components/Toolbar', () => ({
  Toolbar: ({ onExecute, onEstimatedPlan }: { onExecute: () => void; onEstimatedPlan: () => void }) => (
    <div data-testid="toolbar">
      <button data-testid="toolbar-run" onClick={onExecute}>Run</button>
      <button data-testid="toolbar-estimated-plan" onClick={onEstimatedPlan}>Estimated Plan</button>
    </div>
  ),
  useFormatOptions: () => ({ formatBeforeRun: false }),
}));

vi.mock('./components/Editor', () => ({
  SqlEditor: React.forwardRef((_props: unknown, ref: React.ForwardedRef<{ getSelectedText: () => string; getValue: () => string; formatSql: () => void }>) => {
    React.useImperativeHandle(ref, () => ({
      getSelectedText: () => '',
      getValue: () => 'SELECT 1',
      formatSql: vi.fn(),
    }));

    return <div data-testid="sql-editor" />;
  }),
}));

vi.mock('./components/Results', () => ({
  ResultsPanel: () => <div data-testid="results-panel" />,
}));

describe('App history info layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders history panel above results panel when both are visible', () => {
    const dismissHistoryInfo = vi.fn();
    vi.mocked(useVSCode).mockReturnValue({
      isExecuting: false,
      executeQuery: vi.fn(),
      executeEstimatedPlan: vi.fn(),
      currentConnectionId: 'conn1',
      currentDatabase: 'master',
      postMessage: vi.fn(),
      shouldAutoExecute: false,
      clearAutoExecute: vi.fn(),
      lastResults: [[['value']]],
      lastMessages: [],
      lastPlanXml: null,
      lastError: null,
      editorContent: 'SELECT 1',
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

    render(<App />);

    const historyPanel = screen.getByTestId('history-info-panel');
    const resultsPanel = screen.getByTestId('results-panel');
    expect(historyPanel.compareDocumentPosition(resultsPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('dismisses history panel before running query', () => {
    const dismissHistoryInfo = vi.fn();
    const executeQuery = vi.fn();

    vi.mocked(useVSCode).mockReturnValue({
      isExecuting: false,
      executeQuery,
      executeEstimatedPlan: vi.fn(),
      currentConnectionId: 'conn1',
      currentDatabase: 'master',
      postMessage: vi.fn(),
      shouldAutoExecute: false,
      clearAutoExecute: vi.fn(),
      lastResults: null,
      lastMessages: [],
      lastPlanXml: null,
      lastError: null,
      editorContent: 'SELECT 1',
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

    render(<App />);

    fireEvent.click(screen.getByTestId('toolbar-run'));
    expect(dismissHistoryInfo).toHaveBeenCalledOnce();
    expect(executeQuery).toHaveBeenCalledOnce();
  });

  it('dismisses history panel before estimated plan', () => {
    const dismissHistoryInfo = vi.fn();
    const executeEstimatedPlan = vi.fn();

    vi.mocked(useVSCode).mockReturnValue({
      isExecuting: false,
      executeQuery: vi.fn(),
      executeEstimatedPlan,
      currentConnectionId: 'conn1',
      currentDatabase: 'master',
      postMessage: vi.fn(),
      shouldAutoExecute: false,
      clearAutoExecute: vi.fn(),
      lastResults: null,
      lastMessages: [],
      lastPlanXml: null,
      lastError: null,
      editorContent: 'SELECT 1',
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

    render(<App />);

    fireEvent.click(screen.getByTestId('toolbar-estimated-plan'));
    expect(dismissHistoryInfo).toHaveBeenCalledOnce();
    expect(executeEstimatedPlan).toHaveBeenCalledOnce();
  });
});