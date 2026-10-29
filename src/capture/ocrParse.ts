import type { BrandTier, ParsedItem, ParsedReceipt } from '../types';
import { categoryDef } from '../lib/categories';
import { round2 } from '../lib/currency';
import { categorizeItemText } from './categorize';
import { coerceParsed, normalizeItemName } from './validate';
import { parseFlexibleDate } from '../bank/parser';

const STORE_BRAND_RE = /\b(great value|kirkland|market pantry|good\s*&\s*gather|up\s*&\s*up|equate|member'?s mark|365|trader joe'?s|kroger|simple truth|signature select|lucerne|quali\w*|taeq|carrefour|dia)\b/i;

const BOILERPLATE_MERCHANT_RE =
  /^(cupom fiscal|documento auxiliar|danfe|nfce|nfc-e|extrato|cnpj|cpf|ie:|im:|endereco|endereço|tel\b|telefone|phone|www\.|http|welcome|obrigado|thank you|receipt|customer copy|via cliente|caixa|operador|data\b|hora\b|\d{2}[/:]\d{2}|[-=*_.\s]+)$/i;

const SUMMARY_LINE_RE =
  /\b(sub\s*-?\s*total|total\b|valor\s+total|valor\s+a\s+pagar|a\s+pagar|amount\s+due|balance\s+due|grand\s+total|sales\s+tax|tax\b|hst|gst|vat|imposto|tributo|icms|troco|change\s+due|change\b|tend\b|tendered|cash\b|dinheiro|cartao|cartão|credito|crédito|debito|débito|pix\b|visa\b|mastercard|amex|elo\b|auth\b|aprovad|approved|aid\b|cnpj|cpf|items\s+sold|qtd\s+total\s+de\s+itens|desconto\s+total)\b/i;

const TOTAL_LABEL_RE = /\b(grand\s+total|total\s+a\s+pagar|valor\s+total|valor\s+a\s+pagar|amount\s+due|balance\s+due|^total\b|\btotal\s*[:$r])/i;
const SUBTOTAL_LABEL_RE = /\b(sub\s*-?\s*total|soma\s+dos\s+itens)\b/i;
const TAX_LABEL_RE = /\b(sales\s+tax|tax\b|imposto\w*|tributo\w*)\b/i;
const PAYMENT_RE = /\b(visa|mastercard|amex|discover|pix|dinheiro|cash|debit|débito|debito|credit|crédito|credito|elo|apple\s*pay|google\s*pay)\b/i;

function parsePriceToken(raw: string): number | null {
  const s = raw.replace(/[R$\s]/gi, '').trim();
  if (!s) return null;
  const normalized = /,\d{2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = parseFloat(normalized);
  return isFinite(n) && n >= 0 ? round2(n) : null;
}

export function detectReceiptCurrency(text: string): 'BRL' | 'USD' {
  if (/R\$\s*\d|\b(cupom\s+fiscal|nfc-?e|cnpj|valor\s+total|valor\s+a\s+pagar|troco|imposto)\b/i.test(text)) {
    return 'BRL';
  }
  return 'USD';
}

export function extractReceiptDate(text: string, isBRL: boolean): string | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    // ISO YYYY-MM-DD
    const iso = line.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (iso) {
      const parsed = parseFlexibleDate(iso[0], isBRL);
      if (parsed) return parsed;
    }
    // DD/MM/YYYY or MM/DD/YYYY or 2-digit year
    const sl = line.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2}|\d{2})\b/);
    if (sl) {
      const parsed = parseFlexibleDate(sl[0], isBRL);
      if (parsed) return parsed;
    }
  }
  return null;
}

