import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { GitHubCliStarService, GhRunResult } from '../githubCliStarService';
import { GitHubStarPrompt } from '../githubStarPrompt';

const ok: GhRunResult = { exitCode: 0, stdout: '', stderr: '' };
const notFound: GhRunResult = { exitCode: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
const authError: GhRunResult = { exitCode: 4, stdout: '', stderr: 'gh auth login required' };

suite('GitHubCliStarService Tests', () => {
    test('reports starred when the API call succeeds', async () => {
        const run = sinon.stub().resolves(ok);
        const service = new GitHubCliStarService('o/r', run);
        assert.strictEqual(await service.getStarStatus(), 'starred');
        assert.deepStrictEqual(run.firstCall.args[0], ['api', 'user/starred/o/r']);
    });

    test('reports notStarred on HTTP 404', async () => {
        const service = new GitHubCliStarService('o/r', sinon.stub().resolves(notFound));
        assert.strictEqual(await service.getStarStatus(), 'notStarred');
    });

    test('reports unavailable for auth errors and missing gh', async () => {
        assert.strictEqual(
            await new GitHubCliStarService('o/r', sinon.stub().resolves(authError)).getStarStatus(),
            'unavailable'
        );
        assert.strictEqual(
            await new GitHubCliStarService(
                'o/r',
                sinon.stub().resolves({ exitCode: -1, stdout: '', stderr: 'spawn gh ENOENT' })
            ).getStarStatus(),
            'unavailable'
        );
    });

    test('star() uses PUT and reflects the exit code', async () => {
        const run = sinon.stub();
        run.onFirstCall().resolves(ok);
        run.onSecondCall().resolves(authError);
        const service = new GitHubCliStarService('o/r', run);
        assert.strictEqual(await service.star(), true);
        assert.deepStrictEqual(run.firstCall.args[0], ['api', '-X', 'PUT', 'user/starred/o/r']);
        assert.strictEqual(await service.star(), false);
    });
});

suite('GitHubStarPrompt Tests', () => {
    const storageKey = 'mssqlManager.githubStarPrompt.v2';
    let sandbox: sinon.SinonSandbox;
    let outputChannel: vscode.OutputChannel;
    let mockUpdate: sinon.SinonStub;
    let mockGet: sinon.SinonStub;
    let context: vscode.ExtensionContext;
    let cli: { getStarStatus: sinon.SinonStub; star: sinon.SinonStub };

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

        cli = {
            getStarStatus: sandbox.stub().resolves('notStarred'),
            star: sandbox.stub().resolves(true)
        };
    });

    teardown(() => {
        sandbox.restore();
    });

    test('gh CLI success stars silently without opening the browser', async () => {
        const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
        showInformationMessageStub.onFirstCall().resolves('Star now' as any);
        const openExternalStub = sandbox.stub(vscode.env, 'openExternal').resolves(true);
        const prompt = new GitHubStarPrompt(context, outputChannel, cli as any);

        await prompt.promptAfterSuccessfulQuery();

        assert.strictEqual(cli.star.calledOnce, true);
        assert.strictEqual(openExternalStub.notCalled, true);
        assert.strictEqual(mockUpdate.calledWith(storageKey, sinon.match.has('userAction', 'starred')), true);
    });

    test('gh CLI failure falls back to the browser and marks starredBrowser', async () => {
        cli.star.resolves(false);
        const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves('Star now' as any);
        const openExternalStub = sandbox.stub(vscode.env, 'openExternal').resolves(true);
        const prompt = new GitHubStarPrompt(context, outputChannel, cli as any);

        await prompt.promptAfterSuccessfulQuery();

        assert.strictEqual(showInformationMessageStub.calledOnce, true);
        assert.strictEqual(openExternalStub.calledOnce, true);
        assert.strictEqual(mockUpdate.calledWith(storageKey, sinon.match.has('userAction', 'starredBrowser')), true);
    });

    test('without gh the browser is used and the button is Star on GitHub', async () => {
        cli.getStarStatus.resolves('unavailable');
        const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves('Star on GitHub' as any);
        const openExternalStub = sandbox.stub(vscode.env, 'openExternal').resolves(true);
        const prompt = new GitHubStarPrompt(context, outputChannel, cli as any);

        await prompt.promptAfterSuccessfulQuery();

        assert.strictEqual(showInformationMessageStub.firstCall.args.includes('Star on GitHub'), true);
        assert.strictEqual(cli.star.notCalled, true);
        assert.strictEqual(openExternalStub.calledOnce, true);
        assert.strictEqual(mockUpdate.calledWith(storageKey, sinon.match.has('userAction', 'starredBrowser')), true);
    });

    test('already starred skips the prompt and marks starred', async () => {
        cli.getStarStatus.resolves('starred');
        const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
        const prompt = new GitHubStarPrompt(context, outputChannel, cli as any);

        await prompt.promptAfterSuccessfulQuery();

        assert.strictEqual(showInformationMessageStub.called, false);
        assert.strictEqual(mockUpdate.calledWith(storageKey, sinon.match.has('userAction', 'starred')), true);
    });

    test('snoozes the prompt for a week when Maybe later is selected', async () => {
        const clock = sinon.useFakeTimers({ now: new Date('2026-06-04T00:00:00Z') });
        try {
            const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves('Maybe later' as any);
            const prompt = new GitHubStarPrompt(context, outputChannel, cli as any);

            await prompt.promptAfterSuccessfulQuery();

            assert.strictEqual(showInformationMessageStub.calledOnce, true);
            assert.strictEqual(mockUpdate.calledWith(
                storageKey,
                sinon.match.has('snoozeUntil', Date.parse('2026-06-11T00:00:00Z'))
            ), true);
        } finally {
            clock.restore();
        }
    });

    test('skips the prompt when dismissed or already starred in v2 state', async () => {
        for (const userAction of ['dismissed', 'starred', 'starredBrowser']) {
            mockGet.returns({ userAction });
            const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
            const prompt = new GitHubStarPrompt(context, outputChannel, cli as any);

            await prompt.promptAfterSuccessfulQuery();

            assert.strictEqual(showInformationMessageStub.called, false);
            assert.strictEqual(cli.getStarStatus.called, false);
            showInformationMessageStub.restore();
        }
    });
});