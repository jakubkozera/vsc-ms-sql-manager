import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEditorSetup } from '../hooks/useEditorSetup';
import { useEditorActions } from '../hooks/useEditorActions';
import { useCompletionProvider } from '../hooks/useCompletionProvider';
import { useSchemaProviders } from '../hooks/useSchemaProviders';
import type { DatabaseSchema } from '../../../types/schema';

// --- Shared mocks ---

const testSchema: DatabaseSchema = {
  tables: [
    {
      schema: 'dbo',
      name: 'Users',
      columns: [
        { name: 'Id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'Name', type: 'nvarchar', nullable: false },
      ],
    },
  ],
  views: [],
  foreignKeys: [],
  storedProcedures: [],
  functions: [],
};

function createMockEditor() {
  const valueHolder = { value: '' };
  return {
    getModel: vi.fn(() => ({
      getValue: () => valueHolder.value,
      getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 100 }),
      getValueInRange: () => valueHolder.value,
      getWordAtPosition: () => null,
      getWordUntilPosition: () => ({ word: '', startColumn: 1, endColumn: 1 }),
      getLineContent: () => '',
    })),
    getSelection: vi.fn(() => null),
    getPosition: vi.fn(() => ({ lineNumber: 1, column: 1 })),
    executeEdits: vi.fn(),
    focus: vi.fn(),
    setValue: vi.fn((v: string) => { valueHolder.value = v; }),
    getValue: vi.fn(() => valueHolder.value),
    updateOptions: vi.fn(),
    addAction: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
    onMouseDown: vi.fn(() => ({ dispose: vi.fn() })),
    createContextKey: vi.fn(() => ({ set: vi.fn() })),
    _valueHolder: valueHolder,
  };
}

function createMockMonaco() {
  return {
    languages: {
      registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerDocumentFormattingEditProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerDocumentRangeFormattingEditProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })),
      CompletionItemKind: {
        Class: 5,
        Field: 3,
        Function: 1,
        Interface: 7,
        Method: 0,
        Operator: 11,
        Snippet: 27,
      },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    },
    editor: {
      setModelMarkers: vi.fn(),
    },
    KeyCode: { F5: 116, KeyV: 86, KeyS: 83, KeyN: 78, KeyE: 69 },
    KeyMod: { CtrlCmd: 2048, Shift: 1024 },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
  };
}

// --- useEditorSetup ---

describe('useEditorSetup', () => {
  it('returns a setupEditor callback', () => {
    const editorRef = { current: null } as any;
    const monacoRef = { current: null } as any;
    const setEditorReady = vi.fn();
    const formatOptions = { tabWidth: 2, keywordCase: 'upper' as const, dataTypeCase: 'upper' as const, functionCase: 'upper' as const, linesBetweenQueries: 1, indentStyle: 'standard' as const, logicalOperatorNewline: 'before' as const, formatBeforeRun: false };

    const { result } = renderHook(() =>
      useEditorSetup(editorRef, monacoRef, setEditorReady, formatOptions, 'SELECT 1')
    );

    expect(typeof result.current).toBe('function');
  });

  it('setupEditor configures editor options and registers formatting providers', () => {
    const editorRef = { current: null } as any;
    const monacoRef = { current: null } as any;
    const setEditorReady = vi.fn();
    const formatOptions = { tabWidth: 2, keywordCase: 'upper' as const, dataTypeCase: 'upper' as const, functionCase: 'upper' as const, linesBetweenQueries: 1, indentStyle: 'standard' as const, logicalOperatorNewline: 'before' as const, formatBeforeRun: false };

    const { result } = renderHook(() =>
      useEditorSetup(editorRef, monacoRef, setEditorReady, formatOptions, 'SELECT 1')
    );

    const mockEditor = createMockEditor();
    const mockMonaco = createMockMonaco();

    const disposables = result.current(mockEditor as any, mockMonaco as any);

    expect(mockEditor.updateOptions).toHaveBeenCalledOnce();
    expect(mockMonaco.languages.registerDocumentFormattingEditProvider).toHaveBeenCalledWith('sql', expect.any(Object));
    expect(mockMonaco.languages.registerDocumentRangeFormattingEditProvider).toHaveBeenCalledWith('sql', expect.any(Object));
    expect(setEditorReady).toHaveBeenCalledWith(true);
    expect(mockEditor.focus).toHaveBeenCalled();
    expect(disposables).toHaveLength(2);
  });

  it('sets initial value when provided', () => {
    const editorRef = { current: null } as any;
    const monacoRef = { current: null } as any;
    const setEditorReady = vi.fn();
    const formatOptions = { tabWidth: 2, keywordCase: 'upper' as const, dataTypeCase: 'upper' as const, functionCase: 'upper' as const, linesBetweenQueries: 1, indentStyle: 'standard' as const, logicalOperatorNewline: 'before' as const, formatBeforeRun: false };

    const { result } = renderHook(() =>
      useEditorSetup(editorRef, monacoRef, setEditorReady, formatOptions, 'SELECT 42')
    );

    const mockEditor = createMockEditor();
    const mockMonaco = createMockMonaco();
    result.current(mockEditor as any, mockMonaco as any);

    expect(mockEditor.setValue).toHaveBeenCalledWith('SELECT 42');
  });

  it('does not call setValue when initialValue is empty', () => {
    const editorRef = { current: null } as any;
    const monacoRef = { current: null } as any;
    const setEditorReady = vi.fn();
    const formatOptions = { tabWidth: 2, keywordCase: 'upper' as const, dataTypeCase: 'upper' as const, functionCase: 'upper' as const, linesBetweenQueries: 1, indentStyle: 'standard' as const, logicalOperatorNewline: 'before' as const, formatBeforeRun: false };

    const { result } = renderHook(() =>
      useEditorSetup(editorRef, monacoRef, setEditorReady, formatOptions, '')
    );

    const mockEditor = createMockEditor();
    const mockMonaco = createMockMonaco();
    result.current(mockEditor as any, mockMonaco as any);

    expect(mockEditor.setValue).not.toHaveBeenCalled();
  });
});

