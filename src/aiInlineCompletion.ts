import * as vscode from 'vscode';

export interface InlineCompletionRequest {
    requestId: string;
    prefix: string;
    suffix: string;
    schemaContext?: string;
}

const maxPrefixChars = 4000;
const maxSuffixChars = 1500;
const preferredModelFamilies = ['gpt-4.1', 'gpt-4o-mini', 'gpt-5-mini', 'gpt-4o'];

/**
 * Provides AI inline (ghost text) completions for the custom SQL editor webview.
 * The webview's Monaco instance is isolated from VS Code's inline completion providers
 * (e.g. GitHub Copilot), so we bridge to the Language Model API instead.
 */
export class AiInlineCompletionService implements vscode.Disposable {
    private pending = new Map<string, vscode.CancellationTokenSource>();
    private modelPromise: Promise<vscode.LanguageModelChat | undefined> | undefined;
    private modelsChangedSubscription: vscode.Disposable | undefined;

    constructor(private readonly outputChannel: vscode.OutputChannel) {
        // Forks like Cursor/Windsurf may not implement the Language Model API
        this.modelsChangedSubscription = vscode.lm?.onDidChangeChatModels?.(() => {
            this.modelPromise = undefined;
        });
    }

    public isEnabled(): boolean {
        if (!vscode.workspace.getConfiguration('mssqlManager').get<boolean>('aiInlineCompletions.enabled', true)) {
            return false;
        }
        // Respect the user's Copilot per-language toggle
        const copilotEnable = vscode.workspace.getConfiguration('github.copilot').get<Record<string, boolean>>('enable');
        if (copilotEnable) {
            if (copilotEnable.sql === false) { return false; }
            if (copilotEnable.sql === undefined && copilotEnable['*'] === false) { return false; }
        }
        return true;
    }

    public async handleRequest(webview: vscode.Webview, request: InlineCompletionRequest): Promise<void> {
        const cts = new vscode.CancellationTokenSource();
        this.pending.set(request.requestId, cts);
        let text = '';
        try {
            if (this.isEnabled()) {
                text = await this.complete(request, cts.token);
            }
        } catch (error) {
            this.outputChannel.appendLine(`[AiInlineCompletion] Error: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.pending.delete(request.requestId);
            cts.dispose();
        }
        webview.postMessage({ type: 'inlineCompletionResult', requestId: request.requestId, text });
    }

    public cancel(requestId: string): void {
        this.pending.get(requestId)?.cancel();
    }

    private selectModel(): Promise<vscode.LanguageModelChat | undefined> {
        if (!this.modelPromise) {
            this.modelPromise = this.findModel().catch(error => {
                this.outputChannel.appendLine(`[AiInlineCompletion] Model selection failed: ${error instanceof Error ? error.message : String(error)}`);
                return undefined;
            });
        }
        return this.modelPromise;
    }

    private async findModel(): Promise<vscode.LanguageModelChat | undefined> {
        if (typeof vscode.lm?.selectChatModels !== 'function') {
            this.outputChannel.appendLine('[AiInlineCompletion] Language Model API not available in this editor; AI inline suggestions disabled.');
            return undefined;
        }
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        if (models.length === 0) {
            this.outputChannel.appendLine('[AiInlineCompletion] No GitHub Copilot language models available; AI inline suggestions disabled.');
            return undefined;
        }
        for (const family of preferredModelFamilies) {
            const match = models.find(m => m.family === family);
            if (match) { return match; }
        }
        return models[0];
    }

    private async complete(request: InlineCompletionRequest, token: vscode.CancellationToken): Promise<string> {
        const model = await this.selectModel();
        if (!model || token.isCancellationRequested) {
            return '';
        }

        const prefix = request.prefix.slice(-maxPrefixChars);
        const suffix = request.suffix.slice(0, maxSuffixChars);
        const prompt = buildPrompt(prefix, suffix, request.schemaContext);

        const response = await model.sendRequest(
            [vscode.LanguageModelChatMessage.User(prompt)],
            { justification: 'Provide inline T-SQL code completions in the MS SQL Manager editor.' },
            token
        );

        let raw = '';
        for await (const fragment of response.text) {
            if (token.isCancellationRequested) {
                return '';
            }
            raw += fragment;
        }
        return cleanCompletion(raw, prefix, suffix);
    }

    public dispose(): void {
        this.modelsChangedSubscription?.dispose();
        for (const cts of this.pending.values()) {
            cts.cancel();
            cts.dispose();
        }
        this.pending.clear();
    }
}

export function buildPrompt(prefix: string, suffix: string, schemaContext?: string): string {
    const parts = [
        'You are a T-SQL (Microsoft SQL Server) code completion engine.',
        'Continue the code exactly at the <CURSOR> marker.',
        'Respond ONLY with the raw text to insert at the cursor: no markdown, no code fences, no explanations.',
        'Do not repeat text that is already before or after the cursor. Keep the completion short (usually finish the current statement or line).',
        'If nothing useful can be suggested, respond with an empty message.',
    ];
    if (schemaContext && schemaContext.trim()) {
        parts.push('', 'Database schema (use these exact table/column names):', schemaContext.trim());
    }
    parts.push('', 'Code:', `${prefix}<CURSOR>${suffix}`);
    return parts.join('\n');
}

export function cleanCompletion(raw: string, prefix: string, suffix: string): string {
    let text = raw;

    const fenced = text.match(/```[a-zA-Z]*\r?\n?([\s\S]*?)(?:```|$)/);
    if (fenced) {
        text = fenced[1];
    }
    text = text.replace(/<CURSOR>/g, '').replace(/\s+$/, '');

    if (!text.trim()) {
        return '';
    }

    // Model sometimes echoes the current line before the cursor
    const currentLinePrefix = prefix.slice(prefix.lastIndexOf('\n') + 1);
    if (currentLinePrefix.trim() && text.startsWith(currentLinePrefix)) {
        text = text.slice(currentLinePrefix.length);
    }

    // Drop trailing overlap with text already after the cursor
    const suffixLine = suffix.split(/\r?\n/)[0].trim();
    if (suffixLine && text.trimEnd().endsWith(suffixLine)) {
        text = text.trimEnd().slice(0, -suffixLine.length).replace(/\s+$/, '');
    }

    // Avoid a leading newline when the cursor line is empty
    if (!currentLinePrefix.trim()) {
        text = text.replace(/^\r?\n/, '');
    }

    return text.trim() ? text : '';
}
