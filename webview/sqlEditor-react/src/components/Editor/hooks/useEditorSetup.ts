import { useCallback, type MutableRefObject } from 'react';
import type { editor, languages } from 'monaco-editor';
import { format } from 'sql-formatter';
import type { FormatOptions } from '../../Toolbar/FormatButton';

type MonacoType = typeof import('monaco-editor');

/**
 * Registers Monaco editor options, formatting providers,
 * sets initial value and focuses the editor.
 * Returns a callback to be called during handleEditorMount.
 */
export function useEditorSetup(
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>,
  monacoRef: MutableRefObject<MonacoType | null>,
  setEditorReady: (ready: boolean) => void,
  formatOptions: FormatOptions,
  initialValue: string
) {
  const setupEditor = useCallback(
    (editor: editor.IStandaloneCodeEditor, monacoInstance: MonacoType): { dispose: () => void }[] => {
      editorRef.current = editor;
      monacoRef.current = monacoInstance;
      setEditorReady(true);

      // Configure editor options
      editor.updateOptions({
        fontSize: 14,
        fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbers: 'on',
        renderLineHighlight: 'all',
        automaticLayout: true,
        wordWrap: 'on',
        padding: { top: 8, bottom: 8 },
        scrollbar: {
          vertical: 'visible',
          horizontal: 'visible',
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
      });

      // Register formatting providers
      const documentFormattingProvider = monacoInstance.languages.registerDocumentFormattingEditProvider('sql', {
        provideDocumentFormattingEdits: (model: editor.ITextModel, _options: languages.FormattingOptions, _token: any) => {
          try {
            const formattedText = format(model.getValue(), {
              language: 'transactsql',
              tabWidth: formatOptions.tabWidth,
              keywordCase: formatOptions.keywordCase,
              dataTypeCase: formatOptions.dataTypeCase,
              functionCase: formatOptions.functionCase,
              linesBetweenQueries: formatOptions.linesBetweenQueries,
              indentStyle: formatOptions.indentStyle,
              logicalOperatorNewline: formatOptions.logicalOperatorNewline,
            });
            return [{ range: model.getFullModelRange(), text: formattedText }];
          } catch (error) {
            console.error('[SqlEditor] Error formatting document:', error);
            return [];
          }
        },
      });

      const documentRangeFormattingProvider = monacoInstance.languages.registerDocumentRangeFormattingEditProvider('sql', {
        provideDocumentRangeFormattingEdits: (model: editor.ITextModel, range: any, _options: languages.FormattingOptions, _token: any) => {
          try {
            const formattedText = format(model.getValueInRange(range), {
              language: 'transactsql',
              tabWidth: formatOptions.tabWidth,
              keywordCase: formatOptions.keywordCase,
              dataTypeCase: formatOptions.dataTypeCase,
              functionCase: formatOptions.functionCase,
              linesBetweenQueries: formatOptions.linesBetweenQueries,
              indentStyle: formatOptions.indentStyle,
              logicalOperatorNewline: formatOptions.logicalOperatorNewline,
            });
            return [{ range, text: formattedText }];
          } catch (error) {
            console.error('[SqlEditor] Error formatting selection:', error);
            return [];
          }
        },
      });

      // Set initial value and focus
      if (initialValue) {
        editor.setValue(initialValue);
      }
      editor.focus();

      return [documentFormattingProvider, documentRangeFormattingProvider];
    },
    [formatOptions, initialValue]
  );

  return setupEditor;
}
