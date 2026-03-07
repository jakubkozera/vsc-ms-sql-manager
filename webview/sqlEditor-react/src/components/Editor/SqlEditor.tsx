import { useRef, useCallback, useEffect, forwardRef, useImperativeHandle, useState } from 'react';
import MonacoEditor, { BeforeMount, OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { format } from 'sql-formatter';
import { useVSCode } from '../../context/VSCodeContext';
import { useFormatOptions } from '../Toolbar/FormatButton';
import { useEditorSetup, useEditorActions, useCompletionProvider, useSchemaProviders, useWildcardExpansion } from './hooks';
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

/** Reads a CSS custom property from the documentElement. */
function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * (Re-)defines all 4 SQL Monaco themes with the current VS Code CSS variables.
 * Safe to call repeatedly — Monaco updates the theme in-place.
 * Must be called before setTheme() so background/foreground reflect the new theme.
 */
function defineMonacoThemes(monaco: MonacoType): void {
  // ── Dark theme ──
  // Note: Monaco's built-in vs-dark base overrides string.sql→FF0000 and predefined.sql→FF00FF,
  // so we must explicitly override those .sql-suffixed tokens as well.
  monaco.editor.defineTheme('sql-dark', {
    base: 'vs-dark',
    inherit: true,
    colors: {
      'editor.background': cssVar('--vscode-editor-background', '#1E1E1E'),
      'editor.foreground': cssVar('--vscode-editor-foreground', '#D4D4D4'),
    },
    rules: [
      { token: 'keyword', foreground: '569CD6' },
      { token: 'keyword.block', foreground: '569CD6' },
      { token: 'keyword.choice', foreground: '569CD6' },
      { token: 'keyword.try', foreground: '569CD6' },
      { token: 'keyword.catch', foreground: '569CD6' },
      { token: 'operator', foreground: '569CD6' },
      { token: 'operator.sql', foreground: '569CD6' },
      { token: 'string', foreground: 'CE9178' },
      { token: 'string.sql', foreground: 'CE9178' },
      { token: 'predefined', foreground: 'DCDCAA' },
      { token: 'predefined.sql', foreground: 'DCDCAA' },
      { token: 'number', foreground: 'B5CEA8' },
      { token: 'comment', foreground: '6A9955' },
      { token: 'comment.quote', foreground: '6A9955' },
      { token: 'identifier', foreground: 'D4D4D4' },
      { token: 'identifier.quote', foreground: 'D4D4D4' },
      { token: 'delimiter', foreground: 'D4D4D4' },
      { token: 'delimiter.parenthesis', foreground: 'D4D4D4' },
      { token: 'type', foreground: '4EC9B0' },
    ],
  });

  // ── Light theme ──
  monaco.editor.defineTheme('sql-light', {
    base: 'vs',
    inherit: true,
    colors: {
      'editor.background': cssVar('--vscode-editor-background', '#FFFFFF'),
      'editor.foreground': cssVar('--vscode-editor-foreground', '#000000'),
    },
    rules: [
      { token: 'keyword', foreground: '0000FF' },
      { token: 'keyword.block', foreground: '0000FF' },
      { token: 'keyword.choice', foreground: '0000FF' },
      { token: 'keyword.try', foreground: '0000FF' },
      { token: 'keyword.catch', foreground: '0000FF' },
      { token: 'operator', foreground: '0000FF' },
      { token: 'operator.sql', foreground: '0000FF' },
      { token: 'string', foreground: 'A31515' },
      { token: 'string.sql', foreground: 'A31515' },
      { token: 'predefined', foreground: '795E26' },
      { token: 'predefined.sql', foreground: '795E26' },
      { token: 'number', foreground: '098658' },
      { token: 'comment', foreground: '008000' },
      { token: 'comment.quote', foreground: '008000' },
      { token: 'identifier', foreground: '001080' },
      { token: 'identifier.quote', foreground: '001080' },
      { token: 'delimiter', foreground: '000000' },
      { token: 'delimiter.parenthesis', foreground: '000000' },
      { token: 'type', foreground: '267F99' },
    ],
  });

  // ── High-contrast dark ──
  monaco.editor.defineTheme('sql-hc-dark', {
    base: 'hc-black',
    inherit: true,
    colors: {
      'editor.background': cssVar('--vscode-editor-background', '#000000'),
      'editor.foreground': cssVar('--vscode-editor-foreground', '#FFFFFF'),
    },
    rules: [
      { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
      { token: 'keyword.block', foreground: '569CD6', fontStyle: 'bold' },
      { token: 'keyword.choice', foreground: '569CD6', fontStyle: 'bold' },
      { token: 'keyword.try', foreground: '569CD6', fontStyle: 'bold' },
      { token: 'keyword.catch', foreground: '569CD6', fontStyle: 'bold' },
      { token: 'operator', foreground: '569CD6', fontStyle: 'bold' },
      { token: 'operator.sql', foreground: '569CD6' },
      { token: 'string', foreground: 'CE9178' },
      { token: 'string.sql', foreground: 'CE9178' },
      { token: 'predefined', foreground: 'DCDCAA' },
      { token: 'predefined.sql', foreground: 'DCDCAA' },
      { token: 'number', foreground: 'B5CEA8' },
      { token: 'comment', foreground: '7CA668' },
      { token: 'comment.quote', foreground: '7CA668' },
      { token: 'identifier', foreground: 'FFFFFF' },
      { token: 'identifier.quote', foreground: 'FFFFFF' },
    ],
  });

  // ── High-contrast light ──
  monaco.editor.defineTheme('sql-hc-light', {
    base: 'hc-light',
    inherit: true,
    colors: {
      'editor.background': cssVar('--vscode-editor-background', '#FFFFFF'),
      'editor.foreground': cssVar('--vscode-editor-foreground', '#000000'),
    },
    rules: [
      { token: 'keyword', foreground: '0000FF', fontStyle: 'bold' },
      { token: 'keyword.block', foreground: '0000FF', fontStyle: 'bold' },
      { token: 'keyword.choice', foreground: '0000FF', fontStyle: 'bold' },
      { token: 'keyword.try', foreground: '0000FF', fontStyle: 'bold' },
      { token: 'keyword.catch', foreground: '0000FF', fontStyle: 'bold' },
      { token: 'operator', foreground: '0000FF', fontStyle: 'bold' },
      { token: 'operator.sql', foreground: '0000FF' },
      { token: 'string', foreground: 'A31515' },
      { token: 'string.sql', foreground: 'A31515' },
      { token: 'predefined', foreground: '795E26' },
      { token: 'predefined.sql', foreground: '795E26' },
      { token: 'number', foreground: '098658' },
      { token: 'comment', foreground: '008000' },
      { token: 'comment.quote', foreground: '008000' },
      { token: 'identifier', foreground: '000000' },
      { token: 'identifier.quote', foreground: '000000' },
    ],
  });
}

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
    useWildcardExpansion(monacoRef, editorRef, dbSchema, editorReady);

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

    /**
     * Detect VS Code theme kind from document.body class.
     * VS Code adds vscode-dark / vscode-light / vscode-high-contrast / vscode-high-contrast-light.
     */
    const getVscodeThemeKind = (): 'sql-dark' | 'sql-light' | 'sql-hc-dark' | 'sql-hc-light' => {
      const body = document.body;
      if (body.classList.contains('vscode-high-contrast-light')) return 'sql-hc-light';
      if (body.classList.contains('vscode-high-contrast')) return 'sql-hc-dark';
      if (body.classList.contains('vscode-light')) return 'sql-light';
      return 'sql-dark';
    };

    const [monacoTheme, setMonacoTheme] = useState<string>(() => getVscodeThemeKind());

    // Watch for VS Code theme changes via MutationObserver on body class
    useEffect(() => {
      const observer = new MutationObserver(() => {
        const newTheme = getVscodeThemeKind();
        // Re-define themes with fresh CSS variables (background/foreground changed)
        // then switch imperatively — this must happen before React re-render.
        const monaco = monacoRef.current;
        if (monaco) {
          defineMonacoThemes(monaco);
          monaco.editor.setTheme(newTheme);
        }
        setMonacoTheme(newTheme);
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      return () => observer.disconnect();
    }, []);

    const handleEditorWillMount: BeforeMount = useCallback((monacoInstance) => {
      // Define all 4 SQL themes with current VS Code CSS variables
      defineMonacoThemes(monacoInstance);

      // Extend the SQL Monarch tokenizer with extra built-in functions
      // and add APPLY, MATCHED to keywords (they're only in operators by default)
      // @ts-expect-error — no type declarations for internal Monaco SQL module
      import('monaco-editor/esm/vs/basic-languages/sql/sql').then(({ language }: { language: any }) => {
        const extended = { ...language };
        extended.builtinFunctions = [...(language.builtinFunctions || []), ...EXTRA_BUILTIN_FUNCTIONS];
        // Add APPLY and MATCHED to keywords so they also match @keywords
        const existingKeywords: string[] = language.keywords || [];
        const missingKeywords = ['APPLY', 'MATCHED'].filter(
          k => !existingKeywords.some((ek: string) => ek.toUpperCase() === k)
        );
        if (missingKeywords.length > 0) {
          extended.keywords = [...existingKeywords, ...missingKeywords];
        }

        // Fix tokenizer: make word-based operators match as keywords (same blue color).
        // Copy the tokenizer deeply enough to modify the root rules.
        const origTokenizer = language.tokenizer;
        extended.tokenizer = { ...origTokenizer, root: [...origTokenizer.root] };
        // Find the case-match rule in root and change @operators from "operator" to "keyword"
        extended.tokenizer.root = extended.tokenizer.root.map((rule: any) => {
          if (Array.isArray(rule) && rule.length === 2 && rule[1]?.cases?.['@operators']) {
            return [rule[0], {
              cases: {
                ...rule[1].cases,
                '@operators': 'keyword',
              },
            }];
          }
          return rule;
        });

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
          theme={monacoTheme}
          defaultValue={initialValue}
          beforeMount={handleEditorWillMount}
          onMount={handleEditorMount}
          options={{
            automaticLayout: true,
            fixedOverflowWidgets: true,
          }}
        />
      </div>
    );
  }
);

SqlEditor.displayName = 'SqlEditor';
