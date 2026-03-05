import { useEffect, type MutableRefObject } from 'react';
import type { editor, languages } from 'monaco-editor';
import type { DatabaseSchema, TableInfo, ViewInfo, StoredProcedureInfo, FunctionInfo, ColumnInfo } from '../../../types/schema';
import {
  builtInSnippets,
  analyzeSqlContext,
  extractTablesFromQuery,
  findTableForAlias,
  getColumnsForTable,
  getRelatedTables,
  generateSmartAlias,
  getSqlOperators,
  getAggregateFunctions,
} from '../../../services';

type MonacoType = typeof import('monaco-editor');

/**
 * Registers the T-SQL completion item provider (autocomplete) with Monaco.
 * Returns a disposable. Re-registers whenever dbSchema or editorReady changes.
 */
export function useCompletionProvider(
  monacoRef: MutableRefObject<MonacoType | null>,
  dbSchema: DatabaseSchema | undefined,
  editorReady: boolean
): void {
  useEffect(() => {
    if (!monacoRef.current || !dbSchema || !editorReady) return;

    const monacoInstance = monacoRef.current;

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

          const schema = (table as any).schema || 'dbo';
          const bracketedName = `[${schema}].[${table.name}]`;
          const aliasName = generateSmartAlias(table.name);
          const fullName = schema === 'dbo' ? table.name : `${schema}.${table.name}`;

          const table100Label = `${table.name}100`;
          const tableAllLabel = `${table.name}*`;

          const existingLabels = new Set(suggestions.map(s => (typeof s.label === 'string' ? s.label : '').toLowerCase()));

          if (!existingLabels.has(table100Label.toLowerCase())) {
            suggestions.push({
              label: table100Label,
              kind: monacoInstance.languages.CompletionItemKind.Snippet,
              detail: `📅 Generate SELECT TOP 100 from ${fullName}`,
              insertText: `SELECT TOP 100 *\nFROM ${bracketedName} [${aliasName}]`,
              insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              sortText: `0_${table.name}_100`,
              documentation: {
                value: `**Quick Script**: SELECT TOP 100 rows from ${fullName}\n\nThis will generate a complete SELECT statement to view the first 100 rows from the table.`,
              },
            });
          }

          if (!existingLabels.has(tableAllLabel.toLowerCase())) {
            suggestions.push({
              label: tableAllLabel,
              kind: monacoInstance.languages.CompletionItemKind.Snippet,
              detail: `📅 Generate SELECT * from ${fullName}`,
              insertText: `SELECT *\nFROM ${bracketedName} [${aliasName}]`,
              insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              sortText: `0_${table.name}_all`,
              documentation: {
                value: `**Quick Script**: SELECT all rows from ${fullName}\n\n⚠️ **Warning**: This will return ALL rows from the table.`,
              },
            });
          }
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

    return () => {
      completionProvider.dispose();
    };
  }, [dbSchema, editorReady]);
}
