// ============================================================================
// Faktura: schemat odpowiedzi modelu, czyszczenie, kontrola poprawności.
// ============================================================================
import { amountsMatch, isValidNip, normalizeDate, normalizeEan, normalizeNip, normalizeUnit, normalizeVat, parseNumber, round2 } from './validate.ts';

export type Warning = { code: string; text: string };
export type Severity = 'error' | 'warn';
export type Issue = Warning & { severity: Severity; weight: number };

export type NormalizedLine = {
  raw_name: string;
  qty: number;
  unit: string | null;
  unit_price_net: number | null;
  total_net: number | null;
  vat_rate: number | null;
  ean: string | null;
  /** pozycja bez wpływu na magazyn (transport, usługa, rabat) */
  skip: boolean;
  ai_confidence: number;
};

export type Normalized = {
  doc_kind: 'invoice' | 'correction' | 'receipt' | 'delivery_note' | 'other';
  supplier_name: string | null;
  supplier_nip: string | null;
  invoice_number: string | null;
  issue_date: string | null;
  currency: string;
  total_net: number | null;
  total_vat: number | null;
  total_gross: number | null;
  lines: NormalizedLine[];
  /** ostrzeżenia zgłoszone przez model */
  model_warnings: Warning[];
  /** uwagi z czyszczenia danych (np. odrzucony EAN) */
  notes: Warning[];
  ai_confidence: number;
};

// ---- schemat odpowiedzi (structured outputs: output_config.format) ---------------------------------
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };

export const INVOICE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['document_kind', 'supplier', 'invoice', 'totals', 'lines', 'warnings', 'overall_confidence'],
  properties: {
    document_kind: {
      type: 'string',
      enum: ['invoice', 'correction', 'receipt', 'delivery_note', 'other'],
      description: 'invoice = faktura VAT; correction = faktura korygująca; receipt = paragon; delivery_note = WZ / list przewozowy; other = nie wiadomo.',
    },
    supplier: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'nip'],
      properties: {
        name: { ...nullableString, description: 'Nazwa SPRZEDAWCY (wystawcy), nie nabywcy.' },
        nip: { ...nullableString, description: 'NIP sprzedawcy: 10 cyfr, bez kresek i prefiksu PL. null, gdy nieczytelny.' },
      },
    },
    invoice: {
      type: 'object',
      additionalProperties: false,
      required: ['number', 'issue_date', 'currency'],
      properties: {
        number: { ...nullableString, description: 'Numer faktury dokładnie jak na dokumencie (np. FV/2026/10/0451).' },
        issue_date: { ...nullableString, description: 'Data wystawienia w formacie RRRR-MM-DD.' },
        currency: { ...nullableString, description: 'Trzyliterowy kod waluty, np. PLN. Gdy nie podano — PLN.' },
      },
    },
    totals: {
      type: 'object',
      additionalProperties: false,
      required: ['net', 'vat', 'gross'],
      properties: {
        net: { ...nullableNumber, description: 'Suma wartości netto z podsumowania „Razem". Liczba z kropką dziesiętną.' },
        vat: { ...nullableNumber, description: 'Suma kwot VAT z podsumowania.' },
        gross: { ...nullableNumber, description: 'Do zapłaty / wartość brutto razem.' },
      },
    },
    lines: {
      type: 'array',
      description: 'Jedna pozycja na wiersz tabeli towarów, w kolejności z dokumentu.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'quantity', 'unit', 'unit_price_net', 'total_net', 'vat_rate', 'ean', 'is_stock_item', 'confidence'],
        properties: {
          name: { type: 'string', description: 'Nazwa towaru dokładnie jak na dokumencie (bez numeru Lp.).' },
          quantity: { type: 'number', description: 'Ilość. Dla faktury korygującej — zmiana ilości (może być ujemna).' },
          unit: { ...nullableString, description: 'Jednostka miary: szt., op., kg, l, m itd.' },
          unit_price_net: { ...nullableNumber, description: 'Cena jednostkowa NETTO (przed rabatem tylko, jeśli nie ma ceny po rabacie).' },
          total_net: { ...nullableNumber, description: 'Wartość netto wiersza.' },
          vat_rate: { ...nullableNumber, description: 'Stawka VAT jako liczba: 23, 8, 5, 0. Dla „zw", „np" — null.' },
          ean: { ...nullableString, description: 'Kod kreskowy EAN/GTIN TYLKO jeśli wydrukowany na dokumencie przy tej pozycji.' },
          is_stock_item: { type: 'boolean', description: 'false dla usług, transportu, opakowań zwrotnych, rabatów i opłat; true dla towarów przyjmowanych na magazyn.' },
          confidence: { type: 'integer', description: 'Pewność odczytu tej pozycji 0–100 (100 = wyraźnie czytelna).' },
        },
      },
    },
    warnings: {
      type: 'array',
      description: 'Krótkie uwagi o problemach z odczytem (nieczytelne fragmenty, brak numeru, rozbieżności). Pusta tablica, gdy wszystko jest jasne.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'text'],
        properties: { code: { type: 'string' }, text: { type: 'string', description: 'Po polsku, jedno zdanie.' } },
      },
    },
    overall_confidence: { type: 'integer', description: 'Ogólna pewność odczytu całego dokumentu 0–100.' },
  },
} as const;

