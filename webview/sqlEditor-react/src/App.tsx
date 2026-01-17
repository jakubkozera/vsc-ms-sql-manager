import { useRef, useCallback, useEffect } from 'react';
import { useVSCode } from './context/VSCodeContext';
import { useLocalStorage } from './hooks/useLocalStorage';
import { Toolbar, useFormatOptions } from './components/Toolbar';
import { SqlEditor, SqlEditorHandle } from './components/Editor';
import { ResultsPanel } from './components/Results';
import './styles/app.css';

function App() {
  const {
    isExecuting,
    executeQuery,
  } = useVSCode();

  const editorRef = useRef<SqlEditorHandle>(null);
  const formatOptions = useFormatOptions();

  // Include actual execution plan toggle
  const [includeActualPlan, setIncludeActualPlan] = useLocalStorage('includeActualPlan', false);

  // Editor/Results split resizing
  const [editorHeight, setEditorHeight] = useLocalStorage('editorHeight', 300);
  const resizerRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);

  const handleExecute = useCallback(() => {
    if (!editorRef.current) return;

    let sql = editorRef.current.getSelectedText();
    if (!sql) {
      sql = editorRef.current.getValue();
    }

    if (sql.trim()) {
      // Format before run if enabled
      if (formatOptions.formatBeforeRun) {
        editorRef.current.formatSql();
        // Get the formatted value
        sql = editorRef.current.getSelectedText() || editorRef.current.getValue();
      }
      executeQuery(sql, { includeActualPlan });
    }
  }, [executeQuery, includeActualPlan, formatOptions.formatBeforeRun]);

  const handleFormat = useCallback(() => {
    editorRef.current?.formatSql();
  }, []);

  // Resizer mouse handling
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const containerRect = document.getElementById('container')?.getBoundingClientRect();
      if (!containerRect) return;

      const toolbarHeight = 52; // Approximate toolbar height
      const minEditorHeight = 100;
      const minResultsHeight = 100;
      const maxEditorHeight = containerRect.height - toolbarHeight - minResultsHeight - 6;

      let newHeight = e.clientY - containerRect.top - toolbarHeight;
      newHeight = Math.max(minEditorHeight, Math.min(maxEditorHeight, newHeight));
      setEditorHeight(newHeight);
    };

    const handleMouseUp = () => {
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
    isResizing.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

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
      <div id="editorContainer" style={{ height: `${editorHeight}px` }}>
        <SqlEditor
          ref={editorRef}
          onExecute={(sql) => executeQuery(sql, { includeActualPlan })}
          initialValue="-- Write your SQL query here\nSELECT * FROM "
        />
      </div>

      {/* Resizer */}
      <div
        className="resizer"
        id="resizer"
        ref={resizerRef}
        onMouseDown={handleResizerMouseDown}
      />

      {/* Results Panel */}
      <div id="resultsContainer" className="visible">
        <ResultsPanel />
      </div>
    </div>
  );
}

export default App;
