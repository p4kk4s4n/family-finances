import { CATEGORY_NAMES, normalizeCategory } from '../lib/categories';
import { normalizeCurrency, round2 } from '../lib/currency';
import { blobToBase64, GeminiError } from '../capture/gemini';

export interface RawBankRow {
  date: string; // YYYY-MM-DD
  description: string;
  merchant: string;
  amount: number; // positive expense amount in original currency
  currency: string;
  suggestedCategory: string;
}

const PAYMENT_SKIP_RE =
  /\b(autopay|payment\s+thank\s+you|online\s+payment|automatic\s+payment|pagamento\s+de\s+fatura|pagamento\s+recebido|pagamento\s+efetuado|credit\s+card\s+payment|balance\s+transfer)\b/i;

export function cleanBankMerchant(desc: string): string {
  return desc
    .replace(/^(sq\s*\*|tst\s*\*|paypal\s*\*|pag\s*\*|mp\s*\*|ifood\s*\*|uber\s*\*|pos\s+debit\s+|purchase\s+authorized\s+on\s+\d{1,2}\/\d{1,2}\s+)/i, '')
    .replace(/\s+#\d+.*$/, '')
    .replace(/\s+\d{4,}.*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function guessCategory(text: string): string {
  const s = text.toLowerCase();
  if (/\b(shell|chevron|exxon|mobil|bp|texaco|arco|posto|ipiranga|petrobras|uber|lyft|metro|parking|toll)\b/.test(s)) return 'Fuel & Transport';
  if (/\b(starbucks|dunkin|peets|coffee|cafe|café|padaria)\b/.test(s)) return 'Coffee';
  if (/\b(mcdonald|chipotle|panera|wendys|taco bell|burger|pizza|sushi|grill|bistro|restaurant|restaurante|lanchonete|doordash|ubereats|ifood)\b/.test(s))
    return 'Dining Out';
  if (/\b(cvs|walgreens|rite aid|pharmacy|farmacia|drogaria|drogasil|raia)\b/.test(s)) return 'Health & Pharmacy';
  if (/\b(petco|petsmart|petz|cobasi|vet)\b/.test(s)) return 'Pets';
  if (/\b(aldi|kroger|safeway|publix|whole foods|trader joe|wegmans|heb|costco|sams club|walmart|target|pão de açúcar|pao de acucar|carrefour|assaí|assai|mercado|supermercado)\b/.test(s))
    return 'Pantry Staples';
  return 'Other';
}

export function parseFlexibleDate(raw: string, preferDayFirst = false): string | null {
  const s = raw.trim().replace(/^["']|["']$/g, '');
  if (!s) return null;
  // ISO YYYY-MM-DD or YYYY/MM/DD
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // OFX YYYYMMDD
  const ofx = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (ofx) return `${ofx[1]}-${ofx[2]}-${ofx[3]}`;

  // Slash or dash separated: MM/DD/YYYY or DD/MM/YYYY
  const sl = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (sl) {
    let [, a, b, y] = sl;
    if (y.length === 2) y = `20${y}`;
    const na = Number(a);
    const nb = Number(b);
    const dayFirst = na > 12 || (preferDayFirst && nb <= 12);
    const month = dayFirst ? nb : na;
    const day = dayFirst ? na : nb;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

function parseAmountNumber(raw: string): number | null {
  let s = raw.trim().replace(/^["']|["']$/g, '');
  if (!s) return null;
  const parenNeg = /^\(.*\)$/.test(s);
  s = s.replace(/[^\d,.-]/g, '');
  if (!s) return null;
  const normalized = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = parseFloat(normalized);
  if (!isFinite(n)) return null;
  return parenNeg ? -Math.abs(n) : n;
}

function splitCSVLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/**
 * Parses a bank or credit-card CSV statement into normalized expense rows.
 */
export function parseStatementCSV(text: string, defaultCurrency = 'USD'): RawBankRow[] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const first = lines[0];
  const delim = first.includes(';') && !first.includes(',') ? ';' : first.includes('\t') ? '\t' : ',';
  const rows = lines.map((l) => splitCSVLine(l, delim));

  const header = rows[0].map((h) => h.toLowerCase().replace(/^["']|["']$/g, '').trim());
  const dateIdx = header.findIndex((h) => /\b(date|data|posted|trans.*date|dt)\b/.test(h));
  const descIdx = header.findIndex((h) => /\b(desc|merchant|name|memo|payee|hist|estabelecimento|title|lançamento)\b/.test(h));
  const amtIdx = header.findIndex((h) => /\b(amount|valor|total|amt|charge|value)\b/.test(h));
  const debitIdx = header.findIndex((h) => /\b(debit|débito|debito|withdrawal)\b/.test(h));
  const currIdx = header.findIndex((h) => /\b(curr|moeda)\b/.test(h));

  const hasHeader = dateIdx !== -1 && (amtIdx !== -1 || debitIdx !== -1);
  const startRow = hasHeader ? 1 : 0;
  const dCol = hasHeader ? dateIdx : 0;
  const mCol = hasHeader ? (descIdx !== -1 ? descIdx : 1) : 1;
  const aCol = hasHeader ? (amtIdx !== -1 ? amtIdx : debitIdx) : 2;

  const isBRL = defaultCurrency === 'BRL' || /\b(valor|histórico|estabelecimento|r\$)\b/i.test(first);
  const dataRows = rows.slice(startRow);

  // Determine sign convention: some banks export expenses as negative (-45.20), others as positive (45.20).
  const parsedAmounts = dataRows
    .map((r) => ({ row: r, desc: r[mCol] ?? '', amt: parseAmountNumber(r[aCol] ?? '') }))
    .filter((x) => x.amt !== null && x.amt !== 0 && !PAYMENT_SKIP_RE.test(x.desc));

  const negCount = parsedAmounts.filter((x) => (x.amt ?? 0) < 0).length;
  const posCount = parsedAmounts.filter((x) => (x.amt ?? 0) > 0).length;
  const expensesAreNegative = negCount > posCount;

  const result: RawBankRow[] = [];
  for (const { row, desc, amt } of parsedAmounts) {
    if (amt === null) continue;
    const isExpense = expensesAreNegative ? amt < 0 : amt > 0;
    if (!isExpense) continue;

    const date = parseFlexibleDate(row[dCol] ?? '', isBRL);
    if (!date) continue;

    const rawDesc = desc.replace(/^["']|["']$/g, '').trim() || 'Card Charge';
    const merchant = cleanBankMerchant(rawDesc) || rawDesc;
    const rowCurr = currIdx !== -1 && row[currIdx] ? normalizeCurrency(row[currIdx]) : rHasBRL(row[aCol]) ? 'BRL' : normalizeCurrency(defaultCurrency);
    const cleanAmt = round2(Math.abs(amt));

    result.push({
      date,
      description: rawDesc,
      merchant,
      amount: cleanAmt,
      currency: rowCurr,
      suggestedCategory: guessCategory(`${merchant} ${rawDesc}`),
    });
  }

  return result;
}

function rHasBRL(cell?: string): boolean {
  return !!cell && /R\$/i.test(cell);
}

/**
 * Parses standard OFX / QFX bank or credit-card statements.
 */
export function parseStatementOFX(text: string, defaultCurrency = 'USD'): RawBankRow[] {
  const curMatch = text.match(/<CURDEF>\s*([A-Z]{3})/i);
  const currency = normalizeCurrency(curMatch ? curMatch[1] : defaultCurrency);

  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const out: RawBankRow[] = [];

  for (const rawBlock of blocks) {
    const block = rawBlock.split(/<\/STMTTRN>/i)[0];
    const tag = (name: string): string => {
      const m = block.match(new RegExp(`<${name}>\\s*([^<\\r\\n]+)`, 'i'));
      return m ? m[1].trim() : '';
    };
    const dt = parseFlexibleDate(tag('DTPOSTED'));
    const amt = parseAmountNumber(tag('TRNAMT'));
    const name = tag('NAME');
    const memo = tag('MEMO');
    const trnType = tag('TRNTYPE').toUpperCase();
    const desc = [name, memo].filter(Boolean).join(' - ').trim() || 'Bank Transaction';

    if (!dt || amt === null || amt === 0) continue;
    if (PAYMENT_SKIP_RE.test(desc) || trnType === 'CREDIT' || trnType === 'PAYMENT' || trnType === 'DEP') continue;
    // In OFX, debits/purchases are typically negative, though some exporters emit positive numbers for credit card charges.
    if (amt > 0 && blocks.some((b) => /<TRNAMT>\s*-/.test(b))) continue;

    const merchant = cleanBankMerchant(name || memo || desc) || desc;
    out.push({
      date: dt,
      description: desc,
      merchant,
      amount: round2(Math.abs(amt)),
      currency,
      suggestedCategory: guessCategory(`${merchant} ${desc}`),
    });
  }

  return out;
}

export const BANK_STATEMENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    currency: { type: 'STRING', description: 'Default ISO currency code of the statement (e.g. USD, BRL).' },
    transactions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING', description: 'Transaction or posting date as YYYY-MM-DD' },
          description: { type: 'STRING', description: 'Original line description from statement' },
          merchant: { type: 'STRING', description: 'Cleaned merchant/store name' },
          amount: { type: 'NUMBER', description: 'Positive purchase/expense amount' },
          currency: { type: 'STRING', description: 'ISO 4217 currency code (USD, BRL, etc.)' },
          suggestedCategory: { type: 'STRING', enum: CATEGORY_NAMES },
        },
        required: ['date', 'description', 'merchant', 'amount', 'currency', 'suggestedCategory'],
      },
    },
  },
  required: ['currency', 'transactions'],
};

export const BANK_STATEMENT_PROMPT = `You are a financial statement parser for a personal budgeting app.
Extract all purchase/expense transactions from this bank or credit card statement (PDF, image, or CSV).
Rules:
- Only include actual expenses/purchases/charges. Exclude bill payments, autopay, credits, refunds, and running balance lines.
- All expense amounts must be positive numbers in the statement's original currency.
- Detect currency: "R$" or Portuguese text => BRL; "$" in the US => USD.
- Format all dates as YYYY-MM-DD.
- Clean merchant names (e.g. "SQ *BLUE BOTTLE" -> "Blue Bottle", "WAL-MART #1234" -> "Walmart").
- Pick the best suggestedCategory from the allowed enum.`;

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Uses Gemini multimodal AI to extract transactions from PDFs, statement screenshots, or arbitrary CSVs.
 */
export async function parseStatementWithGemini(
  file: Blob,
  mimeType: string,
  apiKey: string,
  model: string,
  fetchFn: FetchFn = (i, init) => fetch(i, init),
): Promise<RawBankRow[]> {
  const data = await blobToBase64(file);
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: BANK_STATEMENT_PROMPT }, { inline_data: { mime_type: mimeType || 'application/pdf', data } }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: BANK_STATEMENT_SCHEMA,
      temperature: 0,
    },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new GeminiError(`Gemini statement error ${res.status}: ${errText.slice(0, 200)}`, res.status);
  }
  const json = await res.json();
  const text: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
  if (!text) throw new GeminiError('Gemini returned an empty response for statement.');
  const parsed = JSON.parse(text);
  const fallbackCurr = normalizeCurrency(parsed?.currency);
  const list: any[] = Array.isArray(parsed?.transactions) ? parsed.transactions : [];

  return list
    .map((tx): RawBankRow | null => {
      const amount = round2(Math.abs(Number(tx?.amount) || 0));
      const date = parseFlexibleDate(String(tx?.date ?? '')) ?? new Date().toISOString().slice(0, 10);
      if (!(amount > 0)) return null;
      const description = String(tx?.description || tx?.merchant || 'Card Charge').trim();
      const merchant = cleanBankMerchant(String(tx?.merchant || description)) || description;
      return {
        date,
        description,
        merchant,
        amount,
        currency: normalizeCurrency(tx?.currency || fallbackCurr),
        suggestedCategory: normalizeCategory(tx?.suggestedCategory),
      };
    })
    .filter((x): x is RawBankRow => x !== null);
}
