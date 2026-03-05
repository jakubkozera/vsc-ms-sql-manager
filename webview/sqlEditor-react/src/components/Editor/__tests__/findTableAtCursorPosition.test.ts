import { describe, it, expect } from 'vitest';
import { findTableAtCursorPosition } from '../hooks/useEditorActions';
import type { DatabaseSchema } from '../../../types/schema';

const testSchema: DatabaseSchema = {
  tables: [
    { schema: 'dbo', name: 'Users', columns: [{ name: 'Id', type: 'int', nullable: false, isPrimaryKey: true }] },
    { schema: 'dbo', name: 'Orders', columns: [{ name: 'Id', type: 'int', nullable: false }] },
    { schema: 'sales', name: 'Products', columns: [{ name: 'Id', type: 'int', nullable: false }] },
  ],
  views: [
    { schema: 'dbo', name: 'ActiveUsers', columns: [{ name: 'Id', type: 'int', nullable: false }] },
  ],
  foreignKeys: [],
};

function makeEditor(wordAtPosition: { word: string; startColumn: number; endColumn: number } | null) {
  return {
    getModel: () => ({
      getWordAtPosition: () => wordAtPosition,
    }),
    getPosition: () => ({ lineNumber: 1, column: 1 }),
  };
}

describe('findTableAtCursorPosition', () => {
  it('returns null when position is null', () => {
    const ed = makeEditor({ word: 'Users', startColumn: 1, endColumn: 6 });
    expect(findTableAtCursorPosition(ed as any, null, testSchema)).toBeNull();
  });

  it('returns null when model is null', () => {
    const ed = { getModel: () => null, getPosition: () => ({ lineNumber: 1, column: 1 }) };
    expect(findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 1 }, testSchema)).toBeNull();
  });

  it('returns null when no word at position', () => {
    const ed = makeEditor(null);
    expect(findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 1 }, testSchema)).toBeNull();
  });

  it('returns null when word is empty', () => {
    const ed = makeEditor({ word: '', startColumn: 1, endColumn: 1 });
    expect(findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 1 }, testSchema)).toBeNull();
  });

  it('finds a table by exact name', () => {
    const ed = makeEditor({ word: 'Users', startColumn: 1, endColumn: 6 });
    const result = findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 3 }, testSchema);
    expect(result).toEqual({ schema: 'dbo', table: 'Users' });
  });

  it('finds a table case-insensitively', () => {
    const ed = makeEditor({ word: 'users', startColumn: 1, endColumn: 6 });
    const result = findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 3 }, testSchema);
    expect(result).toEqual({ schema: 'dbo', table: 'Users' });
  });

  it('finds a view by name', () => {
    const ed = makeEditor({ word: 'ActiveUsers', startColumn: 1, endColumn: 12 });
    const result = findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 3 }, testSchema);
    expect(result).toEqual({ schema: 'dbo', table: 'ActiveUsers' });
  });

  it('returns null for unknown table name', () => {
    const ed = makeEditor({ word: 'NonExistent', startColumn: 1, endColumn: 12 });
    const result = findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 3 }, testSchema);
    expect(result).toBeNull();
  });

  it('returns null when no schema provided', () => {
    const ed = makeEditor({ word: 'Users', startColumn: 1, endColumn: 6 });
    expect(findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 3 })).toBeNull();
  });

  it('finds table in non-dbo schema', () => {
    const ed = makeEditor({ word: 'Products', startColumn: 1, endColumn: 9 });
    const result = findTableAtCursorPosition(ed as any, { lineNumber: 1, column: 3 }, testSchema);
    expect(result).toEqual({ schema: 'sales', table: 'Products' });
  });
});
