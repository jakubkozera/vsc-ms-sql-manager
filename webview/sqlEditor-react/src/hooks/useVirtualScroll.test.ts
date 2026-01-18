import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVirtualScroll } from './useVirtualScroll';

// Mock ResizeObserver
const mockResizeObserver = vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

vi.stubGlobal('ResizeObserver', mockResizeObserver);

describe('useVirtualScroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty virtualItems when itemCount is 0', () => {
    const { result } = renderHook(() =>
      useVirtualScroll({
        itemCount: 0,
        itemHeight: 30,
      })
    );

    expect(result.current.virtualItems).toEqual([]);
    expect(result.current.totalHeight).toBe(0);
  });

  it('calculates correct totalHeight', () => {
    const { result } = renderHook(() =>
      useVirtualScroll({
        itemCount: 100,
        itemHeight: 30,
      })
    );

    expect(result.current.totalHeight).toBe(3000);
  });

  it('provides scrollToIndex function', () => {
    const { result } = renderHook(() =>
      useVirtualScroll({
        itemCount: 100,
        itemHeight: 30,
      })
    );

    expect(typeof result.current.scrollToIndex).toBe('function');
  });

  it('provides containerRef', () => {
    const { result } = renderHook(() =>
      useVirtualScroll({
        itemCount: 100,
        itemHeight: 30,
      })
    );

    expect(result.current.containerRef).toBeDefined();
    expect(result.current.containerRef.current).toBeNull();
  });

  it('uses default overscan when not provided', () => {
    const { result } = renderHook(() =>
      useVirtualScroll({
        itemCount: 100,
        itemHeight: 30,
      })
    );

    // Hook should work without custom overscan
    expect(result.current.virtualItems).toBeDefined();
  });

  it('accepts custom overscan', () => {
    const { result } = renderHook(() =>
      useVirtualScroll({
        itemCount: 100,
        itemHeight: 30,
        overscan: 10,
      })
    );

    expect(result.current.virtualItems).toBeDefined();
  });
});
