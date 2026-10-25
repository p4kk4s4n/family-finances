import { describe, expect, it, vi } from 'vitest';
import { cleanBankMerchant, parseStatementCSV, parseStatementOFX, parseStatementWithGemini } from './parser';
import { matchTransactionsToReceipts } from './reconcile';
import type { BankTransaction, Receipt } from '../types';

describe('bank statement parser', () => {
  it('cleans card processor prefixes and store numbers from bank descriptions', () => {
    expect(cleanBankMerchant('SQ *BLUE BOTTLE COFFEE')).toBe('BLUE BOTTLE COFFEE');
    expect(cleanBankMerchant('WALMART SUPERCENTER #1234')).toBe('WALMART SUPERCENTER');
    expect(cleanBankMerchant('IFOOD *PADARIA REAL')).toBe('PADARIA REAL');
  });

  it('parses US CSV statements and skips credit card payments', () => {
    const csv = [
      'Transaction Date,Description,Amount',
      '10/18/2026,"TARGET #0412",32.00',
      '10/19/2026,"SQ *STARBUCKS",6.45',
      '10/20/2026,"AUTOMATIC PAYMENT - THANK YOU",-500.00',
    ].join('\n');

    const rows = parseStatementCSV(csv, 'USD');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: '2026-10-18',
      merchant: 'TARGET',
      amount: 32,
      currency: 'USD',
      suggestedCategory: 'Pantry Staples',
    });
    expect(rows[1]).toMatchObject({
      date: '2026-10-19',
      merchant: 'STARBUCKS',
      amount: 6.45,
      suggestedCategory: 'Coffee',
    });
  });

  it('parses negative-debit CSVs and Brazilian semicolon/R$ CSVs', () => {
    const brlCsv = [
      'Data;Estabelecimento;Valor',
      '21/10/2026;Pão de Açúcar;R$ 125,40',
      '22/10/2026;Posto Ipiranga;R$ 210,00',
      '23/10/2026;Pagamento de Fatura;-R$ 800,00',
    ].join('\n');

    const rows = parseStatementCSV(brlCsv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: '2026-10-21',
      merchant: 'Pão de Açúcar',
      amount: 125.4,
      currency: 'BRL',
      suggestedCategory: 'Pantry Staples',
    });
    expect(rows[1].suggestedCategory).toBe('Fuel & Transport');
  });

  it('parses OFX / QFX statement blocks', () => {
    const ofx = `
      <OFX><BANKMSGSRSV1><STMTRS><CURDEF>USD<BANKTRANLIST>
      <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261015120000<TRNAMT>-42.10<NAME>WALMART #55</STMTTRN>
      <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261016120000<TRNAMT>200.00<NAME>PAYMENT THANK YOU</STMTTRN>
      </BANKTRANLIST></STMTRS></BANKMSGSRSV1></OFX>
    `;
    const rows = parseStatementOFX(ofx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-10-15',
      merchant: 'WALMART',
      amount: 42.1,
      currency: 'USD',
    });
  });

  it('parses PDFs/statements via Gemini structured output', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      currency: 'USD',
                      transactions: [
                        {
                          date: '2026-10-11',
                          description: 'COSTCO WHSE #102',
                          merchant: 'Costco',
                          amount: 145.8,
                          currency: 'USD',
                          suggestedCategory: 'Pantry Staples',
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    const rows = await parseStatementWithGemini(blob, 'application/pdf', 'KEY', 'gemini-flash-latest', fetchFn);
    expect(rows).toHaveLength(1);
    expect(rows[0].merchant).toBe('Costco');
    expect(rows[0].amount).toBe(145.8);
  });
});

describe('reconciliation matcher', () => {
  const receipts: Receipt[] = [
    {
      id: 10,
      createdAt: 1,
      status: 'saved',
      source: 'photo',
      merchant: 'Target',
      date: '2026-10-20',
      currency: 'USD',
      total: 32,
      totalUSD: 32,
    },
  ];

  const mkTx = (p: Partial<BankTransaction>): BankTransaction => ({
    importedAt: 1,
    date: '2026-10-22', // posted 2 days after receipt
    description: 'TARGET #0412',
    merchant: 'TARGET',
    amount: 32,
    currency: 'USD',
    amountUSD: 32,
    fxRate: 1,
    suggestedCategory: 'Pantry Staples',
    status: 'unmatched',
    ...p,
  });

  it('matches a bank charge posted within ±3 days to its snapped receipt (1-to-1)', () => {
    const txs = [
      mkTx({ date: '2026-10-22', amount: 32, amountUSD: 32 }), // matches receipt #10 (2 days after)
      mkTx({ date: '2026-10-22', amount: 32, amountUSD: 32 }), // second identical charge should stay unmatched
      mkTx({ date: '2026-10-29', amount: 32, amountUSD: 32 }), // 9 days later -> outside ±3d window
    ];

    const matched = matchTransactionsToReceipts(txs, receipts);
    expect(matched[0].status).toBe('matched');
    expect(matched[0].matchedReceiptId).toBe(10);
    expect(matched[1].status).toBe('unmatched');
    expect(matched[2].status).toBe('unmatched');
  });
});
