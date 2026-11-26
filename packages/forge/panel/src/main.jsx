import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { enableTheme } from './bridge.js';
import './styles.css';

// Pick up Jira's theme first so the first paint already matches the page around the panel.
enableTheme()
  .catch(() => undefined)
  .finally(() => {
    createRoot(document.getElementById('root')).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
