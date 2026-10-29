export type BrandTier = 'store' | 'name' | 'unknown';
export type ReceiptStatus = 'queued' | 'processing' | 'ai_failed' | 'needs_review' | 'error' | 'saved';
/** 'bank' is used for bank-statement imported charges. */
export type ReceiptSource = 'photo' | 'share' | 'manual' | 'import' | 'bank';

export interface ParsedItem {
  name: string;
  normalizedName: string;
  category: string;
  quantity: number;
  unitPrice: number;
  total: number;
  isDiscretionary: boolean;
  brandTier: BrandTier;
}

export interface ParsedReceipt {
  merchant: string;
  date: string; // YYYY-MM-DD
  currency: string; // ISO code, e.g. USD, BRL
  subtotal: number | null;
  tax: number | null;
  total: number;
  paymentMethod: string | null;
  items: ParsedItem[];
}

export interface Receipt {
  id?: number;
  createdAt: number;
  status: ReceiptStatus;
  source: ReceiptSource;
  image?: Blob;
  imageType?: string;
  imageHash?: string;
  draft?: ParsedReceipt;
  error?: string;
  duplicateOf?: number;
  parsedBy?: 'gemini' | 'ocr';
  aiError?: string;
  leaseUntil?: number;
  attempts?: number;
  strikes?: number;
  nextAttemptAt?: number;
  // Saved fields (amounts are in the receipt's original currency)
  merchant?: string;
  date?: string;
  currency?: string;
  fxRate?: number; // multiply original amount by this to get USD
  fxSource?: 'auto' | 'fallback' | 'manual' | 'none';
  subtotal?: number | null;
  tax?: number | null;
  total?: number;
  totalUSD?: number;
  paymentMethod?: string | null;
}

export interface Item {
  id?: number;
  receiptId: number;
  date: string;
  merchant: string;
  rawName: string;
  normalizedName: string;
  category: string;
  quantity: number;
  unitPrice: number;
  total: number;
  currency: string;
  fxRate: number;
  unitPriceUSD: number;
  totalUSD: number;
  isDiscretionary: boolean;
  brandTier: BrandTier;
}

export interface Budget {
  category: string;
  monthlyLimit: number; // USD
}

export type ScaleStep = 0 | 1 | 2 | 3 | 4;

export interface Settings {
  key: 'app';
  apiKey?: string;
  model: string;
  brlRateFallback: number; // USD per 1 BRL
  autoFxRate: boolean;
  leakageThreshold: number; // USD
  backupBeforeUpdate: boolean;
  monthlyBudgetTotal?: number; // optional override; defaults to sum of category budgets
  ocrFallback: boolean; // fall back to on-device OCR when AI fails
  ocrOnly: boolean; // privacy mode: read on this device only
  notifyWhenReady: boolean; // show notification when background worker finishes a receipt
  fontScale?: ScaleStep; // 0=Small, 1=Medium, 2=Large, 3=Extra Large, 4=Vision Impaired
  iconScale?: ScaleStep; // 0=Small, 1=Medium, 2=Large, 3=Extra Large, 4=Vision Impaired
  resolutionScale?: ScaleStep; // 0=Small, 1=Medium, 2=Large, 3=Extra Large, 4=Vision Impaired
}

export type BankTxStatus = 'unmatched' | 'matched' | 'imported' | 'ignored';

export interface BankTransaction {
  id?: number;
  importedAt: number;
  date: string; // YYYY-MM-DD
  description: string; // Raw merchant / bank memo
  merchant: string; // Cleaned merchant name
  amount: number; // Positive = expense/charge in original currency
  currency: string; // 'USD' | 'BRL' | etc.
  amountUSD: number; // Converted to USD
  fxRate: number;
  suggestedCategory: string;
  status: BankTxStatus;
  matchedReceiptId?: number; // Linked receipt (pre-existing or created via 1-tap import)
  statementName?: string;
}
