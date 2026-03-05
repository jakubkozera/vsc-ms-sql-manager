import { useEffect, type MutableRefObject } from 'react';
import type { editor } from 'monaco-editor';
import type { DatabaseSchema } from '../../../types/schema';
import { validateSql, provideHoverContent } from '../../../services';

type MonacoType = typeof import('monaco-editor');

/**
 * Registers the SQL hover provider and content-change validation.
 * Re-registers whenever dbSchema or editorReady changes.
 */
export function useSchemaProviders(
  monacoRef: MutableRefObject<MonacoType | null>,
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>,
  dbSchema: DatabaseSchema | undefined,
  editorReady: boolean
): void {
  useEffect(() => {
    if (!monacoRef.current || !dbSchema || !editorReady) return;

    const monacoInstance = monacoRef.current;
    const disposables: { dispose: () => void }[] = [];

    // Hover provider
    const hoverProvider = monacoInstance.languages.registerHoverProvider('sql', {
      provideHover: (model: editor.ITextModel, position: { lineNumber: number; column: number }) => {
        try {
          const fullText = model.getValue();
          const lineText = model.getLineContent(position.lineNumber);
          const wordObj = model.getWordAtPosition(position);
          return provideHoverContent(fullText, lineText, position, wordObj, dbSchema);
        } catch (err) {
          console.error('[SQL-HOVER] Error in hover provider', err);
        }
        return null;
      },
    });
    disposables.push(hoverProvider);

    // Content-change validation
    const validationDisposable = editorRef.current?.onDidChangeModelContent(() => {
      const model = editorRef.current?.getModel();
      if (!model) return;

      const timeoutId = setTimeout(() => {
        const sql = model.getValue();
        const markers = validateSql(sql, dbSchema);

        const monacoMarkers = markers.map((m) => ({
          severity:
            m.severity === 'error'
              ? monacoInstance.MarkerSeverity.Error
              : m.severity === 'warning'
              ? monacoInstance.MarkerSeverity.Warning
              : monacoInstance.MarkerSeverity.Info,
          message: m.message,
          startLineNumber: m.startLineNumber,
          startColumn: m.startColumn,
          endLineNumber: m.endLineNumber,
          endColumn: m.endColumn,
        }));

        monacoInstance.editor.setModelMarkers(model, 'sql-validator', monacoMarkers);
      }, 500);

      return () => clearTimeout(timeoutId);
    });

    if (validationDisposable) {
      disposables.push(validationDisposable);
    }

    return () => {
      disposables.forEach((d) => d.dispose());
    };
  }, [dbSchema, editorReady]);
}
