import type { WeeklyDigest } from './digest';
import { formatMoney } from '../lib/currency';
import { categoryDef } from '../lib/categories';

/** Render the weekly digest as a 1080×1350 PNG card for sharing in any messaging app. */
export async function renderDigestCard(d: WeeklyDigest): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;

  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1f7a5a');
  bg.addColorStop(1, '#0f1a16');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  g.fillStyle = '#ffffff';
  g.font = '600 44px system-ui, sans-serif';
  g.fillText('🧾 Family Finances', 70, 110);
  g.font = '400 34px system-ui, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillText(`Week of ${d.from} → ${d.to}`, 70, 165);

  g.fillStyle = '#ffffff';
  g.font = '700 120px system-ui, sans-serif';
  g.fillText(formatMoney(d.spent), 70, 330);
  g.font = '400 38px system-ui, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.fillText(`of ${formatMoney(d.weeklyBudget)} weekly budget`, 70, 390);

  // progress bar
  const pct = Math.min(1.5, d.pctOfBudget / 100);
  g.fillStyle = 'rgba(255,255,255,0.15)';
  roundRect(g, 70, 430, W - 140, 36, 18);
  g.fill();
  g.fillStyle = pct > 1 ? '#ff7a6b' : pct > 0.85 ? '#ffc65c' : '#7ee2b0';
  roundRect(g, 70, 430, Math.max(36, (W - 140) * Math.min(1, pct)), 36, 18);
  g.fill();

  let y = 560;
  g.fillStyle = '#ffffff';
  g.font = '600 40px system-ui, sans-serif';
  g.fillText('Top categories', 70, y);
  g.font = '400 38px system-ui, sans-serif';
  for (const tc of d.topCategories) {
    y += 64;
    g.fillText(`${categoryDef(tc.category).emoji}  ${tc.category}`, 70, y);
    const t = formatMoney(tc.total);
    g.fillText(t, W - 70 - g.measureText(t).width, y);
  }

  y += 110;
  g.font = '600 40px system-ui, sans-serif';
  g.fillText('💧 Receipt leakage', 70, y);
  g.font = '400 36px system-ui, sans-serif';
  y += 56;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText(`${d.leakageCount} small treats/impulse items · ${formatMoney(d.leakageTotal)}`, 70, y);

  if (d.biggestMover) {
    y += 100;
    g.fillStyle = '#ffffff';
    g.font = '600 40px system-ui, sans-serif';
    g.fillText('📈 Biggest price change', 70, y);
    y += 56;
    g.font = '400 36px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillText(`${d.biggestMover.name}: ${d.biggestMover.pct > 0 ? '+' : ''}${d.biggestMover.pct}% vs 3 months ago`, 70, y);
  }

  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.font = '400 28px system-ui, sans-serif';
  g.fillText(`${d.receiptsCount} receipts captured this week`, 70, H - 70);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Render failed'))), 'image/png'));
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
