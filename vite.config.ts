/// <reference types="vitest" />
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

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(sha),
    __BUILD_TIME__: JSON.stringify(builtAt),
  },
  plugins: [
    react(),
    versionFile(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
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
