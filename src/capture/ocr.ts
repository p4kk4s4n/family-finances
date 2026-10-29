import type { ParsedReceipt } from '../types';
import { parseOcrText } from './ocrParse';

/** Preprocess image on canvas (grayscale + contrast stretch + upscale if tiny) to improve receipt OCR accuracy. */
export async function preprocessForOcr(file: Blob): Promise<Blob> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap === 'undefined' || typeof document === 'undefined') {
    return file;
  }
  try {
    const bmp = await createImageBitmap(file);
    const minWidth = 1000;
    const scale = bmp.width < minWidth ? Math.min(2, minWidth / Math.max(1, bmp.width)) : 1;
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      bmp.close();
      return file;
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();

    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    let min = 255;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      d[i] = g;
      if (g < min) min = g;
      if (g > max) max = g;
    }
    const range = Math.max(1, max - min);
    for (let i = 0; i < d.length; i += 4) {
      const stretched = Math.min(255, Math.max(0, Math.round(((d[i] - min) * 255) / range)));
      d[i] = stretched;
      d[i + 1] = stretched;
      d[i + 2] = stretched;
    }
    ctx.putImageData(imgData, 0, 0);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/png'));
  } catch {
    return file;
  }
}

export function getOcrAssetBase(): string {
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${base.endsWith('/') ? base : `${base}/`}ocr`;
}

/**
 * Runs Tesseract.js on-device (English + Portuguese) using same-origin `/ocr/` assets
 * and converts the recognized text into a ParsedReceipt.
 */
export async function ocrReceipt(file: Blob, mimeType = file.type || 'image/jpeg'): Promise<ParsedReceipt> {
  if (mimeType === 'application/pdf' || file.type === 'application/pdf') {
    throw new Error('PDF e-receipts cannot be read with on-device OCR. Retry with Gemini AI or enter manually.');
  }
  const processed = await preprocessForOcr(file);
  const { createWorker } = await import('tesseract.js');
  const ocrBase = getOcrAssetBase();

  const worker = await createWorker(['eng', 'por'], 1, {
    workerPath: `${ocrBase}/worker.min.js`,
    corePath: `${ocrBase}`,
    langPath: `${ocrBase}`,
    gzip: true,
    workerBlobURL: false,
  });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: '4' as any, // Assume a single column of text of variable sizes
      preserve_interword_spaces: '1',
    });
    const { data } = await worker.recognize(processed);
    return parseOcrText(data.text || '');
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

let prefetched = false;

/** Warm the `/ocr/` cache in the background when online and OCR fallback is enabled. */
export async function prefetchOcrAssets(): Promise<void> {
  if (prefetched || typeof window === 'undefined' || !navigator.onLine) return;
  prefetched = true;
  const ocrBase = getOcrAssetBase();
  const urls = [
    `${ocrBase}/worker.min.js`,
    `${ocrBase}/tesseract-core-simd-lstm.wasm.js`,
    `${ocrBase}/tesseract-core-lstm.wasm.js`,
    `${ocrBase}/eng.traineddata.gz`,
    `${ocrBase}/por.traineddata.gz`,
  ];
  await Promise.all(
    urls.map((u) =>
      fetch(u, { cache: 'force-cache' }).catch(() => undefined),
    ),
  );
}
