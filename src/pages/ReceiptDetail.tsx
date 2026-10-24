import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings } from '../db/schema';
import { go } from '../App';
import { Card, Empty, Money, StatusPill } from '../components/ui';
import { deleteReceipt, reopenForEdit, requeue, saveReviewed } from '../capture/queue';
import { emptyDraft, normalizeItemName, validateParsed } from '../capture/validate';
import { CATEGORIES, categoryDef } from '../lib/categories';
import { formatMoney, round2 } from '../lib/currency';
import type { ParsedItem, ParsedReceipt } from '../types';

export default function ReceiptDetail({ id }: { id: number }) {
  const receipt = useLiveQuery(() => db.receipts.get(id), [id]);
  const items = useLiveQuery(() => db.items.where('receiptId').equals(id).toArray(), [id]);
  const [imgUrl, setImgUrl] = useState<string>();

  useEffect(() => {
    if (!receipt?.image) return;
    const u = URL.createObjectURL(receipt.image);
    setImgUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [receipt?.image]);

  if (receipt === undefined) return null;
  if (!receipt) return <Card><Empty>Receipt not found.</Empty></Card>;

  const remove = async () => {
    if (confirm('Delete this receipt?')) {
      await deleteReceipt(id);
      go('receipts');
    }
  };

  const image = imgUrl && (
    <details className="img-wrap">
      <summary>View {receipt.imageType === 'application/pdf' ? 'PDF' : 'photo'}</summary>
      {receipt.imageType === 'application/pdf' ? (
        <a href={imgUrl} target="_blank" rel="noreferrer">Open PDF</a>
      ) : (
        <img src={imgUrl} alt="Receipt" />
      )}
    </details>
  );

  if (receipt.status === 'needs_review' && receipt.draft) {
    return (
      <>
        {receipt.duplicateOf && (
          <div className="banner warn">
            ⚠️ This looks like a duplicate of <button className="link" onClick={() => go(`receipt/${receipt.duplicateOf}`)}>another receipt</button>.
            <button className="btn small danger" onClick={remove}>Discard</button>
          </div>
        )}
        {image}
        <ReviewForm id={id} initial={receipt.draft} onDelete={remove} />
      </>
    );
  }

  if (receipt.status !== 'saved') {
    return (
      <Card title="Receipt" action={<StatusPill s={receipt.status} />}>
        {image}
        {receipt.status === 'error' && <p className="error">{receipt.error}</p>}
        {receipt.status === 'queued' && <p className="muted">Waiting to be read. Needs a Gemini API key and a connection.</p>}
        <div className="btn-row">
          {(receipt.status === 'error' || receipt.status === 'queued') && <button className="btn" onClick={() => requeue(id)}>Retry</button>}
          <button className="btn" onClick={() => db.receipts.update(id, { status: 'needs_review', draft: emptyDraft() })}>Enter manually</button>
          <button className="btn danger" onClick={remove}>Delete</button>
        </div>
      </Card>
    );
  }

  return (
    <Card title={receipt.merchant} action={<StatusPill s="saved" />}>
      <p className="muted">
        {receipt.date} · {receipt.paymentMethod || 'payment n/a'}
        {receipt.currency !== 'USD' && ` · ${formatMoney(receipt.total, receipt.currency)} @ ${receipt.fxRate?.toFixed(4)} (${receipt.fxSource})`}
      </p>
      {image}
      <table className="items">
        <tbody>
          {items?.map((i) => (
            <tr key={i.id}>
              <td>
                {categoryDef(i.category).emoji} {i.rawName}
                <small>
                  {i.quantity} × {formatMoney(i.unitPrice, i.currency)} · {i.category}
                  {i.isDiscretionary ? ' · want' : ''}
                  {i.brandTier !== 'unknown' ? ` · ${i.brandTier} brand` : ''}
                </small>
              </td>
              <td className="num"><Money v={i.totalUSD} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-between total-row">
        <span>Total {receipt.tax ? <small>(incl. tax {formatMoney(receipt.tax, receipt.currency)})</small> : null}</span>
        <b><Money v={receipt.totalUSD} /></b>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={() => reopenForEdit(id)}>Edit</button>
        <button className="btn danger" onClick={remove}>Delete</button>
      </div>
    </Card>
  );
}

function ReviewForm({ id, initial, onDelete }: { id: number; initial: ParsedReceipt; onDelete: () => void }) {
  const [d, setD] = useState<ParsedReceipt>(initial);
  const [fallbackRate, setFallbackRate] = useState(0.18);
  const [manualRate, setManualRate] = useState('');
  const [saving, setSaving] = useState(false);
  const v = useMemo(() => validateParsed(d), [d]);

  useEffect(() => {
    void getSettings().then((s) => setFallbackRate(s.brlRateFallback));
  }, []);

  const set = <K extends keyof ParsedReceipt>(k: K, val: ParsedReceipt[K]) => setD((p) => ({ ...p, [k]: val }));
  const setItem = (idx: number, patch: Partial<ParsedItem>) =>
    setD((p) => ({
      ...p,
      items: p.items.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...patch };
        if ('quantity' in patch || 'unitPrice' in patch) next.total = round2(next.quantity * next.unitPrice);
        if ('name' in patch) next.normalizedName = normalizeItemName(next.name);
        if ('category' in patch) next.isDiscretionary = categoryDef(next.category).discretionary;
        return next;
      }),
    }));
  const addItem = () =>
    setD((p) => ({
      ...p,
      items: [...p.items, { name: '', normalizedName: '', category: 'Other', quantity: 1, unitPrice: 0, total: 0, isDiscretionary: true, brandTier: 'unknown' }],
    }));
  const removeItem = (idx: number) => setD((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));

  const save = async () => {
    setSaving(true);
    try {
      await saveReviewed(id, d, manualRate ? Number(manualRate) : undefined);
      go(`receipt/${id}`);
    } finally {
      setSaving(false);
    }
  };

  const num = (s: string) => (s === '' ? 0 : Number(s));

  return (
    <Card title="Review receipt">
      <div className="form-grid">
        <label>Merchant<input value={d.merchant} onChange={(e) => set('merchant', e.target.value)} /></label>
        <label>Date<input type="date" value={d.date} onChange={(e) => set('date', e.target.value)} /></label>
        <label>
          Currency
          <select value={d.currency} onChange={(e) => set('currency', e.target.value)}>
            <option value="USD">USD $</option>
            <option value="BRL">BRL R$</option>
            {!['USD', 'BRL'].includes(d.currency) && <option value={d.currency}>{d.currency}</option>}
          </select>
        </label>
        <label>Payment<input value={d.paymentMethod ?? ''} onChange={(e) => set('paymentMethod', e.target.value || null)} /></label>
        <label>Tax<input type="number" step="0.01" inputMode="decimal" value={d.tax ?? ''} onChange={(e) => set('tax', e.target.value === '' ? null : Number(e.target.value))} /></label>
        <label>Total<input type="number" step="0.01" inputMode="decimal" value={d.total} onChange={(e) => set('total', num(e.target.value))} /></label>
      </div>

      {d.currency !== 'USD' && (
        <div className="fx-box">
          ≈ <b>{formatMoney(d.total * (manualRate ? Number(manualRate) : fallbackRate))}</b> USD
          <small> The rate for {d.date} is fetched automatically when you save. Your fallback rate is {fallbackRate}.</small>
          <label className="inline">Override rate (USD per 1 {d.currency})
            <input type="number" step="0.0001" placeholder="auto" value={manualRate} onChange={(e) => setManualRate(e.target.value)} />
          </label>
        </div>
      )}

      {v.warnings.length > 0 && (
        <ul className="warnings">
          {v.warnings.map((w) => <li key={w}>⚠️ {w}</li>)}
        </ul>
      )}

      <h3>Line items <small className="muted">({d.items.length} · sum {formatMoney(v.itemsSum, d.currency)})</small></h3>
      <div className="review-items">
        {d.items.map((it, idx) => (
          <div key={idx} className="review-item">
            <div className="row-between">
              <input className="grow" placeholder="Item name" value={it.name} onChange={(e) => setItem(idx, { name: e.target.value })} />
              <button className="icon-btn" aria-label="Remove item" onClick={() => removeItem(idx)}>✕</button>
            </div>
            <div className="review-item-grid">
              <select value={it.category} onChange={(e) => setItem(idx, { category: e.target.value })} aria-label="Category">
                {CATEGORIES.map((c) => <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>)}
              </select>
              <label className="mini">Qty<input type="number" step="any" value={it.quantity} onChange={(e) => setItem(idx, { quantity: num(e.target.value) })} /></label>
              <label className="mini">Unit<input type="number" step="0.01" value={it.unitPrice} onChange={(e) => setItem(idx, { unitPrice: num(e.target.value) })} /></label>
              <label className="mini">Total<input type="number" step="0.01" value={it.total} onChange={(e) => setItem(idx, { total: num(e.target.value) })} /></label>
            </div>
            <div className="review-item-flags">
              <label className="check"><input type="checkbox" checked={it.isDiscretionary} onChange={(e) => setItem(idx, { isDiscretionary: e.target.checked })} /> Want (discretionary)</label>
              <select value={it.brandTier} onChange={(e) => setItem(idx, { brandTier: e.target.value as ParsedItem['brandTier'] })} aria-label="Brand tier">
                <option value="unknown">Brand ?</option>
                <option value="store">Store brand</option>
                <option value="name">Name brand</option>
              </select>
            </div>
          </div>
        ))}
      </div>
      <button className="btn block" onClick={addItem}>+ Add item</button>

      <div className="btn-row sticky-actions">
        <button className="btn danger" onClick={onDelete}>Delete</button>
        <button className="btn primary" disabled={saving || !d.merchant} onClick={save}>{saving ? 'Saving…' : 'Save receipt'}</button>
      </div>
    </Card>
  );
}
