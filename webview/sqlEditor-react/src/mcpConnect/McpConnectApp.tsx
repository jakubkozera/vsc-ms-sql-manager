export type McpConnectMessage = { type: 'copyMcpConfig' | 'openMcpSettings' };

interface McpConnectProps {
  postMessage: (message: McpConnectMessage) => void;
}

export function McpConnectApp({ postMessage }: McpConnectProps) {
  return (
    <main className="mcp-guide">
      <header>
        <p className="mcp-eyebrow">MS SQL Manager · Model Context Protocol</p>
        <h1>Connect MCP</h1>
        <p>Let an MCP client inspect your SQL Server schema and run T-SQL using the connections already open in MS SQL Manager.</p>
      </header>

      <section aria-labelledby="mcp-setup">
        <h2 id="mcp-setup">Set up your client</h2>
        <ol>
          <li>Connect to SQL Server in Database Explorer. Saved but disconnected profiles are not available to the client.</li>
          <li><strong>Copy MCP Server Configuration</strong> below. If the server is disabled, VS Code will ask you to enable it first.</li>
          <li>
            Add the copied <code>mssql-manager</code> entry to your client's MCP configuration. For Cursor, use your personal
            {' '}<code>~/.cursor/mcp.json</code> file. Merge the entry into the existing <code>mcpServers</code> object if you already have servers configured.
          </li>
          <li>Reload the MCP configuration in your client. Keep this VS Code window open and your SQL connections active.</li>
        </ol>
        <div className="mcp-actions">
          <button type="button" onClick={() => postMessage({ type: 'copyMcpConfig' })}>Copy MCP Server Configuration</button>
          <button type="button" className="mcp-secondary" onClick={() => postMessage({ type: 'openMcpSettings' })}>Open MCP Settings</button>
        </div>
        <p className="mcp-note"><strong>Keep the token private.</strong> The copied configuration contains a bearer token. Do not share it or commit it to source control.</p>
      </section>

      <section aria-labelledby="mcp-tools">
        <h2 id="mcp-tools">Available tools</h2>
        <dl>
          <dt><code>list_databases</code></dt>
          <dd>Lists databases reachable through active connections, including the connection IDs you can use to select a target.</dd>
          <dt><code>get_schema</code></dt>
          <dd>Returns tables, columns, keys, indexes, views, procedures, functions, and linked database instructions. Call this before writing SQL. Use <code>objects</code> to narrow the results on large databases.</dd>
          <dt><code>run_query</code></dt>
          <dd>Runs T-SQL and returns JSON results. Use <code>maxRows</code> to adjust how many rows are returned per result set. Data-modifying statements require confirmation.</dd>
        </dl>
        <p className="mcp-note"><strong>Try asking:</strong> “List my connected databases and ask me which one to use. Then show me its schema without running a query.”</p>
      </section>

      <section aria-labelledby="mcp-behavior">
        <h2 id="mcp-behavior">How it works</h2>
        <ul>
          <li>The server uses <strong>Streamable HTTP</strong> at <code>http://127.0.0.1:47815/mcp</code> by default. If your client uses a different config format, use the URL and <code>Authorization</code> header from the copied configuration.</li>
          <li>Loopback refers to the machine running the VS Code extension host. In a remote VS Code session, it is not your desktop's loopback address.</li>
          <li>If more than one database could be the target, the client can ask you to choose. You can also specify <code>connectionId</code> and <code>database</code> explicitly.</li>
          <li>Confirmation for a data-modifying query appears in the MCP client if it supports elicitation (asking for input); otherwise VS Code shows a confirmation dialog. Queries use your active connection's SQL permissions.</li>
          <li>If the port is busy, change <code>mssqlManager.mcp.port</code>, then copy the configuration again. To stop the server, turn off <code>mssqlManager.mcp.enabled</code>.</li>
        </ul>
        <p>Using GitHub Copilot inside VS Code? The built-in <code>#mssqlDatabases</code>, <code>#mssqlSchema</code>, and <code>#mssqlQuery</code> tools do not require MCP setup.</p>
      </section>
    </main>
  );
}
