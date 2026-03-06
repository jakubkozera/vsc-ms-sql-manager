import { describe, it, expect } from 'vitest';
import {
  renderTableMarkdown,
  renderColumnMarkdown,
  renderMultiTableColumnMarkdown,
  renderOutboundForeignKeys,
  renderInboundForeignKeys,
  renderCteMarkdown,
  provideHoverContent,
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
  it('renders column properties table', () => {
    const col = sampleColumns[0]; // Id
    const md = renderColumnMarkdown('dbo', 'Users', col);
    expect(md).toContain('| **Table** | dbo.Users |');
    expect(md).toContain('| **Column** | Id |');
    expect(md).toContain('| **Type** | int |');
    expect(md).toContain('| **Nullable** | NO |');
    expect(md).toContain('| **Primary Key** | YES |');
  });

  it('shows FK for foreign key columns', () => {
    const col = sampleColumns[3]; // DepartmentId
    const md = renderColumnMarkdown('dbo', 'Users', col);
    expect(md).toContain('| **Foreign Key** | YES |');
  });

  it('does not show PK/FK for non-key columns', () => {
    const col = sampleColumns[1]; // Name
    const md = renderColumnMarkdown('dbo', 'Users', col);
    expect(md).not.toContain('Primary Key');
    expect(md).not.toContain('Foreign Key');
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
