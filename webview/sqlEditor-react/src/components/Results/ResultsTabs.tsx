import { TabId } from './ResultsPanel';
import { AggregationBar } from './Grid/AggregationBar';
import './ResultsTabs.css';

interface ResultsTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  hasResults: boolean;
  hasMessages: boolean;
  hasPlan: boolean;
  resultSetCount: number;
  /** Total row count for the current result set */
  rowCount?: number;
  /** Number of selected rows */
  selectedRowCount?: number;
  /** Selected values for inline aggregation (non-datetime) */
  selectedValues?: unknown[];
  /** Whether to show inline aggregation bar */
  showInlineAggregation?: boolean;
  /** SQL column type for type-aware aggregation */
  columnType?: string;
  /** Number of active filters */
  activeFilterCount?: number;
  /** Callback to clear filters */
  onClearFilters?: () => void;
  /** Number of pending changes (edits + deletes) */
  pendingChangesCount?: number;
  /** Quick save callback - commits all pending changes */
  onQuickSave?: () => void;
  /** SQL preview text for quick save tooltip */
  sqlPreview?: string;
  /** Number of charts created */
  chartCount?: number;
}

export function ResultsTabs({
  activeTab,
  onTabChange,
  hasResults,
  hasMessages,
  hasPlan,
  resultSetCount,
  rowCount = 0,
  selectedRowCount = 0,
  selectedValues = [],
  showInlineAggregation = false,
  columnType,
  activeFilterCount = 0,
  onClearFilters,
  pendingChangesCount = 0,
  onQuickSave,
  sqlPreview,
  chartCount = 0,
}: ResultsTabsProps) {
  return (
    <div className="results-tabs-container">
      <div className="results-tabs-row">
        <div className="results-tabs">
          <button
            className={`results-tab ${activeTab === 'results' ? 'active' : ''}`}
            onClick={() => onTabChange('results')}
            data-testid="results-tab"
          >
            Results
            {hasResults && resultSetCount > 1 && (
              <span className="tab-badge">{resultSetCount}</span>
            )}
          </button>

          <button
            className={`results-tab ${activeTab === 'messages' ? 'active' : ''} ${hasMessages ? 'has-content' : ''}`}
            onClick={() => onTabChange('messages')}
            data-testid="messages-tab"
          >
            Messages
          </button>

          {pendingChangesCount > 0 && (
            <button
              className={`results-tab ${activeTab === 'pendingChanges' ? 'active' : ''}`}
              onClick={() => onTabChange('pendingChanges')}
              data-testid="pending-changes-tab"
            >
              Pending Changes
              <span className="tab-badge pending-badge">{pendingChangesCount}</span>
            </button>
          )}

          {pendingChangesCount > 0 && onQuickSave && (
            <button
              className="quick-save-button"
              onClick={onQuickSave}
              data-testid="quick-save-button"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2" />
                <path d="M12 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
                <path d="M14 4l0 4l-6 0l0 -4" />
              </svg>
              {sqlPreview && (
                <span className="quick-save-tooltip">{sqlPreview}</span>
              )}
            </button>
          )}

          {hasPlan && (
            <button
              className={`results-tab ${activeTab === 'plan' ? 'active' : ''}`}
              onClick={() => onTabChange('plan')}
              data-testid="plan-tab"
            >
              Query Plan
              <span className="tab-indicator" />
            </button>
          )}

          {chartCount > 0 && (
            <button
              className={`results-tab ${activeTab === 'charts' ? 'active' : ''}`}
              onClick={() => onTabChange('charts')}
              data-testid="charts-tab"
            >
              Charts
              <span className="tab-badge">{chartCount}</span>
            </button>
          )}
        </div>

        {/* Aggregation stats - same row as tabs, right aligned */}
        <div className="tabs-row-stats">
          {activeTab === 'results' && hasResults && (
            <>
              <span className="row-count">{rowCount} rows</span>
              {activeFilterCount > 0 && (
                <>
                  <span className="filter-indicator">
                    ({activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''})
                  </span>
                  <button 
                    className="clear-filters-btn"
                    onClick={onClearFilters}
                    title="Clear all filters"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm2.646 4.646L8.707 7.585l1.939 1.939-.707.707-1.939-1.939-1.939 1.939-.707-.707L7.293 7.585 5.354 5.646l.707-.707L8 6.878l1.939-1.939.707.707z"/>
                    </svg>
                  </button>
                </>
              )}
              {selectedRowCount > 0 && (
                <span className="selection-indicator">• {selectedRowCount} selected</span>
              )}
            </>
          )}
          <AggregationBar
            selectedValues={selectedValues}
            visible={showInlineAggregation && activeTab === 'results'}
            columnType={columnType}
          />
        </div>
      </div>
    </div>
  );
}
