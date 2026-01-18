import { useCallback, useRef, useState, useEffect, useMemo } from 'react';

export interface VirtualScrollOptions {
  itemCount: number;
  itemHeight: number;
  overscan?: number; // Extra items to render outside viewport
}

export interface VirtualScrollResult {
  containerRef: React.RefObject<HTMLDivElement>;
  virtualItems: VirtualItem[];
  totalHeight: number;
  scrollToIndex: (index: number) => void;
}

export interface VirtualItem {
  index: number;
  start: number;
  size: number;
}

const DEFAULT_OVERSCAN = 5;

export function useVirtualScroll({
  itemCount,
  itemHeight,
  overscan = DEFAULT_OVERSCAN,
}: VirtualScrollOptions): VirtualScrollResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Update container height on mount and resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateHeight = () => {
      setContainerHeight(container.clientHeight);
    };

    updateHeight();

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  // Handle scroll events
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      setScrollTop(container.scrollTop);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Calculate visible items
  const virtualItems = useMemo(() => {
    if (itemCount === 0 || containerHeight === 0) {
      return [];
    }

    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const endIndex = Math.min(itemCount - 1, startIndex + visibleCount + overscan * 2);

    const items: VirtualItem[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      items.push({
        index: i,
        start: i * itemHeight,
        size: itemHeight,
      });
    }

    return items;
  }, [itemCount, itemHeight, scrollTop, containerHeight, overscan]);

  // Total height for scroll container
  const totalHeight = itemCount * itemHeight;

  // Scroll to specific index
  const scrollToIndex = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) return;

    const targetTop = index * itemHeight;
    container.scrollTop = targetTop;
  }, [itemHeight]);

  return {
    containerRef: containerRef as React.RefObject<HTMLDivElement>,
    virtualItems,
    totalHeight,
    scrollToIndex,
  };
}