export function extractMerchant(lines: string[]): string {
  for (const raw of lines.slice(0, 10)) {
    const clean = raw
      .replace(/[*=_~]+/g, ' ')
      .replace(/\s+#?\d{3,}.*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean.length < 3) continue;
    const letters = (clean.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
    if (letters < 3) continue;
    if (BOILERPLATE_MERCHANT_RE.test(clean)) continue;
    // Skip lines that look like a street address with numbers or phone number
    if (/^\d+\s+[a-z]/i.test(clean) || /\b\d{3}[-.)\s]+\d{3}[-.\s]+\d{4}\b/.test(clean)) continue;
    if (/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.test(clean)) continue; // CNPJ
    return clean.slice(0, 60).trim();
  }
  return 'Receipt (OCR)';
}

/**
 * Pure heuristic parser that converts raw OCR text into a sanitized ParsedReceipt.
 */
export function parseOcrText(rawText: string, fallbackDate = new Date().toISOString().slice(0, 10)): ParsedReceipt {
  const text = (rawText || '').replace(/\r\n/g, '\n');
  const currency = detectReceiptCurrency(text);
  const isBRL = currency === 'BRL';
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const merchant = extractMerchant(lines);
  const date = extractReceiptDate(text, isBRL) ?? fallbackDate;

  let subtotal: number | null = null;
  let tax: number | null = null;
  let total: number | null = null;
  let paymentMethod: string | null = null;

  const priceEndRe = /(?:R\$\s*|\$\s*)?(-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|-?\d+[.,]\d{2})\s*[A-Za-z*]?\s*$/;

  const items: ParsedItem[] = [];
  let pendingName: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!paymentMethod) {
      const pm = line.match(PAYMENT_RE);
      if (pm) paymentMethod = pm[1].toUpperCase();
    }

    const priceMatch = line.match(priceEndRe);
    const amount = priceMatch ? parsePriceToken(priceMatch[1]) : null;

    // Check summary lines first
    if (SUBTOTAL_LABEL_RE.test(line) && amount !== null && amount > 0) {
      subtotal = amount;
      pendingName = null;
      continue;
    }
    if (TAX_LABEL_RE.test(line) && !SUBTOTAL_LABEL_RE.test(line) && !TOTAL_LABEL_RE.test(line) && amount !== null && amount >= 0) {
      tax = amount;
      pendingName = null;
      continue;
    }
    if (TOTAL_LABEL_RE.test(line) && !SUBTOTAL_LABEL_RE.test(line) && !/qtd|itens|items|sav|desconto/i.test(line) && amount !== null && amount > 0) {
      total = amount;
      pendingName = null;
      continue;
    }
    if (SUMMARY_LINE_RE.test(line)) {
      pendingName = null;
      continue;
    }

    // Check if this line is a bare qty x unitPrice + total line that belongs to a previous pendingName
    // e.g. "2 x 25,00   50,00" or "2 @ 3.50   7.00"
    const qtyOnlyLine = line.match(
      /^(\d+(?:[.,]\d+)?)\s*(?:x|X|@|un\b|kg\b)\s*(?:R\$|\$)?\s*(\d+[.,]\d{2})\s+(?:R\$|\$)?\s*(\d+[.,]\d{2})\s*[A-Za-z*]?\s*$/i,
    );
    if (qtyOnlyLine && pendingName) {
      const qty = parseFloat(qtyOnlyLine[1].replace(',', '.')) || 1;
      const unit = parsePriceToken(qtyOnlyLine[2]) ?? 0;
      const lineTotal = parsePriceToken(qtyOnlyLine[3]) ?? round2(qty * unit);
      if (lineTotal > 0) {
        items.push(buildItem(pendingName, qty, unit || round2(lineTotal / qty), lineTotal));
      }
      pendingName = null;
      continue;
    }

    // Check if this line is ONLY a price (and we have a pending item name on the previous line)
    const barePrice = line.match(/^(?:R\$|\$)?\s*(\d+[.,]\d{2})\s*[A-Za-z*]?\s*$/);
    if (barePrice && pendingName) {
      const lineTotal = parsePriceToken(barePrice[1]);
      if (lineTotal && lineTotal > 0) {
        items.push(buildItem(pendingName, 1, lineTotal, lineTotal));
      }
      pendingName = null;
      continue;
    }

    if (amount !== null && priceMatch) {
      let left = line.slice(0, priceMatch.index).trim();
      // Strip leading item index or SKU code (e.g. "001 78912345 CAFÉ PILÃO" -> "CAFÉ PILÃO")
      left = left.replace(/^\d{1,3}\s+\d{5,14}\s+/, '').replace(/^\d{5,14}\s+/, '');

      // Check inline qty expression: "Item Name 2 x 3.50" or "2 x Item Name"
      let qty = 1;
      let unitPrice = Math.abs(amount);
      const inlineTrailQty = left.match(/^(.*?)\s+(\d+(?:[.,]\d+)?)\s*(?:x|X|@)\s*(?:R\$|\$)?\s*(\d+[.,]\d{2})\s*$/);
      const inlineLeadQty = left.match(/^(\d+)\s*(?:x|X|@)\s+(.+)$/);

      if (inlineTrailQty && inlineTrailQty[1].trim().length >= 2) {
        left = inlineTrailQty[1].trim();
        qty = parseFloat(inlineTrailQty[2].replace(',', '.')) || 1;
        unitPrice = parsePriceToken(inlineTrailQty[3]) ?? round2(Math.abs(amount) / qty);
      } else if (inlineLeadQty && inlineLeadQty[2].trim().length >= 2) {
        qty = parseInt(inlineLeadQty[1], 10) || 1;
        left = inlineLeadQty[2].trim();
        unitPrice = round2(Math.abs(amount) / qty);
      }

      // Clean trailing dots/dashes
      left = left.replace(/[.\-_]+$/, '').trim();

      // Discount line (negative amount): apply to previous item if possible
      if (amount < 0 && items.length > 0) {
        const prev = items[items.length - 1];
        prev.total = round2(Math.max(0, prev.total + amount));
        prev.unitPrice = round2(prev.total / (prev.quantity || 1));
        pendingName = null;
        continue;
      }

      const letters = (left.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
      if (letters >= 2 && amount > 0 && left.toLowerCase() !== merchant.toLowerCase()) {
        items.push(buildItem(left, qty, unitPrice, amount));
        pendingName = null;
        continue;
      }
    } else {
      // Candidate name-only line (in case the price or qty x unit is on the next line)
      const cleaned = line.replace(/^\d{1,3}\s+\d{5,14}\s+/, '').trim();
      const letters = (cleaned.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
      if (
        letters >= 3 &&
        cleaned.toLowerCase() !== merchant.toLowerCase() &&
        !BOILERPLATE_MERCHANT_RE.test(cleaned) &&
        !SUMMARY_LINE_RE.test(cleaned)
      ) {
        pendingName = cleaned;
      }
    }
  }

  const itemsSum = round2(items.reduce((s, it) => s + it.total, 0));
  if (total === null || total <= 0) {
    total = round2(itemsSum + (tax ?? 0));
  }

  return coerceParsed({
    merchant,
    date,
    currency,
    subtotal,
    tax,
    total,
    paymentMethod,
    items,
  });
}

function buildItem(rawName: string, quantity: number, unitPrice: number, total: number): ParsedItem {
  const name = rawName.replace(/\s+/g, ' ').trim();
  const category = categorizeItemText(name);
  const tier: BrandTier = STORE_BRAND_RE.test(name) ? 'store' : 'unknown';
  return {
    name,
    normalizedName: normalizeItemName(name),
    category,
    quantity: round2(quantity) || 1,
    unitPrice: round2(unitPrice),
    total: round2(total),
    isDiscretionary: categoryDef(category).discretionary,
    brandTier: tier,
  };
}
