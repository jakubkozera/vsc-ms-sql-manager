import { useVSCode } from './context/VSCodeContext';
import './styles/app.css';

function App() {
  const { isConnected, currentConnectionId, currentDatabase, dbSchema } = useVSCode();

  return (
    <div id="container">
      {/* Toolbar */}
      <div id="toolbar">
        <div className="button-container">
          <button className="main-button" id="executeButton" title="Execute Query (F5 or Ctrl+Shift+E)">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 4v16l13 -8z" />
            </svg>
            Run
          </button>
        </div>
        
        <div className="toolbar-separator"></div>
        
        <span id="statusLabel">
          {isConnected 
            ? `Connected: ${currentConnectionId} / ${currentDatabase || 'No DB'}`
            : 'Not Connected'
          }
        </span>
        
        <span style={{ marginLeft: 'auto', fontSize: '12px', opacity: 0.7 }}>
          Schema: {dbSchema.tables.length} tables, {dbSchema.views.length} views
        </span>
      </div>

      {/* Editor Container (placeholder) */}
      <div id="editorContainer">
        <div id="editor" style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          color: 'var(--vscode-descriptionForeground)',
          fontSize: '14px'
        }}>
          Monaco Editor will be integrated in Etap 2
        </div>
      </div>

      {/* Resizer */}
      <div className="resizer" id="resizer"></div>

      {/* Results Container (placeholder) */}
      <div id="resultsContainer" className="visible">
        <div className="results-tabs">
          <button className="results-tab active" data-tab="results">Results</button>
          <button className="results-tab" data-tab="messages">Messages</button>
        </div>
        <div id="resultsContent" style={{ 
          padding: '20px', 
          color: 'var(--vscode-descriptionForeground)',
          fontSize: '14px'
        }}>
          Results Grid will be implemented in Etap 3
        </div>
      </div>
    </div>
  );
}

export default App;
