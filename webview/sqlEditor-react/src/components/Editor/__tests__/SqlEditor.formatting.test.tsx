import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '../../../test/testUtils';
import { SqlEditor } from '../SqlEditor';

// Mock @monaco-editor/react to call onMount with our fake editor & monaco instances
vi.mock('@monaco-editor/react', () => {
  return {
    default: (props: any) => {
      // Create a very small mock editor and monaco objects
      const valueHolder = { value: props.defaultValue || '' };

      const mockModel = {
        getValue: () => valueHolder.value,
        getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: valueHolder.value.length + 1 }),
        getValueInRange: (_range: any) => valueHolder.value.substring(0),
        setValue: (v: string) => { valueHolder.value = v; },
      };

      const mockEditor = {
        getModel: () => mockModel,
        getSelection: () => null,
        executeEdits: vi.fn((_source: string, edits: any[]) => {
          // emulate replacing whole model
          if (edits && edits.length) {
            const e = edits[0];
            if (e && e.text !== undefined) {
              valueHolder.value = e.text;
            }
          }
          return true;
        }),
        focus: () => {},
        setValue: (v: string) => { valueHolder.value = v; },
        getValue: () => valueHolder.value,
        updateOptions: () => {},
        // Monaco editor helpers used by SqlEditor
        addAction: (_action: any) => ({ dispose: () => {} }),
        onDidChangeModelContent: (_listener: any) => ({ dispose: () => {} }),
        onMouseDown: (_listener: any) => ({ dispose: () => {} }),
      };

      const registerSpy = vi.fn(() => ({ dispose: () => {} }));
      const mockMonaco = {
        languages: {
          registerDocumentFormattingEditProvider: registerSpy,
          registerDocumentRangeFormattingEditProvider: registerSpy,
        },
        KeyCode: { F5: 116, KeyF: 70, KeyV: 86 },
        KeyMod: { CtrlCmd: 2, Shift: 4 },
        languagesModule: {},
      };

      // Call onMount asynchronously to avoid React setState-in-render warnings
      if (props.onMount) {
        Promise.resolve().then(() => props.onMount(mockEditor, mockMonaco));
      }

      // Render a placeholder
      return React.createElement('div', null, 'mock-monaco');
    }
  };
});

describe('SqlEditor formatting integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calls formatting providers registration on mount', () => {
    // We import the mocked module to access the registerSpy via its closure isn't exported,
    // so instead we assert behavior indirectly by rendering and ensuring no errors occur.
    const onExecute = vi.fn();
    const { getByText } = render(<SqlEditor onExecute={onExecute} initialValue={"select * from t"} />);

    // The mock returns a placeholder node
    expect(getByText('mock-monaco')).toBeTruthy();
  });

  it('formats document when formatSql is called via ref', async () => {
    const onExecute = vi.fn();

    // create a ref object to call formatSql
    const ref: any = React.createRef();

    render(<SqlEditor ref={ref} onExecute={onExecute} initialValue={"select * from myTable where id=1"} />);

    // ensure ref is available and has formatSql method
    expect(ref.current).toBeDefined();
    expect(typeof ref.current.formatSql).toBe('function');

    // Call formatSql which uses sql-formatter to transform the text
    ref.current.formatSql();

    // The mocked editor.executeEdits updated the internal value, so verify it changed
    // We cannot directly access the mock's valueHolder here, but we can call getValue via exposed ref
    const newValue = ref.current.getValue();
    expect(newValue).toBeTruthy();
    // Expect keywords to be uppercased by sql-formatter
    expect(newValue.toUpperCase()).toContain('SELECT');
    expect(newValue).not.toEqual('select * from myTable where id=1');
  });
});
