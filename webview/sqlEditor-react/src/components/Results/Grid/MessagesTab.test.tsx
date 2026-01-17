import { describe, it, expect } from 'vitest';
import { render, screen } from '../../../test/testUtils';
import { MessagesTab } from '../MessagesTab';

describe('MessagesTab', () => {
  it('shows empty state when no messages', () => {
    render(
      <MessagesTab
        messages={[]}
        error={null}
        executionTime={null}
        rowsAffected={null}
      />
    );
    
    expect(screen.getByText(/no messages/i)).toBeInTheDocument();
  });

  it('displays error message', () => {
    render(
      <MessagesTab
        messages={[]}
        error="SQL syntax error near 'SELECT'"
        executionTime={null}
        rowsAffected={null}
      />
    );
    
    expect(screen.getByTestId('error-message')).toBeInTheDocument();
    expect(screen.getByText(/SQL syntax error/)).toBeInTheDocument();
  });

  it('displays messages list', () => {
    render(
      <MessagesTab
        messages={[
          { type: 'info', text: 'Query started' },
          { type: 'info', text: 'Query completed' },
        ]}
        error={null}
        executionTime={null}
        rowsAffected={null}
      />
    );
    
    expect(screen.getByTestId('message-0')).toBeInTheDocument();
    expect(screen.getByTestId('message-1')).toBeInTheDocument();
    expect(screen.getByText('Query started')).toBeInTheDocument();
    expect(screen.getByText('Query completed')).toBeInTheDocument();
  });

  it('displays execution summary', () => {
    render(
      <MessagesTab
        messages={[{ type: 'info', text: 'Done' }]}
        error={null}
        executionTime={123}
        rowsAffected={42}
      />
    );
    
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('123ms')).toBeInTheDocument();
  });

  it('displays different message types with correct styling', () => {
    render(
      <MessagesTab
        messages={[
          { type: 'error', text: 'Error message' },
          { type: 'warning', text: 'Warning message' },
          { type: 'info', text: 'Info message' },
        ]}
        error={null}
        executionTime={null}
        rowsAffected={null}
      />
    );
    
    expect(screen.getByTestId('message-0')).toHaveClass('error');
    expect(screen.getByTestId('message-1')).toHaveClass('warning');
    expect(screen.getByTestId('message-2')).toHaveClass('info');
  });
});
