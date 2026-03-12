import { describe, it, expect } from 'vitest';
import {
  findWildcardAtPosition,
  resolveWildcard,
  buildColumnExpansion,
  findWildcardCandidatesInLine,
} from './sqlWildcardService';
import type { DatabaseSchema, ColumnInfo } from '../types/schema';

// ── Test schema ───────────────────────────────────────────────────────────────

const mockSchema: DatabaseSchema = {
  tables: [
    {
      schema: 'dbo',
      name: 'Orders',
      columns: [
        { name: 'Id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'CustomerId', type: 'int', nullable: false },
        { name: 'Total', type: 'decimal', nullable: true },
      ],
    },
    {
      schema: 'dbo',
      name: 'Customers',
      columns: [
        { name: 'Id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'Name', type: 'nvarchar', nullable: true },
      ],
    },
  ],
  views: [],
  foreignKeys: [],
};

// ── Monaco model stub ─────────────────────────────────────────────────────────

function makeModel(sql: string) {
  const lines = sql.split('\n');
  return {
    getValue: () => sql,
    getValueInRange(range: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    }): string {
      if (range.startLineNumber !== range.endLineNumber) return '';
      const line = lines[range.startLineNumber - 1] ?? '';
      return line.substring(range.startColumn - 1, range.endColumn - 1);
    },
  };
}

// ── findWildcardAtPosition ────────────────────────────────────────────────────

describe('findWildcardAtPosition', () => {
  it('returns null when cursor is not after *', () => {
    const model = makeModel('SELECT col FROM t');
    expect(findWildcardAtPosition(model, { lineNumber: 1, column: 8 })).toBeNull();
  });

  it('detects bare * immediately after the asterisk', () => {
    // "SELECT *" → * is at col 8, cursor at col 9 (after *)
    const model = makeModel('SELECT *');
    const result = findWildcardAtPosition(model, { lineNumber: 1, column: 9 });
    expect(result).not.toBeNull();
    expect(result!.alias).toBeNull();
    expect(result!.wildcardRange).toEqual({
      startLineNumber: 1,
      startColumn: 8,
      endLineNumber: 1,
      endColumn: 9,
    });
  });

  it('detects alias.* pattern', () => {
    // "SELECT o.*" → alias='o', * at col 10, cursor at col 11
    const model = makeModel('SELECT o.*');
    const result = findWildcardAtPosition(model, { lineNumber: 1, column: 11 });
    expect(result).not.toBeNull();
    expect(result!.alias).toBe('o');
    // range covers "o.*"
    expect(result!.wildcardRange.startColumn).toBe(8); // 'o' starts at col 8
    expect(result!.wildcardRange.endColumn).toBe(11);
  });

  it('handles cursor on a line other than line 1', () => {
    const model = makeModel('SELECT\n    t.*\nFROM dbo.Orders t');
    // line 2: "    t.*"  → 't' at col 5, '*' at col 7, cursor at col 8
    const result = findWildcardAtPosition(model, { lineNumber: 2, column: 8 });
    expect(result).not.toBeNull();
    expect(result!.alias).toBe('t');
    expect(result!.wildcardRange.startLineNumber).toBe(2);
  });

  it('returns null when column < 2', () => {
    const model = makeModel('*');
    expect(findWildcardAtPosition(model, { lineNumber: 1, column: 1 })).toBeNull();
  });

  it('ignores SQL keywords before dot (e.g. FROM.*)', () => {
    const model = makeModel('FROM.*');
    const result = findWildcardAtPosition(model, { lineNumber: 1, column: 7 });
    // FROM is a SQL keyword — alias should be null (bare star path)
    expect(result).not.toBeNull();
    expect(result!.alias).toBeNull();
  });
});

// ── resolveWildcard ───────────────────────────────────────────────────────────

describe('resolveWildcard', () => {
  it('resolves bare * without explicit alias — one segment, no alias prefix', () => {
    const sql = 'SELECT *\nFROM dbo.Orders';
    const wildcardInfo = {
      alias: null,
      wildcardRange: { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 9 },
    };
    const result = resolveWildcard(sql, wildcardInfo, mockSchema);
    expect(result).not.toBeNull();
    expect(result!.segments).toHaveLength(1);
    expect(result!.segments[0].alias).toBeNull();
    expect(result!.totalColumns).toBe(3);
  });

  it('resolves bare * and picks up explicit table alias', () => {
    const sql = 'SELECT *\nFROM dbo.Orders o';
    const wildcardInfo = {
      alias: null,
      wildcardRange: { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 9 },
    };
    const result = resolveWildcard(sql, wildcardInfo, mockSchema);
    expect(result).not.toBeNull();
    expect(result!.segments[0].alias).toBe('o');
    expect(result!.segments[0].columns.map((c) => c.name)).toEqual(['Id', 'CustomerId', 'Total']);
  });

  it('resolves alias.* pattern — single segment with correct alias', () => {
    const sql = 'SELECT c.*\nFROM dbo.Customers c';
    const wildcardInfo = {
      alias: 'c',
      wildcardRange: { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 11 },
    };
    const result = resolveWildcard(sql, wildcardInfo, mockSchema);
    expect(result).not.toBeNull();
    expect(result!.segments).toHaveLength(1);
    expect(result!.segments[0].alias).toBe('c');
    expect(result!.segments[0].columns.map((c) => c.name)).toEqual(['Id', 'Name']);
    expect(result!.totalColumns).toBe(2);
  });

  it('resolves bare * across FROM + JOIN — returns one segment per table', () => {
    const sql =
      'SELECT *\n' +
      'FROM dbo.Orders o\n' +
      'JOIN dbo.Customers c ON o.CustomerId = c.Id';
    const wildcardInfo = {
      alias: null,
      wildcardRange: { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 9 },
    };
    const result = resolveWildcard(sql, wildcardInfo, mockSchema);
    expect(result).not.toBeNull();
    expect(result!.segments).toHaveLength(2);
    expect(result!.segments[0].alias).toBe('o');
    expect(result!.segments[0].columns.map((c) => c.name)).toEqual(['Id', 'CustomerId', 'Total']);
    expect(result!.segments[1].alias).toBe('c');
    expect(result!.segments[1].columns.map((c) => c.name)).toEqual(['Id', 'Name']);
    expect(result!.totalColumns).toBe(5);
  });

  it('resolves bare * across FROM + JOIN with bracketed identifiers', () => {
    // Mirrors the real-world case: SELECT TOP 100 * FROM [dbo].[Orders] [o] JOIN [dbo].[Customers] [c]
    const sql =
      'SELECT TOP 100 *\n' +
      'FROM [dbo].[Orders] [o]\n' +
      'JOIN [dbo].[Customers] [c] ON [o].[CustomerId] = [c].[Id]';
    const wildcardInfo = {
      alias: null,
      wildcardRange: { startLineNumber: 1, startColumn: 16, endLineNumber: 1, endColumn: 17 },
    };
    const result = resolveWildcard(sql, wildcardInfo, mockSchema);
    expect(result).not.toBeNull();
    expect(result!.segments).toHaveLength(2);
    expect(result!.segments[0].alias).toBe('o');
    expect(result!.segments[1].alias).toBe('c');
    expect(result!.totalColumns).toBe(5);
  });

  it('returns null when table is not in schema', () => {
    const sql = 'SELECT *\nFROM dbo.Unknown';
    const wildcardInfo = {
      alias: null,
      wildcardRange: { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 9 },
    };
    expect(resolveWildcard(sql, wildcardInfo, mockSchema)).toBeNull();
  });

  it('returns null when alias is not found in FROM clause', () => {
    const sql = 'SELECT x.*\nFROM dbo.Orders o';
    const wildcardInfo = {
      alias: 'x',
      wildcardRange: { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 11 },
    };
    expect(resolveWildcard(sql, wildcardInfo, mockSchema)).toBeNull();
  });
});

// ── buildColumnExpansion ──────────────────────────────────────────────────────

describe('buildColumnExpansion', () => {
  const cols3: ColumnInfo[] = [
    { name: 'Id', type: 'int', nullable: false },
    { name: 'Name', type: 'nvarchar', nullable: true },
    { name: 'Email', type: 'nvarchar', nullable: true },
  ];

  it('single column — no trailing comma, no newline', () => {
    expect(buildColumnExpansion([{ columns: [cols3[0]], alias: null }], 8)).toBe('Id');
  });

  it('multiple columns without alias — per-row separated', () => {
    expect(buildColumnExpansion([{ columns: cols3, alias: null }], 1)).toBe('Id,\nName,\nEmail');
  });

  it('multiple columns with alias — prefixes each column name', () => {
    expect(buildColumnExpansion([{ columns: cols3, alias: 'o' }], 1)).toBe('o.Id,\no.Name,\no.Email');
  });

  it('indents subsequent rows to startColumn position', () => {
    // startColumn = 8 → 7 spaces before lines 2+
    const result = buildColumnExpansion([{ columns: cols3, alias: null }], 8);
    const lines = result.split('\n');
    expect(lines[0]).toBe('Id,');
    expect(lines[1]).toBe('       Name,'); // 7 spaces
    expect(lines[2]).toBe('       Email'); // 7 spaces, no comma
  });

  it('indents subsequent rows with alias', () => {
    const result = buildColumnExpansion([{ columns: cols3, alias: 'o' }], 8);
    const lines = result.split('\n');
    expect(lines[0]).toBe('o.Id,');
    expect(lines[1]).toBe('       o.Name,');
    expect(lines[2]).toBe('       o.Email');
  });

  it('last column has no trailing comma', () => {
    const result = buildColumnExpansion([{ columns: cols3, alias: 'o' }], 1);
    expect(result.endsWith('o.Email')).toBe(true);
    expect(result).not.toMatch(/,\s*$/);
  });

  it('returns fallback * when all segments are empty', () => {
    expect(buildColumnExpansion([], 1)).toBe('*');
    expect(buildColumnExpansion([{ columns: [], alias: 'o' }], 1)).toBe('*');
  });

  it('startColumn defaults to 1 (no indentation)', () => {
    expect(buildColumnExpansion([{ columns: cols3, alias: null }])).toBe('Id,\nName,\nEmail');
  });

  it('multi-table JOIN — flattens all segments with their respective aliases', () => {
    const ordersColumns = mockSchema.tables[0].columns; // Id, CustomerId, Total
    const customersColumns = mockSchema.tables[1].columns; // Id, Name
    const result = buildColumnExpansion(
      [
        { columns: ordersColumns, alias: 'o' },
        { columns: customersColumns, alias: 'c' },
      ],
      16 // startColumn=16 → 15 spaces indent
    );
    const lines = result.split('\n');
    expect(lines[0]).toBe('o.Id,');
    expect(lines[1]).toBe('               o.CustomerId,');
    expect(lines[2]).toBe('               o.Total,');
    expect(lines[3]).toBe('               c.Id,');
    expect(lines[4]).toBe('               c.Name');
    expect(lines[lines.length - 1]).not.toMatch(/,$/);
  });

  it('real-world: SELECT * FROM Orders o — per-row with alias', () => {
    const columns = mockSchema.tables[0].columns; // Id, CustomerId, Total
    const result = buildColumnExpansion([{ columns, alias: 'o' }], 8);
    expect(result).toBe('o.Id,\n       o.CustomerId,\n       o.Total');
  });
});

// ── findWildcardCandidatesInLine ──────────────────────────────────────────────

describe('findWildcardCandidatesInLine', () => {
  it('finds bare * in SELECT line', () => {
    const candidates = findWildcardCandidatesInLine('SELECT *', 1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].alias).toBeNull();
    expect(candidates[0].wildcardRange.startColumn).toBe(8);
    expect(candidates[0].wildcardRange.endColumn).toBe(9);
  });

  it('finds bare * in SELECT TOP N * (SELECT TOP 100 *)', () => {
    // This must NOT be filtered as arithmetic — 100 precedes * but it is not an expression
    const candidates = findWildcardCandidatesInLine('SELECT TOP 100 *', 1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].alias).toBeNull();
  });

  it('finds alias.* candidate', () => {
    const candidates = findWildcardCandidatesInLine('SELECT o.*', 1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].alias).toBe('o');
  });

  it('finds multiple alias wildcards on a single line', () => {
    const candidates = findWildcardCandidatesInLine('SELECT o.*, c.*', 1);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].alias).toBe('o');
    expect(candidates[1].alias).toBe('c');
  });

  it('ignores star inside inline comment', () => {
    const candidates = findWildcardCandidatesInLine('SELECT col -- SELECT *', 1);
    expect(candidates).toHaveLength(0);
  });

  it('ignores arithmetic: digit immediately before * (no space)', () => {
    // "2*3" — * follows digit with no space
    const candidates = findWildcardCandidatesInLine('SELECT 2*3', 1);
    expect(candidates).toHaveLength(0);
  });

  it('ignores arithmetic: digit after * (space-padded)', () => {
    // "2 * 3" — digit after *
    const candidates = findWildcardCandidatesInLine('SELECT 2 * 3', 1);
    expect(candidates).toHaveLength(0);
  });

  it('ignores SQL keywords before .* (e.g. FROM.*)', () => {
    const candidates = findWildcardCandidatesInLine('FROM.*', 1);
    const aliasCandidates = candidates.filter((c) => c.alias !== null);
    expect(aliasCandidates).toHaveLength(0);
  });

  it('returns empty array for line with no wildcards', () => {
    expect(findWildcardCandidatesInLine('SELECT col1, col2 FROM tbl', 1)).toHaveLength(0);
  });

  it('records correct lineNumber in wildcardRange', () => {
    const candidates = findWildcardCandidatesInLine('    SELECT *', 5);
    expect(candidates[0].wildcardRange.startLineNumber).toBe(5);
    expect(candidates[0].wildcardRange.endLineNumber).toBe(5);
  });

  // ── COUNT(*) / function-argument wildcard suppression ─────────────────────

  it('does NOT return a candidate for COUNT(*)', () => {
    const candidates = findWildcardCandidatesInLine('SELECT COUNT(*) FROM Orders', 1);
    expect(candidates).toHaveLength(0);
  });

  it('does NOT return a candidate for SUM(*)', () => {
    const candidates = findWildcardCandidatesInLine('SELECT SUM(*) FROM t', 1);
    expect(candidates).toHaveLength(0);
  });

  it('does NOT return a candidate for func(*) in complex query', () => {
    const line = 'SELECT COUNT(*), MAX(Price) FROM Products';
    const candidates = findWildcardCandidatesInLine(line, 1);
    expect(candidates).toHaveLength(0);
  });

  it('still returns candidate for bare * alongside COUNT(*)', () => {
    // "SELECT *, COUNT(*)" — bare * is an expandable wildcard; COUNT(*) is not
    const candidates = findWildcardCandidatesInLine('SELECT *, COUNT(*) FROM Orders', 1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].alias).toBeNull();
    // bare * is at column 8 (1-based), so startColumn=8
    expect(candidates[0].wildcardRange.startColumn).toBe(8);
  });
});

// ── findWildcardAtPosition — COUNT(*) suppression ────────────────────────────

describe('findWildcardAtPosition — COUNT(*) suppression', () => {
  it('returns null when cursor is immediately after * preceded by (', () => {
    // COUNT(*) — cursor at column 14 (after *)
    // "SELECT COUNT(*)" 
    //  1234567890123456
    //  cursor at 14: char before = '*', char before that = '('
    const model = makeModel('SELECT COUNT(*)');
    // column 14 = cursor right after *
    const result = findWildcardAtPosition(model, { lineNumber: 1, column: 15 });
    expect(result).toBeNull();
  });

  it('returns null for any (*)  pattern', () => {
    const model = makeModel('SUM(*)');
    // * is at column 5, cursor at column 6
    const result = findWildcardAtPosition(model, { lineNumber: 1, column: 6 });
    expect(result).toBeNull();
  });

  it('still returns non-null for bare * not preceded by (', () => {
    // "SELECT *" — cursor at col 9
    const model = makeModel('SELECT *');
    const result = findWildcardAtPosition(model, { lineNumber: 1, column: 9 });
    expect(result).not.toBeNull();
  });
});
