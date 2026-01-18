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
  /** Selected values for aggregation */
  selectedValues?: unknown[];
  /** Whether aggregation bar is visible */
  showAggregation?: boolean;
  /** Row count for the current result set */
  rowCount?: number;
  /** Number of selected rows */
  selectedRowCount?: number;
  /** Number of active filters */
  activeFilterCount?: number;
  /** Callback to clear filters */
  onClearFilters?: () => void;
}

export function ResultsTabs({
  activeTab,
  onTabChange,
  hasResults,
  hasMessages,
  hasPlan,
  resultSetCount,
  selectedValues = [],
  showAggregation = false,
  rowCount = 0,
  selectedRowCount = 0,
  activeFilterCount = 0,
  onClearFilters,
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
            visible={showAggregation && activeTab === 'results'} 
          />
        </div>
      </div>
    </div>
  );
}
