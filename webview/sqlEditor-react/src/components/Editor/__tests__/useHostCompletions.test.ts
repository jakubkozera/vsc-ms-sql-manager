import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useAiInlineCompletions,
  useHostSnippetCompletions,
  inlineCompletionDebounceMs,
} from '../hooks/useHostCompletions';
import type { DatabaseSchema } from '../../../types/schema';

const schema: DatabaseSchema = {
  tables: [{ schema: 'dbo', name: 'Users', columns: [{ name: 'Id', type: 'int', nullable: false, isPrimaryKey: true }] }],
  views: [],
  foreignKeys: [],
};

function createToken() {
  const listeners: Array<() => void> = [];
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: vi.fn((listener: () => void) => {
      listeners.push(listener);
      return { dispose: vi.fn() };
    }),
  };
  const cancel = () => {
    token.isCancellationRequested = true;
    listeners.forEach((l) => l());
  };
  return { token, cancel };
}

function createModel(text: string) {
  const lines = text.split('\n');
  return {
    getValue: () => text,
    getOffsetAt: (pos: { lineNumber: number; column: number }) =>
      lines.slice(0, pos.lineNumber - 1).reduce((n, l) => n + l.length + 1, 0) + pos.column - 1,
    getLineContent: (line: number) => lines[line - 1],
    getWordUntilPosition: () => ({ word: 'sel', startColumn: 1, endColumn: 4 }),
  };
}

function createMonaco() {
  class Range {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number
    ) {}
  }
  return {
    Range,
    languages: {
      registerInlineCompletionsProvider: vi.fn((_lang: string, _provider: any) => ({ dispose: vi.fn() })),
      registerCompletionItemProvider: vi.fn((_lang: string, _provider: any) => ({ dispose: vi.fn() })),
      CompletionItemKind: { Snippet: 27 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    },
  };
}

function respond(data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

describe('useAiInlineCompletions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const monaco = createMonaco();
    const postMessage = vi.fn();
    renderHook(() =>
      useAiInlineCompletions({ current: monaco as any }, { current: schema }, true, postMessage)
    );
    const provider = monaco.languages.registerInlineCompletionsProvider.mock.calls[0][1];
    return { monaco, postMessage, provider };
  }

  it('does not register when editor is not ready', () => {
    const monaco = createMonaco();
    renderHook(() => useAiInlineCompletions({ current: monaco as any }, { current: schema }, false, vi.fn()));
    expect(monaco.languages.registerInlineCompletionsProvider).not.toHaveBeenCalled();
  });

  it('requests a completion from the host after debounce and returns ghost text', async () => {
    const { postMessage, provider } = setup();
    const { token } = createToken();
    const model = createModel('SELECT * FROM Users\nWHERE ');

    const resultPromise = provider.provideInlineCompletions(model, { lineNumber: 2, column: 7 }, {}, token);
    expect(postMessage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(inlineCompletionDebounceMs);
    expect(postMessage).toHaveBeenCalledTimes(1);
    const request = postMessage.mock.calls[0][0];
    expect(request).toMatchObject({
      type: 'requestInlineCompletion',
      prefix: 'SELECT * FROM Users\nWHERE ',
      suffix: '',
    });
    expect(request.schemaContext).toContain('TABLE [dbo].[Users] (Id int PK)');

    respond({ type: 'inlineCompletionResult', requestId: request.requestId, text: 'Id = 1' });
    const result = await resultPromise;

    expect(result.items).toHaveLength(1);
    expect(result.items[0].insertText).toBe('Id = 1');
    expect(result.items[0].range).toMatchObject({ startLineNumber: 2, startColumn: 7, endLineNumber: 2, endColumn: 7 });
  });

  it('ignores responses for other request ids', async () => {
    const { postMessage, provider } = setup();
    const { token, cancel } = createToken();
    const resultPromise = provider.provideInlineCompletions(createModel('SELECT '), { lineNumber: 1, column: 8 }, {}, token);
    await vi.advanceTimersByTimeAsync(inlineCompletionDebounceMs);

    respond({ type: 'inlineCompletionResult', requestId: 'other', text: 'nope' });
    cancel();
    const result = await resultPromise;

    expect(result.items).toHaveLength(0);
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'cancelInlineCompletion', requestId: postMessage.mock.calls[0][0].requestId });
  });

  it('skips the request when cancelled during debounce', async () => {
    const { postMessage, provider } = setup();
    const { token, cancel } = createToken();
    const resultPromise = provider.provideInlineCompletions(createModel('SELECT '), { lineNumber: 1, column: 8 }, {}, token);
    cancel();
    await vi.advanceTimersByTimeAsync(inlineCompletionDebounceMs);

    expect((await resultPromise).items).toHaveLength(0);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('skips empty documents and mid-word positions', async () => {
    const { postMessage, provider } = setup();
    const empty = provider.provideInlineCompletions(createModel('   '), { lineNumber: 1, column: 4 }, {}, createToken().token);
    const midWord = provider.provideInlineCompletions(createModel('SELECT'), { lineNumber: 1, column: 3 }, {}, createToken().token);
    await vi.advanceTimersByTimeAsync(inlineCompletionDebounceMs);

    expect((await empty).items).toHaveLength(0);
    expect((await midWord).items).toHaveLength(0);
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe('useHostSnippetCompletions', () => {
  it('maps host snippet items to Monaco snippet suggestions', async () => {
    const monaco = createMonaco();
    const postMessage = vi.fn();
    renderHook(() => useHostSnippetCompletions({ current: monaco as any }, true, postMessage));
    const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];

    const resultPromise = provider.provideCompletionItems(
      createModel('sel'), { lineNumber: 1, column: 4 }, {}, createToken().token
    );
    const request = postMessage.mock.calls[0][0];
    expect(request).toMatchObject({ type: 'requestHostCompletions', content: 'sel', line: 0, character: 3 });

    respond({
      type: 'hostCompletionsResult',
      requestId: request.requestId,
      items: [{ label: 'sel', insertText: 'SELECT ${1:*} FROM ${2:table}', detail: 'User snippet', documentation: 'Select' }],
    });
    const result = await resultPromise;

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        label: 'sel',
        kind: 27,
        insertText: 'SELECT ${1:*} FROM ${2:table}',
        insertTextRules: 4,
        detail: 'User snippet',
        documentation: { value: 'Select' },
        range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 4 },
      }),
    ]);
  });

  it('returns no suggestions when the host does not answer', async () => {
    vi.useFakeTimers();
    try {
      const monaco = createMonaco();
      renderHook(() => useHostSnippetCompletions({ current: monaco as any }, true, vi.fn()));
      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const resultPromise = provider.provideCompletionItems(createModel('sel'), { lineNumber: 1, column: 4 }, {}, createToken().token);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await resultPromise).suggestions).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
