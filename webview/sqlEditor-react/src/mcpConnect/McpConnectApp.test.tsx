import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { McpConnectApp } from './McpConnectApp';

describe('McpConnectApp', () => {
  it('explains setup and lists the exposed MCP tools', () => {
    render(<McpConnectApp postMessage={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Connect MCP' })).toBeVisible();
    expect(screen.getByText('http://127.0.0.1:47815/mcp')).toBeVisible();
    expect(screen.getAllByRole('term').map(term => term.textContent))
      .toEqual(['list_databases', 'get_schema', 'run_query']);
  });

  it('delegates copying and opening settings to the extension host', () => {
    const postMessage = vi.fn();
    render(<McpConnectApp postMessage={postMessage} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy MCP Server Configuration' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open MCP Settings' }));

    expect(postMessage.mock.calls).toEqual([
      [{ type: 'copyMcpConfig' }],
      [{ type: 'openMcpSettings' }],
    ]);
  });
});
