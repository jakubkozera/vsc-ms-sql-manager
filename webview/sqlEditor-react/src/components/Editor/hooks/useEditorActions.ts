import { useCallback, type MutableRefObject } from 'react';
import type { editor } from 'monaco-editor';
import type { DatabaseSchema } from '../../../types/schema';
import type { OutgoingMessage } from '../../../types/messages';
import { findTable } from '../../../services';
import { copyToClipboard } from '../../../services/exportService';

type MonacoType = typeof import('monaco-editor');

function editorHasTextFocus(ed: Pick<editor.ICodeEditor, 'hasTextFocus'>): boolean {
  return typeof ed.hasTextFocus === 'function' ? ed.hasTextFocus() : true;
}

export interface EditorActionsDeps {
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>;
  monacoRef: MutableRefObject<MonacoType | null>;
  dbSchemaRef: MutableRefObject<DatabaseSchema | undefined>;
  currentConnectionIdRef: MutableRefObject<string | null | undefined>;
  currentDatabaseRef: MutableRefObject<string | null | undefined>;
  lastContextPositionRef: MutableRefObject<{ lineNumber: number; column: number } | null>;
  tableAtCursorContextKeyRef: MutableRefObject<any>;
  onExecute: (sql: string) => void;
  requestPaste: () => void;
  postMessage: (message: OutgoingMessage) => void;
  currentConnectionId?: string | null;
  currentDatabase?: string | null;
}

/**
 * Helper: find the table at a given editor cursor position.
 */
export function findTableAtCursorPosition(
  ed: Pick<editor.IStandaloneCodeEditor, 'getModel' | 'getPosition'>,
  position: { lineNumber: number; column: number } | null,
  schema?: DatabaseSchema
): { schema: string; table: string } | null {
  if (!position) return null;
  const model = ed.getModel();
  if (!model) return null;

  const wordInfo = model.getWordAtPosition(position);
  if (!wordInfo?.word) return null;

  let normalizedName = wordInfo.word.trim();
  if (
    (normalizedName.startsWith('[') && normalizedName.endsWith(']')) ||
    (normalizedName.startsWith('"') && normalizedName.endsWith('"'))
  ) {
    normalizedName = normalizedName.substring(1, normalizedName.length - 1);
  }

  if (schema) {
    return findTable(normalizedName, schema);
  }

  return null;
}

/**
 * Registers keybindings (F5, Ctrl+V, Ctrl+S, Ctrl+N) and context menu
 * actions (Script as INSERT/UPDATE/DELETE) on the given Monaco editor.
 * Returns a callback to be called inside handleEditorMount.
 */
