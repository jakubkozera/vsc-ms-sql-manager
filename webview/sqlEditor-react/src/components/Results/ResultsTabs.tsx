import { TabId } from './ResultsPanel';
import './ResultsTabs.css';

interface ResultsTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  hasResults: boolean;
  hasMessages: boolean;
  hasPlan: boolean;
  resultSetCount: number;
  activeResultSet: number;
  onResultSetChange: (index: number) => void;
}

export function ResultsTabs({
  activeTab,
  onTabChange,
  hasResults,
  hasMessages,
  hasPlan,
  resultSetCount,
  activeResultSet,
  onResultSetChange,
}: ResultsTabsProps) {
  return (
    <div className="results-tabs-container">
      <div className="results-tabs">
        <button
          className={`results-tab ${activeTab === 'results' ? 'active' : ''}`}
          onClick={() => onTabChange('results')}
          data-testid="results-tab"
        >
          Results
          {hasResults && resultSetCount > 0 && (
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

        <button
          className={`results-tab ${activeTab === 'plan' ? 'active' : ''}`}
          onClick={() => onTabChange('plan')}
          data-testid="plan-tab"
        >
          Query Plan
          {hasPlan && <span className="tab-indicator" />}
        </button>
      </div>

      {/* Result set selector (when multiple result sets) */}
      {activeTab === 'results' && resultSetCount > 1 && (
        <div className="result-set-selector">
          {Array.from({ length: resultSetCount }, (_, i) => (
            <button
              key={i}
              className={`result-set-tab ${activeResultSet === i ? 'active' : ''}`}
              onClick={() => onResultSetChange(i)}
              data-testid={`result-set-${i}`}
            >
              Result {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