// --- useEditorActions ---

describe('useEditorActions', () => {
  it('returns a registerActions callback', () => {
    const deps = {
      editorRef: { current: null } as any,
      monacoRef: { current: null } as any,
      dbSchemaRef: { current: undefined } as any,
      currentConnectionIdRef: { current: undefined } as any,
      currentDatabaseRef: { current: undefined } as any,
      lastContextPositionRef: { current: null } as any,
      tableAtCursorContextKeyRef: { current: null } as any,
      onExecute: vi.fn(),
      requestPaste: vi.fn(),
      postMessage: vi.fn(),
    };

    const { result } = renderHook(() => useEditorActions(deps));
    expect(typeof result.current).toBe('function');
  });

  it('registers all expected actions when called', () => {
    const deps = {
      editorRef: { current: null } as any,
      monacoRef: { current: null } as any,
      dbSchemaRef: { current: undefined } as any,
      currentConnectionIdRef: { current: undefined } as any,
      currentDatabaseRef: { current: undefined } as any,
      lastContextPositionRef: { current: null } as any,
      tableAtCursorContextKeyRef: { current: null } as any,
      onExecute: vi.fn(),
      requestPaste: vi.fn(),
      postMessage: vi.fn(),
    };

    const { result } = renderHook(() => useEditorActions(deps));

    const mockEditor = createMockEditor();
    const mockMonaco = createMockMonaco();
    result.current(mockEditor as any, mockMonaco as any);

    // 4 keybinding actions + 3 script actions = 7 addAction calls
    expect(mockEditor.addAction).toHaveBeenCalledTimes(7);

    const actionIds = mockEditor.addAction.mock.calls.map((c: any) => c[0].id);
    expect(actionIds).toContain('execute-query');
    expect(actionIds).toContain('paste');
    expect(actionIds).toContain('save-query');
    expect(actionIds).toContain('new-query');
    expect(actionIds).toContain('mssqlmanager.scriptRowAsInsert');
    expect(actionIds).toContain('mssqlmanager.scriptRowAsUpdate');
    expect(actionIds).toContain('mssqlmanager.scriptRowAsDelete');
  });

  it('creates context key for tableAtCursor', () => {
    const deps = {
      editorRef: { current: null } as any,
      monacoRef: { current: null } as any,
      dbSchemaRef: { current: undefined } as any,
      currentConnectionIdRef: { current: undefined } as any,
      currentDatabaseRef: { current: undefined } as any,
      lastContextPositionRef: { current: null } as any,
      tableAtCursorContextKeyRef: { current: null } as any,
      onExecute: vi.fn(),
      requestPaste: vi.fn(),
      postMessage: vi.fn(),
    };

    const { result } = renderHook(() => useEditorActions(deps));

    const mockEditor = createMockEditor();
    const mockMonaco = createMockMonaco();
    result.current(mockEditor as any, mockMonaco as any);

    expect(mockEditor.createContextKey).toHaveBeenCalledWith('tableAtCursor', false);
  });

  it('registers mouse down handler for right-click tracking', () => {
    const deps = {
      editorRef: { current: null } as any,
      monacoRef: { current: null } as any,
      dbSchemaRef: { current: undefined } as any,
      currentConnectionIdRef: { current: undefined } as any,
      currentDatabaseRef: { current: undefined } as any,
      lastContextPositionRef: { current: null } as any,
      tableAtCursorContextKeyRef: { current: null } as any,
      onExecute: vi.fn(),
      requestPaste: vi.fn(),
      postMessage: vi.fn(),
    };

    const { result } = renderHook(() => useEditorActions(deps));

    const mockEditor = createMockEditor();
    const mockMonaco = createMockMonaco();
    result.current(mockEditor as any, mockMonaco as any);

    expect(mockEditor.onMouseDown).toHaveBeenCalledOnce();
  });
});

