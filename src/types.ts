export type BrandTier = 'store' | 'name' | 'unknown';
export type ReceiptStatus = 'queued' | 'processing' | 'needs_review' | 'error' | 'saved';
/** 'bank' is reserved for future bank-statement import (coming soon). */
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

export interface Settings {
  key: 'app';
  apiKey?: string;
  model: string;
  brlRateFallback: number; // USD per 1 BRL
  autoFxRate: boolean;
  leakageThreshold: number; // USD
  backupBeforeUpdate: boolean;
  monthlyBudgetTotal?: number; // optional override; defaults to sum of category budgets
}
