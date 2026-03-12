/**
 * SQL Rename Service
 * Provides rename functionality for CTE names, table aliases, and SQL variables in SQL queries.
 */

import { extractCTEs, splitSqlStatements } from './sqlValidator';

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

export interface SqlDefinitionLocation {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

/**
 * Find the word at a given position in the text.
 * Handles plain identifiers, bracketed identifiers [name], and @variables.
 * Also works when cursor is one position past the end of the word.
 */
function getWordAtPosition(
  text: string,
  lineNumber: number,
  column: number
): { word: string; startColumn: number; endColumn: number } | null {
  const lines = text.split('\n');
  if (lineNumber < 1 || lineNumber > lines.length) return null;
  const line = lines[lineNumber - 1];

  let col = column - 1; // 0-based

  // If col is at end of line or on a non-identifier char, try one position back
  // This handles cursor-after-last-character case
  if ((col >= line.length || !/[a-zA-Z0-9_@\[]/.test(line[col])) && col > 0 && /[a-zA-Z0-9_\]]/.test(line[col - 1])) {
    col = col - 1;
  }

  if (col < 0 || col >= line.length) return null;

  // Check if inside or adjacent to bracketed identifier [name]
  if (line[col] === ']') {
    // Find opening bracket
    let bracketStart = -1;
    for (let i = col - 1; i >= 0; i--) {
      if (line[i] === '[') { bracketStart = i; break; }
    }
    if (bracketStart >= 0) {
      const word = line.substring(bracketStart + 1, col);
      return { word, startColumn: bracketStart + 2, endColumn: col + 1 };
    }
  }

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

  // Check for @variable or @@system variable
  if (line[col] === '@' || (col > 0 && line[col - 1] === '@' && /[a-zA-Z_]/.test(line[col]))) {
    // Find the start of @/@@ prefix
    let start = col;
    if (line[start] !== '@') {
      while (start > 0 && /[a-zA-Z0-9_]/.test(line[start - 1])) start--;
      if (start > 0 && line[start - 1] === '@') start--;
    }
    if (line[start] === '@') {
      // Check for @@system variable — skip one more @ if present
      if (start > 0 && line[start - 1] === '@') return null; // @@var — not renameable
      // Check if next char is also @ (cursor on first @ of @@var)
      if (start + 1 < line.length && line[start + 1] === '@') return null;
      let end = start + 1;
      while (end < line.length && /[a-zA-Z0-9_]/.test(line[end])) end++;
      const word = line.substring(start, end); // includes @
      if (word.length <= 1) return null; // just "@" — invalid
      return { word, startColumn: start + 1, endColumn: end + 1 };
    }
  }

  // Regular word (or @variable if cursor is on any part)
  if (/[a-zA-Z0-9_]/.test(line[col])) {
    let start = col;
    let end = col;
    while (start > 0 && /[a-zA-Z0-9_]/.test(line[start - 1])) start--;
    while (end < line.length - 1 && /[a-zA-Z0-9_]/.test(line[end + 1])) end++;
    // Check if preceded by @
    if (start > 0 && line[start - 1] === '@') {
      // Reject @@system variables
      if (start > 1 && line[start - 2] === '@') return null;
      start--;
      const word = line.substring(start, end + 1);
      return { word, startColumn: start + 1, endColumn: end + 2 };
    }
    const word = line.substring(start, end + 1);
    if (!/^[a-zA-Z_]/.test(word)) return null;
    return { word, startColumn: start + 1, endColumn: end + 2 };
  }

  return null;
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
 * Handles bare identifiers, bracketed [identifier], and @variables.
 */
function findAllOccurrences(
  text: string,
  identifier: string
): { startOffset: number; endOffset: number; isBracketed: boolean }[] {
  const results: { startOffset: number; endOffset: number; isBracketed: boolean }[] = [];

  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let regex: RegExp;
  if (identifier.startsWith('@')) {
    // For @variables, match exactly (they start with @ so no word boundary before)
    regex = new RegExp(`${escaped}\\b`, 'gi');
  } else {
    regex = new RegExp(`\\[${escaped}\\]|\\b${escaped}\\b`, 'gi');
  }

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

function offsetsToRange(text: string, startOffset: number, endOffset: number): SqlDefinitionLocation['range'] {
  const start = offsetToPosition(text, startOffset);
  const end = offsetToPosition(text, endOffset);
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  };
}

function positionToOffset(text: string, lineNumber: number, column: number): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  return offset + Math.max(column - 1, 0);
}

function getStatementAtPosition(
  sql: string,
  lineNumber: number,
  column: number
): { text: string; startOffset: number; endOffset: number } | null {
  const offset = positionToOffset(sql, lineNumber, column);
  const statements = splitSqlStatements(sql);

  for (const statement of statements) {
    if (offset >= statement.startOffset && offset <= statement.endOffset) {
      return statement;
    }
  }

  return null;
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
 * Check if a word is a SQL variable (starts with @, not a system @@variable).
 */
function isSqlVariable(sql: string, word: string): boolean {
  if (!word.startsWith('@') || word.startsWith('@@')) return false;
  // Verify it appears somewhere in the SQL
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped + '\\b', 'i').test(sql);
}

function findVariableDefinitionRange(sql: string, variableName: string): SqlDefinitionLocation['range'] | null {
  const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declarationRegex = new RegExp(`\\bdeclare\\b[\\s\\S]*?${escaped}\\b`, 'gi');
  let declarationMatch: RegExpExecArray | null;

  while ((declarationMatch = declarationRegex.exec(sql)) !== null) {
    const relativeIndex = declarationMatch[0].toLowerCase().indexOf(variableName.toLowerCase());
    if (relativeIndex === -1) continue;

    const startOffset = declarationMatch.index + relativeIndex;
    const endOffset = startOffset + variableName.length;
    return offsetsToRange(sql, startOffset, endOffset);
  }

  const occurrences = findAllOccurrences(sql, variableName);
  if (occurrences.length === 0) {
    return null;
  }

  return offsetsToRange(sql, occurrences[0].startOffset, occurrences[0].endOffset);
}

function findCteDefinitionRange(
  statementText: string,
  statementStartOffset: number,
  cteName: string,
  fullText: string
): SqlDefinitionLocation['range'] | null {
  const escaped = cteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:\\bWITH\\s+|,\\s*)(\\[${escaped}\\]|${escaped})\\s+AS\\s*\\(`, 'gi');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(statementText)) !== null) {
    if (isInsideStringOrComment(statementText, match.index)) {
      continue;
    }

    const token = match[1];
    const tokenStart = match.index + match[0].indexOf(token);
    const isBracketed = token.startsWith('[') && token.endsWith(']');
    const startOffset = statementStartOffset + tokenStart + (isBracketed ? 1 : 0);
    const endOffset = startOffset + cteName.length;
    return offsetsToRange(fullText, startOffset, endOffset);
  }

  return null;
}

function mapOccurrencesToEdits(
  fullText: string,
  baseOffset: number,
  occurrences: { startOffset: number; endOffset: number }[],
  newText: string
): SqlRenameEdit[] {
  return occurrences.map(occ => {
    const start = offsetToPosition(fullText, baseOffset + occ.startOffset);
    const end = offsetToPosition(fullText, baseOffset + occ.endOffset);
    return {
      range: {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      },
      newText,
    };
  });
}

export function provideDefinitionLocation(
  sql: string,
  lineNumber: number,
  column: number
): SqlDefinitionLocation | null {
  const wordInfo = getWordAtPosition(sql, lineNumber, column);
  if (!wordInfo) return null;

  if (isSqlVariable(sql, wordInfo.word)) {
    const range = findVariableDefinitionRange(sql, wordInfo.word);
    return range ? { range } : null;
  }

  const statement = getStatementAtPosition(sql, lineNumber, column);
  if (!statement) return null;

  const ctes = extractCTEs(statement.text);
  if (!ctes.has(wordInfo.word.toLowerCase())) {
    return null;
  }

  const range = findCteDefinitionRange(statement.text, statement.startOffset, wordInfo.word, sql);
  return range ? { range } : null;
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

  // Skip SQL keywords (but not @variables)
  if (!word.startsWith('@') && /^(select|from|where|join|inner|left|right|full|cross|outer|on|and|or|not|in|is|null|as|with|set|insert|update|delete|into|values|order|group|by|having|union|all|distinct|top|case|when|then|else|end|exists|between|like|asc|desc|begin|commit|rollback|declare|exec|execute|create|alter|drop|table|view|procedure|function|index|trigger|go)$/i.test(word)) {
    return null;
  }

  const makeResult = () => ({
    range: {
      startLineNumber: lineNumber,
      startColumn: wordInfo.startColumn,
      endLineNumber: lineNumber,
      endColumn: wordInfo.endColumn,
    },
    text: word,
  });

  // Check if it's a SQL variable — show name without @ in rename popup
  if (isSqlVariable(sql, word)) {
    return {
      range: {
        startLineNumber: lineNumber,
        startColumn: wordInfo.startColumn + 1, // skip the @ prefix
        endLineNumber: lineNumber,
        endColumn: wordInfo.endColumn,
      },
      text: word.substring(1), // display without @
    };
  }

  // Check if it's a CTE name in the current statement
  const statement = getStatementAtPosition(sql, lineNumber, column);
  const ctes = statement ? extractCTEs(statement.text) : new Set<string>();
  if (ctes.has(word.toLowerCase())) {
    return makeResult();
  }

  // Check if it's a table alias
  if (isTableAlias(sql, word)) {
    return makeResult();
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
  const wordInfo = getWordAtPosition(sql, lineNumber, column);
  if (!wordInfo) return [];

  const word = wordInfo.word;

  // Validate: skip keywords, require CTE/alias/variable
  if (!word.startsWith('@') && /^(select|from|where|join|inner|left|right|full|cross|outer|on|and|or|not|in|is|null|as|with|set|insert|update|delete|into|values|order|group|by|having|union|all|distinct|top|case|when|then|else|end|exists|between|like|asc|desc|begin|commit|rollback|declare|exec|execute|create|alter|drop|table|view|procedure|function|index|trigger|go)$/i.test(word)) {
    return [];
  }

  const isVariable = isSqlVariable(sql, word);
  if (!isVariable) {
    const statement = getStatementAtPosition(sql, lineNumber, column);
    const statementText = statement?.text ?? sql;
    const statementOffset = statement?.startOffset ?? 0;
    const ctes = extractCTEs(statementText);
    const isCte = ctes.has(word.toLowerCase());
    const isAlias = isTableAlias(statementText, word);
    if (!isCte && !isAlias) return [];

    const occurrences = findAllOccurrences(statementText, word);
    return mapOccurrencesToEdits(sql, statementOffset, occurrences, newName);
  }

  // For @variables, user typed name without @, so prepend it
  const effectiveNewName = isVariable ? '@' + newName.replace(/^@/, '') : newName;
  const occurrences = findAllOccurrences(sql, word);

  return mapOccurrencesToEdits(sql, 0, occurrences, effectiveNewName);
}
