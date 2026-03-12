import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useVariableHighlight } from './useVariableHighlight';
import type { MutableRefObject } from 'react';

// ── Monaco / editor mock helpers ─────────────────────────────────────────────

function makePosition(lineNumber: number, column: number) {
  return { lineNumber, column };
}

function makeModelMock(text: string) {
  return {
    getValue: vi.fn(() => text),
    getPositionAt: vi.fn((offset: number) => {
      // Simple implementation: single-line text
      return makePosition(1, offset + 1);
    }),
  };
}

function makeDecorationsMock() {
  return {
    clear: vi.fn(),
    set: vi.fn(),
  };
}

function makeEditorMock(text = '') {
  const decorations = makeDecorationsMock();
  const model = makeModelMock(text);
  return {
    editor: {
      getModel: vi.fn(() => model),
      createDecorationsCollection: vi.fn(() => decorations),
      onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
    },
    decorations,
    model,
  };
}

function makeMonacoMock() {
  class MockRange {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number
    ) {}
  }
  return { Range: MockRange };
}

function makeRefs<T>(value: T): MutableRefObject<T> {
  return { current: value };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useVariableHighlight', () => {
  afterEach(() => {
    vi.clearAllMocks();
    // Remove injected style element between tests
    document.getElementById('mssql-variable-highlight-style')?.remove();
  });

  it('does nothing when monacoRef is null', () => {
    expect(() => {
      renderHook(() =>
        useVariableHighlight(
          makeRefs(null),
          makeRefs(null),
          '#6adc7a',
          true
        )
      );
    }).not.toThrow();
  });

  it('does nothing when editorRef is null', () => {
    const monaco = makeMonacoMock();
    expect(() => {
      renderHook(() =>
        useVariableHighlight(
          makeRefs(monaco as never),
          makeRefs(null),
          '#6adc7a',
          true
        )
      );
    }).not.toThrow();
  });

  it('does nothing when editorReady is false', () => {
    const monaco = makeMonacoMock();
    const { editor } = makeEditorMock('SELECT @UserId');
    renderHook(() =>
      useVariableHighlight(
        makeRefs(monaco as never),
        makeRefs(editor as never),
        '#6adc7a',
        false
      )
    );
    expect(editor.createDecorationsCollection).not.toHaveBeenCalled();
  });

  it('clears decorations when color is empty string', () => {
    const monaco = makeMonacoMock();
    const { editor, decorations } = makeEditorMock('SELECT @UserId');

    // First render with a color to create decorations
    const { rerender } = renderHook(
      ({ color }: { color: string }) =>
        useVariableHighlight(
          makeRefs(monaco as never),
          makeRefs(editor as never),
          color,
          true
        ),
      { initialProps: { color: '#6adc7a' } }
    );

    expect(editor.createDecorationsCollection).toHaveBeenCalledTimes(1);

    // Remove color → should clear
    rerender({ color: '' });
    expect(decorations.clear).toHaveBeenCalled();
  });

  it('injects a <style> element with the correct class name', () => {
    const monaco = makeMonacoMock();
    const { editor } = makeEditorMock('SELECT @UserId');

    renderHook(() =>
      useVariableHighlight(
        makeRefs(monaco as never),
        makeRefs(editor as never),
        '#aabbcc',
        true
      )
    );

    const styleEl = document.getElementById('mssql-variable-highlight-style');
    expect(styleEl).not.toBeNull();
    expect(styleEl!.textContent).toContain('sql-variable-highlight');
  });

  it('uses the color directly as foreground color (no alpha appending)', () => {
    const monaco = makeMonacoMock();
    const { editor } = makeEditorMock('SELECT @x');

    renderHook(() =>
      useVariableHighlight(
        makeRefs(monaco as never),
        makeRefs(editor as never),
        '#6adc7a',
        true
      )
    );

    const styleEl = document.getElementById('mssql-variable-highlight-style');
    // Must use `color:` (foreground), NOT `background:`
    expect(styleEl!.textContent).toContain('color: #6adc7a');
    expect(styleEl!.textContent).not.toContain('background');
    // Must NOT append alpha suffix
    expect(styleEl!.textContent).not.toContain('#6adc7a55');
  });

  it('uses any provided color string as-is for the foreground', () => {
    const monaco = makeMonacoMock();
    const { editor } = makeEditorMock('SELECT @x');

    renderHook(() =>
      useVariableHighlight(
        makeRefs(monaco as never),
        makeRefs(editor as never),
        '#6adc7aff',
        true
      )
    );

    const styleEl = document.getElementById('mssql-variable-highlight-style');
    expect(styleEl!.textContent).toContain('color: #6adc7aff');
    // Should NOT append more digits
    expect(styleEl!.textContent).not.toContain('#6adc7aff55');
  });

  it('creates decoration collection when color and editor are ready', () => {
    const monaco = makeMonacoMock();
    const { editor } = makeEditorMock('SELECT @UserId, @Amount FROM t');

    renderHook(() =>
      useVariableHighlight(
        makeRefs(monaco as never),
        makeRefs(editor as never),
        '#6adc7a',
        true
      )
    );

    expect(editor.createDecorationsCollection).toHaveBeenCalledTimes(1);
    // The argument should be an array of decorations (2 variables)
    const [decos] = (editor.createDecorationsCollection.mock.calls[0] as unknown) as [unknown[]];
    expect(Array.isArray(decos)).toBe(true);
    expect(decos).toHaveLength(2);
  });

  it('creates zero decorations when text has no @variables', () => {
    const monaco = makeMonacoMock();
    const { editor } = makeEditorMock('SELECT col FROM dbo.Table');

    renderHook(() =>
      useVariableHighlight(
        makeRefs(monaco as never),
        makeRefs(editor as never),
        '#6adc7a',
        true
      )
    );

    const [decos] = (editor.createDecorationsCollection.mock.calls[0] as unknown) as [unknown[]];
    expect(decos).toHaveLength(0);
  });
});
