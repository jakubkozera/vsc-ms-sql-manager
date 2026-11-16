import * as vscode from 'vscode';
import { GitHubCliStarService } from './githubCliStarService';

export interface GitHubStarPromptState {
    // 'starred' = confirmed through gh CLI, 'starredBrowser' = only opened the browser (not verified)
    userAction?: 'none' | 'starred' | 'starredBrowser' | 'dismissed';
    snoozeUntil?: number;
}

export class GitHubStarPrompt {
    // v1 (`mssqlManager.githubStarPrompt`) counted every browser click as dismissed, so v2 starts fresh.
    private static readonly storageKey = 'mssqlManager.githubStarPrompt.v2';
    private static readonly repo = 'jakubkozera/vsc-ms-sql-manager';
    private static readonly repoUrl = `https://github.com/${GitHubStarPrompt.repo}`;
    private static readonly snoozeDurationMs = 7 * 24 * 60 * 60 * 1000;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel,
        private readonly githubCli: GitHubCliStarService = new GitHubCliStarService(GitHubStarPrompt.repo)
    ) {}

    async promptAfterSuccessfulQuery(): Promise<void> {
        try {
            if (this.shouldSkipPrompt()) {
                return;
            }

            // Silent check through gh CLI — if it's already starred there's nothing to ask for
            const starStatus = await this.githubCli.getStarStatus();
            if (starStatus === 'starred') {
                await this.saveState({ userAction: 'starred' });
                return;
            }

            const canUseCli = starStatus === 'notStarred';
            const starAction = canUseCli ? 'Star now' : 'Star on GitHub';
            const laterAction = 'Maybe later';
            const dismissAction = 'Dismiss';

            const choice = await vscode.window.showInformationMessage(
                'If you like MS SQL Manager, please consider starring the GitHub repo.',
                starAction,
                laterAction,
                dismissAction
            );

            if (!choice) {
                return;
            }

            if (choice === starAction) {
                await this.star(canUseCli);
                return;
            }

            if (choice === laterAction) {
                await this.saveState({ snoozeUntil: Date.now() + GitHubStarPrompt.snoozeDurationMs });
                return;
            }

            if (choice === dismissAction) {
                await this.saveState({ userAction: 'dismissed' });
            }
        } catch (error) {
            this.outputChannel.appendLine(`[GitHubStarPrompt] Failed to show prompt: ${error}`);
        }
    }

    private async star(canUseCli: boolean): Promise<void> {
        if (canUseCli) {
            if (await this.githubCli.star()) {
                await this.saveState({ userAction: 'starred' });
                void vscode.window.showInformationMessage('Thanks for starring MS SQL Manager! ⭐');
                return;
            }
            this.outputChannel.appendLine('[GitHubStarPrompt] gh CLI star failed, falling back to browser.');
        }

        // No gh CLI or it failed — fall back to the browser (we can't verify the star there)
        await vscode.env.openExternal(vscode.Uri.parse(GitHubStarPrompt.repoUrl));
        await this.saveState({ userAction: 'starredBrowser' });
    }

    private shouldSkipPrompt(): boolean {
        const state = this.context.globalState.get<GitHubStarPromptState>(GitHubStarPrompt.storageKey, {});
        if (state.userAction && state.userAction !== 'none') {
            return true;
        }

        if (state.snoozeUntil && state.snoozeUntil > Date.now()) {
            return true;
        }

        return false;
    }

    private async saveState(partialState: GitHubStarPromptState): Promise<void> {
        const currentState = this.context.globalState.get<GitHubStarPromptState>(GitHubStarPrompt.storageKey, {});
        const nextState: GitHubStarPromptState = {
            ...currentState,
            ...partialState,
        };

        if (nextState.userAction && nextState.userAction !== 'none') {
            delete nextState.snoozeUntil;
        }

        await this.context.globalState.update(GitHubStarPrompt.storageKey, nextState);
    }
}