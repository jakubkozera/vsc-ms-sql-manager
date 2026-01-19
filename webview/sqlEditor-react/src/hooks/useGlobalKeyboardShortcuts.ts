import { useEffect } from 'react';

interface UseGlobalKeyboardShortcutsOptions {
  onCopy?: () => void;
  enabled?: boolean;
}

/**
 * Hook that sets up global keyboard shortcuts for the application.
 * Handles shortcuts like Ctrl+C for copying grid data when Monaco editor doesn't have focus.
 */
export function useGlobalKeyboardShortcuts({ onCopy, enabled = true }: UseGlobalKeyboardShortcutsOptions = {}) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Ctrl+C (or Cmd+C on Mac) for copying grid data
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        // Check if Monaco editor has focus
        if (isMonacoEditorFocused()) {
          // Let Monaco handle the copy
          return;
        }

        // Check if there's a text input focused (like filter inputs)
        const activeElement = document.activeElement;
        if (activeElement && (
          activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          (activeElement as HTMLElement).isContentEditable
        )) {
          // Let the input handle the copy
          return;
        }

        // Check if there's a grid selection to copy
        if (onCopy) {
          e.preventDefault();
          e.stopPropagation();
          onCopy();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCopy, enabled]);
}

/**
 * Check if Monaco editor currently has focus
 */
function isMonacoEditorFocused(): boolean {
  const activeElement = document.activeElement;
  if (!activeElement) return false;

  // Check if the active element or any of its parents is the Monaco editor
  let element: Element | null = activeElement;
  while (element) {
    if (element.classList.contains('monaco-editor') || 
        element.classList.contains('monaco-editor-background') ||
        element.id === 'editor-container') {
      return true;
    }
    element = element.parentElement;
  }

  return false;
}