// ---- czyszczenie -----------------------------------------------------------------------------------
type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : {});
const asText = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const KINDS = ['invoice', 'correction', 'receipt', 'delivery_note', 'other'] as const;
const MAX_LINES = 300;

export function normalizeExtraction(raw: unknown, today: Date = new Date()): Normalized {
  const r = asDict(raw);
  const supplier = asDict(r.supplier);
  const invoice = asDict(r.invoice);
  const totals = asDict(r.totals);
  const notes: Warning[] = [];

  const kindRaw = typeof r.document_kind === 'string' ? r.document_kind : 'invoice';
  const doc_kind = (KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as Normalized['doc_kind']) : 'invoice';

  let supplier_nip: string | null = null;
  const nipRaw = asText(supplier.nip, 40);
  if (nipRaw) {
    const digits = normalizeNip(nipRaw);
    if (digits.length === 10) supplier_nip = digits;
    else notes.push({ code: 'nip_format', text: `Odczytany NIP „${nipRaw}” nie ma 10 cyfr — pole zostawiono puste.` });
  }

  let supplier_name = asText(supplier.name, 160);
  if (supplier_name && supplier_name.length < 2) supplier_name = null;

  const issue_date = normalizeDate(invoice.issue_date, today);
  if (typeof invoice.issue_date === 'string' && invoice.issue_date.trim() && !issue_date) {
    notes.push({ code: 'date_invalid', text: `Odczytana data „${invoice.issue_date}” jest nierealna — pole zostawiono puste.` });
  }
  const cur = asText(invoice.currency, 8)?.toUpperCase() ?? 'PLN';
  const currency = /^[A-Z]{3}$/.test(cur) ? cur : 'PLN';

  const money = (v: unknown): number | null => {
    const n = parseNumber(v);
    return n === null || Math.abs(n) > 9_999_999_999 ? null : round2(n);
  };

  const lines: NormalizedLine[] = [];
  const rawLines = Array.isArray(r.lines) ? r.lines.slice(0, MAX_LINES) : [];
  for (const item of rawLines) {
    const l = asDict(item);
    const name = asText(l.name, 500);
    const qtyRaw = parseNumber(l.quantity);
    if (!name || qtyRaw === null || qtyRaw === 0 || Math.abs(qtyRaw) > 99_999_999) {
      if (name) notes.push({ code: 'line_dropped', text: `Pominięto pozycję „${name.slice(0, 60)}” — brak czytelnej ilości.` });
      continue;
    }
    const qty = Math.round(qtyRaw * 1000) / 1000;
    const priceRaw = parseNumber(l.unit_price_net);
    const unit_price_net = priceRaw === null || Math.abs(priceRaw) > 9_999_999 ? null : Math.round(priceRaw * 10000) / 10000;
    const total_net = money(l.total_net);
    let ai_confidence = Math.round(clamp(parseNumber(l.confidence) ?? 70, 0, 100));

    let ean: string | null = null;
    const eanRaw = asText(l.ean, 40);
    if (eanRaw) {
      ean = normalizeEan(eanRaw);
      if (!ean) notes.push({ code: 'ean_invalid', text: `Odrzucono kod „${eanRaw}” przy pozycji „${name.slice(0, 40)}” — zła suma kontrolna EAN.` });
    }

    if (unit_price_net !== null && total_net !== null) {
      const expected = round2(qty * unit_price_net);
      if (!amountsMatch(total_net, expected)) {
        ai_confidence = Math.min(ai_confidence, 55);
        notes.push({ code: 'line_math', text: `Pozycja „${name.slice(0, 40)}”: ilość × cena = ${expected.toFixed(2)}, a na fakturze ${total_net.toFixed(2)}. Sprawdź ze zdjęciem.` });
      }
    }

    lines.push({
      raw_name: name,
      qty,
      unit: normalizeUnit(l.unit),
      unit_price_net,
      total_net,
      vat_rate: normalizeVat(l.vat_rate),
      ean,
      skip: l.is_stock_item === false,
      ai_confidence,
    });
  }

  const modelWarnings: Warning[] = [];
  if (Array.isArray(r.warnings)) {
    for (const w of r.warnings.slice(0, 20)) {
      const text = asText(asDict(w).text, 300);
      if (text) modelWarnings.push({ code: asText(asDict(w).code, 40) ?? 'model', text });
    }
  }

  const overallRaw = parseNumber(r.overall_confidence);
  const avgLines = lines.length ? lines.reduce((a, l) => a + l.ai_confidence, 0) / lines.length : 0;
  const ai_confidence = Math.round(clamp(overallRaw ?? avgLines, 0, 100));

  return {
    doc_kind,
    supplier_name,
    supplier_nip,
    invoice_number: asText(invoice.number, 80),
    issue_date,
    currency,
    total_net: money(totals.net),
    total_vat: money(totals.vat),
    total_gross: money(totals.gross),
    lines,
    model_warnings: modelWarnings,
    notes,
    ai_confidence,
  };
}

