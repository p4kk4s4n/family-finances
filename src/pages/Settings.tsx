import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, saveSettings } from '../db/schema';
import { Card } from '../components/ui';
import { testApiKey } from '../capture/gemini';
import { fetchRateToUSD } from '../lib/currency';
import { applyDisplayScale, clampStep, SCALE_LABELS } from '../lib/display';
import { CURRENT_VERSION, checkAndUpdate, type UpdateStatus } from '../updater';
import { exportBlob, exportFilename } from '../share/exportData';
import { downloadBlob } from '../share/shareHelpers';
import { today } from '../components/hooks';
import type { ScaleStep } from '../types';

export default function SettingsPage() {
  const s = useLiveQuery(() => getSettings(), []);
  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyMsg, setKeyMsg] = useState('');
  const [fxMsg, setFxMsg] = useState('');
  const [upd, setUpd] = useState<UpdateStatus | null>(null);
  const [backup, setBackup] = useState(true);

  useEffect(() => {
    if (s) setBackup(s.backupBeforeUpdate);
  }, [s?.backupBeforeUpdate]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('updated')) setUpd({ state: 'latest', remote: CURRENT_VERSION });
  }, []);

  if (!s) return null;

  const fontStep = clampStep(s.fontScale, 1);
  const iconStep = clampStep(s.iconScale, 1);
  const resStep = clampStep(s.resolutionScale, 1);

  const setScale = (field: 'fontScale' | 'iconScale' | 'resolutionScale', raw: string) => {
    const step = clampStep(Number(raw), 1);
    applyDisplayScale({ ...s, [field]: step });
    void saveSettings({ [field]: step });
  };

  const runUpdate = () =>
    checkAndUpdate({
      onStatus: setUpd,
      beforeUpdate: backup ? async () => downloadBlob(await exportBlob(), `backup-${exportFilename()}`) : undefined,
    });

  return (
    <>
      <Card title="🔍 Display &amp; Accessibility">
        <p className="muted">
          Adjust resolution density, font size, and icon size for slim screens (Galaxy Fold cover), standard phones, or vision comfort.
        </p>

        <div className="scale-control">
          <div className="scale-head">
            <label htmlFor="resolution-scale-slider">Resolution / UI scale</label>
            <span className="pill" data-testid="resolution-scale-label">{SCALE_LABELS[resStep]}</span>
          </div>
          <input
            id="resolution-scale-slider"
            data-testid="resolution-scale-slider"
            className="scale-slider"
            type="range"
            min={0}
            max={4}
            step={1}
            value={resStep}
            onChange={(e) => setScale('resolutionScale', e.target.value)}
          />
          <div className="scale-ticks" aria-hidden="true">
            <span>S</span>
            <span>M</span>
            <span>L</span>
            <span>XL</span>
            <span>Vision</span>
          </div>
        </div>

        <div className="scale-control">
          <div className="scale-head">
            <label htmlFor="font-scale-slider">Font size</label>
            <span className="pill" data-testid="font-scale-label">{SCALE_LABELS[fontStep]}</span>
          </div>
          <input
            id="font-scale-slider"
            data-testid="font-scale-slider"
            className="scale-slider"
            type="range"
            min={0}
            max={4}
            step={1}
            value={fontStep}
            onChange={(e) => setScale('fontScale', e.target.value)}
          />
          <div className="scale-ticks" aria-hidden="true">
            <span>S</span>
            <span>M</span>
            <span>L</span>
            <span>XL</span>
            <span>Vision</span>
          </div>
        </div>

        <div className="scale-control">
          <div className="scale-head">
            <label htmlFor="icon-scale-slider">Icon size</label>
            <span className="pill" data-testid="icon-scale-label">{SCALE_LABELS[iconStep]}</span>
          </div>
          <input
            id="icon-scale-slider"
            data-testid="icon-scale-slider"
            className="scale-slider"
            type="range"
            min={0}
            max={4}
            step={1}
            value={iconStep}
            onChange={(e) => setScale('iconScale', e.target.value)}
          />
          <div className="scale-ticks" aria-hidden="true">
            <span>S</span>
            <span>M</span>
            <span>L</span>
            <span>XL</span>
            <span>Vision</span>
          </div>
        </div>

        <div className="btn-row">
          {([0, 1, 2, 3, 4] as ScaleStep[]).map((preset) => (
            <button
              key={preset}
              type="button"
              className={`btn small ${fontStep === preset && iconStep === preset && resStep === preset ? 'primary' : ''}`}
              onClick={() => {
                applyDisplayScale({ fontScale: preset, iconScale: preset, resolutionScale: preset });
                void saveSettings({ fontScale: preset, iconScale: preset, resolutionScale: preset });
              }}
            >
              {SCALE_LABELS[preset]}
            </button>
          ))}
        </div>
      </Card>

      <Card title="🔄 App updates">
        <p className="muted">
          Installed version <code>{CURRENT_VERSION.sha}</code>
          {CURRENT_VERSION.builtAt ? ` · built ${new Date(CURRENT_VERSION.builtAt).toLocaleString()}` : ''}
        </p>
        <button className="btn primary block" data-testid="update-btn" disabled={upd?.state === 'checking' || upd?.state === 'updating'} onClick={runUpdate}>
          Check for updates &amp; install latest
        </button>
        <p className="muted" data-testid="update-status">
          {upd?.state === 'checking' && 'Checking for the latest version…'}
          {upd?.state === 'latest' && "✓ You're on the latest version."}
          {upd?.state === 'updating' && `Installing ${upd.remote.sha}… the app will reload.`}
          {upd?.state === 'error' && `⚠️ ${upd.message}`}
        </p>
        <div className="check-row">
          <input
            id="backup-before-update"
            type="checkbox"
            checked={backup}
            onChange={(e) => {
              const val = e.target.checked;
              setBackup(val);
              void saveSettings({ backupBeforeUpdate: val });
            }}
          />
          <label htmlFor="backup-before-update">Download a data backup before updating</label>
        </div>
        <p className="hint">Updates never erase your receipts. They're stored on this device, separate from the app files.</p>
      </Card>

      <Card title="🔑 Gemini API key &amp; On-device OCR">
        {s.apiKey ? (
          <>
            <p>Key saved on this device: <code>{showKey ? s.apiKey : `${s.apiKey.slice(0, 4)}••••${s.apiKey.slice(-4)}`}</code></p>
            <div className="btn-row">
              <button className="btn" onClick={() => setShowKey((v) => !v)}>{showKey ? 'Hide' : 'Show'}</button>
              <button
                className="btn"
                data-testid="test-key-btn"
                onClick={async () => {
                  setKeyMsg('Testing connection to Google AI…');
                  const res = await testApiKey(s.apiKey!, s.model);
                  setKeyMsg(res.message);
                }}
              >
                Test key
              </button>
              <button className="btn danger" onClick={() => { if (confirm('Remove API key?')) void saveSettings({ apiKey: undefined }); }}>Remove</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              Needed for high-accuracy AI receipt reading. Get a free key at{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>. It stays on this device and is never exported.
            </p>
            <div className="row-between">
              <input className="grow" type="password" placeholder="Paste API key" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} data-testid="api-key-input" />
              <button className="btn primary" disabled={!keyDraft.trim()} onClick={async () => { await saveSettings({ apiKey: keyDraft.trim() }); setKeyDraft(''); setKeyMsg('Saved ✓'); }}>Save</button>
            </div>
          </>
        )}
        {keyMsg && <p className="muted" data-testid="key-test-msg">{keyMsg}</p>}
        <label>
          Preferred model (automatically falls back to <code>gemini-2.5-flash</code> &amp; <code>gemini-2.5-flash-lite</code> if busy)
          <input value={s.model} onChange={(e) => saveSettings({ model: e.target.value })} />
        </label>
        <hr />
        <label className="check">
          <input
            type="checkbox"
            data-testid="ocr-fallback-toggle"
            checked={s.ocrFallback ?? true}
            onChange={(e) => saveSettings({ ocrFallback: e.target.checked })}
          />
          Use on-device OCR (English + Portuguese) when AI is unavailable or fails
        </label>
        <label className="check">
          <input
            type="checkbox"
            data-testid="ocr-only-toggle"
            checked={s.ocrOnly ?? false}
            onChange={(e) => saveSettings({ ocrOnly: e.target.checked })}
          />
          Read receipts on this device only (never send photos to Google)
        </label>
        <label className="check">
          <input
            type="checkbox"
            data-testid="notify-ready-toggle"
            checked={s.notifyWhenReady ?? true}
            onChange={async (e) => {
              const checked = e.target.checked;
              await saveSettings({ notifyWhenReady: checked });
              if (checked && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
                await Notification.requestPermission().catch(() => undefined);
              }
            }}
          />
          Notify me when a receipt finishes reading in the background
        </label>
      </Card>

      <Card title="💱 Currency">
        <p className="muted">Budgets are in USD. Receipts in Brazilian reais (R$) are detected automatically and converted to USD at that day's rate.</p>
        <label className="check">
          <input type="checkbox" checked={s.autoFxRate} onChange={(e) => saveSettings({ autoFxRate: e.target.checked })} />
          Fetch the exchange rate automatically (Frankfurter / ECB)
        </label>
        <label className="row-between">
          <span>Fallback rate: USD per R$1</span>
          <input className="num-input" type="number" step="0.0001" value={s.brlRateFallback} onChange={(e) => saveSettings({ brlRateFallback: Number(e.target.value) || 0 })} />
        </label>
        <button
          className="btn"
          onClick={async () => {
            const r = await fetchRateToUSD('BRL', today());
            if (r) {
              await saveSettings({ brlRateFallback: Number(r.toFixed(4)) });
              setFxMsg(`Updated: R$1 = $${r.toFixed(4)}`);
            } else setFxMsg('Could not fetch the rate (offline?).');
          }}
        >
          Set fallback to today's rate
        </button>
        {fxMsg && <p className="muted">{fxMsg}</p>}
      </Card>

      <Card title="🧮 Insights">
        <label className="row-between">
          <span>"Leakage" threshold (USD per item)</span>
          <input className="num-input" type="number" value={s.leakageThreshold} onChange={(e) => saveSettings({ leakageThreshold: Number(e.target.value) || 0 })} />
        </label>
      </Card>

      <Card title="🗄️ Data">
        <div className="btn-row">
          <button className="btn" onClick={async () => downloadBlob(await exportBlob(), exportFilename())}>Download backup</button>
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm('Erase ALL receipts and items on this device? This cannot be undone.')) return;
              await db.transaction('rw', db.receipts, db.items, db.bankTransactions, async () => {
                await db.receipts.clear();
                await db.items.clear();
                await db.bankTransactions.clear();
              });
            }}
          >
            Erase all data
          </button>
        </div>
      </Card>
    </>
  );
}
