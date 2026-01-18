import { ColumnDef } from '../types/grid';

export type ExportFormat = 'csv' | 'json' | 'tsv' | 'insert' | 'clipboard';

export interface ExportOptions {
  format: ExportFormat;
  includeHeaders?: boolean;
  selectedRowsOnly?: boolean;
  selectedColumnsOnly?: boolean;
  tableName?: string; // For INSERT statements
  quoteStrings?: boolean;
}

/**
 * Export grid data in various formats
 */
export function exportData(
  data: any[][],
  columns: ColumnDef[],
  options: ExportOptions
): string {
  const { format, includeHeaders = true } = options;

  switch (format) {
    case 'csv':
      return toCSV(data, columns, includeHeaders);
    case 'tsv':
      return toTSV(data, columns, includeHeaders);
    case 'json':
      return toJSON(data, columns);
    case 'insert':
      return toInsertStatements(data, columns, options.tableName || 'TableName');
    case 'clipboard':
      return toClipboard(data, columns, includeHeaders);
    default:
      return toCSV(data, columns, includeHeaders);
  }
}

/**
 * Convert to CSV format
 */
function toCSV(data: any[][], columns: ColumnDef[], includeHeaders: boolean): string {
  const lines: string[] = [];

  if (includeHeaders) {
    lines.push(columns.map(c => escapeCSV(c.name)).join(','));
  }

  for (const row of data) {
    const values = columns.map((_, i) => escapeCSV(formatValue(row[i])));
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

/**
 * Convert to TSV format (tab-separated)
 */
function toTSV(data: any[][], columns: ColumnDef[], includeHeaders: boolean): string {
  const lines: string[] = [];

  if (includeHeaders) {
    lines.push(columns.map(c => c.name).join('\t'));
  }

  for (const row of data) {
    const values = columns.map((_, i) => formatValue(row[i]).replace(/\t/g, ' '));
    lines.push(values.join('\t'));
  }

  return lines.join('\n');
}

/**
 * Convert to JSON array of objects
 */
function toJSON(data: any[][], columns: ColumnDef[]): string {
  const objects = data.map(row => {
    const obj: Record<string, any> = {};
    columns.forEach((col, i) => {
      obj[col.name] = row[i];
    });
    return obj;
  });

  return JSON.stringify(objects, null, 2);
}

/**
 * Convert to SQL INSERT statements
 */
function toInsertStatements(data: any[][], columns: ColumnDef[], tableName: string): string {
  const columnNames = columns.map(c => `[${c.name}]`).join(', ');
  const statements: string[] = [];

  for (const row of data) {
    const values = columns.map((col, i) => formatSqlValue(row[i], col.type));
    statements.push(`INSERT INTO [${tableName}] (${columnNames}) VALUES (${values.join(', ')});`);
  }

  return statements.join('\n');
}

/**
 * Format for clipboard (tab-separated, good for pasting into Excel)
 */
function toClipboard(data: any[][], columns: ColumnDef[], includeHeaders: boolean): string {
  return toTSV(data, columns, includeHeaders);
}

/**
 * Escape value for CSV
 */
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Format a value as string
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Format value for SQL INSERT statement
 */
function formatSqlValue(value: any, type: string): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  const lowerType = type.toLowerCase();

  // Numeric types
  if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'].some(t => lowerType.includes(t))) {
    return String(value);
  }

  // Boolean/bit
  if (lowerType.includes('bit') || typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  // Date types
  if (['date', 'datetime', 'datetime2', 'smalldatetime', 'time'].some(t => lowerType.includes(t))) {
    return `'${value}'`;
  }

  // String types - escape single quotes
  const strValue = String(value).replace(/'/g, "''");
  
  // Binary/varbinary
  if (lowerType.includes('binary')) {
    return `0x${Buffer.from(strValue).toString('hex')}`;
  }

  // NVARCHAR prefix
  if (lowerType.startsWith('n')) {
    return `N'${strValue}'`;
  }

  return `'${strValue}'`;
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    // Fallback for older browsers
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Download data as file
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Get file extension and mime type for format
 */
export function getFormatInfo(format: ExportFormat): { extension: string; mimeType: string } {
  switch (format) {
    case 'csv':
      return { extension: 'csv', mimeType: 'text/csv' };
    case 'tsv':
      return { extension: 'tsv', mimeType: 'text/tab-separated-values' };
    case 'json':
      return { extension: 'json', mimeType: 'application/json' };
    case 'insert':
      return { extension: 'sql', mimeType: 'text/plain' };
    default:
      return { extension: 'txt', mimeType: 'text/plain' };
  }
}

/**
 * Extract selected data from full data set
 */
export function extractSelectedData(
  fullData: any[][],
  columns: ColumnDef[],
  selectedRowIndices: number[],
  selectedColumnIndices?: number[]
): { data: any[][]; columns: ColumnDef[] } {
  let filteredColumns = columns;
  let filteredData = fullData;

  // Filter rows
  if (selectedRowIndices.length > 0) {
    filteredData = selectedRowIndices.map(i => fullData[i]).filter(Boolean);
  }

  // Filter columns
  if (selectedColumnIndices && selectedColumnIndices.length > 0) {
    filteredColumns = selectedColumnIndices.map(i => columns[i]).filter(Boolean);
    filteredData = filteredData.map(row =>
      selectedColumnIndices.map(i => row[i])
    );
  }

  return { data: filteredData, columns: filteredColumns };
}
