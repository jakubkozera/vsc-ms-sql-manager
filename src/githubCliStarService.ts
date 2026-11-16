import { execFile } from 'child_process';

export type GhRunResult = { exitCode: number; stdout: string; stderr: string };
export type GhRunner = (args: string[]) => Promise<GhRunResult>;

export type StarStatus = 'starred' | 'notStarred' | 'unavailable';

const GH_TIMEOUT_MS = 10_000;

const runGh: GhRunner = (args) =>
    new Promise((resolve) => {
        execFile(
            'gh',
            args,
            {
                encoding: 'utf8',
                timeout: GH_TIMEOUT_MS,
                windowsHide: true,
                env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
            },
            (error, stdout, stderr) => {
                if (!error) {
                    resolve({ exitCode: 0, stdout, stderr });
                    return;
                }
                const code = (error as NodeJS.ErrnoException).code;
                resolve({
                    exitCode: typeof code === 'number' ? code : -1,
                    stdout: stdout ?? '',
                    stderr: stderr || error.message,
                });
            },
        );
    });

/**
 * Stars a GitHub repository through the user's `gh` CLI (when installed and authenticated).
 * Never throws: every failure is reported as "unavailable" / `false` so callers can fall back silently.
 */
export class GitHubCliStarService {
    constructor(
        private readonly repo: string,
        private readonly run: GhRunner = runGh,
    ) {}

    /** "unavailable" means gh is missing, not logged in, offline or the call failed for any other reason. */
    public async getStarStatus(): Promise<StarStatus> {
        const result = await this.run(['api', `user/starred/${this.repo}`]);
        if (result.exitCode === 0) {
            return 'starred';
        }
        // gh reports "Not Found (HTTP 404)" when the repo is simply not starred by the authenticated user
        return /HTTP 404/i.test(result.stderr) ? 'notStarred' : 'unavailable';
    }

    public async star(): Promise<boolean> {
        const result = await this.run(['api', '-X', 'PUT', `user/starred/${this.repo}`]);
        return result.exitCode === 0;
    }
}
