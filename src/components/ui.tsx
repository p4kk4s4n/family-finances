import type { ReactNode } from 'react';
import { formatMoney } from '../lib/currency';
import type { ReceiptStatus } from '../types';

export function Card({ title, children, action }: { title?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Bar({ value, max, status }: { value: number; max: number; status?: 'ok' | 'warn' | 'over' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : value > 0 ? 100 : 0;
  return (
    <div className="bar">
      <div className={`bar-fill ${status ?? 'ok'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Money({ v, c = 'USD' }: { v: number | null | undefined; c?: string }) {
  return <span className="money">{formatMoney(v, c)}</span>;
}

const STATUS_LABEL: Record<ReceiptStatus, string> = {
  queued: 'Queued',
  processing: 'Reading…',
  ai_failed: 'OCR pending',
  needs_review: 'Review',
  error: 'Error',
  saved: 'Saved',
};

export function StatusPill({ s }: { s: ReceiptStatus }) {
  return <span className={`pill pill-${s}`}>{STATUS_LABEL[s]}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function SoonBadge() {
  return <span className="pill pill-soon">Coming soon</span>;
}
