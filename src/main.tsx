import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './ui/theme.css';
import { loadAllFonts } from './ui/fonts';
import { installDebugBridge } from './app/debugBridge';

void loadAllFonts();
installDebugBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
