import { useEffect } from 'react';

interface UseGlobalKeyboardShortcutsOptions {
  onCopy?: () => void;
  enabled?: boolean;
}

/**
 * Hook that sets up global keyboard shortcuts for the application.
 * Handles Ctrl+C for copying grid data when Monaco editor doesn't have focus.
 * Note: Ctrl+V is NOT handled here to avoid interfering with Monaco's paste functionality.
 */
export function useGlobalKeyboardShortcuts({ onCopy, enabled = true }: UseGlobalKeyboardShortcutsOptions = {}) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle Ctrl+C - ignore all other keyboard events completely
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'c') {
        return;
      }
      
      console.log('[useGlobalKeyboardShortcuts] Ctrl+C detected, Target:', (e.target as any)?.tagName, (e.target as any)?.className);
      
      // Check if event target is within Monaco editor
      const targetIsInMonaco = isElementInMonacoEditor(e.target as Element);
      
      if (targetIsInMonaco) {
        console.log('[useGlobalKeyboardShortcuts] Target in Monaco - letting Monaco handle copy');
        return;
      }

      // Check if there's a text input focused (like filter inputs)
      const target = e.target as HTMLElement;
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )) {
        console.log('[useGlobalKeyboardShortcuts] Target is text input - letting input handle copy');
        return;
      }

      // Check if there's a grid selection to copy
      if (onCopy) {
        console.log('[useGlobalKeyboardShortcuts] Calling grid onCopy handler');
        e.preventDefault();
        e.stopPropagation();
        onCopy();
      }
    };

    console.log('[useGlobalKeyboardShortcuts] Adding keydown listener for Ctrl+C only');
    document.addEventListener('keydown', handleKeyDown, { capture: false });
    return () => {
      console.log('[useGlobalKeyboardShortcuts] Removing keydown listener');
      document.removeEventListener('keydown', handleKeyDown, { capture: false });
    };
  }, [onCopy, enabled]);
}

/**
 * Check if an element is within the Monaco editor
 */
function isElementInMonacoEditor(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  // Check if the element or any of its parents is the Monaco editor
  let current: Element | null = element;
  let depth = 0;
  while (current) {
    if (current.classList.contains('monaco-editor') ||
        current.classList.contains('monaco-editor-background') ||
        (current as any).id === 'editor-container' ||
        current.classList.contains('sql-editor-container') ||
        current.classList.contains('native-edit-context') ||
        current.classList.contains('overflow-guard')) {
      return true;
    }
    
    current = current.parentElement;
    depth++;
    if (depth > 20) {
      break;
    }
  }

  return false;
}
