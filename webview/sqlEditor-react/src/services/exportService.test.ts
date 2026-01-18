import { describe, it, expect } from 'vitest';
import { exportData, extractSelectedData } from './exportService';
import { ColumnDef } from '../types/grid';

describe('exportService', () => {
  const sampleColumns: ColumnDef[] = [
    { name: 'id', index: 0, type: 'int', width: 100, isPrimaryKey: true, isForeignKey: false },
    { name: 'name', index: 1, type: 'varchar', width: 150, isPrimaryKey: false, isForeignKey: false },
    { name: 'email', index: 2, type: 'varchar', width: 200, isPrimaryKey: false, isForeignKey: false },
  ];

  const sampleData = [
    [1, 'John', 'john@example.com'],
    [2, 'Jane', 'jane@example.com'],
    [3, 'Bob', 'bob@example.com'],
  ];

  describe('exportData', () => {
    it('exports to CSV format with headers', () => {
      const result = exportData(sampleData, sampleColumns, {
        format: 'csv',
        includeHeaders: true,
      });

      expect(result).toContain('id,name,email');
      expect(result).toContain('1,John,john@example.com');
    });

    it('exports to CSV format without headers', () => {
      const result = exportData(sampleData, sampleColumns, {
        format: 'csv',
        includeHeaders: false,
      });

      expect(result).not.toContain('id,name,email');
      expect(result).toContain('1,John,john@example.com');
    });

    it('exports to TSV format', () => {
      const result = exportData(sampleData, sampleColumns, {
        format: 'tsv',
        includeHeaders: true,
      });

      expect(result).toContain('id\tname\temail');
      expect(result).toContain('1\tJohn\tjohn@example.com');
    });

    it('exports to JSON format', () => {
      const result = exportData(sampleData, sampleColumns, {
        format: 'json',
        includeHeaders: true,
      });

      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(3);
      expect(parsed[0]).toEqual({ id: 1, name: 'John', email: 'john@example.com' });
    });

    it('exports to INSERT statements', () => {
      const result = exportData(sampleData, sampleColumns, {
        format: 'insert',
        tableName: 'Users',
      });

      expect(result).toContain('INSERT INTO [Users]');
      expect(result).toContain('[id], [name], [email]');
      expect(result).toContain("VALUES (1, 'John', 'john@example.com')");
    });

    it('escapes CSV values with commas', () => {
      const dataWithComma = [[1, 'Doe, John', 'john@example.com']];
      const result = exportData(dataWithComma, sampleColumns, {
        format: 'csv',
        includeHeaders: false,
      });

      expect(result).toContain('"Doe, John"');
    });

    it('handles null values', () => {
      const dataWithNull = [[1, null, 'john@example.com']];
      const result = exportData(dataWithNull, sampleColumns, {
        format: 'csv',
        includeHeaders: false,
      });

      expect(result).toContain('1,,john@example.com');
    });
  });

  describe('extractSelectedData', () => {
    it('extracts all data when no selection', () => {
      const result = extractSelectedData(sampleData, sampleColumns, [0, 1, 2]);

      expect(result.data).toHaveLength(3);
      expect(result.columns).toHaveLength(3);
    });

    it('extracts selected rows only', () => {
      const result = extractSelectedData(sampleData, sampleColumns, [0, 2]);

      expect(result.data).toHaveLength(2);
      expect(result.data[0][1]).toBe('John');
      expect(result.data[1][1]).toBe('Bob');
    });

    it('extracts selected columns only', () => {
      const result = extractSelectedData(sampleData, sampleColumns, [0, 1, 2], [0, 2]);

      expect(result.columns).toHaveLength(2);
      expect(result.columns[0].name).toBe('id');
      expect(result.columns[1].name).toBe('email');
      expect(result.data[0]).toEqual([1, 'john@example.com']);
    });
  });
});
