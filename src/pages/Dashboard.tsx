import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { go } from '../App';
import { Bar, Card, Empty, Money, StatusPill } from '../components/ui';
import { today, useData } from '../components/hooks';
import { basketInflation, budgetStatus, daysInMonth, discretionaryFlex, itemsInMonth, leakage, spendByCategory } from '../insights/metrics';
import { categoryDef } from '../lib/categories';

export default function Dashboard() {
  const { items, budgets, settings, loading } = useData();
  const recent = useLiveQuery(() => db.receipts.orderBy('createdAt').reverse().limit(5).toArray(), []);
  if (loading) return null;

  const ref = today();
  const ym = ref.slice(0, 7);
  const dom = Number(ref.slice(8, 10));
  const mdays = daysInMonth(ym);
  const month = itemsInMonth(items!, ym);
  const budgetTotal = settings?.monthlyBudgetTotal || budgets!.reduce((s, b) => s + b.monthlyLimit, 0);
  const infl = basketInflation(items!, ref, 90);
  const flex = discretionaryFlex({ budgetTotal, monthItems: month, dayOfMonth: dom, monthDays: mdays, inflationPct: infl.pct });
  const lines = budgetStatus(budgets!, spendByCategory(month), dom, mdays).slice(0, 5);
  const leak = leakage(month, settings?.leakageThreshold ?? 10);

  return (
    <>
      <Card>
        <div className="hero">
          <div className="hero-label">Discretionary flexibility this month</div>
          <div className={`hero-value ${flex.flex < 0 ? 'neg' : ''}`}>
            <Money v={flex.flex} />
          </div>
          <div className="hero-sub">
            ≈ <Money v={flex.dailyFlex} /> / day for {flex.remainingDays} remaining days
          </div>
          <div className="hero-grid">
            <div>
              <span>Essentials (projected)</span>
              <Money v={flex.essentialsProjected} />
            </div>
            <div>
              <span>Wants spent</span>
              <Money v={flex.discretionarySpent} />
            </div>
            <div>
              <span>Basket inflation (3 mo)</span>
              <b>{infl.pct == null ? '-' : `${infl.pct > 0 ? '+' : ''}${infl.pct}%`}</b>
            </div>
          </div>
        </div>
      </Card>

      <button className="btn primary block big" onClick={() => go('capture')}>📷 Snap a receipt</button>

      <Card title="Budgets this month" action={<button className="link" onClick={() => go('insights')}>All →</button>}>
        {lines.length === 0 && <Empty>No spending yet this month.</Empty>}
        {lines.map((l) => (
          <div key={l.category} className="budget-row">
            <div className="row-between">
              <span>{categoryDef(l.category).emoji} {l.category}</span>
              <span>
                <Money v={l.spent} /> <small>/ <Money v={l.limit} /></small>
              </span>
            </div>
            <Bar value={l.spent} max={l.limit} status={l.status} />
          </div>
        ))}
      </Card>

      {leak.count > 0 && (
        <Card title="💧 Receipt leakage">
          <p>
            <b>{leak.count}</b> small discretionary items this month added up to <b><Money v={leak.total} /></b>.
          </p>
        </Card>
      )}

      <Card title="Recent receipts" action={<button className="link" onClick={() => go('receipts')}>All →</button>}>
        {!recent?.length && <Empty>Nothing captured yet. Tap Snap to start.</Empty>}
        {recent?.map((r) => (
          <button key={r.id} className="list-row" onClick={() => go(`receipt/${r.id}`)}>
            <span>
              <b>{r.merchant || r.draft?.merchant || 'New receipt'}</b>
              <small>{r.date || r.draft?.date || new Date(r.createdAt).toLocaleDateString()}</small>
            </span>
            <span className="row-end">
              {r.status === 'saved' ? <Money v={r.totalUSD} /> : <StatusPill s={r.status} />}
            </span>
          </button>
        ))}
      </Card>
    </>
  );
}
