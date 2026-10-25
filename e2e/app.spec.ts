import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = process.env.SHOTS_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

// 1x1 PNG fixture (the Gemini call is mocked, so content doesn't matter)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const today = new Date().toISOString().slice(0, 10);

const geminiReply = (payload: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
});

test.beforeEach(({ page }) => {
  page.on('console', (msg) => console.log('PAGE LOG:', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message, err.stack));
});

async function addKey(page: Page) {
  await page.goto('./#/settings');
  await page.getByTestId('api-key-input').fill('TEST-KEY-123');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Key saved on this device')).toBeVisible();
}

test('capture → AI parse → review → save → dashboard insights', async ({ page }) => {
  await page.route('**/generativelanguage.googleapis.com/**', (route) =>
    route.fulfill(
      geminiReply({
        merchant: 'Target',
        date: today,
        currency: 'USD',
        subtotal: 30.5,
        tax: 1.5,
        total: 32,
        paymentMethod: 'Visa 1234',
        items: [
          { name: 'Good & Gather Eggs 12ct', normalizedName: 'eggs large dozen', category: 'Dairy & Eggs', quantity: 1, unitPrice: 3.5, total: 3.5, isDiscretionary: false, brandTier: 'store' },
          { name: 'Tide Pods 42ct', normalizedName: 'laundry detergent pods', category: 'Household Supplies', quantity: 1, unitPrice: 15, total: 15, isDiscretionary: false, brandTier: 'name' },
          { name: 'Starbucks Frappuccino', normalizedName: 'bottled coffee drink', category: 'Coffee', quantity: 2, unitPrice: 3, total: 6, isDiscretionary: true, brandTier: 'name' },
          { name: 'Reeses Cups', normalizedName: 'peanut butter cups', category: 'Snacks & Treats', quantity: 3, unitPrice: 2, total: 6, isDiscretionary: true, brandTier: 'name' },
        ],
      }),
    ),
  );

  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Family Finances' })).toBeVisible();
  await shot(page, '01-dashboard-empty');

  // Capture before a key exists → queued + prompt for key
  await page.goto('./#/capture');
  await page.getByTestId('upload-input').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('waiting. Add your Gemini API key')).toBeVisible();
  await shot(page, '02-capture-needs-key');

  await addKey(page);
  await page.goto('./#/capture');
  await expect(page.locator('.pill-needs_review')).toBeVisible({ timeout: 10_000 });
  await page.locator('.list-row', { hasText: 'Target' }).click();

  await expect(page.getByText('Review receipt')).toBeVisible();
  await expect(page.locator('.review-item')).toHaveCount(4);
  await shot(page, '03-review');
  await page.getByRole('button', { name: 'Save receipt' }).click({ force: true });

  await expect(page.locator('.items tr')).toHaveCount(4);
  await expect(page.locator('.total-row')).toContainText('$32.00');
  await shot(page, '04-receipt-saved');

  await page.goto('./');
  await expect(page.locator('.hero-value')).toBeVisible();
  await expect(page.getByText('small discretionary items')).toContainText('2');
  await shot(page, '05-dashboard');

  await page.goto('./#/insights');
  await expect(page.getByText('Receipt leakage')).toBeVisible();
  await shot(page, '06-insights');
});

