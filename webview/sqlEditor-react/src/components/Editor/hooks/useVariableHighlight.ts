/**
 * useVariableHighlight
 *
 * Applies Monaco editor decorations to highlight SQL variable tokens
 * (identifiers starting with `@`, e.g. `@Project6`, `@UserId`) with a
 * configurable background / foreground color.
 *
 * The highlight is purely cosmetic and does not affect IntelliSense.
 * When `color` is empty the decorations are cleared immediately.
 */

import { useEffect, useRef, type MutableRefObject } from 'react';
import type { editor } from 'monaco-editor';

type MonacoType = typeof import('monaco-editor');

const DECORATION_CLASS_ID = 'sql-variable-highlight';

/**
 * Returns the [start, end] index ranges (inclusive) of all single-quoted SQL
 * string literals in `sql`, including the surrounding quote characters.
 * Handles the `''` escape sequence and `N'...'` Unicode literals so that
 * `@`-signs inside quoted strings (e.g. `'user@example.com'`) are not
 * mistakenly treated as variable references.
 */
function getSqlStringRanges(sql: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < sql.length) {
    const isUnicode = sql[i] === 'N' && sql[i + 1] === "'";
    if (isUnicode || sql[i] === "'") {
      const start = i;
      i += isUnicode ? 2 : 1;
      while (i < sql.length) {
        if (sql[i] === "'") {
          i++;
          if (i < sql.length && sql[i] === "'") {
            // Escaped quote '' — stay inside the literal
            i++;
          } else {
            break; // closing quote
          }
        } else {
          i++;
        }
      }
      ranges.push([start, i - 1]);
    } else {
      i++;
    }
  }
  return ranges;
}

export function useVariableHighlight(
  monacoRef: MutableRefObject<MonacoType | null>,
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>,
  color: string,
  editorReady: boolean
): void {
  // Track the decoration collection so we can replace it on each update
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  // Track the CSS class name registered with Monaco
  const cssClassRef = useRef<string | null>(null);
  const prevColorRef = useRef<string>('');

  useEffect(() => {
    const monaco = monacoRef.current;
    const ed = editorRef.current;
    if (!monaco || !ed || !editorReady) return;

    // When color is cleared, remove all decorations and bail out
    if (!color) {
      decorationsRef.current?.clear();
      return;
    }

    // If the color changed, inject / update the CSS injection
    if (color !== prevColorRef.current || !cssClassRef.current) {
      prevColorRef.current = color;
      const className = DECORATION_CLASS_ID;
      cssClassRef.current = className;

      // Inject/overwrite the CSS rule for our decoration class
      const styleId = 'mssql-variable-highlight-style';
      let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = `.${className} { color: ${color}; }`;
    }

    // Helper: build decorations for the current model content
    function buildDecorations(): editor.IModelDeltaDecoration[] {
      const model = ed!.getModel();
      if (!model) return [];

      const text = model.getValue();
      const decorations: editor.IModelDeltaDecoration[] = [];
      // Pre-compute quoted string ranges so we skip @-signs inside literals
      // such as 'user@example.com'.
      const stringRanges = getSqlStringRanges(text);
      // Match @variableName but skip T-SQL system variables like @@ROWCOUNT.
      const re = /@[a-zA-Z_]\w*/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (m.index > 0 && text[m.index - 1] === '@') {
          continue; // @@system variable
        }
        if (stringRanges.some(([s, e]) => m!.index >= s && m!.index <= e)) {
          continue; // inside a quoted string literal
        }
        const startPos = model.getPositionAt(m.index);
        const endPos = model.getPositionAt(m.index + m[0].length);
        decorations.push({
          range: new monaco!.Range(
            startPos.lineNumber,
            startPos.column,
            endPos.lineNumber,
            endPos.column
          ),
          options: {
            inlineClassName: cssClassRef.current!,
          },
        });
      }
      return decorations;
    }

    // Initialise or replace the decoration collection
    if (!decorationsRef.current) {
      decorationsRef.current = ed.createDecorationsCollection(buildDecorations());
    } else {
      decorationsRef.current.set(buildDecorations());
    }

    // Re-apply whenever the model content changes
    const disposable = ed.onDidChangeModelContent(() => {
      decorationsRef.current?.set(buildDecorations());
    });

    return () => {
      disposable.dispose();
      decorationsRef.current?.clear();
    };
  }, [color, editorReady]);
}
