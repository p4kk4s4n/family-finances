import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings } from './db/schema';
import { drainShareInbox, processQueue, recoverQueue } from './capture/queue';
import Dashboard from './pages/Dashboard';
import Capture from './pages/Capture';
import Receipts from './pages/Receipts';
import ReceiptDetail from './pages/ReceiptDetail';
import Insights from './pages/Insights';
import More from './pages/More';
import Budgets from './pages/Budgets';
import Share from './pages/Share';
import SettingsPage from './pages/Settings';
import ComingSoon from './pages/ComingSoon';

export function useRoute(): string[] {
  const read = () => (window.location.hash.replace(/^#\/?/, '') || 'home').split('/');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(path: string) {
  window.location.hash = `#/${path}`;
}

const NAV = [
  { key: 'home', label: 'Home', icon: '🏠' },
  { key: 'receipts', label: 'Receipts', icon: '🧾' },
  { key: 'capture', label: 'Snap', icon: '📷', primary: true },
  { key: 'insights', label: 'Insights', icon: '📊' },
  { key: 'more', label: 'More', icon: '☰' },
];

export default function App() {
  const route = useRoute();
  const settings = useLiveQuery(() => getSettings(), []);
  const pending = useLiveQuery(() => db.receipts.where('status').equals('queued').count(), []) ?? 0;

  useEffect(() => {
    void recoverQueue();
    const params = new URLSearchParams(window.location.search);
    if (params.has('shared')) void drainShareInbox();
    const online = () => void processQueue();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, []);

  useEffect(() => {
    if (settings?.apiKey) void processQueue();
  }, [settings?.apiKey]);

  const [page, arg] = route;
  let body: JSX.Element;
  switch (page) {
    case 'capture': body = <Capture />; break;
    case 'receipts': body = <Receipts />; break;
    case 'receipt': body = <ReceiptDetail id={Number(arg)} />; break;
    case 'insights': body = <Insights />; break;
    case 'more': body = <More />; break;
    case 'budgets': body = <Budgets />; break;
    case 'share': body = <Share />; break;
    case 'settings': body = <SettingsPage />; break;
    case 'soon': body = <ComingSoon feature={arg} />; break;
    default: body = <Dashboard />;
  }

  const active = ['budgets', 'share', 'settings', 'soon'].includes(page) ? 'more' : page === 'receipt' ? 'receipts' : page;

  return (
    <div className="app">
      <header className="topbar">
        <h1 onClick={() => go('home')}>Family Finances</h1>
      </header>
      {settings && !settings.apiKey && pending > 0 && page !== 'settings' && (
        <div className="banner" role="alert">
          <span>🔑 {pending} receipt{pending > 1 ? 's' : ''} waiting. Add your Gemini API key to read them.</span>
          <button className="btn small" onClick={() => go('settings')}>Add key</button>
        </div>
      )}
      <main className="content">{body}</main>
      <nav className="bottomnav">
        {NAV.map((n) => (
          <button
            key={n.key}
            className={`navbtn ${n.primary ? 'primary' : ''} ${active === n.key ? 'active' : ''}`}
            onClick={() => go(n.key)}
            aria-label={n.label}
          >
            <span className="navicon">{n.icon}</span>
            <span className="navlabel">{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
