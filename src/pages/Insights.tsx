import { useState } from 'react';
import { Bar, Card, Empty, Money } from '../components/ui';
import { today, useData } from '../components/hooks';
import { basketInflation, brandSavings, budgetStatus, daysInMonth, itemsInMonth, leakage, spendByCategory, topItems } from '../insights/metrics';
import { categoryDef } from '../lib/categories';

export default function Insights() {
  const { items, budgets, settings, loading } = useData();
  const [windowDays, setWindowDays] = useState(90);
  if (loading) return null;

  const ref = today();
  const ym = ref.slice(0, 7);
  const month = itemsInMonth(items!, ym);
  const lines = budgetStatus(budgets!, spendByCategory(month), Number(ref.slice(8)), daysInMonth(ym));
  const leak = leakage(month, settings?.leakageThreshold ?? 10);
  const brand = brandSavings(items!);
  const infl = basketInflation(items!, ref, windowDays);
  const top = topItems(month);

  return (
    <>
      <Card title={`Spend vs budget · ${ym}`}>
        {!lines.length && <Empty>Set budgets in More → Budgets.</Empty>}
        {lines.map((l) => (
          <div key={l.category} className="budget-row">
            <div className="row-between">
              <span>{categoryDef(l.category).emoji} {l.category}</span>
              <span><Money v={l.spent} /> <small>/ <Money v={l.limit} /> · proj. <Money v={l.projected} /></small></span>
            </div>
            <Bar value={l.spent} max={l.limit} status={l.status} />
          </div>
        ))}
      </Card>

      <Card title="📈 Personal inflation" action={
        <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} aria-label="Inflation window">
          <option value={30}>vs 1 mo</option>
          <option value={90}>vs 3 mo</option>
          <option value={180}>vs 6 mo</option>
        </select>
      }>
        <p>
          Basket inflation: <b className={infl.pct != null && infl.pct > 0 ? 'neg' : 'pos'}>{infl.pct == null ? 'not enough history yet' : `${infl.pct > 0 ? '+' : ''}${infl.pct}%`}</b>
        </p>
        {infl.tracked.slice(0, 8).map((t) => (
          <div key={t.name} className="row-between small-row">
            <span>{t.name}</span>
            <span><Money v={t.baseline} /> → <Money v={t.recent} /> <b className={t.pct > 0 ? 'neg' : 'pos'}>{t.pct > 0 ? '+' : ''}{t.pct}%</b></span>
          </div>
        ))}
        {!infl.tracked.length && <Empty>Keep snapping. Price trends appear once an item shows up across periods.</Empty>}
      </Card>

      <Card title="💧 Receipt leakage">
        <p>Discretionary items ≤ <Money v={settings?.leakageThreshold ?? 10} />: <b>{leak.count}</b> items · <b><Money v={leak.total} /></b> this month</p>
        {leak.top.map((t) => (
          <div key={t.name} className="row-between small-row"><span>{t.name} ×{t.count}</span><Money v={t.total} /></div>
        ))}
      </Card>

      <Card title="🏷️ Store-brand savings">
        <p>Potential savings by switching to store brand: <b className="pos"><Money v={brand.total} /></b></p>
        {brand.opportunities.slice(0, 6).map((o) => (
          <div key={o.name} className="row-between small-row">
            <span>{o.name}</span>
            <span><Money v={o.nameAvg} /> vs <Money v={o.storeAvg} /> · save <Money v={o.savings} /></span>
          </div>
        ))}
        {!brand.opportunities.length && <Empty>Appears when you've bought both store and name brands of the same item.</Empty>}
      </Card>

      <Card title="Top items this month">
        {top.map((t) => (
          <div key={t.name} className="row-between small-row"><span>{t.name} ×{t.count}</span><Money v={t.total} /></div>
        ))}
        {!top.length && <Empty>No items yet.</Empty>}
      </Card>
    </>
  );
}
