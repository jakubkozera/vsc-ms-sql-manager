import { describe, it, expect } from 'vitest';
import {
  renderTableMarkdown,
  renderColumnMarkdown,
  renderMultiTableColumnMarkdown,
  provideHoverContent,
} from './sqlHoverService';
import type { ColumnInfo, DatabaseSchema } from '../types/schema';

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
    expect(md).toContain('| Column | Type | Nullable | Key |');
  });

  it('includes PK indicator for primary key columns', () => {
    const md = renderTableMarkdown('dbo', 'Users', sampleColumns);
    expect(md).toContain('🔑 PK');
  });

  it('includes FK indicator for foreign key columns', () => {
    const md = renderTableMarkdown('dbo', 'Users', sampleColumns);
    expect(md).toContain('🔗 FK');
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
    expect(md).toContain('| Table | Column | Type | Nullable | Key |');
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
