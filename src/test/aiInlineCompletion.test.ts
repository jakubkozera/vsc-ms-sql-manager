import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { AiInlineCompletionService, buildPrompt, cleanCompletion } from '../aiInlineCompletion';

suite('AiInlineCompletion', () => {
    let sandbox: sinon.SinonSandbox;
    let outputChannel: vscode.OutputChannel;

    setup(() => {
        sandbox = sinon.createSandbox();
        outputChannel = { appendLine: sandbox.stub() } as unknown as vscode.OutputChannel;
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('cleanCompletion', () => {
        test('strips markdown code fences', () => {
            assert.strictEqual(cleanCompletion('```sql\nFROM dbo.Users\n```', 'SELECT * ', ''), 'FROM dbo.Users');
        });

        test('removes echoed current line prefix', () => {
            assert.strictEqual(cleanCompletion('SELECT * FROM Users', 'SELECT * FR', ''), 'OM Users');
        });

        test('removes overlap with text after cursor', () => {
            assert.strictEqual(cleanCompletion('Id, Name FROM Users', 'SELECT ', ' FROM Users'), 'Id, Name');
        });

        test('returns empty string for whitespace-only output', () => {
            assert.strictEqual(cleanCompletion('  \n ', 'SELECT ', ''), '');
        });

        test('drops leading newline when cursor line is empty', () => {
            assert.strictEqual(cleanCompletion('\nWHERE Id = 1', 'SELECT * FROM Users\n', ''), 'WHERE Id = 1');
        });
    });

    suite('buildPrompt', () => {
        test('includes cursor marker and schema context', () => {
            const prompt = buildPrompt('SELECT ', ' FROM Users', 'TABLE [dbo].[Users] (Id int)');
            assert.ok(prompt.includes('SELECT <CURSOR> FROM Users'));
            assert.ok(prompt.includes('TABLE [dbo].[Users] (Id int)'));
        });

        test('omits schema section when no context', () => {
            assert.ok(!buildPrompt('SELECT ', '').includes('Database schema'));
        });
    });

    suite('handleRequest', () => {
        function stubConfig(values: Record<string, unknown>) {
            sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => ({
                get: (key: string, defaultValue?: unknown) => {
                    const fullKey = section ? `${section}.${key}` : key;
                    return fullKey in values ? values[fullKey] : defaultValue;
                },
            }) as unknown as vscode.WorkspaceConfiguration);
        }

        function createWebview() {
            return { postMessage: sandbox.stub().resolves(true) } as unknown as vscode.Webview & { postMessage: sinon.SinonStub };
        }

        function createModel(family: string, chunks: string[]) {
            return {
                family,
                sendRequest: sandbox.stub().resolves({
                    text: (async function* () { for (const c of chunks) { yield c; } })(),
                }),
            };
        }

        test('posts empty result when disabled by setting', async () => {
            stubConfig({ 'mssqlManager.aiInlineCompletions.enabled': false });
            const selectStub = sandbox.stub(vscode.lm, 'selectChatModels');
            const webview = createWebview();
            const service = new AiInlineCompletionService(outputChannel);

            await service.handleRequest(webview, { requestId: 'r1', prefix: 'SELECT ', suffix: '' });

            assert.ok(selectStub.notCalled);
            assert.deepStrictEqual(webview.postMessage.firstCall.args[0], { type: 'inlineCompletionResult', requestId: 'r1', text: '' });
        });

        test('posts empty result when Copilot is disabled for sql', async () => {
            stubConfig({ 'github.copilot.enable': { '*': true, sql: false } });
            const selectStub = sandbox.stub(vscode.lm, 'selectChatModels');
            const webview = createWebview();
            const service = new AiInlineCompletionService(outputChannel);

            await service.handleRequest(webview, { requestId: 'r2', prefix: 'SELECT ', suffix: '' });

            assert.ok(selectStub.notCalled);
            assert.strictEqual(webview.postMessage.firstCall.args[0].text, '');
        });

        test('returns cleaned model completion using preferred model family', async () => {
            stubConfig({});
            const other = createModel('claude-sonnet-4', ['nope']);
            const preferred = createModel('gpt-4.1', ['```sql\n', '* FROM Users', '\n```']);
            sandbox.stub(vscode.lm, 'selectChatModels').resolves([other, preferred] as unknown as vscode.LanguageModelChat[]);
            const webview = createWebview();
            const service = new AiInlineCompletionService(outputChannel);

            await service.handleRequest(webview, { requestId: 'r3', prefix: 'SELECT ', suffix: '', schemaContext: 'TABLE [dbo].[Users] (Id int)' });

            assert.ok(other.sendRequest.notCalled);
            assert.ok(preferred.sendRequest.calledOnce);
            const promptMessage = preferred.sendRequest.firstCall.args[0][0] as vscode.LanguageModelChatMessage;
            const promptText = promptMessage.content.map(p => (p as vscode.LanguageModelTextPart).value).join('');
            assert.ok(promptText.includes('TABLE [dbo].[Users]'));
            assert.deepStrictEqual(webview.postMessage.firstCall.args[0], { type: 'inlineCompletionResult', requestId: 'r3', text: '* FROM Users' });
        });

        test('posts empty result when no models are available', async () => {
            stubConfig({});
            sandbox.stub(vscode.lm, 'selectChatModels').resolves([]);
            const webview = createWebview();
            const service = new AiInlineCompletionService(outputChannel);

            await service.handleRequest(webview, { requestId: 'r4', prefix: 'SELECT ', suffix: '' });

            assert.strictEqual(webview.postMessage.firstCall.args[0].text, '');
        });

        test('posts empty result when Language Model API is missing (e.g. Cursor/Windsurf)', async () => {
            stubConfig({});
            sandbox.stub(vscode.lm, 'selectChatModels').value(undefined);
            const webview = createWebview();
            const service = new AiInlineCompletionService(outputChannel);

            await service.handleRequest(webview, { requestId: 'r6', prefix: 'SELECT ', suffix: '' });

            assert.strictEqual(webview.postMessage.firstCall.args[0].text, '');
        });

        test('caches model lookup across requests', async () => {
            stubConfig({});
            const selectStub = sandbox.stub(vscode.lm, 'selectChatModels').resolves([]);
            const webview = createWebview();
            const service = new AiInlineCompletionService(outputChannel);

            await service.handleRequest(webview, { requestId: 'r7', prefix: 'SELECT ', suffix: '' });
            await service.handleRequest(webview, { requestId: 'r8', prefix: 'SELECT ', suffix: '' });

            assert.strictEqual(selectStub.callCount, 1);
            service.dispose();
        });

        test('cancel stops the pending request', async () => {
            stubConfig({});
            let release: () => void = () => {};
            const gate = new Promise<void>(resolve => { release = resolve; });
            const model = {
                family: 'gpt-4.1',
                sendRequest: sandbox.stub().resolves({
                    text: (async function* () { await gate; yield 'FROM Users'; })(),
                }),
            };
            sandbox.stub(vscode.lm, 'selectChatModels').resolves([model] as unknown as vscode.LanguageModelChat[]);
            const webview = createWebview();
            const service = new AiInlineCompletionService(outputChannel);

            const pending = service.handleRequest(webview, { requestId: 'r5', prefix: 'SELECT * ', suffix: '' });
            await new Promise(resolve => setTimeout(resolve, 10));
            service.cancel('r5');
            release();
            await pending;

            const token = model.sendRequest.firstCall.args[2] as vscode.CancellationToken;
            assert.ok(token.isCancellationRequested);
            assert.strictEqual(webview.postMessage.firstCall.args[0].text, '');
        });
    });
});
