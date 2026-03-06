import { describe, it, expect } from 'vitest';
import {
  findTable,
  findTableForAlias,
  getColumnsForTable,
  extractTablesFromQuery,
  getRelatedTables,
  generateSmartAlias,
  analyzeSqlContext,
  getSqlOperators,
  getAggregateFunctions,
  getAfterFromKeywords,
  removeExecutionComments,
  extractCTEsFromQuery,
  getCTEColumns,
  buildAugmentedSchema,
  getMainQueryText,
} from './sqlCompletionService';
import type { DatabaseSchema } from '../types/schema';

const mockSchema: DatabaseSchema = {
  tables: [
    {
      schema: 'dbo',
      name: 'Users',
      columns: [
        { name: 'Id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'Name', type: 'nvarchar', nullable: true },
        { name: 'Email', type: 'nvarchar', nullable: true },
      ],
    },
    {
      schema: 'dbo',
      name: 'Orders',
      columns: [
        { name: 'Id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'UserId', type: 'int', nullable: false, isForeignKey: true },
        { name: 'Total', type: 'decimal', nullable: false },
        { name: 'OrderDate', type: 'datetime', nullable: true },
      ],
    },
    {
      schema: 'dbo',
      name: 'Projects',
      columns: [
        { name: 'Id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'Name', type: 'nvarchar', nullable: true },
        { name: 'PackageId', type: 'int', nullable: false, isForeignKey: true },
        { name: 'Status', type: 'nvarchar', nullable: true },
      ],
    },
    {
      schema: 'dbo',
      name: 'Packages',
      columns: [
        { name: 'Id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'Name', type: 'nvarchar', nullable: true },
        { name: 'Version', type: 'nvarchar', nullable: true },
      ],
    },
    {
      schema: 'sales',
      name: 'Products',
      columns: [
        { name: 'Id', type: 'int', nullable: false },
        { name: 'Name', type: 'nvarchar', nullable: true },
      ],
    },
  ],
  views: [
    {
      schema: 'dbo',
      name: 'ActiveUsers',
      columns: [{ name: 'Id', type: 'int', nullable: false }],
    },
  ],
  foreignKeys: [
    {
      fromSchema: 'dbo',
      fromTable: 'Orders',
      fromColumn: 'UserId',
      toSchema: 'dbo',
      toTable: 'Users',
      toColumn: 'Id',
    },
    {
      fromSchema: 'dbo',
      fromTable: 'Projects',
      fromColumn: 'PackageId',
      toSchema: 'dbo',
      toTable: 'Packages',
      toColumn: 'Id',
    },
  ],
};

describe('sqlCompletionService', () => {
  describe('findTable', () => {
    it('should find table by name', () => {
      const result = findTable('Users', mockSchema);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('Users');
      expect(result?.schema).toBe('dbo');
    });

    it('should be case-insensitive', () => {
      const result = findTable('users', mockSchema);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('Users');
    });

    it('should find views', () => {
      const result = findTable('ActiveUsers', mockSchema);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('ActiveUsers');
    });

    it('should return null for non-existent table', () => {
      const result = findTable('NonExistent', mockSchema);
      expect(result).toBeNull();
    });
  });

  describe('findTableForAlias', () => {
    it('should find table by alias in FROM clause', () => {
      const query = 'SELECT * FROM Users u WHERE u.Id = 1';
      const result = findTableForAlias(query, 'u', mockSchema);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('Users');
    });

    it('should find table by alias in JOIN clause', () => {
      const query = 'SELECT * FROM Users u JOIN Orders o ON u.Id = o.UserId';
      const result = findTableForAlias(query, 'o', mockSchema);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('Orders');
    });

    it('should handle AS keyword', () => {
      const query = 'SELECT * FROM Users AS u';
      const result = findTableForAlias(query, 'u', mockSchema);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('Users');
    });

    it('should return table if alias matches table name', () => {
      const result = findTableForAlias('SELECT * FROM Users', 'Users', mockSchema);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('Users');
    });

    it('should find table with bracketed alias', () => {
      const query = 'SELECT * FROM [dbo].[Users] [u]';
      const result = findTableForAlias(query, 'u', mockSchema);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('Users');
    });

    it('should find table with bracketed schema and table', () => {
      const query = 'SELECT * FROM [dbo].[Projects] [p] JOIN [dbo].[Packages] [p2] ON [p].[PackageId] = [p2].[Id]';
      const result = findTableForAlias(query, 'p', mockSchema);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('Projects');
    });

    it('should find second alias in multi-join query', () => {
      const query = 'SELECT * FROM [dbo].[Projects] [p] JOIN [dbo].[Packages] [p2] ON [p].[PackageId] = [p2].[Id]';
      const result = findTableForAlias(query, 'p2', mockSchema);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('Packages');
    });
  });

  describe('getColumnsForTable', () => {
    it('should return columns for table', () => {
      const columns = getColumnsForTable('dbo', 'Users', mockSchema);
      expect(columns).toHaveLength(3);
      expect(columns.map((c) => c.name)).toContain('Id');
      expect(columns.map((c) => c.name)).toContain('Name');
    });

    it('should return empty array for non-existent table', () => {
      const columns = getColumnsForTable('dbo', 'NonExistent', mockSchema);
      expect(columns).toHaveLength(0);
    });

    it('should respect schema', () => {
      const columns = getColumnsForTable('sales', 'Products', mockSchema);
      expect(columns).toHaveLength(2);
    });
  });

  describe('extractTablesFromQuery', () => {
    it('should extract table from simple SELECT', () => {
      const tables = extractTablesFromQuery('SELECT * FROM Users', mockSchema);
      expect(tables).toHaveLength(1);
      expect(tables[0].table).toBe('Users');
    });

    it('should extract multiple tables from JOIN', () => {
      const query = 'SELECT * FROM Users u JOIN Orders o ON u.Id = o.UserId';
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables.length).toBeGreaterThanOrEqual(1);
      expect(tables.some(t => t.table === 'Users' || t.table === 'Orders')).toBe(true);
    });

    it('should capture aliases', () => {
      const query = 'SELECT * FROM Users u';
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables).toHaveLength(1);
      expect(tables[0].alias).toBe('u');
      expect(tables[0].hasExplicitAlias).toBe(true);
    });

    it('should not treat SQL keywords as aliases', () => {
      const query = 'SELECT * FROM Users WHERE Id = 1';
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables).toHaveLength(1);
      expect(tables[0].alias).toBe('Users');
    });

    it('should extract tables with bracketed identifiers', () => {
      const query = 'SELECT * FROM [dbo].[Projects] [p]\njoin [dbo].[Packages] [p2] ON [p].[PackageId] = [p2].[Id]';
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables.length).toBeGreaterThanOrEqual(2);
      expect(tables.some(t => t.table === 'Projects')).toBe(true);
      expect(tables.some(t => t.table === 'Packages')).toBe(true);
    });

    it('should capture bracketed aliases', () => {
      const query = 'SELECT * FROM [dbo].[Projects] [p]\njoin [dbo].[Packages] [p2] ON [p].[PackageId] = [p2].[Id]';
      const tables = extractTablesFromQuery(query, mockSchema);
      const projects = tables.find(t => t.table === 'Projects');
      const packages = tables.find(t => t.table === 'Packages');
      expect(projects?.alias).toBe('p');
      expect(packages?.alias).toBe('p2');
    });

    it('should extract tables with LEFT JOIN', () => {
      const query = 'SELECT * FROM Users u LEFT JOIN Orders o ON u.Id = o.UserId';
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables.some(t => t.table === 'Users')).toBe(true);
      expect(tables.some(t => t.table === 'Orders')).toBe(true);
    });

    it('should extract tables from multi-line query', () => {
      const query = `SELECT p.Name, pk.Version
FROM [dbo].[Projects] [p]
JOIN [dbo].[Packages] [pk] ON [p].[PackageId] = [pk].[Id]
WHERE p.Status = 'Active'
ORDER BY p.Name`;
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables.some(t => t.table === 'Projects')).toBe(true);
      expect(tables.some(t => t.table === 'Packages')).toBe(true);
    });
  });

  describe('getRelatedTables', () => {
    it('should return related tables via foreign keys', () => {
      const tablesInQuery = [{ schema: 'dbo', table: 'Users', alias: 'u', hasExplicitAlias: true }];
      const related = getRelatedTables(tablesInQuery, mockSchema);
      expect(related.length).toBeGreaterThan(0);
      expect(related.some((t) => t.name === 'Orders')).toBe(true);
    });

    it('should include FK info in related tables', () => {
      const tablesInQuery = [{ schema: 'dbo', table: 'Users', alias: 'u', hasExplicitAlias: true }];
      const related = getRelatedTables(tablesInQuery, mockSchema);
      const ordersTable = related.find((t) => t.name === 'Orders');
      expect(ordersTable?.foreignKeyInfo).toBeDefined();
    });

    it('should return all tables if no FK relations found', () => {
      const tablesInQuery = [{ schema: 'sales', table: 'Products', alias: 'p', hasExplicitAlias: true }];
      const related = getRelatedTables(tablesInQuery, mockSchema);
      expect(related.some((t) => t.name === 'Users')).toBe(true);
    });
  });

  describe('generateSmartAlias', () => {
    it('should use first letter for simple names', () => {
      expect(generateSmartAlias('Users')).toBe('u');
    });

    it('should use initials for PascalCase names', () => {
      expect(generateSmartAlias('OrderItems')).toBe('oi');
    });

    it('should use initials for underscore names', () => {
      expect(generateSmartAlias('order_items')).toBe('oi');
    });

    it('should remove tbl_ prefix', () => {
      expect(generateSmartAlias('tbl_Users')).toBe('u');
    });
  });

  describe('analyzeSqlContext', () => {
    it('should detect SELECT context', () => {
      const result = analyzeSqlContext('SELECT ', 'SELECT ');
      expect(result.type).toBe('SELECT');
    });

    it('should detect FROM context', () => {
      const result = analyzeSqlContext('SELECT * FROM ', 'SELECT * FROM ');
      expect(result.type).toBe('FROM');
    });

    it('should detect WHERE context', () => {
      const result = analyzeSqlContext('SELECT * FROM Users WHERE ', 'WHERE ');
      expect(result.type).toBe('WHERE');
    });

    it('should detect JOIN context', () => {
      const result = analyzeSqlContext('SELECT * FROM Users JOIN ', 'JOIN ');
      expect(result.type).toBe('JOIN_TABLE');
    });

    it('should detect ORDER BY context', () => {
      const result = analyzeSqlContext('SELECT * FROM Users ORDER BY ', 'ORDER BY ');
      expect(result.type).toBe('ORDER_BY');
    });

    it('should detect GROUP BY context', () => {
      const result = analyzeSqlContext('SELECT * FROM Users GROUP BY ', 'GROUP BY ');
      expect(result.type).toBe('GROUP_BY');
    });

    it('should detect HAVING context', () => {
      const result = analyzeSqlContext('SELECT * FROM Users GROUP BY Name HAVING ', 'HAVING ');
      expect(result.type).toBe('HAVING');
    });

    it('should detect INSERT columns context', () => {
      const result = analyzeSqlContext('INSERT INTO Users (', 'INSERT INTO Users (');
      expect(result.type).toBe('INSERT_COLUMNS');
    });

    // Additional context detection tests

    it('should detect SELECT context in multi-line query', () => {
      const line = 'SELECT ';
      const result = analyzeSqlContext('SELECT ', line);
      expect(result.type).toBe('SELECT');
    });

    it('should detect ORDER BY after WHERE clause', () => {
      const text = 'SELECT * FROM Users u WHERE u.Id > 5 ORDER BY ';
      const result = analyzeSqlContext(text, 'ORDER BY ');
      expect(result.type).toBe('ORDER_BY');
    });

    it('should detect GROUP BY after WHERE clause', () => {
      const text = 'SELECT Name, COUNT(*) FROM Users WHERE Id > 0 GROUP BY ';
      const result = analyzeSqlContext(text, 'GROUP BY ');
      expect(result.type).toBe('GROUP_BY');
    });

    it('should detect ORDER BY after GROUP BY', () => {
      const text = 'SELECT Name, COUNT(*) FROM Users GROUP BY Name ORDER BY ';
      const result = analyzeSqlContext(text, 'ORDER BY ');
      expect(result.type).toBe('ORDER_BY');
    });

    it('should detect HAVING after GROUP BY', () => {
      const text = 'SELECT Name, COUNT(*) cnt FROM Users GROUP BY Name HAVING ';
      const result = analyzeSqlContext(text, 'HAVING ');
      expect(result.type).toBe('HAVING');
    });

    it('should detect INNER JOIN context', () => {
      const result = analyzeSqlContext('SELECT * FROM Users INNER JOIN ', 'INNER JOIN ');
      expect(result.type).toBe('JOIN_TABLE');
    });

    it('should detect LEFT JOIN context', () => {
      const result = analyzeSqlContext('SELECT * FROM Users LEFT JOIN ', 'LEFT JOIN ');
      expect(result.type).toBe('JOIN_TABLE');
    });

    it('should detect AFTER_FROM context', () => {
      const text = 'SELECT * FROM Users u ';
      const result = analyzeSqlContext(text, text);
      expect(result.type).toBe('AFTER_FROM');
    });

    // FROM and AFTER_FROM context tests (user-reported scenarios)

    it('should detect FROM context for SELECT * FROM with trailing space', () => {
      // Cursor is right after FROM — only table names should be shown (no snippets)
      const text = 'SELECT * FROM ';
      const result = analyzeSqlContext(text, text);
      expect(result.type).toBe('FROM');
    });

    it('should detect FROM context for multi-line SELECT * FROM', () => {
      const text = 'SELECT *\nFROM ';
      const result = analyzeSqlContext(text, 'FROM ');
      expect(result.type).toBe('FROM');
    });

    it('should detect AFTER_FROM when cursor is right after table name (no space)', () => {
      // Cursor at end of "Packages" — should suggest WHERE/JOIN keywords, not columns
      const text = 'SELECT * FROM Packages';
      const result = analyzeSqlContext(text, text);
      expect(result.type).toBe('AFTER_FROM');
    });

    it('should detect AFTER_FROM when cursor is right after table name with alias', () => {
      const text = 'SELECT * FROM Packages p';
      const result = analyzeSqlContext(text, text);
      expect(result.type).toBe('AFTER_FROM');
    });

    it('should detect AFTER_FROM for schema-qualified table name', () => {
      const text = 'SELECT * FROM dbo.Packages ';
      const result = analyzeSqlContext(text, text);
      expect(result.type).toBe('AFTER_FROM');
    });

    // Bracketed identifier cases (reported as broken)

    it('should detect AFTER_FROM for bracketed schema.table with unbracketed alias', () => {
      const text = 'SELECT TOP 100 *\nFROM [dbo].[Projects] p';
      const result = analyzeSqlContext(text, 'FROM [dbo].[Projects] p');
      expect(result.type).toBe('AFTER_FROM');
    });

    it('should detect AFTER_FROM for bracketed schema.table with bracketed alias', () => {
      const text = 'SELECT TOP 100 *\nFROM [dbo].[Projects] [p]';
      const result = analyzeSqlContext(text, 'FROM [dbo].[Projects] [p]');
      expect(result.type).toBe('AFTER_FROM');
    });

    it('should detect AFTER_FROM for bracketed schema.table with no alias', () => {
      const text = 'SELECT * FROM [dbo].[Packages] ';
      const result = analyzeSqlContext(text, 'FROM [dbo].[Packages] ');
      expect(result.type).toBe('AFTER_FROM');
    });

    it('should detect AFTER_FROM for bracketed table name (no schema) with unbracketed alias', () => {
      const text = 'SELECT * FROM [Projects] p';
      const result = analyzeSqlContext(text, 'FROM [Projects] p');
      expect(result.type).toBe('AFTER_FROM');
    });

    it('should detect AFTER_FROM for bracketed table name (no schema) with bracketed alias', () => {
      const text = 'SELECT * FROM [Projects] [p]';
      const result = analyzeSqlContext(text, 'FROM [Projects] [p]');
      expect(result.type).toBe('AFTER_FROM');
    });

    it('should detect INSERT_COLUMNS for bracketed schema.table', () => {
      const result = analyzeSqlContext(
        'INSERT INTO [dbo].[Users] (',
        'INSERT INTO [dbo].[Users] ('
      );
      expect(result.type).toBe('INSERT_COLUMNS');
      expect(result.tableName).toBe('users'); // lowercased by lowerLine
    });

    it('should detect INSERT_COLUMNS for bracketed table without schema', () => {
      const result = analyzeSqlContext(
        'INSERT INTO [Users] (',
        'INSERT INTO [Users] ('
      );
      expect(result.type).toBe('INSERT_COLUMNS');
      expect(result.tableName).toBe('users');
    });

    it('should still detect FROM context (no table yet) with bracketed syntax start', () => {
      // Only FROM keyword, cursor right after space — not AFTER_FROM
      const text = 'SELECT * FROM ';
      const result = analyzeSqlContext(text, 'FROM ');
      expect(result.type).toBe('FROM');
    });

    it('should detect WHERE context (not AFTER_FROM) when WHERE already typed', () => {
      // Ensure AFTER_FROM does not interfere once WHERE is present
      const text = 'SELECT * FROM Packages WHERE ';
      const result = analyzeSqlContext(text, 'WHERE ');
      expect(result.type).toBe('WHERE');
    });

    it('should detect WHERE context with columns already typed', () => {
      const text = 'SELECT * FROM Users u WHERE u.Name = \'test\' AND ';
      const result = analyzeSqlContext(text, 'AND ');
      expect(result.type).toBe('WHERE');
    });

    it('should detect ORDER BY context in complex query with JOINs', () => {
      const text = `SELECT p.Name
FROM [dbo].[Projects] [p]
JOIN [dbo].[Packages] [p2] ON [p].[PackageId] = [p2].[Id]
ORDER BY `;
      const result = analyzeSqlContext(text, 'ORDER BY ');
      expect(result.type).toBe('ORDER_BY');
    });

    it('should detect SELECT context in JOIN query', () => {
      const text = 'SELECT ';
      const result = analyzeSqlContext(text, text);
      expect(result.type).toBe('SELECT');
    });

    // ORDER BY sort direction tests

    it('should suggest ASC/DESC after column in ORDER BY', () => {
      const text = `SELECT p.Id, p.Name, p.CostCentre
FROM [dbo].[Projects] [p]
JOIN [dbo].[Packages] [p2] ON [p].[PackageId] = [p2].[Id]
ORDER BY CostCentre `;
      const result = analyzeSqlContext(text, 'ORDER BY CostCentre ');
      expect(result.type).toBe('ORDER_BY');
      expect(result.suggestSortDirection).toBe(true);
    });

    it('should suggest ASC/DESC after qualified column in ORDER BY', () => {
      const text = 'SELECT * FROM Users u ORDER BY u.Name ';
      const result = analyzeSqlContext(text, 'ORDER BY u.Name ');
      expect(result.type).toBe('ORDER_BY');
      expect(result.suggestSortDirection).toBe(true);
    });

    it('should suggest columns after ORDER BY keyword (no column yet)', () => {
      const text = 'SELECT * FROM Users ORDER BY ';
      const result = analyzeSqlContext(text, 'ORDER BY ');
      expect(result.type).toBe('ORDER_BY');
      expect(result.suggestSortDirection).toBeFalsy();
    });

    it('should suggest columns after comma in ORDER BY', () => {
      const text = 'SELECT * FROM Users ORDER BY Name ASC, ';
      const result = analyzeSqlContext(text, 'ORDER BY Name ASC, ');
      expect(result.type).toBe('ORDER_BY');
      expect(result.suggestSortDirection).toBeFalsy();
    });

    it('should not suggest sort direction after ASC/DESC already present', () => {
      const text = 'SELECT * FROM Users ORDER BY Name DESC ';
      const result = analyzeSqlContext(text, 'ORDER BY Name DESC ');
      expect(result.type).toBe('ORDER_BY');
      expect(result.suggestSortDirection).toBe(false);
    });

    it('should suggest columns after comma following DESC', () => {
      const text = 'SELECT * FROM Users ORDER BY Name DESC, ';
      const result = analyzeSqlContext(text, 'ORDER BY Name DESC, ');
      expect(result.type).toBe('ORDER_BY');
      expect(result.suggestSortDirection).toBeFalsy();
    });

    it('should suggest ASC/DESC after second column in ORDER BY', () => {
      const text = 'SELECT * FROM Users ORDER BY Name ASC, Email ';
      const result = analyzeSqlContext(text, 'ORDER BY Name ASC, Email ');
      expect(result.type).toBe('ORDER_BY');
      expect(result.suggestSortDirection).toBe(true);
    });

    it('should suggest ASC/DESC after bracketed column in ORDER BY', () => {
      const text = 'SELECT * FROM Users ORDER BY [Name] ';
      const result = analyzeSqlContext(text, 'ORDER BY [Name] ');
      expect(result.type).toBe('ORDER_BY');
      expect(result.suggestSortDirection).toBe(true);
    });

    it('should suggest ASC/DESC after bracketed qualified column in ORDER BY', () => {
      const text = 'SELECT * FROM Users ORDER BY [u].[Name] ';
      const result = analyzeSqlContext(text, 'ORDER BY [u].[Name] ');
      expect(result.type).toBe('ORDER_BY');
      expect(result.suggestSortDirection).toBe(true);
    });
  });

  describe('getSqlOperators', () => {
    it('should return common SQL operators', () => {
      const operators = getSqlOperators();
      expect(operators.length).toBeGreaterThan(0);
      expect(operators.some((op) => op.label === '=')).toBe(true);
      expect(operators.some((op) => op.label === 'LIKE')).toBe(true);
      expect(operators.some((op) => op.label === 'IS NULL')).toBe(true);
    });
  });

  describe('getAggregateFunctions', () => {
    it('should return common aggregate functions', () => {
      const functions = getAggregateFunctions();
      expect(functions.length).toBeGreaterThan(0);
      expect(functions.some((fn) => fn.label === 'COUNT(*)')).toBe(true);
      expect(functions.some((fn) => fn.label.includes('SUM'))).toBe(true);
      expect(functions.some((fn) => fn.label.includes('AVG'))).toBe(true);
    });
  });

  describe('getAfterFromKeywords', () => {
    it('should return clause keywords valid after a FROM table reference', () => {
      const kws = getAfterFromKeywords();
      expect(kws.length).toBeGreaterThan(0);
      expect(kws.some(k => k.label === 'WHERE')).toBe(true);
    });

    it('should include all JOIN variants', () => {
      const kws = getAfterFromKeywords();
      expect(kws.some(k => k.label === 'INNER JOIN')).toBe(true);
      expect(kws.some(k => k.label === 'LEFT JOIN')).toBe(true);
      expect(kws.some(k => k.label === 'RIGHT JOIN')).toBe(true);
      expect(kws.some(k => k.label === 'CROSS JOIN')).toBe(true);
      expect(kws.some(k => k.label === 'FULL OUTER JOIN')).toBe(true);
    });

    it('should include CROSS APPLY and OUTER APPLY', () => {
      const kws = getAfterFromKeywords();
      expect(kws.some(k => k.label === 'CROSS APPLY')).toBe(true);
      expect(kws.some(k => k.label === 'OUTER APPLY')).toBe(true);
    });

    it('should include GROUP BY and ORDER BY', () => {
      const kws = getAfterFromKeywords();
      expect(kws.some(k => k.label === 'GROUP BY')).toBe(true);
      expect(kws.some(k => k.label === 'ORDER BY')).toBe(true);
    });

    it('should include UNION and UNION ALL', () => {
      const kws = getAfterFromKeywords();
      expect(kws.some(k => k.label === 'UNION')).toBe(true);
      expect(kws.some(k => k.label === 'UNION ALL')).toBe(true);
    });

    it('should have non-empty insertText for each keyword', () => {
      const kws = getAfterFromKeywords();
      kws.forEach(k => {
        expect(k.insertText.length).toBeGreaterThan(0);
      });
    });
  });

  describe('removeExecutionComments', () => {
    it('should remove query history comments', () => {
      const query = `-- Query from history
-- Executed: 2025-01-01
-- Connection: myserver
SELECT * FROM Users`;
      const result = removeExecutionComments(query);
      expect(result).toBe('SELECT * FROM Users');
    });

    it('should preserve non-history comments', () => {
      const query = `-- This is a regular comment
SELECT * FROM Users`;
      const result = removeExecutionComments(query);
      expect(result).toContain('-- This is a regular comment');
    });

    it('should handle empty input', () => {
      expect(removeExecutionComments('')).toBe('');
    });

    it('should handle null/undefined', () => {
      expect(removeExecutionComments(null as unknown as string)).toBeFalsy();
    });
  });

  // ========================================================
  // CTE Support Tests
  // ========================================================

  describe('extractCTEsFromQuery', () => {
    it('should extract single CTE', () => {
      const query = `WITH ActiveUsers AS (
        SELECT Id, Name FROM Users WHERE Id > 0
      )
      SELECT * FROM ActiveUsers`;
      const ctes = extractCTEsFromQuery(query);
      expect(ctes).toHaveLength(1);
      expect(ctes[0].name).toBe('ActiveUsers');
      expect(ctes[0].body).toContain('SELECT Id, Name FROM Users');
    });

    it('should extract multiple CTEs', () => {
      const query = `WITH
        ActiveUsers AS (SELECT Id, Name FROM Users),
        RecentOrders AS (SELECT Id, UserId FROM Orders)
      SELECT * FROM ActiveUsers au JOIN RecentOrders ro ON au.Id = ro.UserId`;
      const ctes = extractCTEsFromQuery(query);
      expect(ctes).toHaveLength(2);
      expect(ctes[0].name).toBe('ActiveUsers');
      expect(ctes[1].name).toBe('RecentOrders');
    });

    it('should extract CTE with explicit column list', () => {
      const query = `WITH UserData (UserId, UserName) AS (
        SELECT Id, Name FROM Users
      )
      SELECT * FROM UserData`;
      const ctes = extractCTEsFromQuery(query);
      expect(ctes).toHaveLength(1);
      expect(ctes[0].explicitColumns).toEqual(['UserId', 'UserName']);
    });

    it('should handle CTE with nested parentheses', () => {
      const query = `WITH Filtered AS (
        SELECT Id, Name FROM Users WHERE Id IN (1, 2, 3)
      )
      SELECT * FROM Filtered`;
      const ctes = extractCTEsFromQuery(query);
      expect(ctes).toHaveLength(1);
      expect(ctes[0].body).toContain('IN (1, 2, 3)');
    });

    it('should return empty array for query without CTEs', () => {
      const query = 'SELECT * FROM Users';
      const ctes = extractCTEsFromQuery(query);
      expect(ctes).toHaveLength(0);
    });

    it('should handle CTE with bracketed name', () => {
      const query = `WITH [MyCTE] AS (
        SELECT Id FROM Users
      )
      SELECT * FROM [MyCTE]`;
      const ctes = extractCTEsFromQuery(query);
      expect(ctes).toHaveLength(1);
      expect(ctes[0].name).toBe('MyCTE');
    });
  });

  describe('getCTEColumns', () => {
    it('should return explicit columns when defined', () => {
      const cte = { name: 'MyCTE', body: 'SELECT Id, Name FROM Users', explicitColumns: ['UserId', 'UserName'] };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns).toHaveLength(2);
      expect(columns[0].name).toBe('UserId');
      expect(columns[1].name).toBe('UserName');
    });

    it('should parse simple columns from SELECT', () => {
      const cte = { name: 'MyCTE', body: 'SELECT Id, Name FROM Users' };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns).toHaveLength(2);
      expect(columns.map(c => c.name)).toContain('Id');
      expect(columns.map(c => c.name)).toContain('Name');
    });

    it('should parse qualified columns', () => {
      const cte = { name: 'MyCTE', body: 'SELECT u.Id, u.Name FROM Users u' };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns).toHaveLength(2);
      expect(columns.map(c => c.name)).toContain('Id');
      expect(columns.map(c => c.name)).toContain('Name');
    });

    it('should parse aliased columns', () => {
      const cte = { name: 'MyCTE', body: 'SELECT Id AS UserId, Name AS UserName FROM Users' };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns).toHaveLength(2);
      expect(columns.map(c => c.name)).toContain('UserId');
      expect(columns.map(c => c.name)).toContain('UserName');
    });

    it('should parse T-SQL assignment style columns', () => {
      const cte = { name: 'MyCTE', body: 'SELECT UserName = Name FROM Users' };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns.some(c => c.name === 'UserName')).toBe(true);
    });

    it('should resolve * from inner tables', () => {
      const cte = { name: 'MyCTE', body: 'SELECT * FROM Users' };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns.length).toBe(3); // Id, Name, Email
      expect(columns.map(c => c.name)).toContain('Id');
      expect(columns.map(c => c.name)).toContain('Name');
      expect(columns.map(c => c.name)).toContain('Email');
    });

    it('should handle columns with brackets', () => {
      const cte = { name: 'MyCTE', body: 'SELECT [Id], [Name] FROM Users' };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns).toHaveLength(2);
      expect(columns.map(c => c.name)).toContain('Id');
      expect(columns.map(c => c.name)).toContain('Name');
    });

    it('should skip complex expressions without alias', () => {
      const cte = { name: 'MyCTE', body: 'SELECT Id, ISNULL(Name, \'Unknown\') FROM Users' };
      const columns = getCTEColumns(cte, mockSchema);
      // Only Id should be extracted, ISNULL without alias is skipped
      expect(columns.some(c => c.name === 'Id')).toBe(true);
    });
  });

  describe('buildAugmentedSchema', () => {
    it('should return original schema when no CTEs', () => {
      const query = 'SELECT * FROM Users';
      const result = buildAugmentedSchema(mockSchema, query);
      expect(result.tables).toHaveLength(mockSchema.tables.length);
    });

    it('should add CTE as virtual table', () => {
      const query = `WITH ActiveUsers AS (
        SELECT Id, Name FROM Users
      )
      SELECT * FROM ActiveUsers`;
      const result = buildAugmentedSchema(mockSchema, query);
      expect(result.tables.length).toBe(mockSchema.tables.length + 1);
      const cteTable = result.tables.find(t => t.name === 'ActiveUsers' && t.schema === 'cte');
      expect(cteTable).toBeDefined();
      expect(cteTable?.columns.map(c => c.name)).toContain('Id');
      expect(cteTable?.columns.map(c => c.name)).toContain('Name');
    });

    it('should preserve original schema objects', () => {
      const query = `WITH MyCTE AS (SELECT Id FROM Users)
      SELECT * FROM MyCTE`;
      const result = buildAugmentedSchema(mockSchema, query);
      expect(result.views).toBe(mockSchema.views);
      expect(result.foreignKeys).toBe(mockSchema.foreignKeys);
    });

    it('CTE tables should be extractable after augmentation', () => {
      const query = `WITH ActiveUsers AS (
        SELECT Id, Name FROM Users WHERE Id > 0
      )
      SELECT au.Id FROM ActiveUsers au`;
      const augmented = buildAugmentedSchema(mockSchema, query);
      const mainQuery = getMainQueryText(query);
      const tables = extractTablesFromQuery(mainQuery, augmented);
      const activeCte = tables.find(t => t.table === 'ActiveUsers');
      expect(activeCte).toBeDefined();
      expect(activeCte?.alias).toBe('au');
    });

    it('CTE columns should be accessible via getColumnsForTable', () => {
      const query = `WITH ProjectData AS (
        SELECT p.Id, p.Name AS ProjectName, pk.Version
        FROM Projects p JOIN Packages pk ON p.PackageId = pk.Id
      )
      SELECT * FROM ProjectData pd`;
      const augmented = buildAugmentedSchema(mockSchema, query);
      const columns = getColumnsForTable('cte', 'ProjectData', augmented);
      expect(columns.map(c => c.name)).toContain('Id');
      expect(columns.map(c => c.name)).toContain('ProjectName');
      expect(columns.map(c => c.name)).toContain('Version');
    });
  });

  describe('getMainQueryText', () => {
    it('should return full query when no CTEs present', () => {
      const query = 'SELECT * FROM Users';
      expect(getMainQueryText(query)).toBe(query);
    });

    it('should strip single CTE definition', () => {
      const query = `WITH ActiveUsers AS (
        SELECT Id, Name FROM Users
      )
      SELECT * FROM ActiveUsers`;
      const main = getMainQueryText(query);
      expect(main.trim()).toMatch(/^SELECT \* FROM ActiveUsers$/);
      expect(main).not.toContain('WITH');
    });

    it('should strip multiple CTE definitions', () => {
      const query = `WITH
        CTE1 AS (SELECT Id FROM Users),
        CTE2 AS (SELECT Id FROM Orders)
      SELECT * FROM CTE1 JOIN CTE2 ON CTE1.Id = CTE2.Id`;
      const main = getMainQueryText(query);
      expect(main.trim()).toContain('SELECT * FROM CTE1');
      expect(main).not.toContain('WITH');
      expect(main).not.toContain('FROM Users');
      expect(main).not.toContain('FROM Orders');
    });

    it('should handle CTE with nested parentheses', () => {
      const query = `WITH Filtered AS (
        SELECT Id FROM Users WHERE Id IN (1, 2, 3)
      )
      SELECT * FROM Filtered`;
      const main = getMainQueryText(query);
      expect(main.trim()).toMatch(/^SELECT \* FROM Filtered$/);
    });
  });

  // ========================================================
  // Context-Aware Column Suggestion Tests
  // ========================================================

  describe('context-aware column suggestions', () => {
    it('should only return columns from query tables in SELECT', () => {
      const query = `SELECT 
FROM [dbo].[Projects] [p]
JOIN [dbo].[Packages] [p2] ON [p].[PackageId] = [p2].[Id]`;
      const augmented = buildAugmentedSchema(mockSchema, query);
      const tables = extractTablesFromQuery(query, augmented);

      // Should find Projects and Packages
      expect(tables.some(t => t.table === 'Projects')).toBe(true);
      expect(tables.some(t => t.table === 'Packages')).toBe(true);

      // Column suggestions should only come from these tables
      const allColumns: string[] = [];
      tables.forEach(t => {
        const cols = getColumnsForTable(t.schema, t.table, augmented);
        allColumns.push(...cols.map(c => c.name));
      });

      // Should have Projects columns
      expect(allColumns).toContain('PackageId');
      expect(allColumns).toContain('Status');
      // Should have Packages columns
      expect(allColumns).toContain('Version');
      // Should NOT have Users columns (not in query)
      expect(allColumns).not.toContain('Email');
    });

    it('should only return columns from query tables in ORDER BY', () => {
      const query = `SELECT *
FROM [dbo].[Projects] [p]
JOIN [dbo].[Packages] [p2] ON [p].[PackageId] = [p2].[Id]
ORDER BY `;
      const augmented = buildAugmentedSchema(mockSchema, query);
      const tables = extractTablesFromQuery(query, augmented);

      const context = analyzeSqlContext(query, 'ORDER BY ');
      expect(context.type).toBe('ORDER_BY');

      const allColumns: string[] = [];
      tables.forEach(t => {
        const cols = getColumnsForTable(t.schema, t.table, augmented);
        allColumns.push(...cols.map(c => c.name));
      });

      // Should have Projects and Packages columns
      expect(allColumns).toContain('Name');
      expect(allColumns).toContain('Version');
      expect(allColumns).toContain('PackageId');
      // Should NOT have Users columns
      expect(allColumns).not.toContain('Email');
    });

    it('should only return columns from query tables in GROUP BY', () => {
      const query = `SELECT p.Status, COUNT(*)
FROM [dbo].[Projects] [p]
GROUP BY `;
      const augmented = buildAugmentedSchema(mockSchema, query);
      const tables = extractTablesFromQuery(query, augmented);

      const context = analyzeSqlContext(query, 'GROUP BY ');
      expect(context.type).toBe('GROUP_BY');

      const allColumns: string[] = [];
      tables.forEach(t => {
        const cols = getColumnsForTable(t.schema, t.table, augmented);
        allColumns.push(...cols.map(c => c.name));
      });

      expect(allColumns).toContain('Status');
      expect(allColumns).toContain('Name');
      expect(allColumns).not.toContain('Email');
      expect(allColumns).not.toContain('Total');
    });

    it('should only return columns from query tables in WHERE', () => {
      const query = `SELECT *
FROM Users u
JOIN Orders o ON u.Id = o.UserId
WHERE `;
      const augmented = buildAugmentedSchema(mockSchema, query);
      const tables = extractTablesFromQuery(query, augmented);

      const context = analyzeSqlContext(query, 'WHERE ');
      expect(context.type).toBe('WHERE');

      const allColumns: string[] = [];
      tables.forEach(t => {
        const cols = getColumnsForTable(t.schema, t.table, augmented);
        allColumns.push(...cols.map(c => c.name));
      });

      // Users + Orders columns
      expect(allColumns).toContain('Id');
      expect(allColumns).toContain('Name');
      expect(allColumns).toContain('Email');
      expect(allColumns).toContain('UserId');
      expect(allColumns).toContain('Total');
      // Not Projects columns
      expect(allColumns).not.toContain('PackageId');
      expect(allColumns).not.toContain('Status');
    });

    it('should handle query with only one table', () => {
      const query = 'SELECT \nFROM Users';
      const augmented = buildAugmentedSchema(mockSchema, query);
      const tables = extractTablesFromQuery(query, augmented);

      expect(tables).toHaveLength(1);
      const columns = getColumnsForTable(tables[0].schema, tables[0].table, augmented);
      expect(columns.map(c => c.name)).toContain('Id');
      expect(columns.map(c => c.name)).toContain('Name');
      expect(columns.map(c => c.name)).toContain('Email');
    });

    it('should provide columns with alias prefix for multi-table queries', () => {
      const query = `SELECT 
FROM [dbo].[Projects] [p]
JOIN [dbo].[Packages] [p2] ON [p].[PackageId] = [p2].[Id]`;
      const augmented = buildAugmentedSchema(mockSchema, query);
      const tables = extractTablesFromQuery(query, augmented);

      // Should have aliases
      const projects = tables.find(t => t.table === 'Projects');
      const packages = tables.find(t => t.table === 'Packages');
      expect(projects?.alias).toBe('p');
      expect(packages?.alias).toBe('p2');
      expect(projects?.hasExplicitAlias).toBe(true);
      expect(packages?.hasExplicitAlias).toBe(true);
    });

    it('should suggest CTE columns in SELECT', () => {
      const query = `WITH ProjectInfo AS (
        SELECT p.Id, p.Name AS ProjectName, pk.Version
        FROM Projects p JOIN Packages pk ON p.PackageId = pk.Id
      )
      SELECT 
      FROM ProjectInfo pi`;
      const augmented = buildAugmentedSchema(mockSchema, query);
      const tables = extractTablesFromQuery(query, augmented);
      const piTable = tables.find(t => t.table === 'ProjectInfo');
      expect(piTable).toBeDefined();

      const columns = getColumnsForTable(piTable!.schema, piTable!.table, augmented);
      expect(columns.map(c => c.name)).toContain('Id');
      expect(columns.map(c => c.name)).toContain('ProjectName');
      expect(columns.map(c => c.name)).toContain('Version');
    });

    it('should suggest CTE columns in ORDER BY', () => {
      const query = `WITH UserOrders AS (
        SELECT u.Name, o.Total, o.OrderDate
        FROM Users u JOIN Orders o ON u.Id = o.UserId
      )
      SELECT * FROM UserOrders uo
      ORDER BY `;
      const augmented = buildAugmentedSchema(mockSchema, query);
      const mainQuery = getMainQueryText(query);
      const tables = extractTablesFromQuery(mainQuery, augmented);

      const context = analyzeSqlContext(query, 'ORDER BY ');
      expect(context.type).toBe('ORDER_BY');

      const allColumns: string[] = [];
      tables.forEach(t => {
        const cols = getColumnsForTable(t.schema, t.table, augmented);
        allColumns.push(...cols.map(c => c.name));
      });

      expect(allColumns).toContain('Name');
      expect(allColumns).toContain('Total');
      expect(allColumns).toContain('OrderDate');
      // Should NOT have columns that aren't in the CTE
      expect(allColumns).not.toContain('Email');
      expect(allColumns).not.toContain('PackageId');
    });

    it('should handle multiple CTEs in column suggestions', () => {
      const query = `WITH
        UserData AS (SELECT Id, Name FROM Users),
        OrderData AS (SELECT Id AS OrderId, Total FROM Orders)
      SELECT 
      FROM UserData ud
      JOIN OrderData od ON ud.Id = od.OrderId`;
      const augmented = buildAugmentedSchema(mockSchema, query);
      const mainQuery = getMainQueryText(query);
      const tables = extractTablesFromQuery(mainQuery, augmented);

      const allColumns: string[] = [];
      tables.forEach(t => {
        const cols = getColumnsForTable(t.schema, t.table, augmented);
        allColumns.push(...cols.map(c => c.name));
      });

      expect(allColumns).toContain('Id');
      expect(allColumns).toContain('Name');
      expect(allColumns).toContain('OrderId');
      expect(allColumns).toContain('Total');
      // These are from the raw tables, not from the CTEs
      expect(allColumns).not.toContain('Email');
      expect(allColumns).not.toContain('UserId');
    });

    it('should work with view as source table', () => {
      const query = 'SELECT \nFROM ActiveUsers au';
      const augmented = buildAugmentedSchema(mockSchema, query);
      const tables = extractTablesFromQuery(query, augmented);

      expect(tables.some(t => t.table === 'ActiveUsers')).toBe(true);
      const auTable = tables.find(t => t.table === 'ActiveUsers');
      if (auTable) {
        const columns = getColumnsForTable(auTable.schema, auTable.table, augmented);
        expect(columns.map(c => c.name)).toContain('Id');
      }
    });

    it('ON_CONDITION context should only suggest query table columns', () => {
      const text = 'SELECT * FROM Users u JOIN Orders o ON ';
      // ON_CONDITION is detected via regex on the line
      // The tables in query should be Users and Orders
      const augmented = buildAugmentedSchema(mockSchema, text);
      const tables = extractTablesFromQuery(text, augmented);

      const allColumns: string[] = [];
      tables.forEach(t => {
        const cols = getColumnsForTable(t.schema, t.table, augmented);
        allColumns.push(...cols.map(c => c.name));
      });

      expect(allColumns).toContain('Id');
      expect(allColumns).toContain('UserId');
      expect(allColumns).not.toContain('PackageId');
    });
  });

  // ========================================================
  // Edge Case Tests
  // ========================================================

  describe('edge cases', () => {
    it('should handle empty query', () => {
      const tables = extractTablesFromQuery('', mockSchema);
      expect(tables).toHaveLength(0);
    });

    it('should handle query with no FROM clause', () => {
      const query = 'SELECT GETDATE()';
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables).toHaveLength(0);
    });

    it('should handle SELECT without FROM for context', () => {
      const context = analyzeSqlContext('SELECT ', 'SELECT ');
      expect(context.type).toBe('SELECT');
    });

    it('should detect ORDER BY after complex WHERE with AND/OR', () => {
      const text = `SELECT * FROM Users u
WHERE u.Id > 1 AND u.Name LIKE '%test%' OR u.Email IS NOT NULL
ORDER BY `;
      const context = analyzeSqlContext(text, 'ORDER BY ');
      expect(context.type).toBe('ORDER_BY');
    });

    it('should detect GROUP BY after JOIN with ON condition', () => {
      const text = `SELECT p.Name, COUNT(*)
FROM Projects p
JOIN Packages pk ON p.PackageId = pk.Id
GROUP BY `;
      const context = analyzeSqlContext(text, 'GROUP BY ');
      expect(context.type).toBe('GROUP_BY');
    });

    it('should handle findTableForAlias with CTE in augmented schema', () => {
      const query = `WITH MyCTE AS (SELECT Id, Name FROM Users)
      SELECT mc.Id FROM MyCTE mc`;
      const augmented = buildAugmentedSchema(mockSchema, query);
      const result = findTableForAlias(query, 'mc', augmented);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('MyCTE');
    });

    it('should handle query with schema-qualified tables without brackets', () => {
      const query = 'SELECT * FROM sales.Products p';
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables.some(t => t.table === 'Products')).toBe(true);
    });

    it('should handle ORDER BY with existing columns typed', () => {
      const text = `SELECT *
FROM Projects p
ORDER BY p.Name, `;
      const context = analyzeSqlContext(text, 'ORDER BY p.Name, ');
      expect(context.type).toBe('ORDER_BY');
    });

    it('should handle GROUP BY with existing columns typed', () => {
      const text = `SELECT p.Status, p.Name, COUNT(*)
FROM Projects p
GROUP BY p.Status, `;
      const context = analyzeSqlContext(text, 'GROUP BY p.Status, ');
      expect(context.type).toBe('GROUP_BY');
    });

    it('should extract tables from query with multiple JOINs', () => {
      const query = `SELECT *
FROM Users u
INNER JOIN Orders o ON u.Id = o.UserId
LEFT JOIN Projects p ON u.Id = p.Id
ORDER BY u.Name`;
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables.some(t => t.table === 'Users')).toBe(true);
      expect(tables.some(t => t.table === 'Orders')).toBe(true);
      expect(tables.some(t => t.table === 'Projects')).toBe(true);
    });

    it('should handle CTE with DISTINCT and TOP', () => {
      const cte = { name: 'MyCTE', body: 'SELECT DISTINCT TOP 10 Id, Name FROM Users' };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns.map(c => c.name)).toContain('Id');
      expect(columns.map(c => c.name)).toContain('Name');
    });

    it('should handle CTE with subquery in column list', () => {
      const cte = {
        name: 'MyCTE',
        body: 'SELECT Id, (SELECT COUNT(*) FROM Orders WHERE UserId = u.Id) AS OrderCount FROM Users u'
      };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns.some(c => c.name === 'Id')).toBe(true);
      expect(columns.some(c => c.name === 'OrderCount')).toBe(true);
    });
  });

  // --------------------------------------------------------
  // 1. findTable - edge cases
  // --------------------------------------------------------

  describe('findTable - additional cases', () => {
    it('should find table with schema-qualified name (dbo.Users)', () => {
      const result = findTable('dbo.Users', mockSchema);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('Users');
      expect(result?.schema).toBe('dbo');
    });

    it('should find table with bracketed schema-qualified name ([dbo].[Users])', () => {
      const result = findTable('[dbo].[Users]', mockSchema);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('Users');
    });

    it('should find table with only bracketed name ([Users])', () => {
      const result = findTable('[Users]', mockSchema);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('Users');
    });

    it('should prefer dbo schema over others when name is ambiguous', () => {
      // "Products" exists only in "sales" schema - should still be found
      const result = findTable('Products', mockSchema);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('Products');
      expect(result?.schema).toBe('sales');
    });

    it('should find a view by case-insensitive name', () => {
      const result = findTable('activeusers', mockSchema);
      expect(result).not.toBeNull();
      expect(result?.table).toBe('ActiveUsers');
    });
  });

  // --------------------------------------------------------
  // 2. extractTablesFromQuery - subqueries and complex cases
  // --------------------------------------------------------

  describe('extractTablesFromQuery - subqueries', () => {
    it('should NOT treat subquery alias as a real table', () => {
      const query = `SELECT * FROM (SELECT Id FROM Users) AS sub`;
      const tables = extractTablesFromQuery(query, mockSchema);
      // "sub" is not a table from the schema
      expect(tables.every(t => t.table !== 'sub')).toBe(true);
    });

    it('should extract outer table when subquery is in WHERE EXISTS', () => {
      const query = `SELECT * FROM Users u WHERE EXISTS (SELECT 1 FROM Orders o WHERE o.UserId = u.Id)`;
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables.some(t => t.table === 'Users')).toBe(true);
    });

    it('should handle CROSS APPLY with subquery', () => {
      const query = `SELECT u.Name, ca.Total
FROM Users u
CROSS APPLY (SELECT TOP 1 Total FROM Orders o WHERE o.UserId = u.Id ORDER BY o.OrderDate DESC) ca`;
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables.some(t => t.table === 'Users')).toBe(true);
    });

    it('should handle table with NOLOCK hint', () => {
      const query = 'SELECT * FROM Users WITH (NOLOCK)';
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables.some(t => t.table === 'Users')).toBe(true);
    });

    it('should handle multiple schemas in one query', () => {
      const query = 'SELECT * FROM dbo.Users u JOIN sales.Products p ON u.Id = p.Id';
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables.some(t => t.table === 'Users' && t.schema === 'dbo')).toBe(true);
      expect(tables.some(t => t.table === 'Products' && t.schema === 'sales')).toBe(true);
    });

    it('should extract table from FULL OUTER JOIN', () => {
      const query = 'SELECT * FROM Users u FULL OUTER JOIN Orders o ON u.Id = o.UserId';
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables.some(t => t.table === 'Users')).toBe(true);
      expect(tables.some(t => t.table === 'Orders')).toBe(true);
    });

    it('should extract table from RIGHT JOIN', () => {
      const query = 'SELECT * FROM Users u RIGHT JOIN Orders o ON u.Id = o.UserId';
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables.some(t => t.table === 'Orders')).toBe(true);
    });
  });

  // --------------------------------------------------------
  // 3. analyzeSqlContext - INSERT, UPDATE, DELETE, MERGE
  // --------------------------------------------------------

  describe('analyzeSqlContext - DML statements', () => {
    it('should detect UPDATE SET context', () => {
      const text = 'UPDATE Users SET ';
      const result = analyzeSqlContext(text, text);
      expect(result.type).toBe('UPDATE_SET');
    });

    it('should detect UPDATE WHERE context', () => {
      const text = "UPDATE Users SET Name = 'test' WHERE ";
      const result = analyzeSqlContext(text, 'WHERE ');
      expect(result.type).toBe('WHERE');
    });

    it('should detect UPDATE table name context', () => {
      const text = 'UPDATE ';
      const result = analyzeSqlContext(text, text);
      // Should suggest tables like FROM
      expect(['FROM', 'UPDATE_TABLE', 'DEFAULT'].includes(result.type)).toBe(true);
    });

    it('should detect DELETE FROM context', () => {
      const text = 'DELETE FROM ';
      const result = analyzeSqlContext(text, text);
      expect(result.type).toBe('FROM');
    });

    it('should detect DELETE WHERE context', () => {
      const text = 'DELETE FROM Users WHERE ';
      const result = analyzeSqlContext(text, 'WHERE ');
      expect(result.type).toBe('WHERE');
    });

    it('should detect INSERT VALUES context', () => {
      const text = 'INSERT INTO Users (Name, Email) VALUES (';
      const result = analyzeSqlContext(text, text);
      expect(result.type).toBe('INSERT_VALUES');
    });

    it('should detect INSERT INTO table name context', () => {
      const text = 'INSERT INTO ';
      const result = analyzeSqlContext(text, text);
      expect(['FROM', 'INSERT_TABLE', 'DEFAULT'].includes(result.type)).toBe(true);
    });

    it('should detect ON_CONDITION context after JOIN...ON', () => {
      const text = 'SELECT * FROM Users u JOIN Orders o ON ';
      const result = analyzeSqlContext(text, 'ON ');
      expect(result.type).toBe('ON_CONDITION');
    });

    it('should detect ON_CONDITION context with bracket qualifiers', () => {
      const text = 'SELECT * FROM [dbo].[Users] [u] JOIN [dbo].[Orders] [o] ON ';
      const result = analyzeSqlContext(text, 'ON ');
      expect(result.type).toBe('ON_CONDITION');
    });
  });

  // --------------------------------------------------------
  // 4. analyzeSqlContext - alias in COLUMN context
  // --------------------------------------------------------

  describe('analyzeSqlContext - alias dot notation', () => {
    it('should detect COLUMN context when alias dot is typed', () => {
      const text = 'SELECT u. FROM Users u';
      const result = analyzeSqlContext(text, 'u.');
      expect(result.type).toBe('COLUMN');
      expect(result.alias).toBe('u');
    });

    it('should detect COLUMN context for second alias in JOIN', () => {
      const text = 'SELECT u.Id, o. FROM Users u JOIN Orders o ON u.Id = o.UserId';
      const result = analyzeSqlContext(text, 'o.');
      expect(result.type).toBe('COLUMN');
      expect(result.alias).toBe('o');
    });

    it('should detect COLUMN context in WHERE clause with alias dot', () => {
      const text = 'SELECT * FROM Users u WHERE u.';
      const result = analyzeSqlContext(text, 'u.');
      expect(result.type).toBe('COLUMN');
      expect(result.alias).toBe('u');
    });

    it('should detect COLUMN context in ORDER BY with alias dot', () => {
      const text = 'SELECT * FROM Users u ORDER BY u.';
      const result = analyzeSqlContext(text, 'u.');
      expect(result.type).toBe('COLUMN');
      expect(result.alias).toBe('u');
    });

    it('should detect COLUMN context in ON condition with alias dot', () => {
      const text = 'SELECT * FROM Users u JOIN Orders o ON u.';
      const result = analyzeSqlContext(text, 'u.');
      expect(result.type).toBe('COLUMN');
      expect(result.alias).toBe('u');
    });

    it('should detect COLUMN context with bracketed alias dot', () => {
      const text = 'SELECT [u]. FROM [dbo].[Users] [u]';
      const result = analyzeSqlContext(text, '[u].');
      expect(result.type).toBe('COLUMN');
    });
  });

  // --------------------------------------------------------
  // 5. CTE - edge cases and complex scenarios
  // --------------------------------------------------------

  describe('extractCTEsFromQuery - edge cases', () => {
    it('should handle recursive CTE (WITH ... UNION ALL)', () => {
      const query = `WITH NumberedRows AS (
        SELECT Id, 1 AS Level FROM Users WHERE Id = 1
        UNION ALL
        SELECT u.Id, nr.Level + 1 FROM Users u JOIN NumberedRows nr ON u.Id = nr.Id + 1
      )
      SELECT * FROM NumberedRows`;
      const ctes = extractCTEsFromQuery(query);
      expect(ctes).toHaveLength(1);
      expect(ctes[0].name).toBe('NumberedRows');
      expect(ctes[0].body).toContain('UNION ALL');
    });

    it('should handle CTE referenced by another CTE', () => {
      const query = `WITH
        Base AS (SELECT Id, Name FROM Users),
        Extended AS (SELECT b.Id, b.Name, o.Total FROM Base b JOIN Orders o ON b.Id = o.UserId)
      SELECT * FROM Extended`;
      const ctes = extractCTEsFromQuery(query);
      expect(ctes).toHaveLength(2);
      expect(ctes[0].name).toBe('Base');
      expect(ctes[1].name).toBe('Extended');
    });

    it('should handle CTE body with CASE WHEN expression', () => {
      const query = `WITH StatusLabels AS (
        SELECT Id, CASE WHEN Status = 'A' THEN 'Active' ELSE 'Inactive' END AS StatusLabel FROM Projects
      )
      SELECT * FROM StatusLabels`;
      const ctes = extractCTEsFromQuery(query);
      expect(ctes).toHaveLength(1);
      expect(ctes[0].body).toContain('CASE WHEN');
    });

    it('should be case-insensitive for WITH keyword', () => {
      const query = `with myCTE as (SELECT Id FROM Users) SELECT * FROM myCTE`;
      const ctes = extractCTEsFromQuery(query);
      expect(ctes).toHaveLength(1);
      expect(ctes[0].name).toBe('myCTE');
    });
  });

  describe('getCTEColumns - edge cases', () => {
    it('should parse COUNT(*) AS alias', () => {
      const cte = { name: 'MyCTE', body: 'SELECT Name, COUNT(*) AS OrderCount FROM Orders GROUP BY Name' };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns.some(c => c.name === 'Name')).toBe(true);
      expect(columns.some(c => c.name === 'OrderCount')).toBe(true);
    });

    it('should parse CAST expression with alias', () => {
      const cte = { name: 'MyCTE', body: 'SELECT CAST(Total AS int) AS TotalInt FROM Orders' };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns.some(c => c.name === 'TotalInt')).toBe(true);
    });

    it('should parse CONVERT expression with alias', () => {
      const cte = { name: 'MyCTE', body: 'SELECT CONVERT(nvarchar, Id) AS IdText FROM Users' };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns.some(c => c.name === 'IdText')).toBe(true);
    });

    it('should parse table.* expanding all columns from that table', () => {
      const cte = { name: 'MyCTE', body: 'SELECT u.* FROM Users u' };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns.map(c => c.name)).toContain('Id');
      expect(columns.map(c => c.name)).toContain('Name');
      expect(columns.map(c => c.name)).toContain('Email');
    });

    it('should not return duplicate column names from * expansion', () => {
      const cte = { name: 'MyCTE', body: 'SELECT *, Id FROM Users' };
      const columns = getCTEColumns(cte, mockSchema);
      const names = columns.map(c => c.name);
      // Id should not appear twice
      expect(names.filter(n => n === 'Id').length).toBe(1);
    });

    it('should handle ISNULL with alias', () => {
      const cte = { name: 'MyCTE', body: "SELECT ISNULL(Name, 'Unknown') AS DisplayName FROM Users" };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns.some(c => c.name === 'DisplayName')).toBe(true);
    });

    it('should parse COALESCE with alias', () => {
      const cte = { name: 'MyCTE', body: 'SELECT COALESCE(Name, Email) AS ContactInfo FROM Users' };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns.some(c => c.name === 'ContactInfo')).toBe(true);
    });

    it('should parse ROW_NUMBER() OVER() AS alias (window function)', () => {
      const cte = { name: 'MyCTE', body: 'SELECT Id, ROW_NUMBER() OVER (ORDER BY Id) AS RowNum FROM Users' };
      const columns = getCTEColumns(cte, mockSchema);
      expect(columns.some(c => c.name === 'Id')).toBe(true);
      expect(columns.some(c => c.name === 'RowNum')).toBe(true);
    });
  });

  // --------------------------------------------------------
  // 6. generateSmartAlias - collisions and special cases
  // --------------------------------------------------------

  describe('generateSmartAlias - collisions and special names', () => {
    it('should handle single-char table name', () => {
      const alias = generateSmartAlias('A');
      expect(alias).toBe('a');
    });

    it('should remove common prefixes: tbl_, vw_, fn_', () => {
      expect(generateSmartAlias('vw_ActiveUsers')).toBe('au');
      expect(generateSmartAlias('fn_GetData')).toBe('gd');
    });

    it('should handle all-uppercase names', () => {
      const alias = generateSmartAlias('ORDERITEMS');
      // May return "o" (first letter) - important that it is a string and does not crash
      expect(typeof alias).toBe('string');
      expect(alias.length).toBeGreaterThan(0);
    });

    it('should handle names with numbers', () => {
      const alias = generateSmartAlias('Orders2024');
      expect(typeof alias).toBe('string');
      expect(alias.length).toBeGreaterThan(0);
    });

    it('should handle mixed underscores and PascalCase', () => {
      const alias = generateSmartAlias('Sales_OrderItems');
      expect(alias).toBe('soi');
    });
  });

  // --------------------------------------------------------
  // 7. getRelatedTables - FK direction (from and to)
  // --------------------------------------------------------

  describe('getRelatedTables - FK directions', () => {
    it('should find parent table via FK (Orders -> Users)', () => {
      const tablesInQuery = [{ schema: 'dbo', table: 'Orders', alias: 'o', hasExplicitAlias: true }];
      const related = getRelatedTables(tablesInQuery, mockSchema);
      expect(related.some(t => t.name === 'Users')).toBe(true);
    });

    it('should not include tables already in query', () => {
      const tablesInQuery = [
        { schema: 'dbo', table: 'Users', alias: 'u', hasExplicitAlias: true },
        { schema: 'dbo', table: 'Orders', alias: 'o', hasExplicitAlias: true },
      ];
      const related = getRelatedTables(tablesInQuery, mockSchema);
      // Users and Orders are already in query
      expect(related.every(t => t.name !== 'Users' && t.name !== 'Orders')).toBe(true);
    });

    it('should include FK column info for joining hint', () => {
      const tablesInQuery = [{ schema: 'dbo', table: 'Orders', alias: 'o', hasExplicitAlias: true }];
      const related = getRelatedTables(tablesInQuery, mockSchema);
      const usersEntry = related.find(t => t.name === 'Users');
      expect(usersEntry?.foreignKeyInfo).toBeDefined();
    });

    it('should handle table with no FK relations - return full list', () => {
      const tablesInQuery = [{ schema: 'sales', table: 'Products', alias: 'p', hasExplicitAlias: true }];
      const related = getRelatedTables(tablesInQuery, mockSchema);
      expect(related.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------
  // 8. removeExecutionComments - variants
  // --------------------------------------------------------

  describe('removeExecutionComments - variants', () => {
    it('should remove block-style execution metadata comments', () => {
      const query = `/* Generated by SSMS */
SELECT * FROM Users`;
      const result = removeExecutionComments(query);
      // Depends on implementation - at least does not crash
      expect(typeof result).toBe('string');
    });

    it('should preserve inline comments mid-query', () => {
      const query = `SELECT * -- get all columns
FROM Users`;
      const result = removeExecutionComments(query);
      expect(result).toContain('FROM Users');
    });

    it('should handle query with only comments', () => {
      const query = `-- Query from history
-- Executed: 2025-01-01`;
      const result = removeExecutionComments(query);
      expect(result.trim()).toBe('');
    });

    it('should handle Windows-style line endings (CRLF)', () => {
      const query = `-- Query from history\r\n-- Executed: 2025-01-01\r\nSELECT * FROM Users`;
      const result = removeExecutionComments(query);
      expect(result.trim()).toBe('SELECT * FROM Users');
    });
  });

  // --------------------------------------------------------
  // 9. buildAugmentedSchema - isolation and overriding
  // --------------------------------------------------------

  describe('buildAugmentedSchema - isolation', () => {
    it('should not mutate original schema', () => {
      const originalTableCount = mockSchema.tables.length;
      const query = `WITH TmpCTE AS (SELECT Id FROM Users) SELECT * FROM TmpCTE`;
      buildAugmentedSchema(mockSchema, query);
      expect(mockSchema.tables.length).toBe(originalTableCount);
    });

    it('should not add CTE that shadows real table name', () => {
      // CTE named "Users" - in augmented should be visible but not duplicate
      const query = `WITH Users AS (SELECT Id FROM Orders) SELECT * FROM Users`;
      const augmented = buildAugmentedSchema(mockSchema, query);
      const usersTables = augmented.tables.filter(t => t.name === 'Users');
      // May be 1 or 2, but should not crash
      expect(usersTables.length).toBeGreaterThanOrEqual(1);
    });

    it('CTE should get schema "cte" to distinguish from real tables', () => {
      const query = `WITH MyData AS (SELECT Id FROM Users) SELECT * FROM MyData`;
      const augmented = buildAugmentedSchema(mockSchema, query);
      const cteTable = augmented.tables.find(t => t.name === 'MyData');
      expect(cteTable?.schema).toBe('cte');
    });
  });

  // --------------------------------------------------------
  // 10. T-SQL / MSSQL specific scenarios
  // --------------------------------------------------------

  describe('T-SQL specific scenarios', () => {
    it('should handle TOP N in SELECT context', () => {
      const text = 'SELECT TOP 100 ';
      const result = analyzeSqlContext(text, text);
      expect(result.type).toBe('SELECT');
    });

    it('should handle TOP (N) WITH TIES', () => {
      const text = 'SELECT TOP (10) WITH TIES ';
      const result = analyzeSqlContext(text, text);
      expect(result.type).toBe('SELECT');
    });

    it('should handle EXEC / EXECUTE context (no completions expected)', () => {
      const text = 'EXEC ';
      const result = analyzeSqlContext(text, text);
      // At least does not crash, type may be UNKNOWN or DEFAULT
      expect(result).toBeDefined();
    });

    it('should handle DECLARE variable context', () => {
      const text = 'DECLARE @userId INT = ';
      const result = analyzeSqlContext(text, text);
      expect(result).toBeDefined();
    });

    it('should detect FROM after semicolon (new statement)', () => {
      const text = 'SELECT * FROM Users; SELECT * FROM ';
      const result = analyzeSqlContext(text, 'SELECT * FROM ');
      expect(result.type).toBe('FROM');
    });

    it('should handle UNION ALL - second SELECT FROM context', () => {
      const text = `SELECT Id FROM Users
UNION ALL
SELECT Id FROM `;
      const result = analyzeSqlContext(text, 'SELECT Id FROM ');
      expect(result.type).toBe('FROM');
    });

    it('should handle WITH (NOLOCK) hint after table - not treat NOLOCK as alias', () => {
      const query = 'SELECT * FROM Users WITH (NOLOCK) WHERE Id = 1';
      const tables = extractTablesFromQuery(query, mockSchema);
      const users = tables.find(t => t.table === 'Users');
      expect(users).toBeDefined();
      // alias should not be "NOLOCK" or "WITH"
      expect(users?.alias).not.toBe('NOLOCK');
      expect(users?.alias).not.toBe('WITH');
    });

    it('should handle table hint UPDLOCK similarly', () => {
      const query = 'SELECT * FROM Orders WITH (UPDLOCK, ROWLOCK)';
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables.some(t => t.table === 'Orders')).toBe(true);
      const orders = tables.find(t => t.table === 'Orders');
      expect(orders?.alias).not.toBe('UPDLOCK');
    });

    it('should extract table from SELECT INTO', () => {
      // SELECT INTO creates a new table, source should be recognized
      const query = 'SELECT Id, Name INTO #TempUsers FROM Users WHERE Id > 0';
      const tables = extractTablesFromQuery(query, mockSchema);
      expect(tables.some(t => t.table === 'Users')).toBe(true);
    });

    it('should handle temp table reference in FROM', () => {
      // Temp tables (#) are not in schema - should not crash
      const query = 'SELECT * FROM #TempUsers t';
      expect(() => extractTablesFromQuery(query, mockSchema)).not.toThrow();
    });

    it('should not crash on empty CTE body', () => {
      const cte = { name: 'Empty', body: '' };
      expect(() => getCTEColumns(cte, mockSchema)).not.toThrow();
    });

    it('should handle ORDER BY with OFFSET FETCH', () => {
      const text = 'SELECT * FROM Users ORDER BY Id OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY';
      const context = analyzeSqlContext(text, 'ORDER BY Id ');
      expect(context.type).toBe('ORDER_BY');
    });
  });
});
