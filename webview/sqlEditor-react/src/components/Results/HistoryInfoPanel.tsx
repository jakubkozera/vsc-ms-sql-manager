import { useVSCode } from '../../context/VSCodeContext';
import './HistoryInfoPanel.css';

export function HistoryInfoPanel() {
  const { historyInfo, dismissHistoryInfo } = useVSCode();

  if (!historyInfo) return null;

  const durationStr = historyInfo.duration !== undefined
    ? `${(historyInfo.duration / 1000).toFixed(2)}s`
    : undefined;

  return (
    <div className="history-info-panel" data-testid="history-info-panel">
      <div className="history-info-content">
        <span className="history-info-item history-info-item-with-icon">
          <span className="history-info-icon" title="Executed" data-testid="history-info-icon-executed">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11.795 21h-6.795a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v4" />
              <path d="M18 18m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />
              <path d="M15 3v4" />
              <path d="M7 3v4" />
              <path d="M3 11h16" />
              <path d="M18 16.496v1.504l1 1" />
            </svg>
          </span>
          <strong>Executed:</strong> {historyInfo.executedAt}
        </span>
        <span className="history-info-item history-info-item-with-icon">
          <span className="history-info-icon" title="Connection" data-testid="history-info-icon-connection">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9.785 6l8.215 8.215l-2.054 2.054a5.81 5.81 0 1 1 -8.215 -8.215l2.054 -2.054z" />
              <path d="M4 20l3.5 -3.5" />
              <path d="M15 4l-3.5 3.5" />
              <path d="M20 9l-3.5 3.5" />
            </svg>
          </span>
          <strong>Connection:</strong> {historyInfo.connectionName} ({historyInfo.server}/{historyInfo.database})
        </span>
        <span className="history-info-item history-info-item-with-icon">
          <span className="history-info-icon" title="Results" data-testid="history-info-icon-results">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 12h.01" />
              <path d="M4 6h.01" />
              <path d="M4 18h.01" />
              <path d="M8 18h2" />
              <path d="M8 12h2" />
              <path d="M8 6h2" />
              <path d="M14 6h6" />
              <path d="M14 12h6" />
              <path d="M14 18h6" />
            </svg>
          </span>
          <strong>Results:</strong> {historyInfo.resultSetCount} {historyInfo.rowCountsStr}
        </span>
        {durationStr && (
          <span className="history-info-item history-info-item-with-icon">
            <span className="history-info-icon" title="Duration" data-testid="history-info-icon-duration">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 13a7 7 0 1 0 14 0a7 7 0 0 0 -14 0z" />
                <path d="M14.5 10.5l-2.5 2.5" />
                <path d="M17 8l1 -1" />
                <path d="M14 3h-4" />
              </svg>
            </span>
              <strong>Duration:</strong> {durationStr}
          </span>
        )}
      </div>
      <button
        className="history-info-close"
        onClick={dismissHistoryInfo}
        title="Dismiss"
        data-testid="history-info-close"
      >
        &#x2715;
      </button>
    </div>
  );
}
