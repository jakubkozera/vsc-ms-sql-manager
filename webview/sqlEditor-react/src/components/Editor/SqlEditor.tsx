import { useRef, useCallback, useEffect, forwardRef, useImperativeHandle, useState } from 'react';
import MonacoEditor, { BeforeMount, OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { format } from 'sql-formatter';
import { useVSCode } from '../../context/VSCodeContext';
import { useFormatOptions } from '../Toolbar/FormatButton';
import { useEditorSetup, useEditorActions, useCompletionProvider, useSchemaProviders } from './hooks';
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
    const [editorReady, setEditorReady] = useState(false);
    const lastContextPositionRef = useRef<{ lineNumber: number; column: number } | null>(null);
    const tableAtCursorContextKeyRef = useRef<any>(null);
    const { dbSchema, requestPaste, pasteContent, clearPasteContent, postMessage, currentConnectionId, currentDatabase } = useVSCode();
    const dbSchemaRef = useRef(dbSchema);
    const currentConnectionIdRef = useRef(currentConnectionId);
    const currentDatabaseRef = useRef(currentDatabase);
    const formatOptions = useFormatOptions();

    // Keep refs in sync so that Monaco callbacks always see fresh state
    useEffect(() => { dbSchemaRef.current = dbSchema; }, [dbSchema]);
    useEffect(() => { currentConnectionIdRef.current = currentConnectionId; }, [currentConnectionId]);
    useEffect(() => { currentDatabaseRef.current = currentDatabase; }, [currentDatabase]);

    // Hooks
    const setupEditor = useEditorSetup(editorRef, monacoRef, setEditorReady, formatOptions, initialValue);

    const registerActions = useEditorActions({
      editorRef, monacoRef, dbSchemaRef, currentConnectionIdRef, currentDatabaseRef,
      lastContextPositionRef, tableAtCursorContextKeyRef,
      onExecute, requestPaste, postMessage, currentConnectionId, currentDatabase,
    });

    useCompletionProvider(monacoRef, dbSchema, editorReady);
    useSchemaProviders(monacoRef, editorRef, dbSchema, editorReady, currentConnectionId);

    // Expose methods to parent via ref
    useImperativeHandle(ref, () => ({
      getValue: () => editorRef.current?.getValue() || '',
      getSelectedText: () => {
        const ed = editorRef.current;
        if (!ed) return '';
        const selection = ed.getSelection();
        if (!selection || selection.isEmpty()) return '';
        return ed.getModel()?.getValueInRange(selection) || '';
      },
      formatSql: () => handleFormat(),
      focus: () => editorRef.current?.focus(),
      executeCurrentLine: () => {
        const ed = editorRef.current;
        if (!ed) return;
        const position = ed.getPosition();
        if (!position) return;
        const model = ed.getModel();
        if (!model) return;
        const lineContent = model.getLineContent(position.lineNumber);
        if (lineContent.trim()) {
          onExecute(lineContent);
        }
      },
    }));

    const handleFormat = useCallback(() => {
      const ed = editorRef.current;
      if (!ed) return;
      const model = ed.getModel();
      if (!model) return;

      const selection = ed.getSelection();
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

        const range = selection && !selection.isEmpty() ? selection : model.getFullModelRange();
        ed.executeEdits('format', [{ range, text: formatted }]);
      } catch (error) {
        console.error('Format error:', error);
      }
    }, [formatOptions]);

    /** Extra SQL functions not in Monaco's built-in SQL Monarch tokenizer */
    const EXTRA_BUILTIN_FUNCTIONS = [
      'OPENJSON', 'JSON_VALUE', 'JSON_QUERY', 'JSON_MODIFY', 'ISJSON',
      'STRING_SPLIT', 'STRING_AGG', 'CONCAT_WS', 'TRANSLATE', 'TRIM',
      'DATEDIFF_BIG', 'GREATEST', 'LEAST', 'GENERATE_SERIES',
    ];

    const handleEditorWillMount: BeforeMount = useCallback((monacoInstance) => {
      // Extend the SQL Monarch tokenizer with extra built-in functions
      // @ts-expect-error — no type declarations for internal Monaco SQL module
      import('monaco-editor/esm/vs/basic-languages/sql/sql').then(({ language }: { language: any }) => {
        const extended = { ...language };
        extended.builtinFunctions = [...(language.builtinFunctions || []), ...EXTRA_BUILTIN_FUNCTIONS];
        monacoInstance.languages.setMonarchTokensProvider('sql', extended);
      });
    }, []);

    const handleEditorMount: OnMount = useCallback((editor, monacoInstance) => {
      const disposables = setupEditor(editor, monacoInstance);
      registerActions(editor, monacoInstance);

      return () => {
        disposables.forEach(d => d.dispose());
      };
    }, [setupEditor, registerActions]);

    // Handle paste content from extension
    useEffect(() => {
      if (pasteContent !== null && editorRef.current) {
        const ed = editorRef.current;
        const selection = ed.getSelection();
        if (selection) {
          ed.executeEdits('paste', [{ range: selection, text: pasteContent }]);
        }
        clearPasteContent();
      }
    }, [pasteContent, clearPasteContent]);

    // Update editor value when initialValue changes (for loading from history/commands)
    useEffect(() => {
      if (editorRef.current && initialValue !== undefined && editorReady) {
        const currentValue = editorRef.current.getValue();
        if (initialValue !== currentValue) {
          editorRef.current.setValue(initialValue);
          editorRef.current.setPosition({ lineNumber: 1, column: 1 });
        }
      }
    }, [initialValue, editorReady]);

    return (
      <div className="sql-editor-container">
        <MonacoEditor
          height="100%"
          language="sql"
          theme="vs-dark"
          defaultValue={initialValue}
          beforeMount={handleEditorWillMount}
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