test('Brazilian reais receipt is converted to USD', async ({ page }) => {
  await page.route('**/api.frankfurter.app/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rates: { USD: 0.2 } }) }));
  await page.route('**/generativelanguage.googleapis.com/**', (route) =>
    route.fulfill(
      geminiReply({
        merchant: 'Pão de Açúcar', date: today, currency: 'BRL', subtotal: 100, tax: null, total: 100, paymentMethod: 'Pix',
        items: [{ name: 'Café Pilão 500g', normalizedName: 'ground coffee 500g', category: 'Pantry Staples', quantity: 2, unitPrice: 25, total: 50, isDiscretionary: false, brandTier: 'name' },
          { name: 'Pão francês', normalizedName: 'bread rolls', category: 'Bakery', quantity: 1, unitPrice: 50, total: 50, isDiscretionary: false, brandTier: 'unknown' }],
      }),
    ),
  );
  await addKey(page);
  await page.goto('./#/capture');
  await page.getByTestId('upload-input').setInputFiles({ name: 'cupom.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('.list-row', { hasText: 'Pão de Açúcar' }).click({ timeout: 10_000 });
  await expect(page.locator('select').first()).toHaveValue('BRL');
  await shot(page, '07-review-brl');
  await page.getByRole('button', { name: 'Save receipt' }).click({ force: true });
  await expect(page.locator('.total-row')).toContainText('$20.00');
  await expect(page.getByText('@ 0.2000 (auto)')).toBeVisible();
});

test('share page offers three separate formats', async ({ page }) => {
  await page.goto('./#/share');
  await expect(page.getByRole('button', { name: 'Share image card' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share text summary' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share data file' })).toBeVisible();
  await shot(page, '08-share');
});

test('settings: one-tap update check', async ({ page }) => {
  await page.goto('./#/settings');
  // Same version deployed → "latest"
  await page.getByTestId('update-btn').click();
  await expect(page.getByTestId('update-status')).toContainText("You're on the latest version");
  await shot(page, '09-settings-update');

  // Newer version deployed → installs + reloads (backup off to avoid a download prompt)
  await page.getByLabel('Download a data backup before updating').setChecked(false);
  await page.route('**/version.json*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'newer123', builtAt: Date.now() }) }));
  const nav = page.waitForURL(/updated=\d+/);
  await page.getByTestId('update-btn').click();
  await nav;
  await expect(page.getByTestId('update-status')).toContainText("You're on the latest version");
});

test('Price Pulse & Pantry and Bank Statement Import workflows', async ({ page }) => {
  // 1. Seed two receipts at different stores via JSON import so we can verify Price Pulse & Bank Matching
  const exportSeed = {
    app: 'family-finances',
    format: 2,
    exportedAt: new Date().toISOString(),
    receipts: [
      { id: 1, createdAt: 1000, status: 'saved', source: 'photo', merchant: 'Aldi', date: '2026-10-10', currency: 'USD', fxRate: 1, total: 3.1, totalUSD: 3.1 },
      { id: 2, createdAt: 2000, status: 'saved', source: 'photo', merchant: 'Target', date: '2026-10-18', currency: 'USD', fxRate: 1, total: 4.5, totalUSD: 4.5 },
    ],
    items: [
      { receiptId: 1, date: '2026-10-10', merchant: 'Aldi', rawName: 'Eggs 12ct', normalizedName: 'eggs large dozen', category: 'Dairy & Eggs', quantity: 1, unitPrice: 3.1, total: 3.1, currency: 'USD', fxRate: 1, unitPriceUSD: 3.1, totalUSD: 3.1, isDiscretionary: false, brandTier: 'store' },
      { receiptId: 2, date: '2026-10-18', merchant: 'Target', rawName: 'Good & Gather Eggs', normalizedName: 'eggs large dozen', category: 'Dairy & Eggs', quantity: 1, unitPrice: 4.5, total: 4.5, currency: 'USD', fxRate: 1, unitPriceUSD: 4.5, totalUSD: 4.5, isDiscretionary: false, brandTier: 'store' },
    ],
    budgets: [],
  };

  await page.goto('./#/share');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'seed.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exportSeed)),
  });
  await expect(page.getByText('Imported 2 receipts')).toBeVisible();

  // 2. Verify Price Pulse & Pantry
  await page.goto('./#/prices');
  await expect(page.getByText('eggs large dozen')).toBeVisible();
  await expect(page.getByText('Best:')).toContainText('Aldi');
  await shot(page, '10-price-pulse');

  await page.getByRole('tab', { name: /Price Jumps/ }).click();
  await expect(page.getByText('eggs large dozen')).toBeVisible();

  await page.getByRole('tab', { name: /Pantry/ }).click();
  await expect(page.getByText('eggs large dozen')).toBeVisible();

  // 3. Verify Bank Statement Import & Reconciliation
  await page.goto('./#/bank');
  const csvContent = [
    'Transaction Date,Description,Amount',
    '10/20/2026,"TARGET #0412",4.50', // 2 days after Target receipt ($4.50) -> auto-matched!
    '10/21/2026,"SHELL OIL 9981",38.00', // Unmatched -> missing receipt
  ].join('\n');

  await page.getByTestId('statement-file-input').setInputFiles({
    name: 'october-statement.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csvContent),
  });

  await expect(page.getByTestId('bank-status-msg')).toContainText('1 matched to receipts, 1 missing receipts');
  await expect(page.getByTestId('bank-tx-row')).toContainText('SHELL OIL');
  await shot(page, '11-bank-import');

  // One-tap import the unmatched Shell fuel charge
  await page.getByTestId('add-expense-btn').click();
  await page.getByRole('tab', { name: /Imported \(1\)/ }).click();
  await expect(page.getByTestId('bank-tx-row')).toContainText('SHELL OIL');
});

test('coming soon features are visible', async ({ page }) => {
  await page.goto('./#/more');
  await expect(page.locator('.pill-soon')).toHaveCount(2);
  await page.getByText('Family Relay').click();
  await expect(page.getByText('Shared household envelopes')).toBeVisible();
});
