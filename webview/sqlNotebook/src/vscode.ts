const vscode = acquireVsCodeApi();

export function postMessage(message: unknown) {
  vscode.postMessage(message);
}
