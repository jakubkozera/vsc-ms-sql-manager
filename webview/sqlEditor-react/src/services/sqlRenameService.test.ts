import { describe, it, expect } from 'vitest';
import { resolveRenameLocation, provideRenameEdits, provideDefinitionLocation } from './sqlRenameService';

describe('sqlRenameService', () => {
  describe('resolveRenameLocation', () => {
    it('should resolve CTE name at definition', () => {
      const sql = 'WITH MyCTE AS (SELECT Id FROM dbo.Users) SELECT * FROM MyCTE';
      // cursor on "MyCTE" in the WITH clause
      const result = resolveRenameLocation(sql, 1, 7); // "M" of MyCTE
      expect(result).not.toBeNull();
      expect(result!.text).toBe('MyCTE');
    });

    it('should resolve CTE name at reference', () => {
      const sql = 'WITH MyCTE AS (SELECT Id FROM dbo.Users) SELECT * FROM MyCTE';
      // cursor on "MyCTE" in FROM clause
      const result = resolveRenameLocation(sql, 1, 57); // "M" of MyCTE in FROM
      expect(result).not.toBeNull();
      expect(result!.text).toBe('MyCTE');
    });

    it('should resolve table alias used as prefix', () => {
      const sql = 'SELECT u.Id FROM Users u';
      const result = resolveRenameLocation(sql, 1, 8); // "u" before .Id
      expect(result).not.toBeNull();
      expect(result!.text).toBe('u');
    });

    it('should resolve table alias at definition', () => {
      const sql = 'SELECT u.Id FROM Users u';
      const result = resolveRenameLocation(sql, 1, 24); // "u" after Users
      expect(result).not.toBeNull();
      expect(result!.text).toBe('u');
    });

    it('should reject SQL keywords', () => {
      const sql = 'SELECT u.Id FROM Users u';
      const result = resolveRenameLocation(sql, 1, 1); // "S" of SELECT
      expect(result).toBeNull();
    });

    it('should resolve word before dot when cursor is on dot', () => {
      const sql = 'SELECT u.Id FROM Users u';
      const result = resolveRenameLocation(sql, 1, 9); // "." dot — resolves to 'u' before the dot
      expect(result).not.toBeNull();
      expect(result!.text).toBe('u');
    });

    it('should resolve bracketed CTE name', () => {
      const sql = 'WITH [MyCTE] AS (SELECT Id FROM dbo.Users) SELECT * FROM [MyCTE]';
      const result = resolveRenameLocation(sql, 1, 8); // inside [MyCTE]
      expect(result).not.toBeNull();
      expect(result!.text).toBe('MyCTE');
    });

    it('should resolve multi-word alias', () => {
      const sql = 'SELECT tbl.Id FROM Users tbl WHERE tbl.Id > 0';
      const result = resolveRenameLocation(sql, 1, 8); // "t" of tbl
      expect(result).not.toBeNull();
      expect(result!.text).toBe('tbl');
    });
  });

  describe('provideRenameEdits', () => {
    it('should rename CTE across definition and references', () => {
      const sql = 'WITH MyCTE AS (SELECT Id FROM dbo.Users) SELECT c.Id FROM MyCTE c';
      // cursor on "MyCTE" in WITH clause
      const edits = provideRenameEdits(sql, 1, 7, 'UserData');
      // Should find at least 2 occurrences: definition and FROM reference
      expect(edits.length).toBeGreaterThanOrEqual(2);
      expect(edits.every(e => e.newText === 'UserData')).toBe(true);
    });

    it('should rename alias across all usages', () => {
      const sql = 'SELECT u.Id, u.Name FROM Users u WHERE u.Id > 0';
      const edits = provideRenameEdits(sql, 1, 8, 'usr');
      // u.Id (×2 in SELECT + WHERE), u.Name, u after Users = 4 occurrences
      expect(edits).toHaveLength(4);
      expect(edits.every(e => e.newText === 'usr')).toBe(true);
    });

    it('should return empty edits for non-renameable position', () => {
      const sql = 'SELECT * FROM Users';
      const edits = provideRenameEdits(sql, 1, 1, 'X'); // SELECT keyword
      expect(edits).toHaveLength(0);
    });

    it('should handle multiline SQL', () => {
      const sql = 'SELECT\n  u.Id,\n  u.Name\nFROM Users u\nWHERE u.Id > 0';
      // cursor on "u" on line 2 column 3
      const edits = provideRenameEdits(sql, 2, 3, 'usr');
      expect(edits.length).toBeGreaterThanOrEqual(3);
      expect(edits.every(e => e.newText === 'usr')).toBe(true);
      // Verify edits span multiple lines
      const lines = new Set(edits.map(e => e.range.startLineNumber));
      expect(lines.size).toBeGreaterThan(1);
    });

    it('should not rename occurrences inside string literals', () => {
      const sql = "SELECT u.Id FROM Users u WHERE u.Name = 'u.test'";
      const edits = provideRenameEdits(sql, 1, 8, 'usr');
      // Should not rename the "u" inside the string 'u.test'
      // u.Id, u after Users, u.Name = 3 occurrences (not the one in string)
      expect(edits).toHaveLength(3);
    });

    it('should not rename occurrences inside comments', () => {
      const sql = 'SELECT u.Id FROM Users u -- u is the alias\nWHERE u.Id > 0';
      const edits = provideRenameEdits(sql, 1, 8, 'usr');
      // u.Id in SELECT, u after Users, u.Id in WHERE = 3 (not the u in comment)
      expect(edits).toHaveLength(3);
    });

    it('should handle bracketed CTE names', () => {
      const sql = 'WITH [MyCTE] AS (SELECT Id FROM dbo.Users) SELECT * FROM [MyCTE]';
      const edits = provideRenameEdits(sql, 1, 8, 'NewCTE');
      expect(edits).toHaveLength(2);
      expect(edits.every(e => e.newText === 'NewCTE')).toBe(true);
    });

    it('should provide correct positions', () => {
      const sql = 'SELECT u.Id FROM Users u';
      const edits = provideRenameEdits(sql, 1, 24, 'x');
      // Find the edit for "u" before ".Id"
      const prefixEdit = edits.find(e => e.range.startColumn === 8);
      expect(prefixEdit).toBeDefined();
      expect(prefixEdit!.range.startLineNumber).toBe(1);
      expect(prefixEdit!.range.endColumn).toBe(9);
    });
  });

  describe('@variable rename', () => {
    it('should resolve @variable at DECLARE — display without @', () => {
      const sql = 'DECLARE @Test INT = 1; SELECT @Test';
      const result = resolveRenameLocation(sql, 1, 10); // "@" of @Test in DECLARE
      expect(result).not.toBeNull();
      expect(result!.text).toBe('Test'); // without @ for rename popup display
      // Range should exclude the @ prefix
      expect(result!.range.startColumn).toBe(10); // after the @
    });

    it('should resolve @variable at usage — display without @', () => {
      const sql = 'DECLARE @Test INT = 1; SELECT @Test';
      const result = resolveRenameLocation(sql, 1, 31); // "@" of @Test in SELECT
      expect(result).not.toBeNull();
      expect(result!.text).toBe('Test');
    });

    it('should rename @variable across all occurrences — prepends @', () => {
      const sql = 'DECLARE @Test INT = 1; SELECT @Test';
      // User types "NewVar" (without @) in the rename popup
      const edits = provideRenameEdits(sql, 1, 10, 'NewVar');
      expect(edits).toHaveLength(2);
      expect(edits.every(e => e.newText === '@NewVar')).toBe(true);
    });

    it('should handle user typing @ in new name — no double @', () => {
      const sql = 'DECLARE @Test INT = 1; SELECT @Test';
      const edits = provideRenameEdits(sql, 1, 10, '@NewVar');
      expect(edits).toHaveLength(2);
      expect(edits.every(e => e.newText === '@NewVar')).toBe(true);
    });

    it('should rename @variable in multiline SQL', () => {
      const sql = 'DECLARE @Cnt INT = 0;\nSET @Cnt = @Cnt + 1;\nSELECT @Cnt';
      const edits = provideRenameEdits(sql, 1, 10, 'Counter');
      expect(edits).toHaveLength(4); // DECLARE @Cnt, SET @Cnt, @Cnt + 1, SELECT @Cnt
      expect(edits.every(e => e.newText === '@Counter')).toBe(true);
    });

    it('should not rename @@system variables', () => {
      const sql = 'SELECT @@IDENTITY, @Test FROM t; DECLARE @Test INT = 1';
      const result = resolveRenameLocation(sql, 1, 9); // "@@" of @@IDENTITY
      expect(result).toBeNull();
    });

    it('should resolve go-to-definition for @variable usage', () => {
      const sql = 'DECLARE @Test INT = 1;\nSELECT @Test';
      const result = provideDefinitionLocation(sql, 2, 9);
      expect(result).toEqual({
        range: {
          startLineNumber: 1,
          startColumn: 9,
          endLineNumber: 1,
          endColumn: 14,
        },
      });
    });

    it('should ignore @@system variables in go-to-definition', () => {
      const sql = 'SELECT @@ROWCOUNT, @Test;\nDECLARE @Test INT = 1;';
      const result = provideDefinitionLocation(sql, 1, 10);
      expect(result).toBeNull();
    });
  });

  describe('cursor-at-end rename', () => {
    it('should resolve rename when cursor is after last character of CTE', () => {
      const sql = 'WITH MyCTE AS (SELECT Id FROM dbo.Users) SELECT * FROM MyCTE';
      // cursor right after "MyCTE" (column 11 = after the E)
      const result = resolveRenameLocation(sql, 1, 11);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('MyCTE');
    });

    it('should resolve rename when cursor is after last character of alias', () => {
      const sql = 'SELECT u.Id FROM Users u';
      // cursor after "u" at end of line (col 25)
      const result = resolveRenameLocation(sql, 1, 25);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('u');
    });
  });
});
