import * as assert from 'node:assert/strict';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

suite('Connect MCP command', () => {
    test('opens the guide and reuses the panel until it is closed', async () => {
        const extension = vscode.extensions.getExtension('jakubkozera.ms-sql-manager');
        assert.ok(extension);
        await extension.activate();

        const sandbox = sinon.createSandbox();
        const createPanel = sandbox.spy(vscode.window, 'createWebviewPanel');
        try {
            await vscode.commands.executeCommand('mssqlManager.connectMcp');
            sinon.assert.calledOnce(createPanel);
            const panel = createPanel.firstCall.returnValue;
            assert.equal(panel.title, 'Connect MCP');
            assert.match(panel.webview.html, /mcpConnect\.js/);
            assert.match(panel.webview.html, /mcpConnect\.css/);

            await vscode.commands.executeCommand('mssqlManager.connectMcp');
            sinon.assert.calledOnce(createPanel);

            panel.dispose();
            await vscode.commands.executeCommand('mssqlManager.connectMcp');
            sinon.assert.calledTwice(createPanel);
        } finally {
            for (const call of createPanel.getCalls()) {
                call.returnValue?.dispose();
            }
            sandbox.restore();
        }
    });
});
