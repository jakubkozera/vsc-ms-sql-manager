import React from 'react';
import ReactDOM from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import { PerformanceDashboardApp } from './PerformanceDashboardApp';
import '../styles/variables.css';
import '../styles/global.css';

loader.config({
  paths: {
    vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.0/min/vs',
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PerformanceDashboardApp />
  </React.StrictMode>
);
