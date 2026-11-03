import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthGate } from './components/Auth';
import { I18nProvider } from './i18n';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </I18nProvider>
  </StrictMode>,
);
