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
};

export default function ComingSoon({ feature }: { feature?: string }) {
  if (feature === 'prices') {
    go('prices');
    return null;
  }
  if (feature === 'bank') {
    go('bank');
    return null;
  }
  const f = SOON[feature ?? ''];
  if (!f) {
    go('more');
    return null;
  }
  return (
    <Card title={<>{f.icon} {f.title}</>} action={<SoonBadge />}>
      <p>{f.tagline}</p>
      <ul className="bullets">{f.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
    </Card>
  );
}
