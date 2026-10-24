import { useMemo, useRef, useState } from 'react';
import { Card } from '../components/ui';
import { today, useData } from '../components/hooks';
import { buildWeeklyDigest, digestToText } from '../share/digest';
import { renderDigestCard } from '../share/card';
import { exportBlob, exportFilename, importExport } from '../share/exportData';
import { shareFile, shareText } from '../share/shareHelpers';

/** Each sharing format is a separate action, so you send exactly the one you want. */
export default function Share() {
  const { items, budgets, settings, loading } = useData();
  const [msg, setMsg] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const digest = useMemo(
    () => (loading ? null : buildWeeklyDigest(items!, budgets!, today(), settings?.leakageThreshold ?? 10)),
    [items, budgets, settings, loading],
  );
  if (!digest) return null;
  const text = digestToText(digest);
  const note = (k: string, m: string) => setMsg((p) => ({ ...p, [k]: m }));

  return (
    <>
      <Card title="🖼️ Image card">
        <p className="muted">A visual weekly summary to drop into any chat.</p>
        <button
          className="btn primary block"
          onClick={async () => {
            const r = await shareFile(await renderDigestCard(digest), `family-finances-week-${digest.to}.png`, 'Weekly spending');
            note('card', r === 'downloaded' ? 'Saved image (sharing not supported here).' : r === 'shared' ? 'Shared ✓' : '');
          }}
        >
          Share image card
        </button>
        {msg.card && <p className="muted">{msg.card}</p>}
      </Card>

      <Card title="💬 Text summary">
        <pre className="digest">{text}</pre>
        <button
          className="btn primary block"
          onClick={async () => {
            const r = await shareText(text, 'Weekly spending');
            note('text', r === 'copied' ? 'Copied to clipboard ✓' : r === 'shared' ? 'Shared ✓' : '');
          }}
        >
          Share text summary
        </button>
        {msg.text && <p className="muted">{msg.text}</p>}
      </Card>

      <Card title="🗂️ Data file (JSON)">
        <p className="muted">Full saved receipts and budgets so your partner can import them into their copy. Photos and API keys are never included.</p>
        <button
          className="btn primary block"
          onClick={async () => {
            const r = await shareFile(await exportBlob(), exportFilename(), 'Family Finances data');
            note('json', r === 'downloaded' ? 'Downloaded ✓' : r === 'shared' ? 'Shared ✓' : '');
          }}
        >
          Share data file
        </button>
        <button className="btn block" onClick={() => fileRef.current?.click()}>Import a data file…</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const r = await importExport(f);
              note('json', `Imported ${r.added} receipts, skipped ${r.skipped} duplicates ✓`);
            } catch (err) {
              note('json', `Import failed: ${(err as Error).message}`);
            }
          }}
        />
        {msg.json && <p className="muted">{msg.json}</p>}
      </Card>
    </>
  );
}
