import { useEffect, type MutableRefObject } from 'react';
import type { CancellationToken, editor, languages, Position } from 'monaco-editor';
import type { DatabaseSchema } from '../../../types/schema';
import type {
  HostCompletionsResultMessage,
  InlineCompletionResultMessage,
  OutgoingMessage,
} from '../../../types/messages';
import { buildSchemaContext } from '../../../services';

type MonacoType = typeof import('monaco-editor');

export const inlineCompletionDebounceMs = 350;
const inlineCompletionTimeoutMs = 15000;
const hostCompletionsTimeoutMs = 1000;

let requestCounter = 0;

/**
 * Waits for a response message from the extension host matching `type` and `requestId`.
 * Resolves with `undefined` on cancellation or timeout.
 */
export function waitForHostResponse<T extends { requestId: string }>(
  type: string,
  requestId: string,
  token: CancellationToken,
  timeoutMs: number
): Promise<T | undefined> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: T | undefined) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      cancelSub.dispose();
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data && data.type === type && data.requestId === requestId) {
        finish(data as T);
      }
    };
    window.addEventListener('message', onMessage);
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    const cancelSub = token.onCancellationRequested(() => finish(undefined));
  });
}

function delay(ms: number, token: CancellationToken): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { sub.dispose(); resolve(); }, ms);
    const sub = token.onCancellationRequested(() => { clearTimeout(timer); sub.dispose(); resolve(); });
  });
}

/**
 * Registers a Monaco inline completions provider that asks the extension host
 * for AI (Copilot language model) ghost-text suggestions.
 */
export function useAiInlineCompletions(
  monacoRef: MutableRefObject<MonacoType | null>,
  dbSchemaRef: MutableRefObject<DatabaseSchema | undefined>,
  editorReady: boolean,
  postMessage: (message: OutgoingMessage) => void
): void {
  useEffect(() => {
    const monacoInstance = monacoRef.current;
    if (!monacoInstance || !editorReady) return;

    const provider = monacoInstance.languages.registerInlineCompletionsProvider('sql', {
      provideInlineCompletions: async (
        model: editor.ITextModel,
        position: Position,
        _context: languages.InlineCompletionContext,
        token: CancellationToken
      ): Promise<languages.InlineCompletions> => {
        const empty = { items: [] };

        await delay(inlineCompletionDebounceMs, token);
        if (token.isCancellationRequested) return empty;

        const text = model.getValue();
        const offset = model.getOffsetAt(position);
        const prefix = text.slice(0, offset);
        const suffix = text.slice(offset);
        if (!prefix.trim()) return empty;

        // Don't suggest in the middle of a word
        const lineSuffix = model.getLineContent(position.lineNumber).slice(position.column - 1);
        if (/^\w/.test(lineSuffix)) return empty;

        const requestId = `ai-${++requestCounter}`;
        const response = waitForHostResponse<InlineCompletionResultMessage>(
          'inlineCompletionResult', requestId, token, inlineCompletionTimeoutMs
        );
        postMessage({
          type: 'requestInlineCompletion',
          requestId,
          prefix,
          suffix,
          schemaContext: buildSchemaContext(dbSchemaRef.current, text),
        });

        const result = await response;
        if (!result) {
          postMessage({ type: 'cancelInlineCompletion', requestId });
          return empty;
        }
        if (!result.text || token.isCancellationRequested) return empty;

        return {
          items: [{
            insertText: result.text,
            range: new monacoInstance.Range(position.lineNumber, position.column, position.lineNumber, position.column),
          }],
        };
      },
      disposeInlineCompletions: () => {},
    });

    return () => provider.dispose();
  }, [monacoRef, dbSchemaRef, editorReady, postMessage]);
}

/**
 * Registers a Monaco completion provider that returns snippet completions
 * (user / workspace / extension SQL snippets) resolved by VS Code in the extension host.
 */
export function useHostSnippetCompletions(
  monacoRef: MutableRefObject<MonacoType | null>,
  editorReady: boolean,
  postMessage: (message: OutgoingMessage) => void
): void {
  useEffect(() => {
    const monacoInstance = monacoRef.current;
    if (!monacoInstance || !editorReady) return;

    const provider = monacoInstance.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: async (
        model: editor.ITextModel,
        position: Position,
        _context: languages.CompletionContext,
        token: CancellationToken
      ): Promise<languages.CompletionList> => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const requestId = `host-${++requestCounter}`;
        const response = waitForHostResponse<HostCompletionsResultMessage>(
          'hostCompletionsResult', requestId, token, hostCompletionsTimeoutMs
        );
        postMessage({
          type: 'requestHostCompletions',
          requestId,
          content: model.getValue(),
          line: position.lineNumber - 1,
          character: position.column - 1,
        });

        const result = await response;
        return {
          suggestions: (result?.items || []).map((item) => ({
            label: item.label,
            kind: monacoInstance.languages.CompletionItemKind.Snippet,
            insertText: item.insertText,
            insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: item.detail,
            documentation: item.documentation ? { value: item.documentation } : undefined,
            range,
            sortText: `8_${item.label}`,
          })),
        };
      },
    });

    return () => provider.dispose();
  }, [monacoRef, editorReady, postMessage]);
}
