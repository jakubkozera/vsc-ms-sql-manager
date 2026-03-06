/**
 * SQL Rename Service
 * Provides rename functionality for CTE names and table aliases in SQL queries.
 */

import { extractCTEs } from './sqlValidator';

export interface SqlRenameLocation {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  text: string;
}

export interface SqlRenameEdit {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  newText: string;
}

/**
 * Find the word at a given position in the text.
 * Handles both plain identifiers and bracketed identifiers [name].
 */
function getWordAtPosition(
  text: string,
  lineNumber: number,
  column: number
): { word: string; startColumn: number; endColumn: number } | null {
  const lines = text.split('\n');
  if (lineNumber < 1 || lineNumber > lines.length) return null;
  const line = lines[lineNumber - 1];

  const col = column - 1; // 0-based
  if (col < 0 || col >= line.length) return null;

  // Check if inside bracketed identifier [name]
  if (line[col] !== '[' && line[col] !== ']') {
    // Look for surrounding brackets
    let bracketStart = -1;
    for (let i = col; i >= 0; i--) {
      if (line[i] === '[') { bracketStart = i; break; }
      if (line[i] === ']') break;
    }
    if (bracketStart >= 0) {
      const bracketEnd = line.indexOf(']', bracketStart + 1);
      if (bracketEnd > col) {
        const word = line.substring(bracketStart + 1, bracketEnd);
        return { word, startColumn: bracketStart + 2, endColumn: bracketEnd + 1 };
      }
    }
  }

  // Regular word
  if (!/[a-zA-Z0-9_]/.test(line[col])) return null;

  let start = col;
  let end = col;
  while (start > 0 && /[a-zA-Z0-9_]/.test(line[start - 1])) start--;
  while (end < line.length - 1 && /[a-zA-Z0-9_]/.test(line[end + 1])) end++;

  const word = line.substring(start, end + 1);
  if (!/^[a-zA-Z_]/.test(word)) return null;

  return { word, startColumn: start + 1, endColumn: end + 2 };
}

/**
 * Check if a position in the text is inside a string literal or comment.
 */
function isInsideStringOrComment(text: string, offset: number): boolean {
  let inSingleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < offset && i < text.length; i++) {
    if (inLineComment) {
      if (text[i] === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (text[i] === '*' && text[i + 1] === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingleQuote) {
      if (text[i] === "'") {
        if (text[i + 1] === "'") { i++; continue; }
        inSingleQuote = false;
      }
      continue;
    }

    if (text[i] === "'") {
      inSingleQuote = true;
    } else if (text[i] === '-' && text[i + 1] === '-') {
      inLineComment = true;
      i++;
    } else if (text[i] === '/' && text[i + 1] === '*') {
      inBlockComment = true;
      i++;
    }
  }

  return inSingleQuote || inLineComment || inBlockComment;
}

/**
 * Find all occurrences of an identifier in SQL text, respecting
 * word boundaries and excluding string literals and comments.
 * Handles both bare identifiers and bracketed [identifier].
 */
function findAllOccurrences(
  text: string,
  identifier: string
): { startOffset: number; endOffset: number; isBracketed: boolean }[] {
  const results: { startOffset: number; endOffset: number; isBracketed: boolean }[] = [];

  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\[${escaped}\\]|\\b${escaped}\\b`, 'gi');

  let match;
  while ((match = regex.exec(text)) !== null) {
    if (isInsideStringOrComment(text, match.index)) continue;

    const isBracketed = match[0].startsWith('[');
    const startOffset = isBracketed ? match.index + 1 : match.index;
    const endOffset = isBracketed ? match.index + match[0].length - 1 : match.index + match[0].length;

    results.push({ startOffset, endOffset, isBracketed });
  }

  return results;
}

/**
 * Convert text offset to line/column position.
 */
function offsetToPosition(text: string, offset: number): { lineNumber: number; column: number } {
  const before = text.substring(0, offset);
  const lines = before.split('\n');
  return {
    lineNumber: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

/**
 * Check if a word is used as a table alias in the SQL — appears before a dot
 * or is assigned as an alias in FROM/JOIN clauses.
 */
function isTableAlias(sql: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Check if word appears as prefix.column pattern
  const prefixRegex = new RegExp(`(?:\\b${escaped}|\\[${escaped}\\])\\s*\\.\\s*(?:\\[|[a-zA-Z_])`, 'i');
  if (prefixRegex.test(sql)) return true;

  // Check if word appears after a table name in FROM/JOIN as an alias
  const aliasRegex = new RegExp(
    `\\b(?:from|join)\\s+(?:\\[?[a-zA-Z_]\\w*\\]?(?:\\s*\\.\\s*\\[?[a-zA-Z_]\\w*\\]?)?)\\s+(?:as\\s+)?(?:\\b${escaped}\\b|\\[${escaped}\\])(?=\\s|$|\\)|,)`,
    'i'
  );
  if (aliasRegex.test(sql)) return true;

  return false;
}

/**
 * Resolve rename location — determines if the word at the cursor can be renamed.
 * Returns the current range and text if renameable, null otherwise.
 */
export function resolveRenameLocation(
  sql: string,
  lineNumber: number,
  column: number
): SqlRenameLocation | null {
  const wordInfo = getWordAtPosition(sql, lineNumber, column);
  if (!wordInfo) return null;

  const word = wordInfo.word;

  // Skip SQL keywords
  if (/^(select|from|where|join|inner|left|right|full|cross|outer|on|and|or|not|in|is|null|as|with|set|insert|update|delete|into|values|order|group|by|having|union|all|distinct|top|case|when|then|else|end|exists|between|like|asc|desc|begin|commit|rollback|declare|exec|execute|create|alter|drop|table|view|procedure|function|index|trigger|go)$/i.test(word)) {
    return null;
  }

  // Check if it's a CTE name
  const ctes = extractCTEs(sql);
  if (ctes.has(word.toLowerCase())) {
    return {
      range: {
        startLineNumber: lineNumber,
        startColumn: wordInfo.startColumn,
        endLineNumber: lineNumber,
        endColumn: wordInfo.endColumn,
      },
      text: word,
    };
  }

  // Check if it's a table alias
  if (isTableAlias(sql, word)) {
    return {
      range: {
        startLineNumber: lineNumber,
        startColumn: wordInfo.startColumn,
        endLineNumber: lineNumber,
        endColumn: wordInfo.endColumn,
      },
      text: word,
    };
  }

  return null;
}

/**
 * Provide rename edits for all occurrences of the CTE name or alias at the cursor position.
 */
export function provideRenameEdits(
  sql: string,
  lineNumber: number,
  column: number,
  newName: string
): SqlRenameEdit[] {
  const location = resolveRenameLocation(sql, lineNumber, column);
  if (!location) return [];

  const word = location.text;
  const occurrences = findAllOccurrences(sql, word);

  return occurrences.map(occ => {
    const start = offsetToPosition(sql, occ.startOffset);
    const end = offsetToPosition(sql, occ.endOffset);
    return {
      range: {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      },
      newText: newName,
    };
  });
}
