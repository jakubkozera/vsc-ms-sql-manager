import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useCteHighlight } from './useCteHighlight';
import type { MutableRefObject } from 'react';

function makePosition(lineNumber: number, column: number) {
  return { lineNumber, column };
}

function makeModelMock(text: string) {
  return {
    getValue: vi.fn(() => text),
    getPositionAt: vi.fn((offset: number) => makePosition(1, offset + 1)),
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

describe('useCteHighlight', () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.getElementById('mssql-cte-highlight-style')?.remove();
  });

  it('highlights CTE definitions and references in multi-statement scripts', () => {
    const monaco = makeMonacoMock();
    const sql = 'PRINT 1; WITH TargetProject AS (SELECT 1), TargetMembers AS (SELECT Id FROM TargetProject) SELECT * FROM TargetMembers';
    const { editor } = makeEditorMock(sql);

    renderHook(() =>
      useCteHighlight(
        makeRefs(monaco as never),
        makeRefs(editor as never),
        '#6adc7a',
        true
      )
    );

    const [decos] = (editor.createDecorationsCollection.mock.calls[0] as unknown) as [unknown[]];
    expect(decos).toHaveLength(4);
  });

  it('clears decorations when color is empty', () => {
    const monaco = makeMonacoMock();
    const sql = 'WITH TargetProject AS (SELECT 1) SELECT * FROM TargetProject';
    const { editor, decorations } = makeEditorMock(sql);

    const { rerender } = renderHook(
      ({ color }: { color: string }) =>
        useCteHighlight(
          makeRefs(monaco as never),
          makeRefs(editor as never),
          color,
          true
        ),
      { initialProps: { color: '#6adc7a' } }
    );

    rerender({ color: '' });
    expect(decorations.clear).toHaveBeenCalled();
  });
});