// ---- kontrola poprawności („KOD sprawdza") ----------------------------------------------------------
export function verifyExtraction(n: Normalized): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, severity: Severity, weight: number, text: string) => issues.push({ code, severity, weight, text });

  if (n.lines.length === 0) add('no_lines', 'error', 10, 'Nie odczytano żadnej pozycji.');
  if (!n.supplier_nip) add('no_nip', 'warn', 2, 'Brak NIP dostawcy.');
  else if (!isValidNip(n.supplier_nip)) add('bad_nip', 'error', 6, 'NIP dostawcy ma błędną sumę kontrolną — możliwa pomyłka odczytu cyfry.');
  if (!n.invoice_number) add('no_number', 'warn', 3, 'Brak numeru faktury.');
  if (!n.issue_date) add('no_date', 'warn', 1, 'Brak daty wystawienia.');

  // Sumy: tylko dla zwykłej faktury (paragony mają wartości brutto, korekty bywają częściowe).
  if (n.doc_kind === 'invoice' && n.lines.length > 0) {
    const sum = round2(n.lines.reduce((a, l) => a + (l.total_net ?? (l.unit_price_net !== null ? l.qty * l.unit_price_net : 0)), 0));
    if (n.total_net !== null && !amountsMatch(n.total_net, sum)) {
      add('sum_mismatch', 'error', 8, `Suma pozycji (${sum.toFixed(2)}) różni się od sumy netto na fakturze (${n.total_net.toFixed(2)}).`);
    }
  }
  if (n.doc_kind === 'invoice' && n.total_net !== null && n.total_vat !== null && n.total_gross !== null) {
    if (!amountsMatch(n.total_gross, round2(n.total_net + n.total_vat))) {
      add('gross_mismatch', 'error', 5, `Netto + VAT (${round2(n.total_net + n.total_vat).toFixed(2)}) nie równa się brutto (${n.total_gross.toFixed(2)}).`);
    }
  }
  const badMath = n.notes.filter((x) => x.code === 'line_math').length;
  if (badMath >= 2) add('line_math', 'error', 4, `Rozbieżna wartość w ${badMath} pozycjach (ilość × cena).`);
  else if (badMath === 1) add('line_math', 'warn', 2, 'Rozbieżna wartość w jednej pozycji (ilość × cena).');
  if (n.ai_confidence < 60) add('low_confidence', 'warn', 3, `Model ocenia pewność odczytu na ${n.ai_confidence}%.`);
  return issues;
}

export const scoreIssues = (issues: Issue[]): number => issues.reduce((a, i) => a + i.weight, 0);

/** Czy warto przeczytać dokument jeszcze raz mocniejszym (droższym) modelem? */
export function needsEscalation(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === 'error') || issues.some((i) => i.code === 'low_confidence');
}
