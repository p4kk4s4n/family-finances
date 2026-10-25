import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { go } from '../App';
import { Card, Empty, Money } from '../components/ui';
import { CATEGORIES, categoryDef } from '../lib/categories';
import { formatMoney, round2 } from '../lib/currency';
import {
  ignoreBankTransaction,
  importAllUnmatchedCharges,
  importChargeAsReceipt,
  ingestStatementFile,
  linkChargeToReceipt,
  rescanUnmatchedTransactions,
} from '../bank/reconcile';
import type { BankTxStatus } from '../types';

export default function BankImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [forceGemini, setForceGemini] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<BankTxStatus | 'all'>('unmatched');
  const [linkingId, setLinkingId] = useState<number | null>(null);

  const txs = useLiveQuery(() => db.bankTransactions.orderBy('date').reverse().toArray(), []);
  const savedReceipts = useLiveQuery(() => db.receipts.where('status').equals('saved').toArray(), []);

  if (!txs || !savedReceipts) return null;

  const unmatched = txs.filter((t) => t.status === 'unmatched');
  const matched = txs.filter((t) => t.status === 'matched');
  const imported = txs.filter((t) => t.status === 'imported');
  const unmatchedTotalUSD = round2(unmatched.reduce((s, t) => s + t.amountUSD, 0));

  const visible = txs.filter((t) => (filter === 'all' ? t.status !== 'ignored' : t.status === filter));

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      let total = 0;
      let matchCount = 0;
      let unmatchCount = 0;
      let dupCount = 0;
      for (const f of [...files]) {
        const res = await ingestStatementFile(f, { forceGemini });
        total += res.total;
        matchCount += res.matched;
        unmatchCount += res.unmatched;
        dupCount += res.skippedDuplicates;
      }
      setMsg(
        `Processed ${total} charges: ${matchCount} matched to receipts, ${unmatchCount} missing receipts${
          dupCount ? ` (${dupCount} duplicates skipped)` : ''
        }.`,
      );
      if (unmatchCount === 0 && matchCount > 0) setFilter('matched');
      else setFilter('unmatched');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="🏦 Bank Statement Import">
        <p className="muted">
          Upload a bank or credit card statement (<b>CSV, OFX/QFX, PDF, or screenshot</b>) to reconcile against your
          snapped receipts within ±3 days and catch missed expenses.
        </p>
        <button
          className="btn primary block"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          data-testid="statement-upload-btn"
        >
          {busy ? 'Reading statement…' : '📄 Upload statement (CSV / OFX / PDF / Photo)'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.ofx,.qfx,application/pdf,image/*"
          multiple
          hidden
          data-testid="statement-file-input"
          onChange={(e) => {
            void onFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="check-row">
          <input
            id="force-gemini-parse"
            type="checkbox"
            checked={forceGemini}
            onChange={(e) => setForceGemini(e.target.checked)}
          />
          <label htmlFor="force-gemini-parse">
            Use Gemini AI for CSVs too (PDFs &amp; photos always use Gemini)
          </label>
        </div>
        {msg && <p className="pos" data-testid="bank-status-msg">{msg}</p>}
        {err && <p className="error">{err}</p>}
      </Card>

      {txs.length > 0 && (
        <Card title="Reconciliation summary">
          <div className="hero-grid" style={{ marginTop: 4 }}>
            <div>
              <span>⚠️ Missing receipts</span>
              <b>{unmatched.length}</b>
              <small><Money v={unmatchedTotalUSD} /></small>
            </div>
            <div>
              <span>✅ Matched</span>
              <b>{matched.length}</b>
            </div>
            <div>
              <span>📥 Imported</span>
              <b>{imported.length}</b>
            </div>
          </div>

          <div className="btn-row">
            {unmatched.length > 0 && (
              <button
                className="btn primary"
                data-testid="import-all-unmatched-btn"
                onClick={async () => {
                  const n = await importAllUnmatchedCharges();
                  setMsg(`Imported ${n} charges into expenses ✓`);
                }}
              >
                ＋ Import all {unmatched.length} missing (<Money v={unmatchedTotalUSD} />)
              </button>
            )}
            <button
              className="btn"
              onClick={async () => {
                const n = await rescanUnmatchedTransactions();
                setMsg(n ? `Matched ${n} additional charge(s) ✓` : 'No new receipt matches found.');
              }}
            >
              🔄 Re-match
            </button>
          </div>

          <div className="seg-tabs" role="tablist" style={{ marginTop: 12 }}>
            <button
              role="tab"
              aria-selected={filter === 'unmatched'}
              className={`seg-tab ${filter === 'unmatched' ? 'active' : ''}`}
              onClick={() => setFilter('unmatched')}
            >
              Missing ({unmatched.length})
            </button>
            <button
              role="tab"
              aria-selected={filter === 'matched'}
              className={`seg-tab ${filter === 'matched' ? 'active' : ''}`}
              onClick={() => setFilter('matched')}
            >
              Matched ({matched.length})
            </button>
            <button
              role="tab"
              aria-selected={filter === 'imported'}
              className={`seg-tab ${filter === 'imported' ? 'active' : ''}`}
              onClick={() => setFilter('imported')}
            >
              Imported ({imported.length})
            </button>
            <button
              role="tab"
              aria-selected={filter === 'all'}
              className={`seg-tab ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All ({txs.filter((t) => t.status !== 'ignored').length})
            </button>
          </div>
        </Card>
      )}

      <Card title="Statement transactions">
        {!visible.length && (
          <Empty>
            {txs.length === 0
              ? 'No statement transactions imported yet.'
              : `No ${filter === 'unmatched' ? 'missing-receipt' : filter} transactions.`}
          </Empty>
        )}
        {visible.map((tx) => (
          <div key={tx.id} className="pulse-item" data-testid="bank-tx-row">
            <div className="row-between">
              <span>
                <b>{tx.merchant}</b>
                <small style={{ display: 'block' }}>
                  {tx.date}
                  {tx.currency !== 'USD' ? ` · ${formatMoney(tx.amount, tx.currency)}` : ''}
                  {tx.description !== tx.merchant ? ` · ${tx.description}` : ''}
                </small>
              </span>
              <span className="row-end">
                <b><Money v={tx.amountUSD} /></b>
                <div style={{ marginTop: 2 }}>
                  {tx.status === 'matched' && <span className="pill pill-saved">✓ Matched</span>}
                  {tx.status === 'imported' && <span className="pill pill-processing">📥 Imported</span>}
                  {tx.status === 'unmatched' && <span className="pill pill-needs_review">Missing receipt</span>}
                </div>
              </span>
            </div>

            {tx.status === 'unmatched' && tx.id != null && (
              <div className="tx-actions">
                <select
                  aria-label="Suggested category"
                  value={tx.suggestedCategory}
                  onChange={(e) => db.bankTransactions.update(tx.id!, { suggestedCategory: e.target.value })}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.emoji} {c.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn small primary"
                  data-testid="add-expense-btn"
                  onClick={() => importChargeAsReceipt(tx.id!, tx.suggestedCategory)}
                >
                  ＋ Add expense
                </button>
                {savedReceipts.length > 0 && (
                  <button
                    className="btn small"
                    onClick={() => setLinkingId(linkingId === tx.id ? null : tx.id!)}
                  >
                    🔗 Link
                  </button>
                )}
                <button
                  className="btn small"
                  onClick={() => ignoreBankTransaction(tx.id!)}
                >
                  Ignore
                </button>
              </div>
            )}

            {linkingId === tx.id && tx.id != null && (
              <div className="history-box">
                <small className="muted">Select a saved receipt to link:</small>
                {savedReceipts.slice(0, 8).map((r) => (
                  <button
                    key={r.id}
                    className="list-row"
                    onClick={async () => {
                      await linkChargeToReceipt(tx.id!, r.id!);
                      setLinkingId(null);
                    }}
                  >
                    <span>
                      <b>{r.merchant}</b>
                      <small>{r.date}</small>
                    </span>
                    <Money v={r.totalUSD} />
                  </button>
                ))}
              </div>
            )}

            {(tx.status === 'matched' || tx.status === 'imported') && tx.matchedReceiptId && (
              <div style={{ marginTop: 6 }}>
                <button className="link" onClick={() => go(`receipt/${tx.matchedReceiptId}`)}>
                  {categoryDef(tx.suggestedCategory).emoji} View linked receipt #{tx.matchedReceiptId} →
                </button>
              </div>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}
