import './lib/polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { registerOfflineSW } from './lib/registerSW';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The SW only caches the static app shell (incl. the lazy PDF chunk and its
// worker) so the in-browser PDF import keeps working offline. It never
// syncs, uploads or stores any user data.
registerOfflineSW();
