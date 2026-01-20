import { useRef, useCallback, useEffect, forwardRef, useImperativeHandle, useState } from 'react';
import MonacoEditor, { OnMount } from '@monaco-editor/react';
import type { editor, languages } from 'monaco-editor';
import { format } from 'sql-formatter';
import { useVSCode } from '../../context/VSCodeContext';
import { useFormatOptions } from '../Toolbar/FormatButton';
import type { TableInfo, ViewInfo, StoredProcedureInfo, FunctionInfo, ColumnInfo } from '../../types/schema';
import {
  validateSql,
  builtInSnippets,
  analyzeSqlContext,
  extractTablesFromQuery,
  findTableForAlias,
  getColumnsForTable,
  getRelatedTables,
  generateSmartAlias,
  getSqlOperators,
  getAggregateFunctions,
} from '../../services';
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
    const { dbSchema, requestPaste, pasteContent, clearPasteContent } = useVSCode();
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
      console.log('[SqlEditor] Monaco editor mounted successfully');
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

      // Add keybindings
      editor.addAction({
        id: 'execute-query',
        label: 'Execute Query',
        keybindings: [
          monacoInstance.KeyCode.F5,
          monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.KeyE,
        ],
        run: () => {
          console.log('[SqlEditor] F5 execute-query action triggered');
          const selection = editor.getSelection();
          const model = editor.getModel();
          if (!model) {
            console.log('[SqlEditor] No model found, cannot execute');
            return;
          }

          let sql: string;
          if (selection && !selection.isEmpty()) {
            sql = model.getValueInRange(selection);
            console.log('[SqlEditor] Executing selection:', sql.substring(0, 100) + '...');
          } else {
            sql = model.getValue();
            console.log('[SqlEditor] Executing entire content:', sql.substring(0, 100) + '...');
          }

          if (sql.trim()) {
            console.log('[SqlEditor] Calling onExecute with SQL of length:', sql.length);
            onExecute(sql);
          } else {
            console.log('[SqlEditor] No SQL to execute (empty or whitespace only)');
          }
        },
      });

      // Add paste action that requests content from extension
      editor.addAction({
        id: 'paste',
        label: 'Paste',
        keybindings: [
          monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyV,
        ],
        run: () => {
          console.log('[SqlEditor] Paste action triggered - requesting from extension');
          requestPaste();
        },
      });

      // Register formatting providers immediately when editor mounts
      // This enables Monaco's built-in formatting commands:
      // - Alt+Shift+F (Format Document)
      // - Ctrl+K Ctrl+F (Format Selection)
      // - Right-click context menu "Format Document" and "Format Selection"
      console.log('[SqlEditor] Registering formatting providers');
      
      const documentFormattingProvider = monacoInstance.languages.registerDocumentFormattingEditProvider('sql', {
        provideDocumentFormattingEdits: (model: editor.ITextModel, _options: languages.FormattingOptions, _token: any) => {
          console.log('[SqlEditor] Document formatting requested');

          const documentText = model.getValue();

          try {
            const formattedText = format(documentText, {
              language: 'transactsql',
              tabWidth: formatOptions.tabWidth,
              keywordCase: formatOptions.keywordCase,
              dataTypeCase: formatOptions.dataTypeCase,
              functionCase: formatOptions.functionCase,
              linesBetweenQueries: formatOptions.linesBetweenQueries,
              indentStyle: formatOptions.indentStyle,
              logicalOperatorNewline: formatOptions.logicalOperatorNewline,
            });

            const fullRange = model.getFullModelRange();
            return [{
              range: fullRange,
              text: formattedText,
            }];
          } catch (error) {
            console.error('[SqlEditor] Error formatting document:', error);
            return [];
          }
        },
      });

      const documentRangeFormattingProvider = monacoInstance.languages.registerDocumentRangeFormattingEditProvider('sql', {
        provideDocumentRangeFormattingEdits: (model: editor.ITextModel, range: any, _options: languages.FormattingOptions, _token: any) => {
          console.log('[SqlEditor] Selection formatting requested for range:', range);

          const selectedText = model.getValueInRange(range);

          try {
            const formattedText = format(selectedText, {
              language: 'transactsql',
              tabWidth: formatOptions.tabWidth,
              keywordCase: formatOptions.keywordCase,
              dataTypeCase: formatOptions.dataTypeCase,
              functionCase: formatOptions.functionCase,
              linesBetweenQueries: formatOptions.linesBetweenQueries,
              indentStyle: formatOptions.indentStyle,
              logicalOperatorNewline: formatOptions.logicalOperatorNewline,
            });

            return [{
              range: range,
              text: formattedText,
            }];
          } catch (error) {
            console.error('[SqlEditor] Error formatting selection:', error);
            return [];
          }
        },
      });

      console.log('[SqlEditor] Formatting providers registered successfully');

      // Store disposables for cleanup
      const formattingDisposables = [documentFormattingProvider, documentRangeFormattingProvider];

      // Set initial value if provided
      if (initialValue) {
        editor.setValue(initialValue);
      }

      // Focus editor
      editor.focus();
      console.log('[SqlEditor] Editor focused');

      // Cleanup function to dispose formatting providers when editor unmounts
      return () => {
        console.log('[SqlEditor] Disposing formatting providers');
        formattingDisposables.forEach(d => d.dispose());
      };
    }, [onExecute, initialValue, formatOptions]);

    // Handle paste content from extension
    useEffect(() => {
      if (pasteContent !== null && editorRef.current) {
        console.log('[SqlEditor] Inserting paste content:', pasteContent);
        const editor = editorRef.current;
        const selection = editor.getSelection();
        if (selection) {
          editor.executeEdits('paste', [{
            range: selection,
            text: pasteContent,
          }]);
        }
        // Clear paste content after use
        clearPasteContent();
      }
    }, [pasteContent, clearPasteContent]);

    // Update editor value when initialValue changes (for loading from history/commands)
    useEffect(() => {
      console.log('[SqlEditor] useEffect triggered - initialValue or editorReady changed:', {
        initialValue: initialValue?.substring(0, 100) + '...',
        hasEditor: !!editorRef.current,
        editorReady
      });

      if (editorRef.current && initialValue !== undefined && editorReady) {
        const currentValue = editorRef.current.getValue();
        console.log('[SqlEditor] Checking if update needed:', {
          initialValueLength: initialValue.length,
          currentValueLength: currentValue.length,
          initialValuePreview: initialValue.substring(0, 50) + '...',
          currentValuePreview: currentValue.substring(0, 50) + '...',
          areEqual: initialValue === currentValue
        });

        // Always update if initial value is different from current value
        // This ensures query history and other programmatic content changes work
        if (initialValue !== currentValue) {
          console.log('[SqlEditor] Updating editor with new SQL:', initialValue.substring(0, 100));
          editorRef.current.setValue(initialValue);
          editorRef.current.setPosition({ lineNumber: 1, column: 1 });
          console.log('[SqlEditor] Editor updated successfully');
        } else {
          console.log('[SqlEditor] No update needed - values are identical');
        }
      } else {
        console.log('[SqlEditor] Skipping update - no editor, undefined initialValue, or editor not ready');
      }
    }, [initialValue, editorReady]);

    // Update autocomplete and validation when schema changes
    useEffect(() => {
      if (!monacoRef.current || !dbSchema) return;

      const monacoInstance = monacoRef.current;
      const disposables: { dispose: () => void }[] = [];

      // Register completions provider for T-SQL
      const completionProvider = monacoInstance.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: ['.', ' '],
        provideCompletionItems: (model: editor.ITextModel, position: { lineNumber: number; column: number }) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          const textUntilPosition = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });

          const lineUntilPosition = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });

          const suggestions: languages.CompletionItem[] = [];

          // Check if we're after a dot (for column suggestions)
          const dotMatch = lineUntilPosition.match(/(\w+)\.\w*$/);
          if (dotMatch) {
            const prefix = dotMatch[1];
            const tableAlias = findTableForAlias(textUntilPosition, prefix, dbSchema);

            if (tableAlias) {
              const columns = getColumnsForTable(tableAlias.schema, tableAlias.table, dbSchema);
              return {
                suggestions: columns.map((col: ColumnInfo) => ({
                  label: col.name,
                  kind: monacoInstance.languages.CompletionItemKind.Field,
                  detail: `${col.type}${col.nullable ? ' (nullable)' : ''}`,
                  insertText: col.name,
                  range,
                })),
              };
            }
          }

          // Analyze SQL context
          const sqlContext = analyzeSqlContext(textUntilPosition, lineUntilPosition);
          const fullText = model.getValue();

          // Handle different SQL contexts
          switch (sqlContext.type) {
            case 'JOIN_TABLE': {
              const tablesInQuery = extractTablesFromQuery(textUntilPosition, dbSchema);
              if (tablesInQuery.length > 0) {
                const relatedTables = getRelatedTables(tablesInQuery, dbSchema);
                relatedTables.forEach((table) => {
                  if (!table || !table.name) return;
                  const fullName = table.schema === 'dbo' ? table.name : `${table.schema}.${table.name}`;
                  const tableAlias = generateSmartAlias(table.name);

                  let insertText = `${fullName} ${tableAlias}`;
                  let detailText = `Table (${table.columns?.length || 0} columns)`;

                  if (table.foreignKeyInfo) {
                    const fkInfo = table.foreignKeyInfo;
                    const toAlias = tableAlias;
                    const fromAlias = fkInfo.fromAlias;

                    if (fkInfo.direction === 'to') {
                      insertText = `${fullName} ${toAlias} ON ${fromAlias}.${fkInfo.fromColumn} = ${toAlias}.${fkInfo.toColumn}`;
                      detailText = `Join on ${fromAlias}.${fkInfo.fromColumn} = ${toAlias}.${fkInfo.toColumn}`;
                    } else {
                      insertText = `${fullName} ${toAlias} ON ${toAlias}.${fkInfo.fromColumn} = ${fromAlias}.${fkInfo.toColumn}`;
                      detailText = `Join on ${toAlias}.${fkInfo.fromColumn} = ${fromAlias}.${fkInfo.toColumn}`;
                    }
                  }

                  suggestions.push({
                    label: fullName,
                    kind: monacoInstance.languages.CompletionItemKind.Class,
                    detail: detailText,
                    insertText: insertText,
                    insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                    sortText: `0_${fullName}`,
                  });
                });
                return { suggestions };
              }
              break;
            }

            case 'ORDER_BY':
            case 'GROUP_BY':
            case 'SELECT':
            case 'WHERE':
            case 'AFTER_FROM': {
              // Suggest columns from tables in query
              const tablesInQuery = extractTablesFromQuery(fullText, dbSchema);
              tablesInQuery.forEach((tableInfo) => {
                const columns = getColumnsForTable(tableInfo.schema, tableInfo.table, dbSchema);
                const displayAlias = tableInfo.alias || tableInfo.table;

                columns.forEach((col: ColumnInfo) => {
                  if (tableInfo.hasExplicitAlias || tablesInQuery.length > 1) {
                    suggestions.push({
                      label: `${displayAlias}.${col.name}`,
                      kind: monacoInstance.languages.CompletionItemKind.Field,
                      detail: `${col.type}${col.nullable ? ' (nullable)' : ''} - from ${tableInfo.table}`,
                      insertText: `${displayAlias}.${col.name}`,
                      range,
                      sortText: `1_${col.name}`,
                    });
                  }
                  suggestions.push({
                    label: col.name,
                    kind: monacoInstance.languages.CompletionItemKind.Field,
                    detail: `${col.type}${col.nullable ? ' (nullable)' : ''} - from ${tableInfo.table}`,
                    insertText: col.name,
                    range,
                    sortText: `2_${col.name}`,
                  });
                });
              });

              // Add operators for WHERE/HAVING
              if (sqlContext.suggestOperators) {
                getSqlOperators().forEach((op) => {
                  suggestions.push({
                    label: op.label,
                    kind: monacoInstance.languages.CompletionItemKind.Operator,
                    detail: op.detail,
                    insertText: op.insertText,
                    insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                    sortText: `0_${op.label}`,
                  });
                });
              }
              break;
            }

            case 'HAVING': {
              // Add aggregate functions
              getAggregateFunctions().forEach((fn) => {
                suggestions.push({
                  label: fn.label,
                  kind: monacoInstance.languages.CompletionItemKind.Function,
                  detail: fn.detail,
                  insertText: fn.insertText,
                  insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range,
                  sortText: `0_${fn.label}`,
                });
              });

              if (sqlContext.suggestOperators) {
                getSqlOperators().forEach((op) => {
                  suggestions.push({
                    label: op.label,
                    kind: monacoInstance.languages.CompletionItemKind.Operator,
                    detail: op.detail,
                    insertText: op.insertText,
                    insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                    sortText: `1_${op.label}`,
                  });
                });
              }
              break;
            }

            case 'INSERT_COLUMNS': {
              if (sqlContext.tableName) {
                const tableInfo = dbSchema.tables?.find(
                  (t: TableInfo) => t.name.toLowerCase() === sqlContext.tableName?.toLowerCase()
                );
                if (tableInfo) {
                  tableInfo.columns.forEach((col: ColumnInfo) => {
                    suggestions.push({
                      label: col.name,
                      kind: monacoInstance.languages.CompletionItemKind.Field,
                      detail: `${col.type}${col.nullable ? ' (nullable)' : ''}`,
                      insertText: col.name,
                      range,
                    });
                  });
                }
              }
              break;
            }
          }

          // Add tables
          dbSchema.tables?.forEach((table: TableInfo) => {
            suggestions.push({
              label: table.name,
              kind: monacoInstance.languages.CompletionItemKind.Class,
              insertText: table.name,
              range,
              detail: `Table (${table.columns.length} columns)`,
              sortText: `3_${table.name}`,
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
              sortText: `4_${view.name}`,
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
              sortText: `5_${sp.name}`,
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
              sortText: `5_${fn.name}`,
            });
          });

          // Add snippets
          builtInSnippets.forEach((snippet) => {
            suggestions.push({
              label: snippet.prefix,
              kind: monacoInstance.languages.CompletionItemKind.Snippet,
              insertText: snippet.body,
              insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              detail: snippet.name,
              documentation: snippet.description,
              sortText: `9_${snippet.prefix}`,
            });
          });

          // Remove duplicates
          const seen = new Set<string>();
          const uniqueSuggestions = suggestions.filter((s) => {
            const key = `${s.label}-${s.kind}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          return { suggestions: uniqueSuggestions };
        },
      });
      disposables.push(completionProvider);

      // Set up validation on content change
      const validationDisposable = editorRef.current?.onDidChangeModelContent(() => {
        const model = editorRef.current?.getModel();
        if (!model) return;

        // Debounce validation
        const timeoutId = setTimeout(() => {
          const sql = model.getValue();
          const markers = validateSql(sql, dbSchema);

          // Convert our markers to Monaco markers
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
