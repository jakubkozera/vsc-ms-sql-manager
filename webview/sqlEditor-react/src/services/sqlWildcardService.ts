/**
 * SQL Wildcard Expansion Service
 *
 * Implements "SELECT * → column list" expansion (à la Redgate SQL Prompt):
 *   SELECT *       → col1, col2, col3
 *   SELECT t.*     → t.col1, t.col2, t.col3
 *   SELECT o.*, c.*  → each expands independently
 */

import type { DatabaseSchema, ColumnInfo } from '../types/schema';
import { findTableForAlias, getColumnsForTable, extractTablesFromQuery } from './sqlCompletionService';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Describes a wildcard (`*` or `alias.*`) found at the cursor position. */
export interface WildcardInfo {
  /** Table alias before `.*`, or null for bare `*`. */
  alias: string | null;
  /** The range in the model that the wildcard occupies (will be replaced). */
  wildcardRange: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

/** One table's worth of columns with its optional qualifying alias. */
export interface WildcardResolutionSegment {
  columns: ColumnInfo[];
  /** Alias used to prefix column names, or null for unqualified. */
  alias: string | null;
}

/**
 * The full expansion for a wildcard.
 * A bare `*` across multiple JOINed tables produces one segment per table.
 * An `alias.*` always produces exactly one segment.
 */
export interface WildcardResolution {
  segments: WildcardResolutionSegment[];
  /** Total column count across all segments (convenience for CodeLens labels). */
  totalColumns: number;
}

/** A potential wildcard found while scanning a line (for CodeLens). */
export interface WildcardCandidate {
  alias: string | null;
  /** 1-based column AFTER the `*`. This is what `findWildcardAtPosition` expects. */
  column: number;
  wildcardRange: WildcardInfo['wildcardRange'];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

// Keywords that cannot be table aliases
const SQL_KEYWORDS = new Set([
  'WHERE', 'ON', 'SET', 'INNER', 'OUTER', 'LEFT', 'RIGHT', 'CROSS', 'FULL',
  'JOIN', 'GROUP', 'ORDER', 'BY', 'HAVING', 'SELECT', 'FROM', 'WITH', 'AS',
  'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN', 'EXISTS',
  'UNION', 'ALL', 'DISTINCT', 'TOP', 'INTO', 'VALUES', 'INSERT', 'UPDATE',
  'DELETE', 'CREATE', 'DROP', 'ALTER', 'TABLE', 'VIEW', 'INDEX', 'NOLOCK',
  'READPAST', 'UPDLOCK', 'ROWLOCK', 'TABLOCK', 'HOLDLOCK', 'APPLY',
]);

type ModelReadonly = {
  getValueInRange(range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }): string;
};

/**
 * Returns the full text of the current SQL statement (from the last `;` before
 * `lineNumber` to the first `;` after it, or the whole buffer when absent).
 */
function getCurrentStatement(sql: string, lineNumber: number): string {
  const lines = sql.split('\n');
  let start = 0;
  let end = lines.length;

  for (let i = lineNumber - 2; i >= 0; i--) {
    if (lines[i].includes(';')) {
      start = i + 1;
      break;
    }
  }
  for (let i = lineNumber; i < lines.length; i++) {
    if (lines[i].includes(';')) {
      end = i + 1;
      break;
    }
  }

  return lines.slice(start, end).join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Checks whether the cursor is right after a `*` (or `alias.*`) and returns
 * its description. Returns null when the cursor is not in an expandable position.
 *
 * Monaco columns are 1-based, and `position.column` is the column *after* the
 * last typed character.
 */
export function findWildcardAtPosition(
  model: ModelReadonly,
  position: { lineNumber: number; column: number }
): WildcardInfo | null {
  const { lineNumber, column } = position;
  if (column < 2) return null;

  const charBefore = model.getValueInRange({
    startLineNumber: lineNumber,
    startColumn: column - 1,
    endLineNumber: lineNumber,
    endColumn: column,
  });
  if (charBefore !== '*') return null;

  // Skip `*` that is a function argument like COUNT(*) — char before `*` would be `(`  
  // (allowing optional whitespace). Check column - 2 for immediate predecessor.
  if (column >= 3) {
    const charBeforeStar = model.getValueInRange({
      startLineNumber: lineNumber,
      startColumn: column - 2,
      endLineNumber: lineNumber,
      endColumn: column - 1,
    });
    if (charBeforeStar === '(') return null;
  }

  // Check for alias.* pattern (column - 2 must be '.')
  if (column >= 3) {
    const charBeforeStar = model.getValueInRange({
      startLineNumber: lineNumber,
      startColumn: column - 2,
      endLineNumber: lineNumber,
      endColumn: column - 1,
    });
    if (charBeforeStar === '.') {
      // Read the part of the line before the dot to extract the alias identifier
      const lineBeforeDot = model.getValueInRange({
        startLineNumber: lineNumber,
        startColumn: 1,
        endLineNumber: lineNumber,
        endColumn: column - 2,
      });
      const m = lineBeforeDot.match(/(\w+)$/);
      if (m && !SQL_KEYWORDS.has(m[1].toUpperCase())) {
        const alias = m[1];
        return {
          alias,
          wildcardRange: {
            startLineNumber: lineNumber,
            // 1-based column of the first char of the alias
            startColumn: column - 2 - alias.length,
            endLineNumber: lineNumber,
            endColumn: column,
          },
        };
      }
    }
  }

  // Bare `*`
  return {
    alias: null,
    wildcardRange: {
      startLineNumber: lineNumber,
      startColumn: column - 1,
      endLineNumber: lineNumber,
      endColumn: column,
    },
  };
}

/**
 * Resolves the columns that a wildcard represents by looking at the FROM
 * clause of the current statement and matching table / alias names.
 */
export function resolveWildcard(
  sql: string,
  wildcardInfo: WildcardInfo,
  schema: DatabaseSchema
): WildcardResolution | null {
  const statement = getCurrentStatement(sql, wildcardInfo.wildcardRange.endLineNumber);

  if (wildcardInfo.alias) {
    // alias.* — single segment for that one table
    const tableRef = findTableForAlias(statement, wildcardInfo.alias, schema);
    if (!tableRef) return null;
    const columns = getColumnsForTable(tableRef.schema, tableRef.table, schema);
    if (columns.length === 0) return null;
    const segment: WildcardResolutionSegment = { columns, alias: wildcardInfo.alias };
    return { segments: [segment], totalColumns: columns.length };
  }

  // Bare * — collect ALL tables from FROM + JOINs so every column is included
  const tables = extractTablesFromQuery(statement, schema);
  if (tables.length === 0) return null;

  const segments: WildcardResolutionSegment[] = [];
  for (const t of tables) {
    const columns = getColumnsForTable(t.schema, t.table, schema);
    if (columns.length === 0) continue;
    // Use the explicit alias from the query if present (e.g. `FROM Orders o` → 'o')
    segments.push({ columns, alias: t.hasExplicitAlias ? t.alias : null });
  }

  if (segments.length === 0) return null;
  const totalColumns = segments.reduce((sum, s) => sum + s.columns.length, 0);
  return { segments, totalColumns };
}

/**
 * Builds the replacement string for a wildcard expansion.
 *
 * Each column is placed on its own line.  The first column sits on the same
 * line as the original `*`; all subsequent columns are indented to the same
 * column position using `startColumn - 1` spaces so they visually align:
 *
 *   SELECT o.Id,        ← startColumn = 8, `o.Id` replaces `*` (which was at col 8)
 *          o.Name,      ← 7 spaces prefix
 *          o.Total
 *
 * @param startColumn  1-based column of the first character being replaced (the
 *                     `*` itself for bare wildcard, or the alias char for `t.*`).
 *                     Defaults to 1 (no indentation).
 */
export function buildColumnExpansion(
  segments: WildcardResolutionSegment[],
  startColumn: number = 1
): string {
  // Flatten all segments into a single ordered list of qualified names
  const names: string[] = [];
  for (const { columns, alias } of segments) {
    for (const c of columns) {
      names.push(alias ? `${alias}.${c.name}` : c.name);
    }
  }

  if (names.length === 0) return '*';
  if (names.length === 1) return names[0];

  const indent = ' '.repeat(Math.max(0, startColumn - 1));
  return names
    .map((name, i) => {
      const prefix = i === 0 ? '' : indent;
      const suffix = i < names.length - 1 ? ',' : '';
      return prefix + name + suffix;
    })
    .join('\n');
}

/**
 * Scans a single source line for wildcard candidates suitable for CodeLens.
 * Strips inline comments before scanning to avoid false-positives.
 */
export function findWildcardCandidatesInLine(
  line: string,
  lineNumber: number
): WildcardCandidate[] {
  const results: WildcardCandidate[] = [];
  // Remove inline comment tail so we don't match `*` inside `-- SELECT *`
  const scanLine = line.replace(/--.*$/, '');

  // Track positions of `*` that are part of alias.* so we skip them for bare-star scan
  const aliasDotStarPositions = new Set<number>();

  // 1. alias.* patterns
  const aliasDotStarRe = /(\w+)\.\*/g;
  let m: RegExpExecArray | null;
  while ((m = aliasDotStarRe.exec(scanLine)) !== null) {
    const alias = m[1];
    if (SQL_KEYWORDS.has(alias.toUpperCase())) continue;
    const starIndex = m.index + m[0].length - 1; // 0-based position of `*`
    aliasDotStarPositions.add(starIndex);
    const colAfterStar = starIndex + 2; // 1-based column AFTER `*`
    results.push({
      alias,
      column: colAfterStar,
      wildcardRange: {
        startLineNumber: lineNumber,
        startColumn: m.index + 1, // 1-based start of alias
        endLineNumber: lineNumber,
        endColumn: colAfterStar,
      },
    });
  }

  // 2. Bare `*` — not part of an alias.* and not arithmetic (surrounded by operands)
  const bareStarRe = /\*/g;
  while ((m = bareStarRe.exec(scanLine)) !== null) {
    const idx = m.index;
    if (aliasDotStarPositions.has(idx)) continue; // Already covered by alias.* scan

    // Heuristic: skip when immediately preceded by a word char, `)` or `]`
    // (handles `val*2`, `func()*n` with no spaces)
    if (idx > 0 && /[\w\)\]]/.test(scanLine[idx - 1])) continue;

    // Skip `*` immediately preceded by `(` — this is a function argument wildcard
    // like COUNT(*), SUM(*), etc., which cannot be expanded to columns.
    if (idx > 0 && scanLine[idx - 1] === '(') continue;

    // Skip when the non-whitespace char after `*` is a digit — handles `2 * 3`.
    // We intentionally do NOT check the char before `*` because patterns like
    // `SELECT TOP 100 *` end with a digit before the star and are valid wildcards.
    const afterTrimmed = scanLine.substring(idx + 1).trimStart();
    if (afterTrimmed.length > 0 && /\d/.test(afterTrimmed[0])) continue;

    const colAfterStar = idx + 2; // 1-based column AFTER `*`
    results.push({
      alias: null,
      column: colAfterStar,
      wildcardRange: {
        startLineNumber: lineNumber,
        startColumn: idx + 1,
        endLineNumber: lineNumber,
        endColumn: colAfterStar,
      },
    });
  }

  return results;
}
