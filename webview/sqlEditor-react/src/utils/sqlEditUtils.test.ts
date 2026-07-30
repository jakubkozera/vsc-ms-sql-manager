import { describe, it, expect } from 'vitest';
import { getColumnSourceInfo, getTableSpecificPks } from './sqlEditUtils';
import type { ResultSetMetadata } from '../types/messages';

const singleTableMeta: ResultSetMetadata = {
  sourceTable: 'Orders',
  sourceSchema: 'dbo',
  isEditable: true,
  primaryKeyColumns: ['order_id'],
  columns: [
    { name: 'order_id', type: 'int', isPrimaryKey: true, sourceTable: 'Orders', sourceSchema: 'dbo' },
    { name: 'customer_name', type: 'varchar', isPrimaryKey: false, sourceTable: 'Orders', sourceSchema: 'dbo' },
  ],
};

const joinTableMeta: ResultSetMetadata = {
  // Multiple tables – result-set-level sourceTable is intentionally undefined
  sourceTable: undefined,
  sourceSchema: 'dbo',
  isEditable: true,
  primaryKeyColumns: ['order_id', 'delivery_id'],
  columns: [
    { name: 'order_id', type: 'int', isPrimaryKey: true, sourceTable: 'Orders', sourceSchema: 'dbo' },
    { name: 'order_name', type: 'varchar', isPrimaryKey: false, sourceTable: 'Orders', sourceSchema: 'dbo' },
    { name: 'delivery_id', type: 'int', isPrimaryKey: true, sourceTable: 'Deliveries', sourceSchema: 'dbo' },
    { name: 'tracking_code', type: 'varchar', isPrimaryKey: false, sourceTable: 'Deliveries', sourceSchema: 'dbo' },
  ],
};

describe('getColumnSourceInfo', () => {
  it('returns result-set level sourceTable for single-table query', () => {
    const { tableName, schemaName } = getColumnSourceInfo(
      singleTableMeta,
      ['order_id', 'customer_name'],
      'customer_name'
    );
    expect(tableName).toBe('Orders');
    expect(schemaName).toBe('dbo');
  });

  it('returns column-level sourceTable for JOIN query where result-set sourceTable is undefined', () => {
    const columns = ['order_id', 'order_name', 'delivery_id', 'tracking_code'];
    const { tableName, schemaName } = getColumnSourceInfo(joinTableMeta, columns, 'tracking_code');
    expect(tableName).toBe('Deliveries');
    expect(schemaName).toBe('dbo');
  });

  it('returns the correct source table for a column from the first table in a JOIN', () => {
    const columns = ['order_id', 'order_name', 'delivery_id', 'tracking_code'];
    const { tableName } = getColumnSourceInfo(joinTableMeta, columns, 'order_name');
    expect(tableName).toBe('Orders');
  });

  it('falls back to empty string when no source table is found anywhere', () => {
    const noTableMeta: ResultSetMetadata = {
      isEditable: false,
      primaryKeyColumns: [],
      columns: [{ name: 'computed_col', type: 'varchar' }],
    };
    const { tableName } = getColumnSourceInfo(noTableMeta, ['computed_col'], 'computed_col');
    expect(tableName).toBe('');
  });

  it('falls back to result-set sourceTable when column has no individual source', () => {
    const metaWithFallback: ResultSetMetadata = {
      sourceTable: 'FallbackTable',
      sourceSchema: 'dbo',
      isEditable: true,
      primaryKeyColumns: ['id'],
      // Column has no sourceTable — should use result-set level
      columns: [{ name: 'id', type: 'int', isPrimaryKey: true }],
    };
    const { tableName } = getColumnSourceInfo(metaWithFallback, ['id'], 'id');
    expect(tableName).toBe('FallbackTable');
  });

  it('returns empty string when column name is not found in columns list', () => {
    const { tableName } = getColumnSourceInfo(singleTableMeta, ['order_id', 'customer_name'], 'nonexistent_col');
    // colIdx is -1, colMeta is undefined, falls back to meta.sourceTable
    expect(tableName).toBe('Orders');
  });
});

describe('getTableSpecificPks', () => {
  it('returns PKs for the Deliveries table in a JOIN result', () => {
    const fallbackPks = ['order_id', 'delivery_id'];
    const pks = getTableSpecificPks(joinTableMeta, fallbackPks, 'Deliveries', 'dbo');
    expect(pks).toEqual(['delivery_id']);
  });

  it('returns PKs for the Orders table in a JOIN result', () => {
    const fallbackPks = ['order_id', 'delivery_id'];
    const pks = getTableSpecificPks(joinTableMeta, fallbackPks, 'Orders', 'dbo');
    expect(pks).toEqual(['order_id']);
  });

  it('falls back to global PKs when no table-specific PKs are found', () => {
    const fallbackPks = ['order_id'];
    const pks = getTableSpecificPks(singleTableMeta, fallbackPks, 'UnknownTable', 'dbo');
    expect(pks).toEqual(['order_id']);
  });

  it('returns table-specific PKs for a single-table result', () => {
    const pks = getTableSpecificPks(singleTableMeta, ['order_id'], 'Orders', 'dbo');
    expect(pks).toEqual(['order_id']);
  });

  it('respects schema when filtering PKs', () => {
    const crossSchemaMeta: ResultSetMetadata = {
      isEditable: true,
      primaryKeyColumns: ['id1', 'id2'],
      columns: [
        { name: 'id1', type: 'int', isPrimaryKey: true, sourceTable: 'Table1', sourceSchema: 'schema1' },
        { name: 'id2', type: 'int', isPrimaryKey: true, sourceTable: 'Table1', sourceSchema: 'schema2' },
      ],
    };
    // Only id1 belongs to schema1.Table1
    const pks = getTableSpecificPks(crossSchemaMeta, ['id1', 'id2'], 'Table1', 'schema1');
    expect(pks).toEqual(['id1']);
  });
});
