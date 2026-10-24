# Family Finances

A mobile-first **receipt-photo budget tracker** that runs as an installable web app (PWA) hosted free on **GitHub Pages**.

Snap a receipt and Gemini AI reads **every line item**, so you see exactly where the money went (groceries vs. treats vs. household) instead of just "Target: \$180". Built for frugality, grocery optimization and tracking **your personal inflation**, so you know how much discretionary flexibility you really have.

## Features

| Area | What it does |
| --- | --- |
| 📷 **Capture** | One-tap camera, multi-photo or PDF upload, **share-sheet import** (send screenshots and e-receipts from any app), a "Snap receipt" home-screen shortcut, and an offline queue processed in the background |
| 🤖 **AI parsing** | Gemini multimodal reads merchant, date, tax, payment method and itemized rows (handles creased or faded receipts). Detects **USD or R\$ (BRL)** automatically |
| ✅ **Review** | Edit any line. Sanity checks flag items that don't add up to the subtotal |
| 🔁 **Duplicate detection** | Photo fingerprint plus merchant, date and total matching |
| 💱 **Currency** | Budgets in USD. BRL receipts are converted at the purchase date's rate (auto-fetched, with a manual fallback rate) |
| 📊 **Insights** | Discretionary flexibility, budget vs spend with month-end projection, **receipt leakage** (small impulse buys), **store-brand savings**, and **personal basket inflation** (1, 3 or 6 months) |
| 📤 **Partner sharing** | Three separate share buttons: **image card**, **text summary**, **JSON data file** (plus import) |
| 🔄 **One-tap updates** | Settings → *Check for updates & install latest* |
| 🔒 **Private** | All data stays on your device (IndexedDB). No accounts, no server |
| 🚧 **Coming soon** | Family Relay (shared envelopes), Pacing and Burn Rate, Price Pulse and Pantry, Bank statement import |

---

## 🚀 Deploy to GitHub Pages (one-time setup, ~10 minutes)

### 1. Install the tools (once per computer)
- **Git**: <https://git-scm.com/download/win>
- **Node.js 20 LTS** (only needed to run it locally): <https://nodejs.org>

### 2. Create the GitHub repository
1. Go to <https://github.com/new>.
2. Name it, e.g. `family-finances`. The name becomes part of your URL.
3. Choose **Public**. GitHub Pages is free for public repos; private repos need a paid plan. Your *data* is never in the repo, only the app code.
4. Do **not** add a README or .gitignore. Click **Create repository**.

### 3. Push this code
Open PowerShell in this folder and run (replace `YOUR-USER`):

```powershell
git init
git add .
git commit -m "Family Finances v1"
git branch -M main
git remote add origin https://github.com/YOUR-USER/family-finances.git
git push -u origin main
```

### 4. Turn on GitHub Pages
1. In the repo, open **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Open the **Actions** tab. The *Deploy to GitHub Pages* workflow runs tests, builds and deploys (about 1–2 minutes).
4. Your app is live at **`https://YOUR-USER.github.io/family-finances/`**.

### 5. Install it on your phone
- **Android (Chrome):** open the URL, then tap ⋮ → **Install app** (or *Add to Home screen*).
- **iPhone (Safari):** open the URL, then tap Share → **Add to Home Screen**.

### 6. Add your Gemini API key (first launch)
1. Get a free key at <https://aistudio.google.com/apikey>.
2. In the app: **More → Settings → Gemini API key**, then paste and **Save**. Tap **Test key** to confirm.
3. The key is stored **only on that device** and is never included in exports. Receipts snapped before adding a key wait in the queue and process automatically once it's saved.

> ⚠️ Free-tier Gemini usage may be used by Google to improve its models. If that matters to you, enable billing on the key's Google Cloud project, which switches it to paid-tier data terms.

---

## 🔄 Updating the app

**Shipping a new version:** commit and push to `main`. GitHub Actions automatically tests, builds and redeploys.

```powershell
git add .
git commit -m "Describe the change"
git push
```

**Installing it on each phone:** **More → Settings → 🔄 Check for updates & install latest**. One tap:
1. Compares the installed build with the version deployed on GitHub Pages (`version.json`).
2. If a newer build exists, it optionally downloads a JSON backup (on by default), refreshes the app files, and reloads into the new version.
3. **Your receipts and budgets are never touched.** They live in on-device storage, separate from the app files.

---

## 👫 Sharing with your partner

**More → Share with partner** offers three independent options:
- **🖼️ Image card**: a visual weekly summary for any messaging app.
- **💬 Text summary**: plain-text recap (spend vs budget, top categories, leakage, biggest price change).
- **🗂️ Data file (JSON)**: full saved receipts and budgets. Your partner opens their copy of the app, taps **Import a data file…**, and duplicates are skipped automatically.

Live shared sync is planned for **Family Relay** (coming soon).

---

## 🛠️ Local development

```powershell
npm install
npm run dev        # http://localhost:5173 (camera works on localhost)
npm test           # unit tests (Vitest)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build (service worker active)
npm run e2e        # end-to-end tests (Playwright; first run: npx playwright install chromium)
npm run icons      # regenerate PWA icons
```

To test on your phone over Wi-Fi, run `npm run dev -- --host` and open the shown network URL. Camera capture requires HTTPS or localhost, so the GitHub Pages URL is the easiest way to test on a phone.

### Project structure
```
src/
  capture/   gemini.ts (AI parsing), validate.ts, queue.ts (offline queue + save), image.ts (downscale, photo hash)
  db/        schema.ts (Dexie/IndexedDB), dedupe.ts
  insights/  metrics.ts (budgets, leakage, brand savings, inflation, flexibility)
  share/     digest.ts (text), card.ts (image), exportData.ts (JSON), shareHelpers.ts
  pages/     Dashboard, Capture, Receipts, ReceiptDetail (review), Insights, Budgets, Share, Settings, ComingSoon
  updater.ts one-tap update logic
  sw.ts      service worker (offline cache + share target)
.github/workflows/deploy.yml   CI: test, build, deploy to Pages
```

The data model already reserves `source: 'bank'` for future bank-statement import.
