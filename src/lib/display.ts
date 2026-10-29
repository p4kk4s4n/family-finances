import type { ScaleStep, Settings } from '../types';

export const SCALE_LABELS: Record<ScaleStep, string> = {
  0: 'Small',
  1: 'Medium',
  2: 'Large',
  3: 'Extra Large',
  4: 'Vision Impaired',
};

export const FONT_FACTORS: Record<ScaleStep, number> = {
  0: 0.9,
  1: 1.0,
  2: 1.15,
  3: 1.32,
  4: 1.55,
};

export const ICON_FACTORS: Record<ScaleStep, number> = {
  0: 0.9,
  1: 1.0,
  2: 1.18,
  3: 1.38,
  4: 1.65,
};

export const RESOLUTION_FACTORS: Record<ScaleStep, number> = {
  0: 0.92,
  1: 1.0,
  2: 1.1,
  3: 1.2,
  4: 1.3,
};

export function clampStep(v: unknown, fallback: ScaleStep = 1): ScaleStep {
  const n = typeof v === 'number' ? Math.round(v) : fallback;
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}

/** Apply the user's resolution, font size, and icon size slider settings to the document root. */
export function applyDisplayScale(settings?: Partial<Settings> | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const fStep = clampStep(settings?.fontScale, 1);
  const iStep = clampStep(settings?.iconScale, 1);
  const rStep = clampStep(settings?.resolutionScale, 1);

  root.style.setProperty('--font-scale', String(FONT_FACTORS[fStep]));
  root.style.setProperty('--icon-scale', String(ICON_FACTORS[iStep]));
  root.style.setProperty('--res-scale', String(RESOLUTION_FACTORS[rStep]));
  root.dataset.fontScale = String(fStep);
  root.dataset.iconScale = String(iStep);
  root.dataset.resolutionScale = String(rStep);
}
