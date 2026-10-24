import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';

export function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Live data used by dashboard/insights. */
export function useData() {
  const items = useLiveQuery(() => db.items.toArray(), []);
  const budgets = useLiveQuery(() => db.budgets.toArray(), []);
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  return { items, budgets, settings, loading: !items || !budgets };
}
