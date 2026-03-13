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
