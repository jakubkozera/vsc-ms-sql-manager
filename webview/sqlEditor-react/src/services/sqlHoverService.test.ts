import { describe, it, expect } from 'vitest';
import {
  renderTableMarkdown,
  renderColumnMarkdown,
  renderMultiTableColumnMarkdown,
  renderOutboundForeignKeys,
  renderInboundForeignKeys,
  renderCteMarkdown,
  renderCteColumnMarkdown,
  provideHoverContent,
  isColumnAliasDefinition,
  renderFunctionHover,
  SQL_FUNCTION_DOCS,
} from './sqlHoverService';
import type { ColumnInfo, DatabaseSchema, ForeignKeyInfo } from '../types/schema';

const sampleColumns: ColumnInfo[] = [
  { name: 'Id', type: 'int', nullable: false, isPrimaryKey: true },
  { name: 'Name', type: 'nvarchar', nullable: false, maxLength: 100 },
  { name: 'Email', type: 'nvarchar', nullable: true, maxLength: 255 },
  { name: 'DepartmentId', type: 'int', nullable: true, isForeignKey: true },
];

const sampleSchema: DatabaseSchema = {
  tables: [
    { schema: 'dbo', name: 'Users', columns: sampleColumns },
    {
      schema: 'dbo',
      name: 'Departments',
      columns: [
        { name: 'Id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'Name', type: 'nvarchar', nullable: false, maxLength: 50 },
      ],
    },
    {
      schema: 'hr',
      name: 'Employees',
      columns: [
        { name: 'EmployeeId', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'Name', type: 'nvarchar', nullable: false, maxLength: 100 },
        { name: 'DepartmentId', type: 'int', nullable: true, isForeignKey: true },
      ],
    },
  ],
  views: [],
  foreignKeys: [],
  storedProcedures: [],
  functions: [],
};

describe('renderTableMarkdown', () => {
  it('renders table with columns header', () => {
    const md = renderTableMarkdown('dbo', 'Users', sampleColumns);
    expect(md).toContain('**dbo.Users**');
    expect(md).toContain('4 columns');
    expect(md).toContain('| Column | Type | Nullable |');
  });

  it('shows maxLength in type', () => {
    const md = renderTableMarkdown('dbo', 'Users', sampleColumns);
    expect(md).toContain('nvarchar(100)');
    expect(md).toContain('nvarchar(255)');
  });

  it('shows nullable correctly', () => {
    const md = renderTableMarkdown('dbo', 'Users', sampleColumns);
    // Id is NOT nullable
    expect(md).toMatch(/\| Id \| int \| NO \|/);
    // Email IS nullable
    expect(md).toMatch(/\| Email \| nvarchar\(255\) \| YES \|/);
  });

  it('handles precision and scale', () => {
    const cols: ColumnInfo[] = [
      { name: 'Price', type: 'decimal', nullable: false, precision: 18, scale: 2 },
    ];
    const md = renderTableMarkdown('dbo', 'Products', cols);
    expect(md).toContain('decimal(18,2)');
  });
});

describe('renderColumnMarkdown', () => {
  it('renders column in horizontal table format', () => {
    const col = sampleColumns[0]; // Id
    const md = renderColumnMarkdown('dbo', 'Users', col);
    expect(md).toContain('| Table | Column | Type | Nullable |');
    expect(md).toContain('| dbo.Users | Id | int | NO |');
  });

  it('shows maxLength in type', () => {
    const col = sampleColumns[1]; // Name nvarchar(100)
    const md = renderColumnMarkdown('dbo', 'Users', col);
    expect(md).toContain('nvarchar(100)');
  });

  it('shows nullable YES', () => {
    const col = sampleColumns[2]; // Email nullable
    const md = renderColumnMarkdown('dbo', 'Users', col);
    expect(md).toContain('| YES |');
  });
});

describe('renderMultiTableColumnMarkdown', () => {
  it('shows column from multiple tables', () => {
    const tables = sampleSchema.tables.filter((t) =>
      t.columns.some((c) => c.name === 'Name')
    );
    const md = renderMultiTableColumnMarkdown(tables, 'Name');
    expect(md).toContain('dbo.Users');
    expect(md).toContain('dbo.Departments');
    expect(md).toContain('hr.Employees');
    expect(md).toContain('| Table | Column | Type | Nullable |');
  });
});

describe('provideHoverContent', () => {
  it('returns table hover for standalone table name', () => {
    const result = provideHoverContent(
      'SELECT * FROM Users',
      'SELECT * FROM Users',
      { lineNumber: 1, column: 18 },
      { word: 'Users', startColumn: 15, endColumn: 20 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    expect(result!.contents[0].value).toContain('**dbo.Users**');
    expect(result!.contents[0].value).toContain('Id');
    expect(result!.contents[0].value).toContain('Email');
  });

  it('returns column hover for alias.column', () => {
    const result = provideHoverContent(
      'SELECT u.Name FROM Users u',
      'SELECT u.Name FROM Users u',
      { lineNumber: 1, column: 13 }, // cursor on 'e' in u.Name
      { word: 'Name', startColumn: 10, endColumn: 14 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    expect(result!.contents[0].value).toContain('dbo.Users');
    expect(result!.contents[0].value).toContain('Name');
    expect(result!.contents[0].value).toContain('nvarchar(100)');
  });

  it('returns null for unknown words', () => {
    const result = provideHoverContent(
      'SELECT foo FROM bar',
      'SELECT foo FROM bar',
      { lineNumber: 1, column: 10 },
      { word: 'foo', startColumn: 8, endColumn: 11 },
      sampleSchema
    );
    expect(result).toBeNull();
  });

  it('returns multi-table column hover when column exists in multiple tables', () => {
    // "Name" exists in Users, Departments, Employees
    const result = provideHoverContent(
      'SELECT Name FROM Users',
      'SELECT Name FROM Users',
      { lineNumber: 1, column: 11 },
      { word: 'Name', startColumn: 8, endColumn: 12 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    // Should show table from query (Users) preferentially but result is multi-table format
    expect(result!.contents[0].value).toContain('dbo.Users');
  });

  it('returns single-column hover for unique column name', () => {
    const result = provideHoverContent(
      'SELECT EmployeeId FROM Employees',
      'SELECT EmployeeId FROM Employees',
      { lineNumber: 1, column: 14 },
      { word: 'EmployeeId', startColumn: 8, endColumn: 18 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    expect(result!.contents[0].value).toContain('hr.Employees');
    expect(result!.contents[0].value).toContain('EmployeeId');
  });

  it('returns table hover when hovering table alias followed by dot', () => {
    // Hovering on "u." without column name should show table schema
    const result = provideHoverContent(
      'SELECT u. FROM Users u',
      'SELECT u. FROM Users u',
      { lineNumber: 1, column: 10 },
      { word: 'u', startColumn: 8, endColumn: 9 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    expect(result!.contents[0].value).toContain('**dbo.Users**');
  });

  it('returns null for null word at position', () => {
    const result = provideHoverContent(
      'SELECT * FROM Users',
      'SELECT * FROM Users',
      { lineNumber: 1, column: 1 },
      null,
      sampleSchema
    );
    expect(result).toBeNull();
  });
});

// ─── FK render helpers ────────────────────────────────────────────────────────

const fkSample: ForeignKeyInfo[] = [
  // Users.DepartmentId → Departments.Id  (single-column FK)
  {
    fromSchema: 'dbo', fromTable: 'Users', fromColumn: 'DepartmentId',
    toSchema: 'dbo', toTable: 'Departments', toColumn: 'Id',
    constraintName: 'FK_Users_Departments',
  },
  // Orders multi-column FK: Orders.UserId + Orders.TenantId → Users.Id + Users.TenantId
  {
    fromSchema: 'dbo', fromTable: 'Orders', fromColumn: 'UserId',
    toSchema: 'dbo', toTable: 'Users', toColumn: 'Id',
    constraintName: 'FK_Orders_Users',
  },
  {
    fromSchema: 'dbo', fromTable: 'Orders', fromColumn: 'TenantId',
    toSchema: 'dbo', toTable: 'Users', toColumn: 'TenantId',
    constraintName: 'FK_Orders_Users',
  },
];

describe('renderOutboundForeignKeys', () => {
  it('returns empty string when no outbound FKs', () => {
    const md = renderOutboundForeignKeys('dbo', 'Departments', fkSample);
    expect(md).toBe('');
  });

  it('renders single-column outbound FK', () => {
    const md = renderOutboundForeignKeys('dbo', 'Users', fkSample);
    expect(md).toContain('**References (FK →)**');
    expect(md).toContain('| FK | Table |');
    expect(md).toContain('DepartmentId');
    expect(md).toContain('dbo.Departments');
  });

  it('renders multi-column FK as Col1:Col2', () => {
    const md = renderOutboundForeignKeys('dbo', 'Orders', fkSample);
    expect(md).toContain('UserId:TenantId');
    expect(md).toContain('dbo.Users');
  });

  it('is case-insensitive for schema and table matching', () => {
    const md = renderOutboundForeignKeys('DBO', 'USERS', fkSample);
    expect(md).toContain('DepartmentId');
  });
});

describe('renderInboundForeignKeys', () => {
  it('returns empty string when no inbound FKs', () => {
    const md = renderInboundForeignKeys('dbo', 'Orders', fkSample);
    expect(md).toBe('');
  });

  it('renders single inbound FK', () => {
    const md = renderInboundForeignKeys('dbo', 'Departments', fkSample);
    expect(md).toContain('**Referenced By (← FK)**');
    expect(md).toContain('| FK | Table |');
    expect(md).toContain('DepartmentId');
    expect(md).toContain('dbo.Users');
  });

  it('renders multi-column inbound FK as Col1:Col2', () => {
    const md = renderInboundForeignKeys('dbo', 'Users', fkSample);
    expect(md).toContain('**Referenced By (← FK)**');
    expect(md).toContain('UserId:TenantId');
    expect(md).toContain('dbo.Orders');
  });

  it('is case-insensitive for schema and table matching', () => {
    const md = renderInboundForeignKeys('DBO', 'DEPARTMENTS', fkSample);
    expect(md).toContain('DepartmentId');
  });
});

describe('provideHoverContent with FK info', () => {
  const schemaWithFKs: DatabaseSchema = {
    ...sampleSchema,
    foreignKeys: [
      {
        fromSchema: 'dbo', fromTable: 'Users', fromColumn: 'DepartmentId',
        toSchema: 'dbo', toTable: 'Departments', toColumn: 'Id',
        constraintName: 'FK_Users_Departments',
      },
    ],
  };

  it('includes outbound FK section when hovering on a table with outbound FKs', () => {
    const result = provideHoverContent(
      'SELECT * FROM Users',
      'SELECT * FROM Users',
      { lineNumber: 1, column: 18 },
      { word: 'Users', startColumn: 15, endColumn: 20 },
      schemaWithFKs
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('References (FK →)');
    expect(md).toContain('DepartmentId');
    expect(md).toContain('dbo.Departments');
  });

  it('includes inbound FK section when hovering on a referenced table', () => {
    const result = provideHoverContent(
      'SELECT * FROM Departments',
      'SELECT * FROM Departments',
      { lineNumber: 1, column: 22 },
      { word: 'Departments', startColumn: 15, endColumn: 26 },
      schemaWithFKs
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('Referenced By (← FK)');
    expect(md).toContain('DepartmentId');
    expect(md).toContain('dbo.Users');
  });

  it('does not show FK sections when table has no FKs at all', () => {
    const result = provideHoverContent(
      'SELECT * FROM Users',
      'SELECT * FROM Users',
      { lineNumber: 1, column: 18 },
      { word: 'Users', startColumn: 15, endColumn: 20 },
      sampleSchema  // foreignKeys: []
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).not.toContain('References (FK →)');
    expect(md).not.toContain('Referenced By (← FK)');
  });
});

describe('renderCteMarkdown', () => {
  it('renders CTE with typed columns', () => {
    const md = renderCteMarkdown({
      name: 'MyCte',
      columns: [
        { name: 'Id', type: 'int', nullable: false },
        { name: 'Name', type: 'nvarchar', nullable: true },
        { name: 'Email', type: 'nvarchar(255)', nullable: true },
      ],
      body: '',
    });
    expect(md).toContain('**CTE: MyCte**');
    expect(md).toContain('3 columns');
    expect(md).toContain('| Column | Type | Nullable |');
    expect(md).toContain('| Id | int | NO |');
    expect(md).toContain('| Name | nvarchar | YES |');
    expect(md).toContain('| Email | nvarchar(255) | YES |');
  });

  it('renders CTE without types when none inferred', () => {
    const md = renderCteMarkdown({
      name: 'Counts',
      columns: [
        { name: 'Total', type: '', nullable: true },
        { name: 'Id', type: '', nullable: true },
      ],
      body: '',
    });
    expect(md).toContain('**CTE: Counts**');
    expect(md).toContain('| Column |');
    expect(md).toContain('| Total |');
    expect(md).not.toContain('Type');
  });

  it('renders mixed typed/untyped columns in type mode', () => {
    const md = renderCteMarkdown({
      name: 'Mixed',
      columns: [
        { name: 'Id', type: 'int', nullable: false },
        { name: 'Calc', type: '', nullable: true },
      ],
      body: '',
    });
    expect(md).toContain('| Column | Type | Nullable |');
    expect(md).toContain('| Id | int | NO |');
    expect(md).toContain('| Calc | ? | YES |');
  });
});

describe('provideHoverContent with CTE', () => {
  it('returns CTE columns on hover over CTE name in FROM clause', () => {
    const sql = `WITH ActiveUsers AS (
  SELECT Id, Name, Email
  FROM dbo.Users
  WHERE Active = 1
)
SELECT * FROM ActiveUsers`;
    const line = 'SELECT * FROM ActiveUsers';
    const result = provideHoverContent(
      sql,
      line,
      { lineNumber: 6, column: 20 },
      { word: 'ActiveUsers', startColumn: 15, endColumn: 26 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('**CTE: ActiveUsers**');
    expect(md).toContain('Id');
    expect(md).toContain('Name');
    expect(md).toContain('Email');
    // Should have type info since schema is provided
    expect(md).toContain('| Column | Type | Nullable |');
  });

  it('returns CTE columns with aliased columns and inferred types', () => {
    const sql = `WITH Stats AS (
  SELECT COUNT(*) AS Total, MAX(Name) AS LastName
  FROM dbo.Users
)
SELECT * FROM Stats`;
    const line = 'SELECT * FROM Stats';
    const result = provideHoverContent(
      sql,
      line,
      { lineNumber: 5, column: 18 },
      { word: 'Stats', startColumn: 15, endColumn: 20 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('**CTE: Stats**');
    expect(md).toContain('Total');
    expect(md).toContain('LastName');
    expect(md).toContain('int');
  });

  it('returns CTE hover for second CTE in multi-CTE query', () => {
    const sql = `WITH
  First AS (SELECT Id FROM dbo.Users),
  Second AS (SELECT Id AS OrderId, UserId FROM dbo.Orders)
SELECT * FROM Second`;
    const line = 'SELECT * FROM Second';
    const result = provideHoverContent(
      sql,
      line,
      { lineNumber: 4, column: 18 },
      { word: 'Second', startColumn: 15, endColumn: 21 },
      { ...sampleSchema, tables: [
          ...sampleSchema.tables,
          { schema: 'dbo', name: 'Orders', columns: [
            { name: 'Id', type: 'int', nullable: false, isPrimaryKey: true },
            { name: 'UserId', type: 'int', nullable: false },
          ]},
        ]}
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('**CTE: Second**');
    expect(md).toContain('OrderId');
    expect(md).toContain('UserId');
  });

  it('prefers CTE over table when name matches both', () => {
    const sql = `WITH Users AS (
  SELECT Id AS UserId, Name AS UserName
  FROM dbo.Users
)
SELECT * FROM Users`;
    const line = 'SELECT * FROM Users';
    const result = provideHoverContent(
      sql,
      line,
      { lineNumber: 5, column: 18 },
      { word: 'Users', startColumn: 15, endColumn: 20 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    // Should show CTE definition, not the table schema
    expect(md).toContain('**CTE: Users**');
    expect(md).toContain('UserId');
    expect(md).toContain('UserName');
  });

  it('returns null for word that is neither CTE nor table', () => {
    const sql = 'WITH MyCte AS (SELECT Id FROM dbo.Users) SELECT * FROM MyCte WHERE something = 1';
    const line = 'WITH MyCte AS (SELECT Id FROM dbo.Users) SELECT * FROM MyCte WHERE something = 1';
    const result = provideHoverContent(
      sql,
      line,
      { lineNumber: 1, column: 75 },
      { word: 'something', startColumn: 68, endColumn: 77 },
      sampleSchema
    );
    expect(result).toBeNull();
  });
});

// ─── Alias.column hover & table alias hover ──────────────────────────────────

describe('provideHoverContent alias.column hover', () => {
  it('returns column definition for alias.column (cursor mid-word)', () => {
    const sql = 'SELECT u.Name FROM Users u';
    const line = 'SELECT u.Name FROM Users u';
    // cursor on 'N' (column 10) — partialCol = 'N', wordAtPosition = 'Name'
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 1, column: 10 },
      { word: 'Name', startColumn: 10, endColumn: 14 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('dbo.Users');
    expect(md).toContain('Name');
    expect(md).toContain('nvarchar(100)');
    // Should be single column detail, not table overview
    expect(md).not.toContain('columns)');
  });

  it('returns column definition for alias.column (cursor at end)', () => {
    const sql = 'SELECT u.Email FROM Users u';
    const line = 'SELECT u.Email FROM Users u';
    // cursor after 'Email' (column 15)
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 1, column: 15 },
      { word: 'Email', startColumn: 10, endColumn: 15 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('Email');
    expect(md).toContain('nvarchar(255)');
  });

  it('returns column definition for table.column (no alias)', () => {
    const sql = 'SELECT Users.Id FROM Users';
    const line = 'SELECT Users.Id FROM Users';
    // cursor on 'Id' (column 15)
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 1, column: 15 },
      { word: 'Id', startColumn: 14, endColumn: 16 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('dbo.Users');
    expect(md).toContain('Id');
    expect(md).toContain('int');
    expect(md).not.toContain('columns)');
  });

  it('returns column definition for schema.table.column', () => {
    const sql = 'SELECT dbo.Users.Email FROM Users';
    const line = 'SELECT dbo.Users.Email FROM Users';
    // cursor on 'Email' (column 18): beforeCursor = 'SELECT dbo.Users.E'
    // the dot pattern matches 'Users.E' → alias='Users', partialCol='E'
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 1, column: 18 },
      { word: 'Email', startColumn: 18, endColumn: 23 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('Email');
    expect(md).toContain('nvarchar(255)');
  });

  it('returns table hover for alias.column when column is unknown', () => {
    const sql = 'SELECT u.NonExistent FROM Users u';
    const line = 'SELECT u.NonExistent FROM Users u';
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 1, column: 15 },
      { word: 'NonExistent', startColumn: 10, endColumn: 21 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    // Falls back to table overview
    expect(md).toContain('**dbo.Users**');
    expect(md).toContain('columns)');
  });
});

describe('provideHoverContent bracketed identifiers', () => {
  it('returns column definition for [alias].[column]', () => {
    const sql = 'SELECT [u].[Name] FROM Users u';
    const line = 'SELECT [u].[Name] FROM Users u';
    // cursor on 'Name' inside brackets (column 13)
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 1, column: 13 },
      { word: 'Name', startColumn: 13, endColumn: 17 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('Name');
    expect(md).toContain('nvarchar(100)');
  });

  it('returns column definition for [table].[column]', () => {
    const sql = 'SELECT [Users].[Email] FROM Users';
    const line = 'SELECT [Users].[Email] FROM Users';
    // cursor on 'Email' inside brackets (column 17)
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 1, column: 17 },
      { word: 'Email', startColumn: 17, endColumn: 22 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('Email');
    expect(md).toContain('nvarchar(255)');
  });

  it('returns column definition for table.[column]', () => {
    const sql = 'SELECT Users.[Id] FROM Users';
    const line = 'SELECT Users.[Id] FROM Users';
    // cursor on 'Id' inside brackets (column 15)
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 1, column: 15 },
      { word: 'Id', startColumn: 15, endColumn: 17 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('Id');
    expect(md).toContain('int');
  });
});

describe('provideHoverContent table alias hover', () => {
  it('shows aliased table definition when hovering on alias (FROM ... alias)', () => {
    const sql = 'SELECT u.Name FROM Users u WHERE u.Id = 1';
    const line = 'SELECT u.Name FROM Users u WHERE u.Id = 1';
    // cursor on 'u' at position 26 (the alias after Users)
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 1, column: 26 },
      { word: 'u', startColumn: 26, endColumn: 27 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('**dbo.Users**');
    expect(md).toContain('Id');
    expect(md).toContain('Name');
    expect(md).toContain('Email');
  });

  it('shows aliased table definition for JOIN alias', () => {
    const sql = 'SELECT * FROM Users u JOIN Departments d ON u.DepartmentId = d.Id';
    const line = 'SELECT * FROM Users u JOIN Departments d ON u.DepartmentId = d.Id';
    // cursor on 'd' (column 40) — alias of Departments
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 1, column: 40 },
      { word: 'd', startColumn: 40, endColumn: 41 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('**dbo.Departments**');
    expect(md).toContain('Id');
    expect(md).toContain('Name');
  });

  it('shows aliased table for AS alias syntax', () => {
    const sql = 'SELECT e.Name FROM hr.Employees AS e';
    const line = 'SELECT e.Name FROM hr.Employees AS e';
    // cursor on 'e' (column 36) — alias of Employees
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 1, column: 36 },
      { word: 'e', startColumn: 36, endColumn: 37 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('hr.Employees');
  });

  it('does not treat actual table name as alias', () => {
    const sql = 'SELECT * FROM Users';
    const line = 'SELECT * FROM Users';
    // cursor on 'Users' — should show table definition, not alias
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 1, column: 18 },
      { word: 'Users', startColumn: 15, endColumn: 20 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('**dbo.Users**');
  });
});

// ─── nvarchar(-1) → nvarchar(max) formatting ────────────────────────────────

describe('formatColumnType maxLength -1 as max', () => {
  it('renders nvarchar(-1) as nvarchar(max) in table markdown', () => {
    const cols: ColumnInfo[] = [
      { name: 'Description', type: 'nvarchar', nullable: true, maxLength: -1 },
    ];
    const md = renderTableMarkdown('dbo', 'Items', cols);
    expect(md).toContain('nvarchar(max)');
    expect(md).not.toContain('nvarchar(-1)');
  });

  it('renders varchar(-1) as varchar(max) in table markdown', () => {
    const cols: ColumnInfo[] = [
      { name: 'Content', type: 'varchar', nullable: false, maxLength: -1 },
    ];
    const md = renderTableMarkdown('dbo', 'Posts', cols);
    expect(md).toContain('varchar(max)');
    expect(md).not.toContain('varchar(-1)');
  });

  it('renders varbinary(-1) as varbinary(max) in table markdown', () => {
    const cols: ColumnInfo[] = [
      { name: 'Data', type: 'varbinary', nullable: true, maxLength: -1 },
    ];
    const md = renderTableMarkdown('dbo', 'Files', cols);
    expect(md).toContain('varbinary(max)');
    expect(md).not.toContain('varbinary(-1)');
  });

  it('renders nvarchar(-1) as nvarchar(max) in column markdown', () => {
    const col: ColumnInfo = { name: 'Body', type: 'nvarchar', nullable: true, maxLength: -1 };
    const md = renderColumnMarkdown('dbo', 'Articles', col);
    expect(md).toContain('nvarchar(max)');
    expect(md).not.toContain('nvarchar(-1)');
    expect(md).toContain('| dbo.Articles | Body | nvarchar(max) | YES |');
  });

  it('preserves normal maxLength values', () => {
    const cols: ColumnInfo[] = [
      { name: 'Name', type: 'nvarchar', nullable: false, maxLength: 100 },
    ];
    const md = renderTableMarkdown('dbo', 'Items', cols);
    expect(md).toContain('nvarchar(100)');
  });
});

// ─── CTE alias hover ────────────────────────────────────────────────────────

describe('renderCteColumnMarkdown', () => {
  it('renders CTE column in horizontal table format', () => {
    const md = renderCteColumnMarkdown('MyCte', { name: 'ProjectId', type: 'int', nullable: false });
    expect(md).toContain('| CTE | Column | Type | Nullable |');
    expect(md).toContain('| MyCte | ProjectId | int | NO |');
  });

  it('shows ? for unknown type', () => {
    const md = renderCteColumnMarkdown('MyCte', { name: 'Calc', type: '', nullable: true });
    expect(md).toContain('| MyCte | Calc | ? | YES |');
  });
});

describe('provideHoverContent CTE alias.column hover', () => {
  const cteSchema: DatabaseSchema = {
    tables: [
      {
        schema: 'dbo', name: 'OrchestrationOperations', columns: [
          { name: 'Id', type: 'int', nullable: false, isPrimaryKey: true },
          { name: 'ProjectId', type: 'int', nullable: true },
          { name: 'CreatedAt', type: 'datetime2', nullable: false },
          { name: 'ParentId', type: 'int', nullable: true },
          { name: 'ToolId', type: 'int', nullable: true },
          { name: 'OperationType', type: 'nvarchar', nullable: false, maxLength: 100 },
          { name: 'Status', type: 'int', nullable: false },
          { name: 'Args', type: 'nvarchar', nullable: true, maxLength: -1 },
        ],
      },
      {
        schema: 'dbo', name: 'Projects', columns: [
          { name: 'Id', type: 'int', nullable: false, isPrimaryKey: true },
          { name: 'Name', type: 'nvarchar', nullable: false, maxLength: 200 },
          { name: 'IsArchived', type: 'bit', nullable: false },
        ],
      },
    ],
    views: [],
    foreignKeys: [],
    storedProcedures: [],
    functions: [],
  };

  const cteQuery = `WITH AddEvents AS (
    SELECT parent.ProjectId, parent.CreatedAt AS AddedDate
    FROM dbo.OrchestrationOperations parent
)
SELECT a.ProjectId FROM AddEvents a`;

  it('returns CTE column hover for alias.column where alias is CTE alias', () => {
    const line = 'SELECT a.ProjectId FROM AddEvents a';
    // cursor on 'P' in ProjectId (column 10)
    const result = provideHoverContent(
      cteQuery, line,
      { lineNumber: 5, column: 10 },
      { word: 'ProjectId', startColumn: 10, endColumn: 19 },
      cteSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('AddEvents');
    expect(md).toContain('ProjectId');
    expect(md).toContain('int');
    // Should show single CTE column detail, not the full CTE
    expect(md).not.toContain('columns)');
  });

  it('returns CTE column hover for alias.column with aliased CTE column', () => {
    const line = 'SELECT a.AddedDate FROM AddEvents a';
    const result = provideHoverContent(
      cteQuery, line,
      { lineNumber: 5, column: 15 },
      { word: 'AddedDate', startColumn: 10, endColumn: 19 },
      cteSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('AddEvents');
    expect(md).toContain('AddedDate');
    expect(md).toContain('datetime2');
  });

  it('returns full CTE schema when hovering CTE alias with unknown column', () => {
    const line = 'SELECT a.Unknown FROM AddEvents a';
    const result = provideHoverContent(
      cteQuery, line,
      { lineNumber: 5, column: 15 },
      { word: 'Unknown', startColumn: 10, endColumn: 17 },
      cteSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('**CTE: AddEvents**');
    expect(md).toContain('columns)');
  });

  it('returns CTE definition when hovering standalone CTE alias', () => {
    const line = 'SELECT a.ProjectId FROM AddEvents a';
    // cursor on 'a' after AddEvents (column 35)
    const result = provideHoverContent(
      cteQuery, line,
      { lineNumber: 5, column: 35 },
      { word: 'a', startColumn: 35, endColumn: 36 },
      cteSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('**CTE: AddEvents**');
    expect(md).toContain('ProjectId');
    expect(md).toContain('AddedDate');
  });

  it('handles CTE alias in JOIN ON clause like a.ProjectId = r.ProjectId', () => {
    const sql = `WITH AddEvents AS (
    SELECT parent.ProjectId, parent.CreatedAt AS AddedDate
    FROM dbo.OrchestrationOperations parent
),
RemoveEvents AS (
    SELECT parent.ProjectId, parent.CreatedAt AS RemovedDate
    FROM dbo.OrchestrationOperations parent
)
SELECT * FROM AddEvents a
INNER JOIN RemoveEvents r ON a.ProjectId = r.ProjectId`;
    const line = 'INNER JOIN RemoveEvents r ON a.ProjectId = r.ProjectId';
    // hover on a.ProjectId — cursor on 'P' (column 32)
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 10, column: 32 },
      { word: 'ProjectId', startColumn: 32, endColumn: 41 },
      cteSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('AddEvents');
    expect(md).toContain('ProjectId');
    expect(md).toContain('int');
  });

  it('resolves r.ProjectId to RemoveEvents CTE in JOIN', () => {
    const sql = `WITH AddEvents AS (
    SELECT parent.ProjectId, parent.CreatedAt AS AddedDate
    FROM dbo.OrchestrationOperations parent
),
RemoveEvents AS (
    SELECT parent.ProjectId, parent.CreatedAt AS RemovedDate
    FROM dbo.OrchestrationOperations parent
)
SELECT * FROM AddEvents a
INNER JOIN RemoveEvents r ON a.ProjectId = r.ProjectId`;
    const line = 'INNER JOIN RemoveEvents r ON a.ProjectId = r.ProjectId';
    // hover on r.ProjectId — cursor on 'P' (column 46)
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 10, column: 46 },
      { word: 'ProjectId', startColumn: 46, endColumn: 55 },
      cteSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('RemoveEvents');
    expect(md).toContain('ProjectId');
  });
});

// ─── Column alias detection ──────────────────────────────────────────────────

describe('isColumnAliasDefinition', () => {
  it('returns true for word directly after AS', () => {
    expect(isColumnAliasDefinition('SELECT td.Name AS Tool', 19)).toBe(true);
  });

  it('returns true for word after AS with extra spaces', () => {
    expect(isColumnAliasDefinition('SELECT x AS   Alias', 15)).toBe(true);
  });

  it('returns false for regular column reference', () => {
    expect(isColumnAliasDefinition('SELECT Name FROM Users', 8)).toBe(false);
  });

  it('returns false for FROM clause table', () => {
    expect(isColumnAliasDefinition('SELECT * FROM Users', 15)).toBe(false);
  });

  it('returns true for bracketed alias [Project name] — first word', () => {
    // "SELECT td.Name AS [Project name]"
    // Word "Project" starts at column 20 (after "[")
    expect(isColumnAliasDefinition('SELECT td.Name AS [Project name]', 20)).toBe(true);
  });

  it('returns true for bracketed alias [Project name] — second word', () => {
    // Word "name" starts at column 28
    expect(isColumnAliasDefinition('SELECT td.Name AS [Project name]', 28)).toBe(true);
  });

  it('returns false for bracketed column reference without AS', () => {
    expect(isColumnAliasDefinition('SELECT [Name] FROM Users', 9)).toBe(false);
  });
});

describe('provideHoverContent column alias skip', () => {
  it('returns null for word preceded by AS (column alias definition)', () => {
    const sql = 'SELECT td.Name AS Tool FROM Users td';
    const line = 'SELECT td.Name AS Tool FROM Users td';
    // cursor on 'Tool' (startColumn = 19)
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 1, column: 20 },
      { word: 'Tool', startColumn: 19, endColumn: 23 },
      sampleSchema
    );
    // Tool is a column alias — should NOT trigger column hover
    expect(result).toBeNull();
  });

  it('still shows hover for alias.column (not preceded by AS)', () => {
    const sql = 'SELECT u.Name FROM Users u';
    const line = 'SELECT u.Name FROM Users u';
    const result = provideHoverContent(
      sql, line,
      { lineNumber: 1, column: 13 },
      { word: 'Name', startColumn: 10, endColumn: 14 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    expect(result!.contents[0].value).toContain('Name');
  });
});

// ─── SQL function hover ──────────────────────────────────────────────────────

describe('renderFunctionHover', () => {
  it('renders function name, description, syntax and example', () => {
    const doc = SQL_FUNCTION_DOCS['lower'];
    const md = renderFunctionHover('LOWER', doc);
    expect(md).toContain('**LOWER**');
    expect(md).toContain('lowercase');
    expect(md).toContain('LOWER(string)');
    expect(md).toContain("SELECT LOWER('Hello World')");
    expect(md).toContain("'hello world'");
  });

  it('renders function without result when result is undefined', () => {
    const doc = SQL_FUNCTION_DOCS['openjson'];
    const md = renderFunctionHover('OPENJSON', doc);
    expect(md).toContain('**OPENJSON**');
    expect(md).toContain('OPENJSON');
    expect(md).not.toContain('→ undefined');
  });
});

describe('provideHoverContent function hover', () => {
  it('shows hover for LOWER function', () => {
    const result = provideHoverContent(
      'SELECT LOWER(Name) FROM Users',
      'SELECT LOWER(Name) FROM Users',
      { lineNumber: 1, column: 10 },
      { word: 'LOWER', startColumn: 8, endColumn: 13 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    const md = result!.contents[0].value;
    expect(md).toContain('**LOWER**');
    expect(md).toContain('lowercase');
  });

  it('shows hover for DATEDIFF function (case insensitive)', () => {
    const result = provideHoverContent(
      'SELECT datediff(day, a, b) FROM t',
      'SELECT datediff(day, a, b) FROM t',
      { lineNumber: 1, column: 12 },
      { word: 'datediff', startColumn: 8, endColumn: 16 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    expect(result!.contents[0].value).toContain('**DATEDIFF**');
    expect(result!.contents[0].value).toContain('DATEDIFF');
  });

  it('shows hover for JSON_VALUE function', () => {
    const result = provideHoverContent(
      "SELECT JSON_VALUE(data, '$.name') FROM t",
      "SELECT JSON_VALUE(data, '$.name') FROM t",
      { lineNumber: 1, column: 12 },
      { word: 'JSON_VALUE', startColumn: 8, endColumn: 18 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    expect(result!.contents[0].value).toContain('**JSON_VALUE**');
    expect(result!.contents[0].value).toContain('scalar');
  });

  it('prefers table/column hover over function hover when name matches', () => {
    // If "Name" matches a column, it should show column hover, not function hover
    const result = provideHoverContent(
      'SELECT Name FROM Users',
      'SELECT Name FROM Users',
      { lineNumber: 1, column: 10 },
      { word: 'Name', startColumn: 8, endColumn: 12 },
      sampleSchema
    );
    expect(result).not.toBeNull();
    // Should show column info, not a function (since Name is not in SQL_FUNCTION_DOCS)
    expect(result!.contents[0].value).toContain('dbo.Users');
  });
});
