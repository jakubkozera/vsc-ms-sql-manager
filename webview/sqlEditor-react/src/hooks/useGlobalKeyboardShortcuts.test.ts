import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useGlobalKeyboardShortcuts } from './useGlobalKeyboardShortcuts';

describe('useGlobalKeyboardShortcuts', () => {
  let mockOnCopy: () => void;

  beforeEach(() => {
    mockOnCopy = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call onCopy when Ctrl+C is pressed', () => {
    renderHook(() => useGlobalKeyboardShortcuts({ onCopy: mockOnCopy }));

    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(mockOnCopy).toHaveBeenCalledTimes(1);
  });

  it('should call onCopy when Cmd+C is pressed (Mac)', () => {
    renderHook(() => useGlobalKeyboardShortcuts({ onCopy: mockOnCopy }));

    const event = new KeyboardEvent('keydown', {
      key: 'c',
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(mockOnCopy).toHaveBeenCalledTimes(1);
  });

  it('should not call onCopy when Monaco editor has focus', () => {
    // Create a mock Monaco editor element
    const monacoDiv = document.createElement('div');
    monacoDiv.className = 'monaco-editor';
    document.body.appendChild(monacoDiv);

    const input = document.createElement('input');
    monacoDiv.appendChild(input);
    input.focus();

    renderHook(() => useGlobalKeyboardShortcuts({ onCopy: mockOnCopy }));

    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(mockOnCopy).not.toHaveBeenCalled();

    document.body.removeChild(monacoDiv);
  });

  it('should not call onCopy when text input has focus', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    renderHook(() => useGlobalKeyboardShortcuts({ onCopy: mockOnCopy }));

    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(mockOnCopy).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it('should not call onCopy when textarea has focus', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    renderHook(() => useGlobalKeyboardShortcuts({ onCopy: mockOnCopy }));

    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(mockOnCopy).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it('should not call onCopy when disabled', () => {
    renderHook(() => useGlobalKeyboardShortcuts({ onCopy: mockOnCopy, enabled: false }));

    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(mockOnCopy).not.toHaveBeenCalled();
  });

  it('should clean up event listener on unmount', () => {
    const { unmount } = renderHook(() => useGlobalKeyboardShortcuts({ onCopy: mockOnCopy }));

    unmount();

    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(mockOnCopy).not.toHaveBeenCalled();
  });

  it('should not call onCopy for other key combinations', () => {
    renderHook(() => useGlobalKeyboardShortcuts({ onCopy: mockOnCopy }));

    // Ctrl+V
    let event = new KeyboardEvent('keydown', {
      key: 'v',
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
    expect(mockOnCopy).not.toHaveBeenCalled();

    // Ctrl+X
    event = new KeyboardEvent('keydown', {
      key: 'x',
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
    expect(mockOnCopy).not.toHaveBeenCalled();

    // Just 'c' without modifier
    event = new KeyboardEvent('keydown', {
      key: 'c',
      bubbles: true,
    });
    document.dispatchEvent(event);
    expect(mockOnCopy).not.toHaveBeenCalled();
  });
});