export function useEditorActions(deps: EditorActionsDeps) {
  const {
    dbSchemaRef,
    currentConnectionIdRef,
    currentDatabaseRef,
    lastContextPositionRef,
    tableAtCursorContextKeyRef,
    onExecute,
    requestPaste,
    postMessage,
    currentConnectionId,
    currentDatabase,
  } = deps;

  const registerActions = useCallback(
    (editor: editor.IStandaloneCodeEditor, monacoInstance: MonacoType) => {
      // Execute query (F5 / Ctrl+Shift+E)
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

          const sql = selection && !selection.isEmpty()
            ? model.getValueInRange(selection)
            : model.getValue();

          if (sql.trim()) {
            onExecute(sql);
          }
        },
      });

      // Paste (Ctrl+V)
      editor.addAction({
        id: 'paste',
        label: 'Paste',
        keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyV],
        precondition: 'editorTextFocus',
        run: (ed) => {
          if (!editorHasTextFocus(ed)) return;
          requestPaste();
        },
      });

      // Cut (Ctrl+X)
      editor.addAction({
        id: 'cut',
        label: 'Cut',
        keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyX],
        precondition: 'editorTextFocus',
        run: (ed) => {
          if (!editorHasTextFocus(ed)) return;
          const model = ed.getModel();
          const selection = ed.getSelection();
          if (!model || !selection) return;

          if (selection.isEmpty()) {
            // No selection: cut the entire current line
            const lineNumber = selection.startLineNumber;
            const lineContent = model.getLineContent(lineNumber);
            const eol = model.getEOL();
            copyToClipboard(lineContent + eol);
            // Delete the line
            const range = lineNumber < model.getLineCount()
              ? { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber + 1, endColumn: 1 }
              : lineNumber > 1
                ? { startLineNumber: lineNumber - 1, startColumn: model.getLineMaxColumn(lineNumber - 1), endLineNumber: lineNumber, endColumn: model.getLineMaxColumn(lineNumber) }
                : { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: model.getLineMaxColumn(1) };
            ed.executeEdits('cut', [{ range, text: '' }]);
          } else {
            // Has selection: cut selected text
            const text = model.getValueInRange(selection);
            copyToClipboard(text);
            ed.executeEdits('cut', [{ range: selection, text: '' }]);
          }
        },
      });

      // Save query (Ctrl+S)
      editor.addAction({
        id: 'save-query',
        label: 'Save Query',
        keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS],
        run: (ed) => {
          postMessage({ type: 'saveQuery', content: ed.getValue() });
        },
      });

      // New query (Ctrl+N)
      editor.addAction({
        id: 'new-query',
        label: 'New Query',
        keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyN],
        run: () => {
          postMessage({
            type: 'newQueryFromWebview',
            connectionId: currentConnectionId || null,
            databaseName: currentDatabase || null,
          });
        },
      });

      // Context key for table at cursor
      if (typeof editor.createContextKey === 'function') {
        tableAtCursorContextKeyRef.current = editor.createContextKey('tableAtCursor', false);
      }

      // Track right-click position
      editor.onMouseDown((e: any) => {
        try {
          let isRight = false;
          try {
            if (e.event) {
              isRight = !!(e.event.rightButton || e.event.button === 2 || e.event.which === 3);
            }
          } catch (_inner) {
            isRight = false;
          }

          if (isRight) {
            const pos = (e.target && e.target.position) ? e.target.position : editor.getPosition();
            lastContextPositionRef.current = pos;

            const tableInfo = findTableAtCursorPosition(editor, pos, dbSchemaRef.current);
            tableAtCursorContextKeyRef.current?.set(!!tableInfo);
          }
        } catch (err) {
          console.error('[SqlEditor] Error in onMouseDown handler', err);
        }
      });

      // Script as INSERT
      editor.addAction({
        id: 'mssqlmanager.scriptRowAsInsert',
        label: 'Script as INSERT',
        keybindings: [],
        contextMenuGroupId: 'script',
        contextMenuOrder: 1.1,
        precondition: 'tableAtCursor',
        run: (ed) => {
          const position = lastContextPositionRef.current || ed.getPosition();
          const tableInfo = findTableAtCursorPosition(ed, position, dbSchemaRef.current);
          if (tableInfo) {
            postMessage({
              type: 'scriptRowAsInsert',
              schema: tableInfo.schema,
              table: tableInfo.table,
              connectionId: currentConnectionIdRef.current || '',
              database: currentDatabaseRef.current || '',
            });
          }
        },
      });

      // Script as UPDATE
      editor.addAction({
        id: 'mssqlmanager.scriptRowAsUpdate',
        label: 'Script as UPDATE',
        keybindings: [],
        contextMenuGroupId: 'script',
        contextMenuOrder: 1.2,
        precondition: 'tableAtCursor',
        run: (ed) => {
          const position = lastContextPositionRef.current || ed.getPosition();
          const tableInfo = findTableAtCursorPosition(ed, position, dbSchemaRef.current);
          if (tableInfo) {
            postMessage({
              type: 'scriptRowAsUpdate',
              schema: tableInfo.schema,
              table: tableInfo.table,
              connectionId: currentConnectionIdRef.current || '',
              database: currentDatabaseRef.current || '',
            });
          }
        },
      });

      // Script as DELETE
      editor.addAction({
        id: 'mssqlmanager.scriptRowAsDelete',
        label: 'Script as DELETE',
        keybindings: [],
        contextMenuGroupId: 'script',
        contextMenuOrder: 1.3,
        precondition: 'tableAtCursor',
        run: (ed) => {
          const position = lastContextPositionRef.current || ed.getPosition();
          const tableInfo = findTableAtCursorPosition(ed, position, dbSchemaRef.current);
          if (tableInfo) {
            postMessage({
              type: 'scriptRowAsDelete',
              schema: tableInfo.schema,
              table: tableInfo.table,
              connectionId: currentConnectionIdRef.current || '',
              database: currentDatabaseRef.current || '',
            });
          }
        },
      });
    },
    [onExecute, requestPaste, postMessage, currentConnectionId, currentDatabase]
  );

  return registerActions;
}
