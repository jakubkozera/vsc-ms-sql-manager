import { useRef, useCallback, useEffect, useMemo } from 'react';
import { useVSCode } from './context/VSCodeContext';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useGlobalKeyboardShortcuts } from './hooks/useGlobalKeyboardShortcuts';
import { Toolbar, useFormatOptions } from './components/Toolbar';
import { SqlEditor, SqlEditorHandle } from './components/Editor';
import { ResultsPanel } from './components/Results';
import { removeExecutionComments } from './services';
import './styles/app.css';

function App() {
  const {
    isExecuting,
    executeQuery,
    currentConnectionId,
    shouldAutoExecute,
    clearAutoExecute,
    lastResults,
    lastMessages,
    lastPlanXml,
    lastError,
    editorContent,
  } = useVSCode();

  const editorRef = useRef<SqlEditorHandle>(null);
  const formatOptions = useFormatOptions();

  // Include actual execution plan toggle
  const [includeActualPlan, setIncludeActualPlan] = useLocalStorage('includeActualPlan', false);

  // Editor/Results split resizing
  const [editorHeight, setEditorHeight] = useLocalStorage('editorHeight', 300);
  const isResizing = useRef(false);

  // Global keyboard shortcuts for grid operations
  useGlobalKeyboardShortcuts({
    onCopy: () => {
      // TODO: Implement grid copy functionality
      console.log('Grid copy not implemented yet');
    },
  });

  const handleExecute = useCallback(() => {
    if (!editorRef.current) return;

    let sql = editorRef.current.getSelectedText();
    if (!sql) {
      sql = editorRef.current.getValue();
    }

    if (sql.trim()) {
      // Remove execution history comments
      sql = removeExecutionComments(sql);
      
      // Format before run if enabled
      if (formatOptions.formatBeforeRun) {
        editorRef.current.formatSql();
        // Get the formatted value
        sql = editorRef.current.getSelectedText() || editorRef.current.getValue();
      }
      executeQuery(sql, { includeActualPlan });
    }
  }, [executeQuery, includeActualPlan, formatOptions.formatBeforeRun]);

  // Handle auto-execute query
  useEffect(() => {
    if (shouldAutoExecute && currentConnectionId && editorRef.current) {
      const content = editorRef.current.getValue().trim();
      // Auto-execute if content starts with SELECT
      if (content && content.toLowerCase().startsWith('select')) {
        // Small delay to ensure the webview is fully initialized
        const timeoutId = setTimeout(() => {
          const cleanedSql = removeExecutionComments(content);
          executeQuery(cleanedSql, { includeActualPlan });
        }, 50);
        clearAutoExecute();
        return () => clearTimeout(timeoutId);
      }
      clearAutoExecute();
    }
  }, [shouldAutoExecute, currentConnectionId, executeQuery, includeActualPlan, clearAutoExecute]);

  const handleFormat = useCallback(() => {
    editorRef.current?.formatSql();
  }, []);

  // Resizer mouse handling
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const containerRect = document.getElementById('container')?.getBoundingClientRect();
      if (!containerRect) {
        console.warn('[RESIZER] Container not found');
        return;
      }

      const toolbarHeight = 52; // Approximate toolbar height
      const minEditorHeight = 100;
      const minResultsHeight = 100;
      const maxEditorHeight = containerRect.height - toolbarHeight - minResultsHeight - 6;

      let newHeight = e.clientY - containerRect.top - toolbarHeight;
      newHeight = Math.max(minEditorHeight, Math.min(maxEditorHeight, newHeight));
      console.log('[RESIZER] Moving - clientY:', e.clientY, 'newHeight:', newHeight, 'containerHeight:', containerRect.height);
      setEditorHeight(newHeight);
    };

    const handleMouseUp = () => {
      console.log('[RESIZER] Mouse up - final height:', editorHeight);
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setEditorHeight]);

  const handleResizerMouseDown = () => {
    console.log('[RESIZER] Mouse down - starting resize from height:', editorHeight);
    isResizing.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  // Determine if results container should be visible
  const hasResults = useMemo(() => {
    return (lastResults && lastResults.length > 0) || 
           (lastMessages && lastMessages.length > 0) || 
           !!lastPlanXml || 
           !!lastError;
  }, [lastResults, lastMessages, lastPlanXml, lastError]);

  // Calculate results container height
  const resultsHeight = useMemo(() => {
    if (!hasResults) return 0;
    // Get container height and subtract toolbar (52px) and editor height
    const containerHeight = window.innerHeight;
    const toolbarHeight = 52;
    const resizerHeight = 4;
    return containerHeight - toolbarHeight - editorHeight - resizerHeight;
  }, [hasResults, editorHeight]);

  return (
    <div id="container">
      {/* Toolbar */}
      <Toolbar
        onExecute={handleExecute}
        onFormat={handleFormat}
        isExecuting={isExecuting}
        includeActualPlan={includeActualPlan}
        onToggleActualPlan={setIncludeActualPlan}
      />

      {/* Editor Container */}
      <div id="editorContainer" style={{ height: hasResults ? `${editorHeight}px` : undefined, flex: hasResults ? undefined : 1 }}>
        <SqlEditor
          ref={editorRef}
          onExecute={(sql) => executeQuery(sql, { includeActualPlan })}
          initialValue={editorContent || "-- Write your SQL query here\nSELECT * FROM "}
        />
      </div>

      {/* Resizer - only visible when results are shown */}
      {hasResults && (
        <div
          className="resizer visible"
          id="resizer"
          onMouseDown={handleResizerMouseDown}
        />
      )}

      {/* Results Panel - only visible when there are results */}
      {hasResults && (
        <div 
          id="resultsContainer" 
          className="visible"
          style={{ height: `${resultsHeight}px`, flex: `0 0 ${resultsHeight}px` }}
        >
          <ResultsPanel />
        </div>
      )}
    </div>
  );
}

export default App;
