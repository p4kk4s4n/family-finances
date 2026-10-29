import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings } from './db/schema';
import { drainShareInbox, kickQueue, recoverQueue } from './capture/queue';
import { prefetchOcrAssets } from './capture/ocr';
import { applyDisplayScale } from './lib/display';
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
import PricePulse from './pages/PricePulse';
import BankImport from './pages/BankImport';

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
  const pending = useLiveQuery(() => db.receipts.where('status').anyOf('queued', 'ai_failed').count(), []) ?? 0;
  const ocrFallbackCount =
    useLiveQuery(
      () =>
        db.receipts
          .where('status')
          .equals('needs_review')
          .filter((r) => r.parsedBy === 'ocr')
          .count(),
      [],
    ) ?? 0;
  const waitingForKey = pending + ocrFallbackCount;

  useEffect(() => {
    void recoverQueue();
    const params = new URLSearchParams(window.location.search);
    if (params.has('shared')) void drainShareInbox();
    const onOnline = () => void kickQueue();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void recoverQueue();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    applyDisplayScale(settings);
  }, [settings?.fontScale, settings?.iconScale, settings?.resolutionScale]);

  useEffect(() => {
    if (!settings) return;
    if (settings.ocrFallback || settings.ocrOnly) {
      void prefetchOcrAssets();
    }
    if (settings.apiKey && !settings.ocrOnly) {
      void db.receipts
        .where('status')
        .equals('needs_review')
        .filter((r) => r.parsedBy === 'ocr' && /No Gemini API key/i.test(r.aiError || ''))
        .modify({ status: 'queued', parsedBy: undefined, aiError: undefined, strikes: 0, attempts: 0 })
        .then(() => kickQueue());
      return;
    }
    void kickQueue();
  }, [settings?.apiKey, settings?.ocrFallback, settings?.ocrOnly]);

  const [page, arg] = route;
  let body: JSX.Element;
  switch (page) {
    case 'capture': body = <Capture />; break;
    case 'receipts': body = <Receipts />; break;
    case 'receipt': body = <ReceiptDetail id={Number(arg)} />; break;
    case 'insights': body = <Insights />; break;
    case 'more': body = <More />; break;
    case 'budgets': body = <Budgets />; break;
    case 'prices': body = <PricePulse />; break;
    case 'bank': body = <BankImport />; break;
    case 'share': body = <Share />; break;
    case 'settings': body = <SettingsPage />; break;
    case 'soon': body = <ComingSoon feature={arg} />; break;
    default: body = <Dashboard />;
  }

  const active = ['budgets', 'prices', 'bank', 'share', 'settings', 'soon'].includes(page)
    ? 'more'
    : page === 'receipt'
      ? 'receipts'
      : page;

  return (
    <div className="app">
      <header className="topbar">
        <h1 onClick={() => go('home')}>Family Finances</h1>
      </header>
      {settings && !settings.apiKey && !settings.ocrOnly && waitingForKey > 0 && page !== 'settings' && (
        <div className="banner" role="alert">
          <span>🔑 {waitingForKey} receipt{waitingForKey > 1 ? 's' : ''} waiting. Add your Gemini API key to read them with AI.</span>
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
