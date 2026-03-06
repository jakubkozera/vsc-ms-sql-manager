/**
 * useWildcardExpansion
 *
 * Wires the "SELECT * expansion" feature (à la Redgate SQL Prompt) into Monaco:
 *
 *  • TAB key — when the cursor is right after `*` (or `alias.*`) and the
 *    corresponding table has schema columns, expands the wildcard in-place.
 *    Falls through to the normal TAB behaviour when no expansion is possible.
 *
 *  • CodeLens — shows a clickable "Expand * → N columns" lens above every line
 *    that contains an expandable wildcard, so the user can also trigger it with
 *    the mouse.
 */

import { useEffect, useRef, type MutableRefObject } from 'react';
import type { editor } from 'monaco-editor';
import type { DatabaseSchema } from '../../../types/schema';
import {
  findWildcardAtPosition,
  resolveWildcard,
  buildColumnExpansion,
  findWildcardCandidatesInLine,
} from '../../../services/sqlWildcardService';

type MonacoType = typeof import('monaco-editor');

// ── Internal helper ──────────────────────────────────────────────────────────

/**
 * Attempts to expand the wildcard at `position` (defaults to current cursor).
 * Returns true when the expansion was applied, false otherwise.
 */
function tryExpand(
  ed: editor.IStandaloneCodeEditor,
  schema: DatabaseSchema,
  position?: { lineNumber: number; column: number }
): boolean {
  const model = ed.getModel();
  if (!model) return false;

  const pos = position ?? ed.getPosition();
  if (!pos) return false;

  const wildcardInfo = findWildcardAtPosition(model, pos);
  if (!wildcardInfo) return false;

  const resolution = resolveWildcard(model.getValue(), wildcardInfo, schema);
  if (!resolution || resolution.totalColumns === 0) return false;

  const expanded = buildColumnExpansion(
    resolution.segments,
    wildcardInfo.wildcardRange.startColumn
  );

  ed.executeEdits('expand-wildcard', [{ range: wildcardInfo.wildcardRange, text: expanded }]);

  // Place cursor at the end of the last inserted line
  const expandedLines = expanded.split('\n');
  const finalLine = wildcardInfo.wildcardRange.startLineNumber + expandedLines.length - 1;
  const finalCol = expandedLines[expandedLines.length - 1].length + 1;
  ed.setPosition({ lineNumber: finalLine, column: finalCol });
  ed.focus();
  return true;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWildcardExpansion(
  monacoRef: MutableRefObject<MonacoType | null>,
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>,
  dbSchema: DatabaseSchema | undefined,
  editorReady: boolean
): void {
  // Keep a ref so that the registered callbacks always see the latest schema
  // without having to re-register Monaco providers on every schema change.
  const dbSchemaRef = useRef(dbSchema);
  useEffect(() => {
    dbSchemaRef.current = dbSchema;
  }, [dbSchema]);

  useEffect(() => {
    const monacoInstance = monacoRef.current;
    const ed = editorRef.current;
    if (!monacoInstance || !ed || !editorReady) return;

    const disposables: { dispose: () => void }[] = [];

    // ── 1. TAB interceptor ───────────────────────────────────────────────────
    //
    // onKeyDown fires before Monaco's own keybinding dispatch, so calling
    // e.preventDefault() stops further processing (including the suggestion
    // widget's TAB handler) only when we actually perform an expansion.
    disposables.push(
      ed.onKeyDown((e) => {
        if (e.keyCode !== monacoInstance.KeyCode.Tab) return;
        if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;

        const schema = dbSchemaRef.current;
        if (!schema) return;

        const model = ed.getModel();
        const pos = ed.getPosition();
        if (!model || !pos) return;

        // Only intercept when cursor is immediately after `*`
        const wildcardInfo = findWildcardAtPosition(model, pos);
        if (!wildcardInfo) return;

        const resolution = resolveWildcard(model.getValue(), wildcardInfo, schema);
        if (!resolution || resolution.totalColumns === 0) return;

        // Consume the event and expand
        e.preventDefault();
        e.stopPropagation();

        const expanded = buildColumnExpansion(
          resolution.segments,
          wildcardInfo.wildcardRange.startColumn
        );
        ed.executeEdits('expand-wildcard', [{ range: wildcardInfo.wildcardRange, text: expanded }]);
        // Place cursor at the end of the last inserted line
        const expandedLines = expanded.split('\n');
        const finalLine = wildcardInfo.wildcardRange.startLineNumber + expandedLines.length - 1;
        const finalCol = expandedLines[expandedLines.length - 1].length + 1;
        ed.setPosition({ lineNumber: finalLine, column: finalCol });
      })
    );

    // ── 2. CodeLens command ──────────────────────────────────────────────────
    //
    // CodeLens `command.id` must reference a registered Monaco command.
    // `editor.registerCommand` is the standard way to do this.
    disposables.push(
      monacoInstance.editor.registerCommand(
        'mssql.expandWildcardAt',
        (_accessor: unknown, lineNumber: number, column: number) => {
          const schema = dbSchemaRef.current;
          const currentEd = editorRef.current;
          if (!schema || !currentEd) return;
          tryExpand(currentEd, schema, { lineNumber, column });
        }
      )
    );

    // ── 3. CodeLens provider ─────────────────────────────────────────────────
    disposables.push(
      monacoInstance.languages.registerCodeLensProvider('sql', {
        provideCodeLenses(model) {
          const schema = dbSchemaRef.current;
          if (!schema) return { lenses: [], dispose: () => {} };

          const lenses: {
            range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
            id: string;
            command: { id: string; title: string; arguments: unknown[] };
          }[] = [];
          const fullText = model.getValue();
          const lines = fullText.split('\n');

          lines.forEach((line, idx) => {
            const lineNumber = idx + 1;
            const candidates = findWildcardCandidatesInLine(line, lineNumber);

            for (const candidate of candidates) {
              const resolution = resolveWildcard(
                fullText,
                { alias: candidate.alias, wildcardRange: candidate.wildcardRange },
                schema
              );
              if (!resolution || resolution.totalColumns === 0) continue;

              lenses.push({
                range: {
                  startLineNumber: lineNumber,
                  startColumn: 1,
                  endLineNumber: lineNumber,
                  endColumn: 1,
                },
                id: `expand-wildcard-${lineNumber}-${candidate.column}`,
                command: {
                  id: 'mssql.expandWildcardAt',
                  title: `Expand * → ${resolution.totalColumns} columns`,
                  // Arguments passed to the registered command above
                  arguments: [lineNumber, candidate.column],
                },
              });
            }
          });

          return { lenses, dispose: () => {} };
        },
        resolveCodeLens(_model, codeLens) {
          return codeLens;
        },
      })
    );

    return () => {
      for (const d of disposables) d.dispose();
    };
  }, [editorReady]); // editorReady gates registration; live data flows through refs
}
