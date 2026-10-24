/** Downscale photos before storage/upload (faster parsing, smaller IndexedDB). PDFs pass through. */
export async function downscaleImage(file: Blob, maxDim = 1800, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', quality));
  } catch {
    return file;
  }
}

/** 64-bit difference hash (dHash) as 16 hex chars, for spotting accidental double-snaps. */
export async function imageDHash(file: Blob): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) return undefined;
  try {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = 9;
    canvas.height = 8;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, 9, 8);
    bmp.close();
    const px = ctx.getImageData(0, 0, 9, 8).data;
    const gray = (x: number, y: number) => {
      const i = (y * 9 + x) * 4;
      return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    };
    let hex = '';
    for (let y = 0; y < 8; y++) {
      let nibble = 0;
      for (let x = 0; x < 8; x++) {
        nibble = (nibble << 1) | (gray(x, y) > gray(x + 1, y) ? 1 : 0);
        if (x % 4 === 3) {
          hex += nibble.toString(16);
          nibble = 0;
        }
      }
    }
    return hex;
  } catch {
    return undefined;
  }
}
