import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { go } from '../App';
import { Card, Empty, Money, StatusPill } from '../components/ui';
import { formatMoney } from '../lib/currency';

export default function Receipts() {
  const [month, setMonth] = useState('');
  const receipts = useLiveQuery(() => db.receipts.orderBy('createdAt').reverse().toArray(), []);
  const months = [...new Set((receipts ?? []).map((r) => r.date?.slice(0, 7)).filter(Boolean) as string[])].sort().reverse();
  const shown = (receipts ?? []).filter((r) => !month || r.date?.startsWith(month));
  const total = shown.reduce((s, r) => s + (r.status === 'saved' ? r.totalUSD ?? 0 : 0), 0);

  return (
    <Card
      title="Receipts"
      action={
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Filter month">
          <option value="">All</option>
          {months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      }
    >
      <p className="muted">{shown.length} receipts · {formatMoney(total)}</p>
      {!shown.length && <Empty>No receipts yet.</Empty>}
      {shown.map((r) => (
        <button key={r.id} className="list-row" onClick={() => go(`receipt/${r.id}`)}>
          <span>
            <b>{r.merchant || r.draft?.merchant || 'Receipt'}</b>
            <small>
              {r.date || new Date(r.createdAt).toLocaleDateString()}
              {r.currency && r.currency !== 'USD' ? ` · ${formatMoney(r.total, r.currency)}` : ''}
            </small>
          </span>
          <span className="row-end">
            {r.status === 'saved' ? <Money v={r.totalUSD} /> : <StatusPill s={r.status} />}
          </span>
        </button>
      ))}
    </Card>
  );
}
