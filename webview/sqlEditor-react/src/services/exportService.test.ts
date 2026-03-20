import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportData, extractSelectedData, copyRichTableToClipboard, toTableHtml } from './exportService';
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

  describe('INSERT statement generation', () => {
    it('generates correct INSERT statement for a single row', () => {
      const result = exportData([[1, 'John', 'john@example.com']], sampleColumns, {
        format: 'insert',
        tableName: 'Users',
      });

      expect(result).toBe(
        "INSERT INTO [Users] ([id], [name], [email]) VALUES (1, 'John', 'john@example.com');"
      );
    });

    it('generates multiple INSERT statements for multiple rows', () => {
      const result = exportData(sampleData, sampleColumns, {
        format: 'insert',
        tableName: 'Users',
      });

      const lines = result.split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain("INSERT INTO [Users]");
      expect(lines[1]).toContain("INSERT INTO [Users]");
      expect(lines[2]).toContain("INSERT INTO [Users]");
    });

    it('wraps string values in single quotes', () => {
      const result = exportData([[42, 'Alice', 'alice@example.com']], sampleColumns, {
        format: 'insert',
        tableName: 'Contacts',
      });

      expect(result).toContain("'Alice'");
      expect(result).toContain("'alice@example.com'");
      expect(result).toContain('42');
      expect(result).not.toMatch(/'\d+'/); // numeric values should not be quoted
    });

    it('emits NULL (unquoted) for null values', () => {
      const result = exportData([[1, null, 'john@example.com']], sampleColumns, {
        format: 'insert',
        tableName: 'Users',
      });

      expect(result).toContain('NULL');
      expect(result).not.toContain("'null'");
    });

    it('escapes single quotes inside string values', () => {
      const result = exportData([[1, "O'Brien", 'ob@example.com']], sampleColumns, {
        format: 'insert',
        tableName: 'Users',
      });

      expect(result).toContain("'O''Brien'");
    });

    it('uses fallback table name when none supplied', () => {
      // exportData falls back to 'TableName' when tableName option is omitted
      const result = exportData([[1, 'John', 'john@example.com']], sampleColumns, {
        format: 'insert',
      });

      expect(result).toContain('[TableName]');
    });

    it('uses only selected columns when data is pre-filtered via extractSelectedData', () => {
      const { data, columns } = extractSelectedData(sampleData, sampleColumns, [0], [0, 1]);
      const result = exportData(data, columns, {
        format: 'insert',
        tableName: 'Users',
      });

      expect(result).toContain('[id], [name]');
      expect(result).not.toContain('[email]');
      expect(result).toContain("VALUES (1, 'John')");
    });
  });

  describe('table format (ASCII table)', () => {
    it('exports data as an aligned ASCII table', () => {
      const result = exportData(sampleData, sampleColumns, {
        format: 'table',
        includeHeaders: true,
      });

      const lines = result.split('\n');
      // separator + header + separator + 3 data rows + separator = 7 lines
      expect(lines).toHaveLength(7);
      // First and last lines are separators
      expect(lines[0]).toMatch(/^\+[-+]+\+$/);
      expect(lines[6]).toMatch(/^\+[-+]+\+$/);
      // Header row
      expect(lines[1]).toContain('| id');
      expect(lines[1]).toContain('name');
      expect(lines[1]).toContain('email');
      // Data rows
      expect(lines[3]).toContain('John');
      expect(lines[4]).toContain('Jane');
      expect(lines[5]).toContain('Bob');
    });

    it('aligns columns to the widest value', () => {
      const cols: ColumnDef[] = [
        { name: 'x', index: 0, type: 'varchar', width: 100, isPrimaryKey: false, isForeignKey: false },
      ];
      const data = [['short'], ['a much longer value']];
      const result = exportData(data, cols, { format: 'table', includeHeaders: true });
      const lines = result.split('\n');
      // All data lines should have the same length
      expect(lines[1].length).toBe(lines[3].length);
      expect(lines[1].length).toBe(lines[4].length);
    });

    it('handles null values by rendering empty string', () => {
      const cols: ColumnDef[] = [
        { name: 'val', index: 0, type: 'varchar', width: 100, isPrimaryKey: false, isForeignKey: false },
      ];
      const data = [[null], ['hello']];
      const result = exportData(data, cols, { format: 'table', includeHeaders: true });
      expect(result).toContain('|');
      // null should be rendered as empty string (no "null" text)
      const lines = result.split('\n');
      expect(lines[3]).not.toContain('null');
    });

    it('produces proper box-drawing structure', () => {
      const cols: ColumnDef[] = [
        { name: 'a', index: 0, type: 'int', width: 50, isPrimaryKey: false, isForeignKey: false },
        { name: 'b', index: 1, type: 'int', width: 50, isPrimaryKey: false, isForeignKey: false },
      ];
      const data = [[1, 2]];
      const result = exportData(data, cols, { format: 'table', includeHeaders: true });
      const lines = result.split('\n');
      // Separator: +---+---+
      expect(lines[0]).toBe('+---+---+');
      // Header: | a | b |
      expect(lines[1]).toBe('| a | b |');
      // Separator again
      expect(lines[2]).toBe('+---+---+');
      // Data: | 1 | 2 |
      expect(lines[3]).toBe('| 1 | 2 |');
      // Final separator
      expect(lines[4]).toBe('+---+---+');
    });
  });

  describe('copyRichTableToClipboard', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('calls navigator.clipboard.write with a ClipboardItem when ClipboardItem is available', async () => {
      let capturedItemData: Record<string, Blob> | null = null;

      class ClipboardItemMock {
        constructor(data: Record<string, Blob>) {
          capturedItemData = data;
        }
      }

      const writeMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis, 'ClipboardItem', { value: ClipboardItemMock, writable: true, configurable: true });
      Object.defineProperty(navigator, 'clipboard', { value: { write: writeMock }, writable: true, configurable: true });

      const cols: ColumnDef[] = [
        { name: 'Name', index: 0, type: 'varchar', width: 100, isPrimaryKey: false, isForeignKey: false },
      ];
      await copyRichTableToClipboard([['Alice'], ['Bob']], cols);

      expect(writeMock).toHaveBeenCalledOnce();
      expect(capturedItemData).not.toBeNull();
      expect(capturedItemData!['text/html']).toBeInstanceOf(Blob);
      expect(capturedItemData!['text/plain']).toBeInstanceOf(Blob);
    });
  });

  describe('toTableHtml', () => {
    const cols: ColumnDef[] = [
      { name: 'Email', index: 0, type: 'varchar', width: 100, isPrimaryKey: false, isForeignKey: false },
      { name: 'Count', index: 1, type: 'int', width: 100, isPrimaryKey: false, isForeignKey: false },
    ];

    it('generates a table with thead and tbody', () => {
      const html = toTableHtml([['alice@example.com', 3]], cols);
      expect(html).toContain('<table>');
      expect(html).toContain('<thead>');
      expect(html).toContain('<tbody>');
      expect(html).toContain('</table>');
    });

    it('generates header cells for each column', () => {
      const html = toTableHtml([], cols);
      expect(html).toContain('<th>Email</th>');
      expect(html).toContain('<th>Count</th>');
    });

    it('generates data cells for each row', () => {
      const html = toTableHtml([['alice@example.com', 3], ['bob@example.com', 1]], cols);
      expect(html).toContain('<td>alice@example.com</td>');
      expect(html).toContain('<td>3</td>');
      expect(html).toContain('<td>bob@example.com</td>');
    });

    it('escapes HTML special characters to prevent XSS', () => {
      const html = toTableHtml([['<script>alert("xss")</script>']], [cols[0]]);
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&quot;xss&quot;');
    });

    it('renders null/undefined as empty string', () => {
      const html = toTableHtml([[null, undefined]], cols);
      expect(html).not.toContain('>null<');
      expect(html).not.toContain('>undefined<');
      expect(html).toContain('<td></td>');
    });

    it('escapes & in values', () => {
      const html = toTableHtml([['A & B']], [cols[0]]);
      expect(html).toContain('A &amp; B');
    });
  });
});
