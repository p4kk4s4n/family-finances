import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, saveSettings } from '../db/schema';
import { Card, Money } from '../components/ui';
import { CATEGORIES } from '../lib/categories';

export default function Budgets() {
  const budgets = useLiveQuery(() => db.budgets.toArray(), []);
  const settings = useLiveQuery(() => getSettings(), []);
  if (!budgets || !settings) return null;
  const sum = budgets.reduce((s, b) => s + b.monthlyLimit, 0);
  const get = (c: string) => budgets.find((b) => b.category === c)?.monthlyLimit ?? 0;

  return (
    <Card title="Monthly budgets (USD)">
      <p className="muted">
        Category total: <b><Money v={sum} /></b>
      </p>
      <label className="row-between">
        <span>Overall monthly budget <small className="muted">(optional override for flexibility)</small></span>
        <input
          className="num-input"
          type="number"
          inputMode="decimal"
          placeholder={String(sum)}
          value={settings.monthlyBudgetTotal ?? ''}
          onChange={(e) => saveSettings({ monthlyBudgetTotal: e.target.value === '' ? undefined : Number(e.target.value) })}
        />
      </label>
      <hr />
      {CATEGORIES.map((c) => (
        <label key={c.name} className="row-between budget-edit">
          <span>{c.emoji} {c.name} {c.discretionary && <small className="muted">· want</small>}</span>
          <input
            className="num-input"
            type="number"
            inputMode="decimal"
            value={get(c.name)}
            onChange={(e) => db.budgets.put({ category: c.name, monthlyLimit: Number(e.target.value) || 0 })}
          />
        </label>
      ))}
    </Card>
  );
}
