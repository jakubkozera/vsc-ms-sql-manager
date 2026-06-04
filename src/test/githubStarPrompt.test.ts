import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { GitHubStarPrompt } from '../githubStarPrompt';

suite('GitHubStarPrompt Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let outputChannel: vscode.OutputChannel;
    let mockUpdate: sinon.SinonStub;
    let mockGet: sinon.SinonStub;
    let context: vscode.ExtensionContext;

    setup(() => {
        sandbox = sinon.createSandbox();

        outputChannel = {
            appendLine: sandbox.stub(),
            show: sandbox.stub(),
            hide: sandbox.stub(),
            clear: sandbox.stub(),
            dispose: sandbox.stub(),
            name: 'test-channel'
        } as any;

        mockGet = sandbox.stub().returns({});
        mockUpdate = sandbox.stub().resolves();

        context = {
            globalState: {
                get: mockGet,
                update: mockUpdate
            }
        } as any;
    });

    teardown(() => {
        sandbox.restore();
    });

    test('prompts and opens the repo when Star repo is selected', async () => {
        const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves('Star repo' as any);
        const openExternalStub = sandbox.stub(vscode.env, 'openExternal').resolves(true);
        const prompt = new GitHubStarPrompt(context, outputChannel);

        await prompt.promptAfterSuccessfulQuery();

        assert.strictEqual(showInformationMessageStub.calledOnce, true);
        assert.strictEqual(openExternalStub.calledOnce, true);
        assert.strictEqual(mockUpdate.calledWith('mssqlManager.githubStarPrompt', sinon.match.has('dismissed', true)), true);
    });

    test('snoozes the prompt for a week when Maybe later is selected', async () => {
        const clock = sinon.useFakeTimers({ now: new Date('2026-06-04T00:00:00Z') });
        try {
            const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves('Maybe later' as any);
            const prompt = new GitHubStarPrompt(context, outputChannel);

            await prompt.promptAfterSuccessfulQuery();

            assert.strictEqual(showInformationMessageStub.calledOnce, true);
            assert.strictEqual(mockUpdate.calledWith(
                'mssqlManager.githubStarPrompt',
                sinon.match.has('snoozeUntil', Date.parse('2026-06-11T00:00:00Z'))
            ), true);
        } finally {
            clock.restore();
        }
    });

    test('skips the prompt when dismissed', async () => {
        mockGet.returns({ dismissed: true });
        const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
        const prompt = new GitHubStarPrompt(context, outputChannel);

        await prompt.promptAfterSuccessfulQuery();

        assert.strictEqual(showInformationMessageStub.called, false);
        assert.strictEqual(mockUpdate.called, false);
    });
});