import { describe, it, expect } from 'vitest';
import { validateCellValue } from './cellValidation';

describe('validateCellValue', () => {
  // ── NULL is always valid ────────────────────────────────────
  it('returns null for NULL value regardless of type', () => {
    expect(validateCellValue(null, 'int')).toBeNull();
    expect(validateCellValue(undefined, 'bigint')).toBeNull();
    expect(validateCellValue(null, 'datetime')).toBeNull();
  });

  // ── INT ─────────────────────────────────────────────────────
  describe('int', () => {
    it('accepts valid integer', () => {
      expect(validateCellValue(42, 'int')).toBeNull();
      expect(validateCellValue('42', 'int')).toBeNull();
      expect(validateCellValue('-100', 'int')).toBeNull();
      expect(validateCellValue('0', 'int')).toBeNull();
    });

    it('rejects non-numeric string', () => {
      expect(validateCellValue('abc', 'int')).not.toBeNull();
      expect(validateCellValue('12.5', 'int')).not.toBeNull();
    });

    it('rejects out-of-range value', () => {
      expect(validateCellValue('2147483648', 'int')).not.toBeNull();
      expect(validateCellValue('-2147483649', 'int')).not.toBeNull();
    });

    it('accepts boundary values', () => {
      expect(validateCellValue('2147483647', 'int')).toBeNull();
      expect(validateCellValue('-2147483648', 'int')).toBeNull();
    });
  });

  // ── BIGINT ──────────────────────────────────────────────────
  describe('bigint', () => {
    it('accepts valid value', () => {
      expect(validateCellValue('9007199254740991', 'bigint')).toBeNull();
    });

    it('rejects non-numeric', () => {
      expect(validateCellValue('not a number', 'bigint')).not.toBeNull();
    });
  });

  // ── SMALLINT ────────────────────────────────────────────────
  describe('smallint', () => {
    it('accepts in-range value', () => {
      expect(validateCellValue('100', 'smallint')).toBeNull();
    });

    it('rejects out-of-range value', () => {
      expect(validateCellValue('32768', 'smallint')).not.toBeNull();
      expect(validateCellValue('-32769', 'smallint')).not.toBeNull();
    });
  });

  // ── TINYINT ─────────────────────────────────────────────────
  describe('tinyint', () => {
    it('accepts 0-255', () => {
      expect(validateCellValue('0', 'tinyint')).toBeNull();
      expect(validateCellValue('255', 'tinyint')).toBeNull();
    });

    it('rejects negative', () => {
      expect(validateCellValue('-1', 'tinyint')).not.toBeNull();
    });

    it('rejects >255', () => {
      expect(validateCellValue('256', 'tinyint')).not.toBeNull();
    });
  });

  // ── DECIMAL / NUMERIC / MONEY ───────────────────────────────
  describe('decimal/numeric/money', () => {
    it('accepts valid decimals', () => {
      expect(validateCellValue('123.45', 'decimal')).toBeNull();
      expect(validateCellValue('-99.9', 'numeric')).toBeNull();
      expect(validateCellValue('100', 'money')).toBeNull();
      expect(validateCellValue('0.01', 'smallmoney')).toBeNull();
    });

    it('rejects non-numeric', () => {
      expect(validateCellValue('abc', 'decimal')).not.toBeNull();
      expect(validateCellValue('12.34.56', 'numeric')).not.toBeNull();
    });
  });

  // ── FLOAT / REAL ────────────────────────────────────────────
  describe('float/real', () => {
    it('accepts scientific notation', () => {
      expect(validateCellValue('1e10', 'float')).toBeNull();
      expect(validateCellValue('-3.14', 'real')).toBeNull();
    });

    it('rejects non-numeric', () => {
      expect(validateCellValue('not-a-float', 'float')).not.toBeNull();
    });
  });

  // ── BIT ─────────────────────────────────────────────────────
  describe('bit', () => {
    it('accepts 0, 1, true, false', () => {
      expect(validateCellValue('0', 'bit')).toBeNull();
      expect(validateCellValue('1', 'bit')).toBeNull();
      expect(validateCellValue('true', 'bit')).toBeNull();
      expect(validateCellValue('false', 'bit')).toBeNull();
      expect(validateCellValue('TRUE', 'bit')).toBeNull();
    });

    it('rejects other values', () => {
      expect(validateCellValue('yes', 'bit')).not.toBeNull();
      expect(validateCellValue('2', 'bit')).not.toBeNull();
    });
  });

  // ── DATE ────────────────────────────────────────────────────
  describe('date', () => {
    it('accepts valid date string', () => {
      expect(validateCellValue('2026-03-13', 'date')).toBeNull();
    });

    it('rejects invalid date', () => {
      expect(validateCellValue('not-a-date', 'date')).not.toBeNull();
    });
  });

  // ── DATETIME / DATETIME2 ───────────────────────────────────
  describe('datetime', () => {
    it('accepts valid datetime', () => {
      expect(validateCellValue('2026-03-13T12:00:00', 'datetime')).toBeNull();
      expect(validateCellValue('2026-03-13 12:00:00', 'datetime2')).toBeNull();
    });

    it('rejects invalid datetime', () => {
      expect(validateCellValue('nope', 'datetime')).not.toBeNull();
    });
  });

  // ── TIME ────────────────────────────────────────────────────
  describe('time', () => {
    it('accepts valid time', () => {
      expect(validateCellValue('12:30:00', 'time')).toBeNull();
      expect(validateCellValue('9:05', 'time')).toBeNull();
      expect(validateCellValue('12:30:00.1234567', 'time')).toBeNull();
    });

    it('rejects invalid time', () => {
      expect(validateCellValue('not-time', 'time')).not.toBeNull();
    });
  });

  // ── UNIQUEIDENTIFIER ────────────────────────────────────────
  describe('uniqueidentifier', () => {
    it('accepts valid GUID', () => {
      expect(validateCellValue('12345678-1234-1234-1234-123456789abc', 'uniqueidentifier')).toBeNull();
    });

    it('rejects invalid GUID', () => {
      expect(validateCellValue('not-a-guid', 'uniqueidentifier')).not.toBeNull();
      expect(validateCellValue('12345678-1234', 'uniqueidentifier')).not.toBeNull();
    });
  });

  // ── STRING TYPES (no validation) ────────────────────────────
  describe('string types', () => {
    it('accepts any value for varchar', () => {
      expect(validateCellValue('anything', 'varchar')).toBeNull();
    });

    it('accepts any value for nvarchar', () => {
      expect(validateCellValue(12345, 'nvarchar')).toBeNull();
    });

    it('accepts any value for text', () => {
      expect(validateCellValue('long text...', 'text')).toBeNull();
    });
  });

  // ── EMPTY STRING → treated as NULL (valid) ─────────────────
  describe('empty string passthrough', () => {
    it('treats empty string as valid for int (will become NULL)', () => {
      expect(validateCellValue('', 'int')).toBeNull();
    });

    it('treats empty string as valid for datetime', () => {
      expect(validateCellValue('', 'datetime')).toBeNull();
    });

    it('treats empty string as valid for bit', () => {
      expect(validateCellValue('', 'bit')).toBeNull();
    });
  });
});
