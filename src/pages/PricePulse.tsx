import { useMemo, useState } from 'react';
import { Card, Empty, Money } from '../components/ui';
import { today, useData } from '../components/hooks';
import { categoryDef } from '../lib/categories';
import {
  pantryReorderPredictions,
  priceJumpAlerts,
  productPriceHistory,
  storePriceComparison,
} from '../insights/pantry';

type PulseTab = 'stores' | 'jumps' | 'pantry';

export default function PricePulse() {
  const { items, loading } = useData();
  const [tab, setTab] = useState<PulseTab>('stores');
  const [query, setQuery] = useState('');
  const [showSingleStore, setShowSingleStore] = useState(false);
  const [jumpThreshold, setJumpThreshold] = useState(15);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  const refDate = today();

  const comparisons = useMemo(
    () => (items ? storePriceComparison(items, showSingleStore ? 1 : 2) : []),
    [items, showSingleStore],
  );
  const jumps = useMemo(() => (items ? priceJumpAlerts(items, jumpThreshold) : []), [items, jumpThreshold]);
  const pantry = useMemo(() => (items ? pantryReorderPredictions(items, refDate) : []), [items, refDate]);

  if (loading || !items) return null;

  const q = query.trim().toLowerCase();
  const filteredComparisons = comparisons.filter(
    (c) => !q || c.name.includes(q) || c.stores.some((s) => s.merchant.toLowerCase().includes(q)),
  );

  const totalProducts = new Set(items.map((i) => i.normalizedName).filter(Boolean)).size;

  return (
    <>
      <Card title="📉 Price Pulse & Pantry">
        <p className="muted">
          Tracking <b>{totalProducts}</b> unique products across <b>{items.length}</b> purchased line items.
        </p>
        <div className="seg-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'stores'}
            className={`seg-tab ${tab === 'stores' ? 'active' : ''}`}
            onClick={() => setTab('stores')}
          >
            🏪 Store Prices ({comparisons.length})
          </button>
          <button
            role="tab"
            aria-selected={tab === 'jumps'}
            className={`seg-tab ${tab === 'jumps' ? 'active' : ''}`}
            onClick={() => setTab('jumps')}
          >
            🚨 Price Jumps ({jumps.length})
          </button>
          <button
            role="tab"
            aria-selected={tab === 'pantry'}
            className={`seg-tab ${tab === 'pantry' ? 'active' : ''}`}
            onClick={() => setTab('pantry')}
          >
            🥫 Pantry ({pantry.length})
          </button>
        </div>
      </Card>

      {tab === 'stores' && (
        <Card
          title="Store-by-store unit price comparison"
          action={
            <label className="check" style={{ margin: 0, fontSize: '0.8rem' }}>
              <input
                type="checkbox"
                checked={showSingleStore}
                onChange={(e) => setShowSingleStore(e.target.checked)}
              />
              All items
            </label>
          }
        >
          <input
            placeholder="Search product or store…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%', marginBottom: 10 }}
          />
          {!filteredComparisons.length && (
            <Empty>
              {showSingleStore
                ? 'No products tracked yet. Snap a receipt to start!'
                : 'No products bought at 2+ stores yet. Check "All items" to see single-store prices, or snap receipts from another store.'}
            </Empty>
          )}
          {filteredComparisons.map((c) => {
            const isOpen = expandedProduct === c.name;
            const history = isOpen ? productPriceHistory(items, c.name) : [];
            return (
              <div key={c.name} className="pulse-item">
                <button
                  className="pulse-head"
                  onClick={() => setExpandedProduct(isOpen ? null : c.name)}
                >
                  <div>
                    <b>
                      {categoryDef(c.category).emoji} {c.name}
                    </b>
                    <small>
                      Best: <b>{c.cheapest.merchant}</b> (<Money v={c.cheapest.medianPrice} />/unit)
                    </small>
                  </div>
                  <div className="row-end">
                    {c.savingsPerUnit > 0 ? (
                      <span className="pill pill-saved">
                        Save <Money v={c.savingsPerUnit} /> ({c.spreadPct}%)
                      </span>
                    ) : (
                      <span className="pill">{c.stores.length} store{c.stores.length > 1 ? 's' : ''}</span>
                    )}
                  </div>
                </button>
                <div className="store-chips">
                  {c.stores.map((s, idx) => (
                    <span key={s.merchant} className={`store-chip ${idx === 0 && c.stores.length > 1 ? 'best' : ''}`}>
                      <b>{s.merchant}:</b> <Money v={s.medianPrice} />
                      <small> ({s.count}×)</small>
                    </span>
                  ))}
                </div>
                {isOpen && (
                  <div className="history-box">
                    <small className="muted">Purchase history</small>
                    {history.map((h, i) => (
                      <div key={i} className="row-between small-row">
                        <span>
                          {h.date} · <b>{h.merchant}</b> ({h.quantity}×)
                        </span>
                        <span>
                          <Money v={h.unitPriceUSD} />/ea
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {tab === 'jumps' && (
        <Card
          title="Price-jump & shrinkflation alerts"
          action={
            <select
              value={jumpThreshold}
              onChange={(e) => setJumpThreshold(Number(e.target.value))}
              aria-label="Jump threshold"
            >
              <option value={10}>≥ 10%</option>
              <option value={15}>≥ 15%</option>
              <option value={25}>≥ 25%</option>
            </select>
          }
        >
          <p className="muted">
            Flags items whose latest unit price jumped at least {jumpThreshold}% above your historical median.
          </p>
          {!jumps.length && <Empty>No price jumps ≥ {jumpThreshold}% detected.</Empty>}
          {jumps.map((j) => (
            <div key={j.name} className="pulse-item">
              <div className="row-between">
                <span>
                  <b>
                    {categoryDef(j.category).emoji} {j.name}
                  </b>
                  <small style={{ display: 'block' }}>
                    {j.date} at <b>{j.merchant}</b>
                  </small>
                </span>
                <span className="row-end">
                  <span className="pill pill-error">+{j.jumpPct}%</span>
                  <small style={{ display: 'block' }}>
                    <Money v={j.historicalMedian} /> → <b><Money v={j.latestPrice} /></b>
                  </small>
                </span>
              </div>
            </div>
          ))}
        </Card>
      )}

      {tab === 'pantry' && (
        <Card title="Pantry & reorder predictions">
          <p className="muted">
            Estimates when staple items will run low based on your typical days between purchases.
          </p>
          {!pantry.length && (
            <Empty>
              Buy a staple item on at least 2 different dates to unlock automatic reorder predictions.
            </Empty>
          )}
          {pantry.map((p) => (
            <div key={p.name} className="pulse-item">
              <div className="row-between">
                <span>
                  <b>
                    {categoryDef(p.category).emoji} {p.name}
                  </b>
                  <small style={{ display: 'block' }}>
                    Every ~{p.cadenceDays}d · last bought {p.lastDate} at {p.lastMerchant} (<Money v={p.lastPriceUSD} />)
                  </small>
                </span>
                <span className="row-end">
                  {p.status === 'overdue' && (
                    <span className="pill pill-error">
                      Reorder now ({Math.abs(p.daysRemaining)}d overdue)
                    </span>
                  )}
                  {p.status === 'due_soon' && (
                    <span className="pill pill-needs_review">Due in {p.daysRemaining}d</span>
                  )}
                  {p.status === 'stocked' && (
                    <span className="pill pill-saved">{p.daysRemaining}d left</span>
                  )}
                </span>
              </div>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
