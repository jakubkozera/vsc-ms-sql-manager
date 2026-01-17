import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalStorage } from './useLocalStorage';

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns initial value when localStorage is empty', () => {
    const { result } = renderHook(() => useLocalStorage('testKey', 'initial'));
    expect(result.current[0]).toBe('initial');
  });

  it('returns stored value when localStorage has data', () => {
    localStorage.setItem('testKey', JSON.stringify('stored'));
    const { result } = renderHook(() => useLocalStorage('testKey', 'initial'));
    expect(result.current[0]).toBe('stored');
  });

  it('updates localStorage when setValue is called', () => {
    const { result } = renderHook(() => useLocalStorage('testKey', 'initial'));
    
    act(() => {
      result.current[1]('updated');
    });
    
    expect(result.current[0]).toBe('updated');
    expect(JSON.parse(localStorage.getItem('testKey')!)).toBe('updated');
  });

  it('handles object values', () => {
    const initialValue = { name: 'test', count: 0 };
    const { result } = renderHook(() => useLocalStorage('testKey', initialValue));
    
    act(() => {
      result.current[1]({ name: 'updated', count: 5 });
    });
    
    expect(result.current[0]).toEqual({ name: 'updated', count: 5 });
  });

  it('handles function updater', () => {
    const { result } = renderHook(() => useLocalStorage('testKey', 10));
    
    act(() => {
      result.current[1]((prev: number) => prev + 5);
    });
    
    expect(result.current[0]).toBe(15);
  });

  it('handles corrupted localStorage data gracefully', () => {
    localStorage.setItem('testKey', 'not valid json');
    const { result } = renderHook(() => useLocalStorage('testKey', 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });
});
