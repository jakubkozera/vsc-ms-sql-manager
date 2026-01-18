import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePendingChanges } from './usePendingChanges';

describe('usePendingChanges', () => {
  const sampleRow = [1, 'John', 'john@example.com'];
  
  it('starts with no pending changes', () => {
    const { result } = renderHook(() => usePendingChanges());
    
    expect(result.current.hasPendingChanges).toBe(false);
    expect(result.current.state.totalChangedRows).toBe(0);
    expect(result.current.state.totalDeletedRows).toBe(0);
  });
  
  it('tracks cell edits', () => {
    const { result } = renderHook(() => usePendingChanges());
    
    act(() => {
      result.current.editCell(0, 0, 'name', 1, sampleRow, 'John', 'Jane');
    });
    
    expect(result.current.hasPendingChanges).toBe(true);
    expect(result.current.state.totalChangedRows).toBe(1);
    expect(result.current.isCellModified(0, 0, 'name')).toBe(true);
    expect(result.current.getCellChange(0, 0, 'name')).toEqual({
      original: 'John',
      new: 'Jane',
    });
  });
  
  it('removes change when value reverts to original', () => {
    const { result } = renderHook(() => usePendingChanges());
    
    act(() => {
      result.current.editCell(0, 0, 'name', 1, sampleRow, 'John', 'Jane');
    });
    
    expect(result.current.hasPendingChanges).toBe(true);
    
    act(() => {
      result.current.editCell(0, 0, 'name', 1, sampleRow, 'John', 'John');
    });
    
    expect(result.current.hasPendingChanges).toBe(false);
    expect(result.current.isCellModified(0, 0, 'name')).toBe(false);
  });
  
  it('tracks multiple cell edits in same row', () => {
    const { result } = renderHook(() => usePendingChanges());
    
    act(() => {
      result.current.editCell(0, 0, 'name', 1, sampleRow, 'John', 'Jane');
      result.current.editCell(0, 0, 'email', 2, sampleRow, 'john@example.com', 'jane@example.com');
    });
    
    expect(result.current.state.totalChangedRows).toBe(1);
    const rowChange = result.current.getRowChange(0, 0);
    expect(rowChange?.changes.size).toBe(2);
  });
  
  it('tracks row deletions', () => {
    const { result } = renderHook(() => usePendingChanges());
    
    act(() => {
      result.current.deleteRow(0, 0, sampleRow);
    });
    
    expect(result.current.hasPendingChanges).toBe(true);
    expect(result.current.state.totalDeletedRows).toBe(1);
    expect(result.current.isRowDeleted(0, 0)).toBe(true);
  });
  
  it('restores deleted rows', () => {
    const { result } = renderHook(() => usePendingChanges());
    
    act(() => {
      result.current.deleteRow(0, 0, sampleRow);
    });
    
    expect(result.current.isRowDeleted(0, 0)).toBe(true);
    
    act(() => {
      result.current.restoreRow(0, 0);
    });
    
    expect(result.current.isRowDeleted(0, 0)).toBe(false);
    expect(result.current.hasPendingChanges).toBe(false);
  });
  
  it('reverts individual cell changes', () => {
    const { result } = renderHook(() => usePendingChanges());
    
    act(() => {
      result.current.editCell(0, 0, 'name', 1, sampleRow, 'John', 'Jane');
      result.current.editCell(0, 0, 'email', 2, sampleRow, 'john@example.com', 'jane@example.com');
    });
    
    act(() => {
      result.current.revertCell(0, 0, 'name');
    });
    
    expect(result.current.isCellModified(0, 0, 'name')).toBe(false);
    expect(result.current.isCellModified(0, 0, 'email')).toBe(true);
  });
  
  it('reverts entire row changes', () => {
    const { result } = renderHook(() => usePendingChanges());
    
    act(() => {
      result.current.editCell(0, 0, 'name', 1, sampleRow, 'John', 'Jane');
      result.current.editCell(0, 0, 'email', 2, sampleRow, 'john@example.com', 'jane@example.com');
    });
    
    act(() => {
      result.current.revertRow(0, 0);
    });
    
    expect(result.current.isRowModified(0, 0)).toBe(false);
    expect(result.current.hasPendingChanges).toBe(false);
  });
  
  it('reverts all changes for a result set', () => {
    const { result } = renderHook(() => usePendingChanges());
    
    act(() => {
      result.current.editCell(0, 0, 'name', 1, sampleRow, 'John', 'Jane');
      result.current.editCell(0, 1, 'name', 1, sampleRow, 'Bob', 'Bill');
      result.current.deleteRow(0, 2, sampleRow);
    });
    
    act(() => {
      result.current.revertAll(0);
    });
    
    expect(result.current.hasPendingChanges).toBe(false);
    expect(result.current.state.totalChangedRows).toBe(0);
    expect(result.current.state.totalDeletedRows).toBe(0);
  });
  
  it('commits and clears changes', () => {
    const { result } = renderHook(() => usePendingChanges());
    
    act(() => {
      result.current.editCell(0, 0, 'name', 1, sampleRow, 'John', 'Jane');
    });
    
    act(() => {
      result.current.commitSuccess(0);
    });
    
    expect(result.current.hasPendingChanges).toBe(false);
  });
  
  it('generates UPDATE statements', () => {
    const { result } = renderHook(() => usePendingChanges());
    
    act(() => {
      result.current.editCell(0, 0, 'name', 1, sampleRow, 'John', 'Jane');
    });
    
    const updates = result.current.generateUpdateStatements(0, 'Users', ['id', 'name', 'email'], ['id']);
    
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain('UPDATE [Users]');
    expect(updates[0]).toContain("[name] = 'Jane'");
    expect(updates[0]).toContain('[id] = 1');
  });
  
  it('generates DELETE statements', () => {
    const { result } = renderHook(() => usePendingChanges());
    
    act(() => {
      result.current.deleteRow(0, 0, sampleRow);
    });
    
    const deletes = result.current.generateDeleteStatements(0, 'Users', ['id', 'name', 'email'], ['id']);
    
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('DELETE FROM [Users]');
    expect(deletes[0]).toContain('[id] = 1');
  });
  
  it('handles null values in SQL generation', () => {
    const { result } = renderHook(() => usePendingChanges());
    
    act(() => {
      result.current.editCell(0, 0, 'name', 1, [1, null, 'email'], null, 'Jane');
    });
    
    const updates = result.current.generateUpdateStatements(0, 'Users', ['id', 'name', 'email'], ['id']);
    
    expect(updates[0]).toContain("[name] = 'Jane'");
  });
  
  it('escapes single quotes in SQL', () => {
    const { result } = renderHook(() => usePendingChanges());
    
    act(() => {
      result.current.editCell(0, 0, 'name', 1, sampleRow, 'John', "O'Brien");
    });
    
    const updates = result.current.generateUpdateStatements(0, 'Users', ['id', 'name', 'email'], ['id']);
    
    expect(updates[0]).toContain("[name] = 'O''Brien'");
  });
});
