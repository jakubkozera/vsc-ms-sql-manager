import { useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import MonacoEditor, { OnMount } from '@monaco-editor/react';
import type { editor, languages } from 'monaco-editor';
import { format } from 'sql-formatter';
import { useVSCode } from '../../context/VSCodeContext';
import { useFormatOptions } from '../Toolbar/FormatButton';
import type { TableInfo, ViewInfo, StoredProcedureInfo, FunctionInfo } from '../../types/schema';
import './SqlEditor.css';

export interface SqlEditorHandle {
  getValue: () => string;
  getSelectedText: () => string;
  formatSql: () => void;
  focus: () => void;
  executeCurrentLine: () => void;
}

interface SqlEditorProps {
  onExecute: (sql: string) => void;
  initialValue?: string;
}

type MonacoType = typeof import('monaco-editor');

export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(
  ({ onExecute, initialValue = '' }, ref) => {
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<MonacoType | null>(null);
    const { dbSchema } = useVSCode();
    const formatOptions = useFormatOptions();

    // Expose methods to parent via ref
    useImperativeHandle(ref, () => ({
      getValue: () => editorRef.current?.getValue() || '',
      getSelectedText: () => {
        const editor = editorRef.current;
        if (!editor) return '';
        const selection = editor.getSelection();
        if (!selection || selection.isEmpty()) return '';
        return editor.getModel()?.getValueInRange(selection) || '';
      },
      formatSql: () => handleFormat(),
      focus: () => editorRef.current?.focus(),
      executeCurrentLine: () => {
        const editor = editorRef.current;
        if (!editor) return;
        const position = editor.getPosition();
        if (!position) return;
        const model = editor.getModel();
        if (!model) return;
        const lineContent = model.getLineContent(position.lineNumber);
        if (lineContent.trim()) {
          onExecute(lineContent);
        }
      },
    }));

    const handleFormat = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;

      const model = editor.getModel();
      if (!model) return;

      const selection = editor.getSelection();
      const textToFormat = selection && !selection.isEmpty()
        ? model.getValueInRange(selection)
        : model.getValue();

      try {
        const formatted = format(textToFormat, {
          language: 'transactsql',
          tabWidth: formatOptions.tabWidth,
          keywordCase: formatOptions.keywordCase,
          dataTypeCase: formatOptions.dataTypeCase,
          functionCase: formatOptions.functionCase,
          linesBetweenQueries: formatOptions.linesBetweenQueries,
          indentStyle: formatOptions.indentStyle,
          logicalOperatorNewline: formatOptions.logicalOperatorNewline,
        });

        if (selection && !selection.isEmpty()) {
          editor.executeEdits('format', [{
            range: selection,
            text: formatted,
          }]);
        } else {
          const fullRange = model.getFullModelRange();
          editor.executeEdits('format', [{
            range: fullRange,
            text: formatted,
          }]);
        }
      } catch (error) {
        console.error('Format error:', error);
      }
    }, [formatOptions]);

    const handleEditorMount: OnMount = useCallback((editor, monacoInstance) => {
      editorRef.current = editor;
      monacoRef.current = monacoInstance;

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

      // Add keybindings
      editor.addAction({
        id: 'execute-query',
        label: 'Execute Query',
        keybindings: [
          monacoInstance.KeyCode.F5,
          monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.KeyE,
        ],
        run: () => {
          const selection = editor.getSelection();
          const model = editor.getModel();
          if (!model) return;
          
          const sql = (selection && !selection.isEmpty())
            ? model.getValueInRange(selection)
            : model.getValue();
          
          if (sql.trim()) {
            onExecute(sql);
          }
        },
      });

      editor.addAction({
        id: 'format-sql',
        label: 'Format SQL',
        keybindings: [
          monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.KeyF,
        ],
        run: handleFormat,
      });

      // Set initial value if provided
      if (initialValue) {
        editor.setValue(initialValue);
      }

      // Focus editor
      editor.focus();
    }, [onExecute, handleFormat, initialValue]);

    // Update autocomplete when schema changes
    useEffect(() => {
      if (!monacoRef.current || !dbSchema) return;

      const monacoInstance = monacoRef.current;

      // Register completions provider for T-SQL
      const provider = monacoInstance.languages.registerCompletionItemProvider('sql', {
        provideCompletionItems: (model: editor.ITextModel, position: { lineNumber: number; column: number }) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          const suggestions: languages.CompletionItem[] = [];

          // Add tables
          dbSchema.tables.forEach((table: TableInfo) => {
            suggestions.push({
              label: table.name,
              kind: monacoInstance.languages.CompletionItemKind.Class,
              insertText: table.name,
              range,
              detail: `Table (${table.columns.length} columns)`,
            });

            // Add columns for each table
            table.columns.forEach((col) => {
              suggestions.push({
                label: `${table.name}.${col.name}`,
                kind: monacoInstance.languages.CompletionItemKind.Field,
                insertText: `${table.name}.${col.name}`,
                range,
                detail: `${col.type}${col.nullable ? '' : ' NOT NULL'}`,
              });
            });
          });

          // Add views
          dbSchema.views?.forEach((view: ViewInfo) => {
            suggestions.push({
              label: view.name,
              kind: monacoInstance.languages.CompletionItemKind.Interface,
              insertText: view.name,
              range,
              detail: 'View',
            });
          });

          // Add stored procedures
          dbSchema.storedProcedures?.forEach((sp: StoredProcedureInfo) => {
            suggestions.push({
              label: sp.name,
              kind: monacoInstance.languages.CompletionItemKind.Function,
              insertText: sp.name,
              range,
              detail: 'Stored Procedure',
            });
          });

          // Add functions
          dbSchema.functions?.forEach((fn: FunctionInfo) => {
            suggestions.push({
              label: fn.name,
              kind: monacoInstance.languages.CompletionItemKind.Method,
              insertText: fn.name,
              range,
              detail: 'Function',
            });
          });

          return { suggestions };
        },
      });

      return () => provider.dispose();
    }, [dbSchema]);

    return (
      <div className="sql-editor-container">
        <MonacoEditor
          height="100%"
          language="sql"
          theme="vs-dark"
          defaultValue={initialValue}
          onMount={handleEditorMount}
          options={{
            automaticLayout: true,
          }}
        />
      </div>
    );
  }
);

SqlEditor.displayName = 'SqlEditor';
