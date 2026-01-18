import { useState, useCallback } from 'react';
import { useVSCode } from '../../context/VSCodeContext';
import { ResultsTabs } from './ResultsTabs';
import { MessagesTab } from './MessagesTab';
import { DataGrid } from './Grid/DataGrid';
import { QueryPlanView } from './QueryPlan/QueryPlanView';
import './ResultsPanel.css';

export type TabId = 'results' | 'messages' | 'plan';

export function ResultsPanel() {
  const {
    lastResults,
    lastColumnNames,
    lastMetadata,
    lastMessages,
    lastPlanXml,
    lastError,
    executionTime,
    rowsAffected,
  } = useVSCode();

  const [activeTab, setActiveTab] = useState<TabId>('results');

  // Determine which tabs have content
  const hasResults = lastResults && lastResults.length > 0;
  const hasMessages = lastMessages.length > 0 || !!lastError;
  const hasPlan = !!lastPlanXml;

  // Auto-switch to messages tab on error
  const handleTabChange = useCallback((tabId: TabId) => {
    setActiveTab(tabId);
  }, []);

  return (
    <div className="results-panel">
      <ResultsTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        hasResults={!!hasResults}
        hasMessages={hasMessages}
        hasPlan={hasPlan}
        resultSetCount={lastResults?.length || 0}
      />

      <div className="results-content">
        {activeTab === 'results' && hasResults && (
          <div className={`results-grids-container ${lastResults.length === 1 ? 'single-result' : ''}`}>
            {lastResults.map((data, index) => (
              <div key={index} className={`result-set-wrapper ${lastResults.length === 1 ? 'single-result' : ''}`}>
                <DataGrid
                  data={data}
                  columns={lastColumnNames?.[index] || []}
                  metadata={lastMetadata?.[index]}
                  resultSetIndex={index}
                  isSingleResultSet={lastResults.length === 1}
                />
              </div>
            ))}
          </div>
        )}

        {activeTab === 'results' && !hasResults && (
          <div className="results-empty">
            <svg className="empty-icon-svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="3" y1="9" x2="21" y2="9"></line>
              <line x1="9" y1="21" x2="9" y2="9"></line>
            </svg>
            <p>Execute a query to see results</p>
            <p className="hint">Press F5 or Ctrl+Shift+E to run</p>
          </div>
        )}

        {activeTab === 'messages' && (
          <MessagesTab
            messages={lastMessages}
            error={lastError}
            executionTime={executionTime}
            rowsAffected={rowsAffected}
          />
        )}

        {activeTab === 'plan' && hasPlan && (
          <QueryPlanView planXml={lastPlanXml} />
        )}

        {activeTab === 'plan' && !hasPlan && (
          <div className="results-empty">
            <svg className="empty-icon-svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
            <p>No execution plan available</p>
            <p className="hint">Enable "With execution plan" before running</p>
          </div>
        )}
      </div>
    </div>
  );
}
