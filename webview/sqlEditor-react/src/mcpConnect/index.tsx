import { createRoot } from 'react-dom/client';
import { McpConnectApp, type McpConnectMessage } from './McpConnectApp';
import './mcpConnect.css';

declare function acquireVsCodeApi(): { postMessage(message: McpConnectMessage): void };

const vscode = acquireVsCodeApi();
createRoot(document.getElementById('root')!).render(
  <McpConnectApp postMessage={message => vscode.postMessage(message)} />,
);
