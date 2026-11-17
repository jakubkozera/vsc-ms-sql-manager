import { describe, it, expect } from 'vitest';
import { buildSchemaContext } from './aiCompletionContext';
import type { DatabaseSchema } from '../types/schema';

const schema: DatabaseSchema = {
  tables: [
    { schema: 'dbo', name: 'Users', columns: [{ name: 'Id', type: 'int', nullable: false, isPrimaryKey: true }, { name: 'Name', type: 'nvarchar', nullable: true }] },
    { schema: 'dbo', name: 'Orders', columns: [{ name: 'Id', type: 'int', nullable: false, isPrimaryKey: true }, { name: 'UserId', type: 'int', nullable: false }] },
    { schema: 'sales', name: 'Invoices', columns: [{ name: 'Id', type: 'int', nullable: false }] },
  ],
  views: [{ schema: 'dbo', name: 'vUsers', columns: [{ name: 'Id', type: 'int', nullable: false }] }],
  foreignKeys: [
    { fromSchema: 'dbo', fromTable: 'Orders', fromColumn: 'UserId', toSchema: 'dbo', toTable: 'Users', toColumn: 'Id' },
  ],
};

describe('buildSchemaContext', () => {
  it('returns empty string without schema', () => {
    expect(buildSchemaContext(undefined, 'SELECT 1')).toBe('');
  });

  it('lists referenced tables with columns, their foreign keys, and other object names', () => {
    const ctx = buildSchemaContext(schema, 'SELECT * FROM Users u WHERE ');
    expect(ctx).toContain('TABLE [dbo].[Users] (Id int PK, Name nvarchar)');
    expect(ctx).toContain('FK [dbo].[Orders].[UserId] -> [dbo].[Users].[Id]');
    expect(ctx).toContain('Other objects:');
    expect(ctx).toContain('[dbo].[Orders]');
    expect(ctx).toContain('[sales].[Invoices]');
    expect(ctx).not.toContain('TABLE [dbo].[Orders]');
  });

  it('matches whole words only', () => {
    const ctx = buildSchemaContext(schema, 'SELECT * FROM vUsers');
    expect(ctx).toContain('VIEW [dbo].[vUsers]');
    expect(ctx).not.toContain('TABLE [dbo].[Users]');
  });

  it('respects the size budget', () => {
    const ctx = buildSchemaContext(schema, 'SELECT * FROM Users', 60);
    expect(ctx.length).toBeLessThanOrEqual(60);
  });
});
