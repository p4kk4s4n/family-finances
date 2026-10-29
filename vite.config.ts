/// <reference types="vitest" />
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Base path: GitHub Actions sets VITE_BASE to "/<repo-name>/". Local dev/preview uses "/".
const base = process.env.VITE_BASE || '/';

// Build identity, used by the in-app "Check for updates" button.
const sha = (process.env.GITHUB_SHA || `dev-${Date.now()}`).slice(0, 12);
const builtAt = Date.now();

/** Emits dist/version.json so the running app can compare itself with the deployed build. */
function versionFile(): Plugin {
  return {
    name: 'ff-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ sha, builtAt }, null, 2),
      });
    },
  };
}

/** Copies Tesseract.js worker, WASM core, and English + Portuguese traineddata into public/ocr/ automatically. */
function copyOcrAssets(): Plugin {
  const syncAssets = () => {
    const outDir = resolve(__dirname, 'public/ocr');
    mkdirSync(outDir, { recursive: true });
    const files: Array<[string, string]> = [
      ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
      ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
      ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm'],
      ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
      ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm'],
      ['node_modules/tesseract.js-core/tesseract-core-simd.wasm.js', 'tesseract-core-simd.wasm.js'],
      ['node_modules/tesseract.js-core/tesseract-core.wasm.js', 'tesseract-core.wasm.js'],
      ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
      ['node_modules/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz', 'por.traineddata.gz'],
    ];
    for (const [srcRel, destName] of files) {
      const src = resolve(__dirname, srcRel);
      const dest = resolve(outDir, destName);
      if (existsSync(src) && !existsSync(dest)) {
        copyFileSync(src, dest);
      }
    }
  };
  return {
    name: 'ff-copy-ocr-assets',
    buildStart() {
      syncAssets();
    },
    configureServer() {
      syncAssets();
    },
  };
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(sha),
    __BUILD_TIME__: JSON.stringify(builtAt),
  },
  plugins: [
    react(),
    copyOcrAssets(),
    versionFile(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        globIgnores: ['**/ocr/**'],
      },
      manifest: {
        id: 'family-finances-pwa',
        name: 'Family Finances',
        short_name: 'Family Finances',
        description: 'Snap receipts, track line items, beat inflation.',
        theme_color: '#1f7a5a',
        background_color: '#0f1a16',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Snap receipt', short_name: 'Snap', url: './#/capture', icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
        ],
        // Lets you share photos, screenshots and PDF e-receipts from other apps into Family Finances.
        share_target: {
          action: './share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [{ name: 'receipts', accept: ['image/*', 'application/pdf'] }],
          },
        },
      } as any,
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
