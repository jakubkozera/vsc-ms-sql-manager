import { useEffect, useRef } from 'react';

interface UseGlobalKeyboardShortcutsOptions {
  onCopy?: () => void;
  onSave?: () => void;
  onNewQuery?: () => void;
  enabled?: boolean;
}

/**
 * Hook that sets up global keyboard shortcuts for the application.
 * Handles Ctrl+C for copying grid data when Monaco editor doesn't have focus.
 * Note: Ctrl+V is NOT handled here to avoid interfering with Monaco's paste functionality.
 */
export function useGlobalKeyboardShortcuts({ onCopy, onSave, onNewQuery, enabled = true }: UseGlobalKeyboardShortcutsOptions = {}) {
  // Use refs for callbacks to avoid re-registering the listener on every render
  const onCopyRef = useRef(onCopy);
  const onSaveRef = useRef(onSave);
  const onNewQueryRef = useRef(onNewQuery);
  
  useEffect(() => { onCopyRef.current = onCopy; }, [onCopy]);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { onNewQueryRef.current = onNewQuery; }, [onNewQuery]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        return;
      }

      // Ctrl+S - Save query (global, works even outside Monaco)
      if (e.key === 's' && onSaveRef.current) {
        e.preventDefault();
        e.stopPropagation();
        if (!isElementInMonacoEditor(e.target as Element)) {
          onSaveRef.current();
        }
        return;
      }

      // Ctrl+N - New query (global, works even outside Monaco)
      if (e.key === 'n' && onNewQueryRef.current) {
        e.preventDefault();
        e.stopPropagation();
        if (!isElementInMonacoEditor(e.target as Element)) {
          onNewQueryRef.current();
        }
        return;
      }

      // Only handle Ctrl+C below
      if (e.key !== 'c') {
        return;
      }
      
      // Check if event target is within Monaco editor
      const activeEl = document.activeElement as Element;
      if (isElementInMonacoEditor(e.target as Element) || isElementInMonacoEditor(activeEl)) {
        return;
      }

      // Check if there's a text input focused (like filter inputs)
      const target = (e.target as HTMLElement)?.tagName ? e.target as HTMLElement : activeEl as HTMLElement;
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )) {
        return;
      }

      // Check if there's a grid selection to copy
      if (onCopyRef.current) {
        e.preventDefault();
        e.stopPropagation();
        onCopyRef.current();
      }
    };

    document.addEventListener('keydown', handleKeyDown, { capture: false });
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: false });
    };
  }, [enabled]);
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
    if (current.classList &&
        (current.classList.contains('monaco-editor') ||
        current.classList.contains('monaco-editor-background') ||
        (current as any).id === 'editor-container' ||
        current.classList.contains('sql-editor-container') ||
        current.classList.contains('native-edit-context') ||
        current.classList.contains('overflow-guard'))) {
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
