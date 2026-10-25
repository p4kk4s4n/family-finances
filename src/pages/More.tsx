import { go } from '../App';
import { Card, SoonBadge } from '../components/ui';
import { SOON } from './ComingSoon';

export default function More() {
  return (
    <>
      <Card>
        <button className="list-row" onClick={() => go('prices')}>
          <span>
            <b>📉 Price Pulse &amp; Pantry</b>
            <small>Store price comparison, price jump alerts &amp; reorder timing</small>
          </span>
          <span>›</span>
        </button>
        <button className="list-row" onClick={() => go('bank')}>
          <span>
            <b>🏦 Bank statement import</b>
            <small>Reconcile CSV / OFX / PDF statements against snapped receipts</small>
          </span>
          <span>›</span>
        </button>
        <button className="list-row" onClick={() => go('budgets')}>
          <span>
            <b>💰 Budgets</b>
            <small>Monthly goals per category</small>
          </span>
          <span>›</span>
        </button>
        <button className="list-row" onClick={() => go('share')}>
          <span>
            <b>📤 Share with partner</b>
            <small>Image card, text summary or data file</small>
          </span>
          <span>›</span>
        </button>
        <button className="list-row" onClick={() => go('settings')}>
          <span>
            <b>⚙️ Settings</b>
            <small>API key, currency, updates, data</small>
          </span>
          <span>›</span>
        </button>
      </Card>
      <Card title="Coming soon">
        {Object.entries(SOON).map(([key, f]) => (
          <button key={key} className="list-row" onClick={() => go(`soon/${key}`)}>
            <span>
              <b>
                {f.icon} {f.title}
              </b>
              <small>{f.tagline}</small>
            </span>
            <SoonBadge />
          </button>
        ))}
      </Card>
    </>
  );
}
