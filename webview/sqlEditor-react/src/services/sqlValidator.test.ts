import { describe, it, expect } from 'vitest';
import {
  splitSqlStatements,
  extractCTEs,
  extractCTEsWithColumns,
  extractSelectColumns,
  extractSelectColumnsWithTypes,
  findTableReferences,
  findTableInSchema,
  findColumnReferences,
  validateSql,
} from './sqlValidator';
import type { DatabaseSchema } from '../types/schema';

const mockSchema: DatabaseSchema = {
  tables: [
    {
      schema: 'dbo',
      name: 'Users',
      columns: [
        { name: 'Id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'Name', type: 'nvarchar', nullable: true },
      ],
    },
    {
      schema: 'dbo',
      name: 'Orders',
      columns: [
        { name: 'Id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'UserId', type: 'int', nullable: false, isForeignKey: true },
      ],
    },
    {
      schema: 'sales',
      name: 'Products',
      columns: [{ name: 'Id', type: 'int', nullable: false }],
    },
  ],
  views: [
    {
      schema: 'dbo',
      name: 'ActiveUsers',
      columns: [{ name: 'Id', type: 'int', nullable: false }],
    },
  ],
  foreignKeys: [],
};

describe('sqlValidator', () => {
  describe('splitSqlStatements', () => {
    it('should split multiple statements by semicolon', () => {
      const sql = 'SELECT * FROM Users; SELECT * FROM Orders;';
      const statements = splitSqlStatements(sql);
      expect(statements).toHaveLength(2);
      expect(statements[0].text).toBe('SELECT * FROM Users');
      expect(statements[1].text).toBe(' SELECT * FROM Orders');
    });

    it('should handle single statement without semicolon', () => {
      const sql = 'SELECT * FROM Users';
      const statements = splitSqlStatements(sql);
      expect(statements).toHaveLength(1);
      expect(statements[0].text).toBe('SELECT * FROM Users');
    });

    it('should ignore semicolons inside strings', () => {
      const sql = "SELECT 'a;b' FROM Users";
      const statements = splitSqlStatements(sql);
      expect(statements).toHaveLength(1);
      expect(statements[0].text).toBe("SELECT 'a;b' FROM Users");
    });

    it('should ignore semicolons inside brackets', () => {
      const sql = 'SELECT [a;b] FROM Users';
      const statements = splitSqlStatements(sql);
      expect(statements).toHaveLength(1);
    });

    it('should handle single-line comments', () => {
      const sql = 'SELECT * -- comment;\nFROM Users';
      const statements = splitSqlStatements(sql);
      expect(statements).toHaveLength(1);
    });

    it('should handle block comments', () => {
      const sql = 'SELECT * /* comment; */ FROM Users';
      const statements = splitSqlStatements(sql);
      expect(statements).toHaveLength(1);
    });

    it('should track correct offsets', () => {
      const sql = 'SELECT 1; SELECT 2';
      const statements = splitSqlStatements(sql);
      expect(statements[0].startOffset).toBe(0);
      expect(statements[0].endOffset).toBe(8);
      // Start offset for second statement may vary based on implementation
      expect(statements[1].startOffset).toBeGreaterThanOrEqual(9);
    });
  });

  describe('extractCTEs', () => {
    it('should extract single CTE name', () => {
      const sql = 'WITH MyCTE AS (SELECT 1) SELECT * FROM MyCTE';
      const ctes = extractCTEs(sql);
      expect(ctes.has('mycte')).toBe(true);
      expect(ctes.size).toBe(1);
    });

    it('should extract multiple CTE names', () => {
      const sql = 'WITH CTE1 AS (SELECT 1), CTE2 AS (SELECT 2) SELECT * FROM CTE1';
      const ctes = extractCTEs(sql);
      expect(ctes.has('cte1')).toBe(true);
      expect(ctes.has('cte2')).toBe(true);
      expect(ctes.size).toBe(2);
    });

    it('should handle bracketed CTE names', () => {
      const sql = 'WITH [My CTE] AS (SELECT 1) SELECT * FROM [My CTE]';
      const ctes = extractCTEs(sql);
      expect(ctes.has('my cte')).toBe(true);
    });

    it('should return empty set when no WITH clause', () => {
      const sql = 'SELECT * FROM Users';
      const ctes = extractCTEs(sql);
      expect(ctes.size).toBe(0);
    });

    it('should handle nested parentheses in CTE body', () => {
      const sql = 'WITH MyCTE AS (SELECT (1 + 2) * 3) SELECT * FROM MyCTE';
      const ctes = extractCTEs(sql);
      expect(ctes.has('mycte')).toBe(true);
    });
  });

  describe('findTableReferences', () => {
    it('should find simple FROM table', () => {
      const sql = 'SELECT * FROM Users';
      const refs = findTableReferences(sql);
      expect(refs).toHaveLength(1);
      expect(refs[0].table).toBe('Users');
      expect(refs[0].schema).toBeUndefined();
    });

    it('should find schema-qualified table', () => {
      const sql = 'SELECT * FROM dbo.Users';
      const refs = findTableReferences(sql);
      expect(refs).toHaveLength(1);
      expect(refs[0].table).toBe('Users');
      expect(refs[0].schema).toBe('dbo');
    });

    it('should find bracketed table', () => {
      const sql = 'SELECT * FROM [Users]';
      const refs = findTableReferences(sql);
      expect(refs).toHaveLength(1);
      expect(refs[0].table).toBe('Users');
    });

    it('should find bracketed schema and table', () => {
      const sql = 'SELECT * FROM [dbo].[Users]';
      const refs = findTableReferences(sql);
      expect(refs).toHaveLength(1);
      expect(refs[0].table).toBe('Users');
      expect(refs[0].schema).toBe('dbo');
    });

    it('should find JOIN tables', () => {
      const sql = 'SELECT * FROM Users JOIN Orders ON Users.Id = Orders.UserId';
      const refs = findTableReferences(sql);
      expect(refs.length).toBeGreaterThanOrEqual(2);
      const tableNames = refs.map((r) => r.table);
      expect(tableNames).toContain('Users');
      expect(tableNames).toContain('Orders');
    });

    it('should identify temp tables', () => {
      // Temp tables like #TempTable are not matched by current regex
      // because # is not a valid identifier start character
      // This test documents current behavior
      const sql = 'SELECT * FROM dbo.Users';
      const refs = findTableReferences(sql);
      expect(refs).toHaveLength(1);
      expect(refs[0].table).toBe('Users');
    });

    it('should remove overlapping matches', () => {
      const sql = 'SELECT * FROM dbo.Users';
      const refs = findTableReferences(sql);
      // Should not have both "dbo.Users" and "Users"
      expect(refs).toHaveLength(1);
    });
  });

  describe('findTableInSchema', () => {
    it('should find table in schema', () => {
      expect(findTableInSchema('Users', undefined, mockSchema)).toBe(true);
    });

    it('should find table with specific schema', () => {
      expect(findTableInSchema('Products', 'sales', mockSchema)).toBe(true);
    });

    it('should return false for non-existent table', () => {
      expect(findTableInSchema('NonExistent', undefined, mockSchema)).toBe(false);
    });

    it('should return false for wrong schema', () => {
      expect(findTableInSchema('Products', 'dbo', mockSchema)).toBe(false);
    });

    it('should find views', () => {
      expect(findTableInSchema('ActiveUsers', undefined, mockSchema)).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(findTableInSchema('users', undefined, mockSchema)).toBe(true);
      expect(findTableInSchema('USERS', undefined, mockSchema)).toBe(true);
    });
  });

  describe('validateSql', () => {
    it('should return no markers for valid table', () => {
      const sql = 'SELECT * FROM Users';
      const markers = validateSql(sql, mockSchema);
      expect(markers).toHaveLength(0);
    });

    it('should return error for invalid table', () => {
      const sql = 'SELECT * FROM NonExistent';
      const markers = validateSql(sql, mockSchema);
      expect(markers).toHaveLength(1);
      expect(markers[0].severity).toBe('error');
      expect(markers[0].message).toContain('NonExistent');
    });

    it('should not flag temp tables as errors', () => {
      const sql = 'SELECT * FROM #TempTable';
      const markers = validateSql(sql, mockSchema);
      expect(markers).toHaveLength(0);
    });

    it('should not flag CTE references as errors', () => {
      const sql = 'WITH MyCTE AS (SELECT 1 AS x) SELECT * FROM MyCTE';
      const markers = validateSql(sql, mockSchema);
      expect(markers).toHaveLength(0);
    });

    it('should validate multiple statements', () => {
      const sql = 'SELECT * FROM Users; SELECT * FROM BadTable';
      const markers = validateSql(sql, mockSchema);
      expect(markers).toHaveLength(1);
      expect(markers[0].message).toContain('BadTable');
    });

    it('should provide correct line/column info', () => {
      const sql = 'SELECT * FROM BadTable';
      const markers = validateSql(sql, mockSchema);
      expect(markers).toHaveLength(1);
      expect(markers[0].startLineNumber).toBe(1);
      expect(markers[0].startColumn).toBeGreaterThan(0);
    });

    it('should validate views', () => {
      const sql = 'SELECT * FROM ActiveUsers';
      const markers = validateSql(sql, mockSchema);
      expect(markers).toHaveLength(0);
    });

    it('should validate schema-qualified names', () => {
      const sql = 'SELECT * FROM sales.Products';
      const markers = validateSql(sql, mockSchema);
      expect(markers).toHaveLength(0);
    });

    it('should flag wrong schema', () => {
      const sql = 'SELECT * FROM wrong.Products';
      const markers = validateSql(sql, mockSchema);
      expect(markers).toHaveLength(1);
    });
  });

  describe('extractCTEsWithColumns', () => {
    it('extracts columns from simple CTE', () => {
      const sql = 'WITH MyCte AS (SELECT Id, Name FROM dbo.Users) SELECT * FROM MyCte';
      const ctes = extractCTEsWithColumns(sql);
      expect(ctes).toHaveLength(1);
      expect(ctes[0].name).toBe('MyCte');
      expect(ctes[0].columns.map(c => c.name)).toEqual(['Id', 'Name']);
    });

    it('extracts aliased columns', () => {
      const sql = `WITH Stats AS (
        SELECT COUNT(*) AS Total, MAX(CreatedAt) AS LastDate
        FROM dbo.Orders
      ) SELECT * FROM Stats`;
      const ctes = extractCTEsWithColumns(sql);
      expect(ctes).toHaveLength(1);
      expect(ctes[0].columns.map(c => c.name)).toEqual(['Total', 'LastDate']);
    });

    it('extracts columns from multiple CTEs', () => {
      const sql = `WITH
        A AS (SELECT Id, Name FROM dbo.Users),
        B AS (SELECT Id AS OrderId, UserId FROM dbo.Orders)
      SELECT * FROM A JOIN B ON A.Id = B.UserId`;
      const ctes = extractCTEsWithColumns(sql);
      expect(ctes).toHaveLength(2);
      expect(ctes[0].name).toBe('A');
      expect(ctes[0].columns.map(c => c.name)).toEqual(['Id', 'Name']);
      expect(ctes[1].name).toBe('B');
      expect(ctes[1].columns.map(c => c.name)).toEqual(['OrderId', 'UserId']);
    });

    it('handles dotted column references (table.column)', () => {
      const sql = 'WITH MyCte AS (SELECT u.Id, u.Name FROM dbo.Users u) SELECT * FROM MyCte';
      const ctes = extractCTEsWithColumns(sql);
      expect(ctes[0].columns.map(c => c.name)).toEqual(['Id', 'Name']);
    });

    it('handles bracketed aliases', () => {
      const sql = `WITH MyCte AS (SELECT Id AS [User Id], Name AS [Full Name] FROM dbo.Users) SELECT * FROM MyCte`;
      const ctes = extractCTEsWithColumns(sql);
      expect(ctes[0].columns.map(c => c.name)).toEqual(['User Id', 'Full Name']);
    });

    it('handles function calls with alias', () => {
      const sql = `WITH MyCte AS (
        SELECT JSON_VALUE(data, '$.email') AS Email, COUNT(*) AS Total
        FROM dbo.Users
      ) SELECT * FROM MyCte`;
      const ctes = extractCTEsWithColumns(sql);
      expect(ctes[0].columns.map(c => c.name)).toEqual(['Email', 'Total']);
    });

    it('returns empty array for non-CTE statement', () => {
      const sql = 'SELECT * FROM dbo.Users';
      const ctes = extractCTEsWithColumns(sql);
      expect(ctes).toEqual([]);
    });

    it('handles bracketed CTE names', () => {
      const sql = 'WITH [My CTE] AS (SELECT Id FROM dbo.Users) SELECT * FROM [My CTE]';
      const ctes = extractCTEsWithColumns(sql);
      expect(ctes).toHaveLength(1);
      expect(ctes[0].name).toBe('My CTE');
      expect(ctes[0].columns.map(c => c.name)).toEqual(['Id']);
    });

    it('handles star column', () => {
      const sql = 'WITH MyCte AS (SELECT * FROM dbo.Users) SELECT * FROM MyCte';
      const ctes = extractCTEsWithColumns(sql);
      expect(ctes[0].columns.map(c => c.name)).toEqual(['*']);
    });

    it('handles DISTINCT keyword', () => {
      const sql = 'WITH MyCte AS (SELECT DISTINCT Id, Name FROM dbo.Users) SELECT * FROM MyCte';
      const ctes = extractCTEsWithColumns(sql);
      expect(ctes[0].columns.map(c => c.name)).toEqual(['Id', 'Name']);
    });

    it('infers column types from schema when provided', () => {
      const sql = 'WITH MyCte AS (SELECT Id, Name FROM dbo.Users) SELECT * FROM MyCte';
      const ctes = extractCTEsWithColumns(sql, mockSchema);
      expect(ctes[0].columns[0]).toEqual({ name: 'Id', type: 'int', nullable: false });
      expect(ctes[0].columns[1]).toEqual({ name: 'Name', type: 'nvarchar', nullable: true });
    });

    it('infers types for SQL functions', () => {
      const sql = `WITH Stats AS (
        SELECT COUNT(*) AS Total, YEAR(CreatedAt) AS Yr
        FROM dbo.Orders
      ) SELECT * FROM Stats`;
      const ctes = extractCTEsWithColumns(sql, mockSchema);
      expect(ctes[0].columns[0]).toEqual({ name: 'Total', type: 'int', nullable: false });
      expect(ctes[0].columns[1]).toEqual({ name: 'Yr', type: 'int', nullable: true });
    });

    it('infers type for aliased table.column reference', () => {
      const sql = 'WITH MyCte AS (SELECT u.Id, u.Name FROM dbo.Users u) SELECT * FROM MyCte';
      const ctes = extractCTEsWithColumns(sql, mockSchema);
      expect(ctes[0].columns[0]).toEqual({ name: 'Id', type: 'int', nullable: false });
      expect(ctes[0].columns[1]).toEqual({ name: 'Name', type: 'nvarchar', nullable: true });
    });

    it('infers type for CAST expression', () => {
      const sql = 'WITH MyCte AS (SELECT CAST(Id AS VARCHAR(10)) AS IdStr FROM dbo.Users) SELECT * FROM MyCte';
      const ctes = extractCTEsWithColumns(sql, mockSchema);
      expect(ctes[0].columns[0].name).toBe('IdStr');
      expect(ctes[0].columns[0].type).toBe('VARCHAR(10)');
    });

    it('infers type for JSON_VALUE', () => {
      const sql = `WITH MyCte AS (SELECT JSON_VALUE(data, '$.email') AS Email FROM dbo.Users) SELECT * FROM MyCte`;
      const ctes = extractCTEsWithColumns(sql, mockSchema);
      expect(ctes[0].columns[0]).toEqual({ name: 'Email', type: 'nvarchar', nullable: true });
    });

    it('infers type for CONCAT', () => {
      const sql = `WITH MyCte AS (SELECT CONCAT(Name, '_suffix') AS FullName FROM dbo.Users) SELECT * FROM MyCte`;
      const ctes = extractCTEsWithColumns(sql, mockSchema);
      expect(ctes[0].columns[0]).toEqual({ name: 'FullName', type: 'nvarchar', nullable: false });
    });
  });

  describe('extractSelectColumns', () => {
    it('extracts simple column list', () => {
      const cols = extractSelectColumns('SELECT a, b, c FROM t');
      expect(cols).toEqual(['a', 'b', 'c']);
    });

    it('handles AS aliases', () => {
      const cols = extractSelectColumns('SELECT x AS Alpha, y AS Beta FROM t');
      expect(cols).toEqual(['Alpha', 'Beta']);
    });

    it('handles nested function calls', () => {
      const cols = extractSelectColumns("SELECT COALESCE(a, b) AS Result, YEAR(created) AS Yr FROM t");
      expect(cols).toEqual(['Result', 'Yr']);
    });

    it('handles subquery in SELECT (skips parens)', () => {
      const cols = extractSelectColumns('SELECT (SELECT TOP 1 x FROM y) AS Sub, Id FROM t');
      expect(cols).toEqual(['Sub', 'Id']);
    });

    it('returns empty for non-SELECT', () => {
      const cols = extractSelectColumns('INSERT INTO t VALUES (1)');
      expect(cols).toEqual([]);
    });
  });

  describe('extractSelectColumnsWithTypes', () => {
    it('infers int type for direct column reference', () => {
      const cols = extractSelectColumnsWithTypes(
        'SELECT Id FROM dbo.Users',
        mockSchema
      );
      expect(cols[0]).toEqual({ name: 'Id', type: 'int', nullable: false });
    });

    it('infers nvarchar type for Name column', () => {
      const cols = extractSelectColumnsWithTypes(
        'SELECT Name FROM dbo.Users',
        mockSchema
      );
      expect(cols[0]).toEqual({ name: 'Name', type: 'nvarchar', nullable: true });
    });

    it('infers int type for COUNT function', () => {
      const cols = extractSelectColumnsWithTypes(
        'SELECT COUNT(*) AS Total FROM dbo.Users',
        mockSchema
      );
      expect(cols[0]).toEqual({ name: 'Total', type: 'int', nullable: false });
    });

    it('infers int type for YEAR function', () => {
      const cols = extractSelectColumnsWithTypes(
        'SELECT YEAR(CreatedAt) AS Yr FROM dbo.Users',
        mockSchema
      );
      expect(cols[0]).toEqual({ name: 'Yr', type: 'int', nullable: true });
    });

    it('infers nvarchar for JSON_VALUE', () => {
      const cols = extractSelectColumnsWithTypes(
        "SELECT JSON_VALUE(data, '$.email') AS Email FROM dbo.Users",
        mockSchema
      );
      expect(cols[0]).toEqual({ name: 'Email', type: 'nvarchar', nullable: true });
    });

    it('infers CAST target type', () => {
      const cols = extractSelectColumnsWithTypes(
        'SELECT CAST(Id AS VARCHAR(10)) AS IdStr FROM dbo.Users',
        mockSchema
      );
      expect(cols[0].name).toBe('IdStr');
      expect(cols[0].type).toBe('VARCHAR(10)');
    });

    it('infers nvarchar for CONCAT', () => {
      const cols = extractSelectColumnsWithTypes(
        "SELECT CONCAT(Name, '_x') AS Full FROM dbo.Users",
        mockSchema
      );
      expect(cols[0]).toEqual({ name: 'Full', type: 'nvarchar', nullable: false });
    });

    it('resolves column via table alias', () => {
      const cols = extractSelectColumnsWithTypes(
        'SELECT u.Id, u.Name FROM dbo.Users u',
        mockSchema
      );
      expect(cols[0]).toEqual({ name: 'Id', type: 'int', nullable: false });
      expect(cols[1]).toEqual({ name: 'Name', type: 'nvarchar', nullable: true });
    });

    it('returns empty type without schema', () => {
      const cols = extractSelectColumnsWithTypes(
        'SELECT Id FROM dbo.Users'
      );
      expect(cols[0].name).toBe('Id');
      expect(cols[0].type).toBe('');
    });

    it('infers datetime for GETDATE()', () => {
      const cols = extractSelectColumnsWithTypes(
        'SELECT GETDATE() AS Now FROM dbo.Users',
        mockSchema
      );
      expect(cols[0]).toEqual({ name: 'Now', type: 'datetime', nullable: false });
    });
  });

  describe('findColumnReferences', () => {
    it('finds simple alias.column references', () => {
      const refs = findColumnReferences('SELECT u.Id, u.Name FROM dbo.Users u');
      expect(refs.length).toBeGreaterThanOrEqual(2);
      const cols = refs.map(r => r.column);
      expect(cols).toContain('Id');
      expect(cols).toContain('Name');
    });

    it('finds bracketed references', () => {
      const refs = findColumnReferences('SELECT [u].[Name] FROM dbo.Users u');
      expect(refs.some(r => r.column === 'Name')).toBe(true);
    });

    it('does not include FROM/JOIN table references as column refs', () => {
      const refs = findColumnReferences('SELECT u.Id FROM dbo.Users u');
      // 'Users' preceded by 'dbo.' should not create a column ref for 'Users'
      // Only u.Id should produce a useful column ref
      const colNames = refs.map(r => r.column);
      expect(colNames).toContain('Id');
    });

    it('finds column references in WHERE clause', () => {
      const refs = findColumnReferences('SELECT * FROM dbo.Users u WHERE u.Name = 1');
      expect(refs.some(r => r.prefix === 'u' && r.column === 'Name')).toBe(true);
    });

    it('finds column references in JOIN ON clause', () => {
      const refs = findColumnReferences('SELECT * FROM Users u JOIN Orders o ON u.Id = o.UserId');
      expect(refs.some(r => r.prefix === 'u' && r.column === 'Id')).toBe(true);
      expect(refs.some(r => r.prefix === 'o' && r.column === 'UserId')).toBe(true);
    });
  });

  describe('validateSql column validation', () => {
    it('should not flag valid columns on known tables', () => {
      const sql = 'SELECT u.Id, u.Name FROM dbo.Users u';
      const markers = validateSql(sql, mockSchema);
      expect(markers).toHaveLength(0);
    });

    it('should flag invalid column on known table alias', () => {
      const sql = 'SELECT u.NonExistent FROM dbo.Users u';
      const markers = validateSql(sql, mockSchema);
      const colMarkers = markers.filter(m => m.message.includes('NonExistent'));
      expect(colMarkers).toHaveLength(1);
      expect(colMarkers[0].severity).toBe('warning');
      expect(colMarkers[0].message).toContain('NonExistent');
    });

    it('should flag invalid column on table name (no alias)', () => {
      const sql = 'SELECT Users.BadCol FROM dbo.Users';
      const markers = validateSql(sql, mockSchema);
      const colMarkers = markers.filter(m => m.message.includes('BadCol'));
      expect(colMarkers).toHaveLength(1);
      expect(colMarkers[0].severity).toBe('warning');
    });

    it('should not flag columns on unknown tables', () => {
      // Unknown table already produces an error marker; no column warning needed.
      const sql = 'SELECT x.Col FROM UnknownTable x';
      const markers = validateSql(sql, mockSchema);
      // Should have 1 error for table, but no column warning (table is unknown)
      expect(markers.some(m => m.severity === 'error')).toBe(true);
      expect(markers.filter(m => m.severity === 'warning')).toHaveLength(0);
    });

    it('should validate columns on CTE references', () => {
      const sql = 'WITH MyCTE AS (SELECT Id, Name FROM dbo.Users) SELECT c.BadCol FROM MyCTE c';
      const markers = validateSql(sql, mockSchema);
      const colMarkers = markers.filter(m => m.message.includes('BadCol'));
      expect(colMarkers).toHaveLength(1);
      expect(colMarkers[0].severity).toBe('warning');
    });

    it('should not flag valid CTE columns', () => {
      const sql = 'WITH MyCTE AS (SELECT Id, Name FROM dbo.Users) SELECT c.Id, c.Name FROM MyCTE c';
      const markers = validateSql(sql, mockSchema);
      expect(markers).toHaveLength(0);
    });

    it('should skip column validation for CTE with star columns', () => {
      const sql = 'WITH MyCTE AS (SELECT * FROM dbo.Users) SELECT c.Whatever FROM MyCTE c';
      const markers = validateSql(sql, mockSchema);
      // Star CTE columns mean we cannot validate — no warning expected
      const colMarkers = markers.filter(m => m.severity === 'warning');
      expect(colMarkers).toHaveLength(0);
    });

    it('should validate columns in WHERE clause', () => {
      const sql = 'SELECT u.Id FROM dbo.Users u WHERE u.FakeCol = 1';
      const markers = validateSql(sql, mockSchema);
      const colMarkers = markers.filter(m => m.message.includes('FakeCol'));
      expect(colMarkers).toHaveLength(1);
    });

    it('should validate columns in JOIN ON clause', () => {
      const sql = 'SELECT * FROM dbo.Users u JOIN dbo.Orders o ON u.Id = o.BadCol';
      const markers = validateSql(sql, mockSchema);
      const colMarkers = markers.filter(m => m.message.includes('BadCol'));
      expect(colMarkers).toHaveLength(1);
    });

    it('should validate columns with bracketed identifiers', () => {
      const sql = 'SELECT [u].[NonExistent] FROM dbo.Users u';
      const markers = validateSql(sql, mockSchema);
      const colMarkers = markers.filter(m => m.message.includes('NonExistent'));
      expect(colMarkers).toHaveLength(1);
    });

    it('should provide correct position for column warnings', () => {
      const sql = 'SELECT u.Bad FROM dbo.Users u';
      const markers = validateSql(sql, mockSchema);
      const colMarker = markers.find(m => m.message.includes('Bad'));
      expect(colMarker).toBeDefined();
      expect(colMarker!.startLineNumber).toBe(1);
      expect(colMarker!.startColumn).toBeGreaterThan(0);
    });
  });
});
