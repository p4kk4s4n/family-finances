import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { Card, SoonBadge } from '../components/ui';
import { go } from '../App';

export const SOON: Record<string, { icon: string; title: string; tagline: string; bullets: string[] }> = {
  family: {
    icon: '👨‍👩‍👧',
    title: 'Family Relay',
    tagline: 'Shared household envelopes with live sync',
    bullets: [
      'Any partner or teen snaps; receipts flow into shared family envelopes',
      'Tag line items: personal, shared, reimbursable',
      'Automatic Sunday digest to everyone',
    ],
  },
  pacing: {
    icon: '⏱️',
    title: 'Pacing & Burn Rate',
    tagline: 'Safe-to-spend daily allowances',
    bullets: [
      'Daily and weekly safe-to-spend per envelope',
      'Early warnings when you burn through a budget too fast',
      'Adjusted pacing for the rest of the period',
    ],
  },
  prices: {
    icon: '📉',
    title: 'Price Pulse & Pantry',
    tagline: 'Price history, shrinkflation and reorder alerts',
    bullets: [
      'Compare the same item across stores',
      'Shrinkflation and price-jump alerts',
      'Reorder reminders based on purchase frequency',
    ],
  },
  bank: {
    icon: '🏦',
    title: 'Bank statement import',
    tagline: 'Reconcile receipts against card statements',
    bullets: [
      'Import CSV or OFX statements',
      'Match snapped receipts to posted charges',
      'Find purchases you forgot to snap',
    ],
  },
};

export default function ComingSoon({ feature }: { feature?: string }) {
  const f = SOON[feature ?? ''];
  const tracked = useLiveQuery(async () => new Set((await db.items.toArray()).map((i) => i.normalizedName)).size, []);
  if (!f) {
    go('more');
    return null;
  }
  return (
    <Card title={<>{f.icon} {f.title}</>} action={<SoonBadge />}>
      <p>{f.tagline}</p>
      <ul className="bullets">{f.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
      {feature === 'prices' && (
        <p className="muted">Good news: your line items are already building price history. {tracked ?? 0} products are tracked so far.</p>
      )}
    </Card>
  );
}
