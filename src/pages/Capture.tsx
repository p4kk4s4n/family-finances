import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { go } from '../App';
import { createManualReceipt, enqueueFiles } from '../capture/queue';
import { Card, Empty, StatusPill } from '../components/ui';

export default function Capture() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState('');
  const inFlight = useLiveQuery(
    () => db.receipts.where('status').anyOf('queued', 'processing', 'needs_review', 'error').reverse().sortBy('createdAt'),
    [],
  );

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    const files = [...list];
    await enqueueFiles(files, 'photo');
    setToast(`✓ ${files.length} receipt${files.length > 1 ? 's' : ''} captured. Reading in the background.`);
    setTimeout(() => setToast(''), 3500);
  }

  return (
    <>
      <Card>
        <div className="capture">
          <button className="snap" onClick={() => cameraRef.current?.click()} aria-label="Snap receipt">
            📷
            <span>Snap receipt</span>
          </button>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden data-testid="camera-input" onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
          <div className="capture-actions">
            <button className="btn" onClick={() => uploadRef.current?.click()}>🖼️ Photos / PDF e-receipts</button>
            <button className="btn" onClick={async () => go(`receipt/${await createManualReceipt()}`)}>✍️ Enter manually</button>
          </div>
          <input ref={uploadRef} type="file" accept="image/*,application/pdf" multiple hidden data-testid="upload-input" onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
          <p className="hint">
            Tip: long receipt? Snap it in parts. Online orders: share the screenshot or PDF to <b>Family Finances</b> from any app.
          </p>
        </div>
      </Card>
      {toast && <div className="toast">{toast}</div>}
      <Card title="In progress">
        {!inFlight?.length && <Empty>All caught up.</Empty>}
        {inFlight?.map((r) => (
          <button key={r.id} className="list-row" onClick={() => go(`receipt/${r.id}`)}>
            <span>
              <b>{r.draft?.merchant || 'Receipt'}</b>
              <small>{new Date(r.createdAt).toLocaleString()}{r.duplicateOf ? ' · possible duplicate' : ''}</small>
            </span>
            <StatusPill s={r.status} />
          </button>
        ))}
      </Card>
    </>
  );
}
