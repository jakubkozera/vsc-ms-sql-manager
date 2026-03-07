import React from 'react';
import ReactDOM from 'react-dom/client';
import { SettingsApp } from './SettingsApp';
import '../styles/variables.css';
import '../styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsApp />
  </React.StrictMode>
);
