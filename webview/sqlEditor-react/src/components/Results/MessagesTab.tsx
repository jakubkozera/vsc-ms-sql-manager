import { QueryMessage } from '../../types/messages';
import './MessagesTab.css';

interface MessagesTabProps {
  messages: QueryMessage[];
  error: string | null;
  executionTime: number | null;
  rowsAffected: number | null;
}

export function MessagesTab({
  messages,
  error,
  executionTime,
  rowsAffected,
}: MessagesTabProps) {
  const hasContent = messages.length > 0 || error;

  if (!hasContent) {
    return (
      <div className="messages-empty">
        <p>No messages</p>
      </div>
    );
  }

  return (
    <div className="messages-container" data-testid="messages-container">
      {/* Summary */}
      {(executionTime !== null || rowsAffected !== null) && (
        <div className="messages-summary">
          {rowsAffected !== null && (
            <span className="summary-item">
              <span className="summary-label">Rows affected:</span>
              <span className="summary-value">{rowsAffected}</span>
            </span>
          )}
          {executionTime !== null && (
            <span className="summary-item">
              <span className="summary-label">Execution time:</span>
              <span className="summary-value">{executionTime}ms</span>
            </span>
          )}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="message-item error" data-testid="error-message">
          <span className="message-icon">❌</span>
          <pre className="message-text">{error}</pre>
        </div>
      )}

      {/* Messages list */}
      <div className="messages-list">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`message-item ${msg.type}`}
            data-testid={`message-${index}`}
          >
            <span className="message-icon">
              {msg.type === 'error' && '❌'}
              {msg.type === 'warning' && '⚠️'}
              {msg.type === 'info' && 'ℹ️'}
            </span>
            <pre className="message-text">{msg.text}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
