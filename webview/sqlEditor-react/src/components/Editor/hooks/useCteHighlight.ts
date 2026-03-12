import { useEffect, useRef, type MutableRefObject } from 'react';
import type { editor } from 'monaco-editor';
import { extractCTEs, splitSqlStatements } from '../../../services';

type MonacoType = typeof import('monaco-editor');

const DECORATION_CLASS_ID = 'sql-cte-highlight';

function isInsideStringOrComment(text: string, offset: number): boolean {
  let inSingleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < offset && i < text.length; i++) {
    if (inLineComment) {
      if (text[i] === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (text[i] === '*' && text[i + 1] === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingleQuote) {
      if (text[i] === '\'') {
        if (text[i + 1] === '\'') {
          i++;
          continue;
        }
        inSingleQuote = false;
      }
      continue;
    }

    if (text[i] === '\'') {
      inSingleQuote = true;
    } else if (text[i] === '-' && text[i + 1] === '-') {
      inLineComment = true;
      i++;
    } else if (text[i] === '/' && text[i + 1] === '*') {
      inBlockComment = true;
      i++;
    }
  }

  return inSingleQuote || inLineComment || inBlockComment;
}

export function useCteHighlight(
  monacoRef: MutableRefObject<MonacoType | null>,
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>,
  color: string,
  editorReady: boolean
): void {
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const cssClassRef = useRef<string | null>(null);
  const prevColorRef = useRef<string>('');

  useEffect(() => {
    const monaco = monacoRef.current;
    const ed = editorRef.current;
    if (!monaco || !ed || !editorReady) return;

    if (!color) {
      decorationsRef.current?.clear();
      return;
    }

    if (color !== prevColorRef.current || !cssClassRef.current) {
      prevColorRef.current = color;
      cssClassRef.current = DECORATION_CLASS_ID;

      const styleId = 'mssql-cte-highlight-style';
      let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = `.${DECORATION_CLASS_ID} { color: ${color}; }`;
    }

    function buildDecorations(): editor.IModelDeltaDecoration[] {
      const model = ed!.getModel();
      if (!model) return [];

      const text = model.getValue();
      const statements = splitSqlStatements(text);
      const decorations: editor.IModelDeltaDecoration[] = [];

      for (const statement of statements) {
        const ctes = extractCTEs(statement.text);

        for (const cteName of ctes) {
          const escaped = cteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`\\[${escaped}\\]|\\b${escaped}\\b`, 'gi');
          let match: RegExpExecArray | null;

          while ((match = regex.exec(statement.text)) !== null) {
            if (isInsideStringOrComment(statement.text, match.index)) {
              continue;
            }

            const isBracketed = match[0].startsWith('[') && match[0].endsWith(']');
            const startOffset = statement.startOffset + match.index + (isBracketed ? 1 : 0);
            const endOffset = startOffset + cteName.length;
            const startPos = model.getPositionAt(startOffset);
            const endPos = model.getPositionAt(endOffset);

            decorations.push({
              range: new monaco!.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
              options: {
                inlineClassName: cssClassRef.current!,
              },
            });
          }
        }
      }

      return decorations;
    }

    if (!decorationsRef.current) {
      decorationsRef.current = ed.createDecorationsCollection(buildDecorations());
    } else {
      decorationsRef.current.set(buildDecorations());
    }

    const disposable = ed.onDidChangeModelContent(() => {
      decorationsRef.current?.set(buildDecorations());
    });

    return () => {
      disposable.dispose();
      decorationsRef.current?.clear();
    };
  }, [color, editorReady]);
}