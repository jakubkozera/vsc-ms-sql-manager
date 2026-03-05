import { useCallback, type MutableRefObject } from 'react';
import type { editor } from 'monaco-editor';
import type { DatabaseSchema } from '../../../types/schema';
import type { OutgoingMessage } from '../../../types/messages';
import { findTable } from '../../../services';

type MonacoType = typeof import('monaco-editor');

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
        run: () => requestPaste(),
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
