import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { go } from './App';
import { kickQueue, processQueue } from './capture/queue';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'QUEUE_CHANGED') {
      void processQueue();
    } else if (e.data?.type === 'NAVIGATE' && typeof e.data.path === 'string') {
      go(e.data.path);
    }
  });

  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
        .then(() => navigator.serviceWorker.ready)
        .then(() => kickQueue())
        .catch((e) => console.warn('Service worker registration failed', e));
    });
  }
}
