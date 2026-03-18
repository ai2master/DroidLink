import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import './i18n';
import { useStore } from './stores/useStore';
import { ToastProvider } from './components/ui/toast';
import { ConfirmProvider } from './components/ui/confirm-dialog';
import { TooltipProvider } from './components/ui/tooltip';

// Apply initial density to HTML element
const density = useStore.getState().density;
document.documentElement.setAttribute('data-density', density);

// Apply saved custom font BEFORE first render to avoid FOUC (Flash of Unstyled Content)
// Previously this only ran when Settings page was opened — now it runs at startup
const savedFont = localStorage.getItem('droidlink-font');
if (savedFont) {
  document.documentElement.style.setProperty('--font-family-custom', `"${savedFont}"`);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </ToastProvider>
    </TooltipProvider>
  </React.StrictMode>,
);
