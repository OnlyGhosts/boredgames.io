import '../../client/src/platform/styles/tokens.css';
import '../../client/src/platform/styles/base.css';
import '../../client/src/platform/styles/components.css';
import './admin.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// The site's tokens: dark by default, light when the device asks for it.
const light = window.matchMedia('(prefers-color-scheme: light)');
const applyTheme = () => {
  document.documentElement.dataset.theme = light.matches ? 'light' : 'dark';
};
applyTheme();
light.addEventListener('change', applyTheme);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
