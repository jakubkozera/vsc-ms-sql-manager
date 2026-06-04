import * as vscode from 'vscode';

interface GitHubStarPromptState {
    dismissed?: boolean;
    snoozeUntil?: number;
}

export class GitHubStarPrompt {
    private static readonly storageKey = 'mssqlManager.githubStarPrompt';
    private static readonly repoUrl = 'https://github.com/jakubkozera/vsc-ms-sql-manager';
    private static readonly snoozeDurationMs = 7 * 24 * 60 * 60 * 1000;

    constructor(private readonly context: vscode.ExtensionContext, private readonly outputChannel: vscode.OutputChannel) {}

    async promptAfterSuccessfulQuery(): Promise<void> {
        try {
            if (this.shouldSkipPrompt()) {
                return;
            }

            const choice = await vscode.window.showInformationMessage(
                'If you like MS SQL Manager, please consider starring the GitHub repo.',
                'Star repo',
                'Maybe later',
                'Dismiss'
            );

            if (!choice) {
                return;
            }

            if (choice === 'Star repo') {
                await vscode.env.openExternal(vscode.Uri.parse(GitHubStarPrompt.repoUrl));
                await this.saveState({ dismissed: true });
                return;
            }

            if (choice === 'Maybe later') {
                await this.saveState({ snoozeUntil: Date.now() + GitHubStarPrompt.snoozeDurationMs });
                return;
            }

            if (choice === 'Dismiss') {
                await this.saveState({ dismissed: true });
            }
        } catch (error) {
            this.outputChannel.appendLine(`[GitHubStarPrompt] Failed to show prompt: ${error}`);
        }
    }

    private shouldSkipPrompt(): boolean {
        const state = this.context.globalState.get<GitHubStarPromptState>(GitHubStarPrompt.storageKey, {});
        if (state.dismissed) {
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

        if (nextState.dismissed) {
            delete nextState.snoozeUntil;
        }

        await this.context.globalState.update(GitHubStarPrompt.storageKey, nextState);
    }
}