/**
 * Validates a cell value against its SQL Server column type.
 * Returns null if valid, or a human-readable error message if invalid.
 */
export function validateCellValue(value: unknown, sqlType: string): string | null {
  // NULL is always valid (NULL-ability is not checked here — driver enforces NOT NULL)
  if (value === null || value === undefined) {
    return null;
  }

  const t = sqlType.toLowerCase().trim();

  // Integer types
  if (t === 'int' || t === 'integer') {
    return validateInt(value, -2147483648, 2147483647, 'int');
  }
  if (t === 'bigint') {
    // JS can't represent full bigint range precisely but parseFloat catches non-numeric
    return validateInt(value, -9007199254740991, 9007199254740991, 'bigint');
  }
  if (t === 'smallint') {
    return validateInt(value, -32768, 32767, 'smallint');
  }
  if (t === 'tinyint') {
    return validateInt(value, 0, 255, 'tinyint');
  }

  // Decimal / numeric types
  if (t.startsWith('decimal') || t.startsWith('numeric') || t === 'money' || t === 'smallmoney') {
    return validateNumeric(value, t);
  }
  if (t === 'float' || t === 'real') {
    return validateFloat(value, t);
  }

  // Bit
  if (t === 'bit') {
    return validateBit(value);
  }

  // Date/time types
  if (t === 'date') {
    return validateDate(value);
  }
  if (t === 'datetime' || t === 'datetime2' || t === 'smalldatetime') {
    return validateDateTime(value, t);
  }
  if (t === 'datetimeoffset') {
    return validateDateTimeOffset(value);
  }
  if (t === 'time') {
    return validateTime(value);
  }

  // GUID
  if (t === 'uniqueidentifier') {
    return validateGuid(value);
  }

  // String types — no validation needed (length enforcement is DB-side)
  // Binary types — no client-side validation
  // XML/JSON — no client-side validation

  return null;
}

function validateInt(value: unknown, min: number, max: number, typeName: string): string | null {
  const str = String(value).trim();
  if (str === '') return null; // empty → will become NULL via parseValue
  if (!/^-?\d+$/.test(str)) {
    return `Value must be a whole number for type ${typeName}`;
  }
  const num = Number(str);
  if (num < min || num > max) {
    return `Value out of range for ${typeName} (${min} to ${max})`;
  }
  return null;
}

function validateNumeric(value: unknown, typeName: string): string | null {
  const str = String(value).trim();
  if (str === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    return `Value must be a number for type ${typeName}`;
  }
  return null;
}

function validateFloat(value: unknown, typeName: string): string | null {
  const str = String(value).trim();
  if (str === '') return null;
  const num = Number(str);
  if (isNaN(num)) {
    return `Value must be a number for type ${typeName}`;
  }
  return null;
}

function validateBit(value: unknown): string | null {
  const str = String(value).trim().toLowerCase();
  if (str === '') return null;
  if (!['0', '1', 'true', 'false'].includes(str)) {
    return 'Value must be 0, 1, true, or false for type bit';
  }
  return null;
}

function validateDate(value: unknown): string | null {
  const str = String(value).trim();
  if (str === '') return null;
  // Accept YYYY-MM-DD or common date formats
  const d = new Date(str);
  if (isNaN(d.getTime())) {
    return 'Invalid date value — expected format: YYYY-MM-DD';
  }
  return null;
}

function validateDateTime(value: unknown, typeName: string): string | null {
  const str = String(value).trim();
  if (str === '') return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) {
    return `Invalid date/time value for type ${typeName}`;
  }
  return null;
}

function validateDateTimeOffset(value: unknown): string | null {
  const str = String(value).trim();
  if (str === '') return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) {
    return 'Invalid datetimeoffset value';
  }
  return null;
}

function validateTime(value: unknown): string | null {
  const str = String(value).trim();
  if (str === '') return null;
  // Accept HH:MM:SS or HH:MM:SS.nnnnnnn
  if (!/^\d{1,2}:\d{2}(:\d{2}(\.\d{1,7})?)?$/.test(str)) {
    return 'Invalid time value — expected format: HH:MM:SS';
  }
  return null;
}

function validateGuid(value: unknown): string | null {
  const str = String(value).trim();
  if (str === '') return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    return 'Invalid GUID — expected format: XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX';
  }
  return null;
}