// --- useCompletionProvider ---

describe('useCompletionProvider', () => {
  it('does not register when editorReady is false', () => {
    const mockMonaco = createMockMonaco();
    const monacoRef = { current: mockMonaco } as any;

    renderHook(() => useCompletionProvider(monacoRef, testSchema, false));

    expect(mockMonaco.languages.registerCompletionItemProvider).not.toHaveBeenCalled();
  });

  it('does not register when schema is undefined', () => {
    const mockMonaco = createMockMonaco();
    const monacoRef = { current: mockMonaco } as any;

    renderHook(() => useCompletionProvider(monacoRef, undefined, true));

    expect(mockMonaco.languages.registerCompletionItemProvider).not.toHaveBeenCalled();
  });

  it('does not register when monacoRef is null', () => {
    const monacoRef = { current: null } as any;

    // Should not throw
    renderHook(() => useCompletionProvider(monacoRef, testSchema, true));
  });

  it('registers completion provider when schema and editorReady', () => {
    const mockMonaco = createMockMonaco();
    const monacoRef = { current: mockMonaco } as any;

    renderHook(() => useCompletionProvider(monacoRef, testSchema, true));

    expect(mockMonaco.languages.registerCompletionItemProvider).toHaveBeenCalledWith(
      'sql',
      expect.objectContaining({ triggerCharacters: ['.', ' '] })
    );
  });

  it('disposes on unmount', () => {
    const disposeFn = vi.fn();
    const mockMonaco = createMockMonaco();
    mockMonaco.languages.registerCompletionItemProvider = vi.fn(() => ({ dispose: disposeFn }));
    const monacoRef = { current: mockMonaco } as any;

    const { unmount } = renderHook(() => useCompletionProvider(monacoRef, testSchema, true));
    unmount();

    expect(disposeFn).toHaveBeenCalled();
  });
});

// --- useSchemaProviders ---

describe('useSchemaProviders', () => {
  it('does not register when editorReady is false', () => {
    const mockMonaco = createMockMonaco();
    const monacoRef = { current: mockMonaco } as any;
    const editorRef = { current: createMockEditor() } as any;

    renderHook(() => useSchemaProviders(monacoRef, editorRef, testSchema, false));

    expect(mockMonaco.languages.registerHoverProvider).not.toHaveBeenCalled();
  });

  it('does not register when schema is undefined', () => {
    const mockMonaco = createMockMonaco();
    const monacoRef = { current: mockMonaco } as any;
    const editorRef = { current: createMockEditor() } as any;

    renderHook(() => useSchemaProviders(monacoRef, editorRef, undefined, true));

    expect(mockMonaco.languages.registerHoverProvider).not.toHaveBeenCalled();
  });

  it('registers hover provider and validation when schema and editorReady', () => {
    const mockMonaco = createMockMonaco();
    const mockEditor = createMockEditor();
    const monacoRef = { current: mockMonaco } as any;
    const editorRef = { current: mockEditor } as any;

    renderHook(() => useSchemaProviders(monacoRef, editorRef, testSchema, true));

    expect(mockMonaco.languages.registerHoverProvider).toHaveBeenCalledWith(
      'sql',
      expect.objectContaining({ provideHover: expect.any(Function) })
    );
    expect(mockEditor.onDidChangeModelContent).toHaveBeenCalled();
  });

  it('disposes all providers on unmount', () => {
    const hoverDispose = vi.fn();
    const validationDispose = vi.fn();
    const mockMonaco = createMockMonaco();
    mockMonaco.languages.registerHoverProvider = vi.fn(() => ({ dispose: hoverDispose }));
    const mockEditor = createMockEditor();
    mockEditor.onDidChangeModelContent = vi.fn(() => ({ dispose: validationDispose }));
    const monacoRef = { current: mockMonaco } as any;
    const editorRef = { current: mockEditor } as any;

    const { unmount } = renderHook(() => useSchemaProviders(monacoRef, editorRef, testSchema, true));
    unmount();

    expect(hoverDispose).toHaveBeenCalled();
    expect(validationDispose).toHaveBeenCalled();
  });
});
