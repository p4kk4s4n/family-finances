// Generates the PWA PNG icons (no dependencies). Run: npm run icons
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

const BRAND = [31, 122, 90];
const WHITE = [255, 255, 255];
const LINE = [190, 214, 204];

/** Pixel shader in normalized [0,1] coords: rounded green tile + white receipt with zig-zag bottom. */
function pixel(x, y, maskable) {
  const r = maskable ? 0 : 0.2;
  const inTile = (() => {
    const dx = Math.max(r - x, 0, x - (1 - r));
    const dy = Math.max(r - y, 0, y - (1 - r));
    return dx * dx + dy * dy <= r * r;
  })();
  if (!inTile) return null;
  const s = maskable ? 0.72 : 1; // shrink artwork into the maskable safe zone
  const u = (x - 0.5) / s + 0.5;
  const v = (y - 0.5) / s + 0.5;
  const left = 0.3, right = 0.7, top = 0.2, bottom = 0.78;
  const zig = 0.03 * Math.abs(((u - left) / 0.05) % 2 - 1);
  if (u >= left && u <= right && v >= top && v <= bottom - zig) {
    for (const ly of [0.32, 0.42, 0.52]) if (Math.abs(v - ly) < 0.018 && u > 0.36 && u < 0.64) return LINE;
    if (Math.abs(v - 0.64) < 0.024 && u > 0.5 && u < 0.64) return BRAND;
    return WHITE;
  }
  return BRAND;
}

function png(size, maskable = false) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const c = pixel((x + 0.5) / size, (y + 0.5) / size, maskable);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      if (c) { raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255; }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public', { recursive: true });
writeFileSync('public/icon-192.png', png(192));
writeFileSync('public/icon-512.png', png(512));
writeFileSync('public/icon-maskable-512.png', png(512, true));
writeFileSync('public/apple-touch-icon.png', png(180, true));
console.log('Icons written to public/');
