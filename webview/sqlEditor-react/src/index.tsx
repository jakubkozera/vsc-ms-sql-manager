import React from 'react';
import ReactDOM from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import App from './App';
import { VSCodeProvider } from './context/VSCodeContext';
import './styles/variables.css';
import './styles/global.css';

// Configure Monaco loader to use jsdelivr CDN with explicit version
// This ensures codicon fonts and all Monaco assets load correctly in VS Code webviews
loader.config({
  paths: {
    vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.0/min/vs',
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VSCodeProvider>
      <App />
    </VSCodeProvider>
  </React.StrictMode>
);
