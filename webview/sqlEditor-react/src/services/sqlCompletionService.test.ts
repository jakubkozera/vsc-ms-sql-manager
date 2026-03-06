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
});
