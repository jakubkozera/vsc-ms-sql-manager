import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock VS Code API
vi.stubGlobal('acquireVsCodeApi', () => ({
  postMessage: vi.fn(),
  getState: vi.fn(() => null),
  setState: vi.fn(),
}));

// Mock ResizeObserver
vi.stubGlobal('ResizeObserver', class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
});

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
