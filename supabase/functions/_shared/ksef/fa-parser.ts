// ============================================================================
// Parser faktury ustrukturyzowanej FA(2)/FA(3) z KSeF → dane w kształcie, który przyjmuje baza
// (to samo, co wynik odczytu zdjęcia przez AI: patrz apply_document_extraction w migracji 0010).
// ============================================================================
// Struktura pól pochodzi z oficjalnego schematu XSD „schemat_FA(3)_v1-0E.xsd" (Ministerstwo Finansów):
//   Naglowek/KodFormularza        — rodzaj formularza (FA)
//   Podmiot1/DaneIdentyfikacyjne  — sprzedawca: NIP, Nazwa
//   Fa/KodWaluty, P_1 (data wystawienia), P_2 (numer), P_13_1…P_13_11 (sumy netto wg stawek), P_15 (należność ogółem)
//   Fa/RodzajFaktury              — VAT, KOR, ZAL, ROZ, UPR, KOR_ZAL, KOR_ROZ
//   Fa/FaWiersz*                  — pozycje: P_7 nazwa, GTIN, P_8A jednostka, P_8B ilość, P_9A cena netto,
//                                   P_9B cena brutto, P_10 rabat, P_11 wartość netto, P_11A brutto, P_12 stawka VAT,
//                                   StanPrzed (=1 w korektach: wiersz „przed korektą")
//
// Zasada: „LLM czyta, kod sprawdza" nie dotyczy KSeF — tu dane są maszynowe, więc nie zgadujemy.
// Czego nie da się odczytać jednoznacznie, to OSTRZEŻENIE dla człowieka (nie cicha poprawka).
// Parser jest odporny na przypadkowe różnice (kolejność, prefiksy przestrzeni nazw, FA(2) vs FA(3)),
// ale odmawia, gdy faktura ma inny format (PEF, FA_RR) — wtedy zapisujemy sam nagłówek z listy metadanych.

import { child, childrenOf, parseXml, text, XmlError, type XmlNode } from '../xml.ts';
import { normalizeDate, normalizeEan, normalizeNip, normalizeUnit, parseNumber, round2 } from '../validate.ts';
import type { KsefInvoiceMeta } from './types.ts';

export type Warning = { code: string; text: string };

export interface KsefLine {
  raw_name: string;
  qty: number;
  unit: string | null;
  unit_price_net: number | null;
  total_net: number | null;
  vat_rate: number | null;
  ean: string | null;
  skip: boolean;
}

export interface KsefInvoicePayload {
  doc_kind: 'invoice' | 'correction' | 'other';
  supplier_name: string | null;
  supplier_nip: string | null;
  invoice_number: string | null;
  issue_date: string | null;
  currency: string;
  total_net: number | null;
  total_gross: number | null;
  ai_warnings: Warning[];
  lines: KsefLine[];
}

export type ParseOutcome =
  | { ok: true; payload: KsefInvoicePayload; form: string }
  | { ok: false; reason: 'xml' | 'unsupported_form' | 'structure' | 'too_many_lines'; message: string };

export const MAX_LINES = 1000;

const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const fitsNumeric = (n: number, intDigits: number) => Number.isFinite(n) && Math.abs(n) < 10 ** intDigits;

const deaccent = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

/** Pozycje, które zwykle nie są towarem magazynowym (koszty transportu, rabaty, opłaty). Użytkownik może to zmienić. */
const NON_GOODS_START = /^(transport|przesylk|wysylk|kurier|dostaw|koszt|oplata|oplaty|rabat|upust|opust|kaucj|fracht|spedycj|paliw)/;

/** Stawka z pola P_12: „23", „8", „0 KR", „zw", „oo", „np I" → liczba albo null (zwolnione / nie podlega / odwrotne obciążenie). */
export function parseVatRate(value: string | undefined): number | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (/^0\s*(kr|wdt|ex)$/.test(v)) return 0;
  if (/^\d+([.,]\d+)?$/.test(v)) return Number(v.replace(',', '.'));
  return null;
}

interface RawLine {
  name: string;
  unit: string | null;
  vat: number | null;
  qty: number | null;
  unitNet: number | null;
  net: number | null;
  ean: string | null;
  before: boolean;
}

function readLine(node: XmlNode): RawLine {
  const name = (text(node, 'P_7') ?? text(node, 'Indeks') ?? '(bez nazwy)').slice(0, 500);
  const vat = parseVatRate(text(node, 'P_12'));
  const qty = parseNumber(text(node, 'P_8B'));
  const discount = parseNumber(text(node, 'P_10'));
  const factor = vat === null ? null : 1 + vat / 100;

  let unitNet = parseNumber(text(node, 'P_9A'));
  const unitGross = parseNumber(text(node, 'P_9B'));
  if (unitNet === null && unitGross !== null && factor !== null) unitNet = unitGross / factor;

  let net = parseNumber(text(node, 'P_11'));
  const gross = parseNumber(text(node, 'P_11A'));
  if (net === null && gross !== null && factor !== null) net = gross / factor;
  if (net === null && unitNet !== null && qty !== null) net = unitNet * qty - (discount ?? 0);

  // przy rabacie (P_10) cena z P_9A nie oddaje faktycznej ceny zakupu — wartość pozycji (P_11) jest wiążąca
  if (qty !== null && qty !== 0 && net !== null && (discount !== null || unitNet === null)) unitNet = net / qty;

  return {
    name,
    unit: normalizeUnit(text(node, 'P_8A')),
    vat,
    qty,
    unitNet: unitNet === null ? null : round4(unitNet),
    net: net === null ? null : round2(net),
    ean: normalizeEan(text(node, 'GTIN')) ?? normalizeEan(text(node, 'Indeks')),
    before: text(node, 'StanPrzed') === '1',
  };
}

const looksLikeNonGoods = (name: string, unit: string | null) => unit === 'usł.' || NON_GOODS_START.test(deaccent(name).trim());

function toLine(r: { name: string; unit: string | null; vat: number | null; qty: number; unitNet: number | null; net: number | null; ean: string | null }, forceSkip = false): KsefLine {
  return {
    raw_name: r.name,
    qty: round3(r.qty),
    unit: r.unit,
    unit_price_net: r.unitNet,
    total_net: r.net,
    vat_rate: r.vat,
    ean: r.ean,
    skip: forceSkip || looksLikeNonGoods(r.name, r.unit) || (r.net !== null && r.net < 0 && r.qty > 0),   // ujemna wartość przy dodatniej ilości = rabat
  };
}

/** Korekta: faktura zawiera wiersze „przed" (StanPrzed=1) i „po". Dla magazynu liczy się RÓŻNICA (po − przed). */
function correctionLines(raws: RawLine[], warnings: Warning[]): { lines: KsefLine[]; dropped: number } {
  if (!raws.some((r) => r.before)) {
    warnings.push({ code: 'ksef_correction_no_before', text: 'Korekta nie zawiera wierszy „przed korektą”, więc nie da się wyliczyć zmiany stanu. Pozycje oznaczono jako pomijane — sprawdź je ręcznie.' });
    return { lines: raws.filter((r) => (r.qty ?? 0) !== 0).map((r) => toLine({ ...r, qty: r.qty as number }, true)), dropped: 0 };
  }
  const groups = new Map<string, { name: string; unit: string | null; vat: number | null; ean: string | null; qty: number; net: number; hasNet: boolean; unitNet: number | null }>();
  for (const r of raws) {
    const key = `${deaccent(r.name).replace(/\s+/g, ' ').trim()}|${r.unit ?? ''}|${r.vat ?? 'x'}`;
    const g = groups.get(key) ?? { name: r.name, unit: r.unit, vat: r.vat, ean: r.ean, qty: 0, net: 0, hasNet: false, unitNet: null };
    const sign = r.before ? -1 : 1;
    g.qty += sign * (r.qty ?? 0);
    if (r.net !== null) { g.net += sign * r.net; g.hasNet = true; }
    if (!r.before) { g.unitNet = r.unitNet ?? g.unitNet; g.ean = r.ean ?? g.ean; g.name = r.name; }
    groups.set(key, g);
  }
  const lines: KsefLine[] = [];
  let dropped = 0;
  for (const g of groups.values()) {
    const qty = round3(g.qty);
    if (qty === 0) { dropped++; continue; }
    const net = g.hasNet ? round2(g.net) : null;
    lines.push(toLine({ name: g.name, unit: g.unit, vat: g.vat, qty, net, ean: g.ean, unitNet: net !== null ? round4(net / qty) : g.unitNet }));
  }
  return { lines, dropped };
}

const NET_SUM_TAGS = ['P_13_1', 'P_13_2', 'P_13_3', 'P_13_4', 'P_13_5', 'P_13_6_1', 'P_13_6_2', 'P_13_6_3', 'P_13_7', 'P_13_8', 'P_13_9', 'P_13_10', 'P_13_11'];

const KIND_BY_TYPE: Record<string, KsefInvoicePayload['doc_kind']> = {
  VAT: 'invoice', ROZ: 'invoice', UPR: 'invoice', ZAL: 'other', KOR: 'correction', KOR_ZAL: 'correction', KOR_ROZ: 'correction',
};

export function parseKsefInvoice(xml: string, today: Date = new Date()): ParseOutcome {
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch (e) {
    return { ok: false, reason: 'xml', message: `Nie udało się odczytać pliku XML faktury (${e instanceof XmlError ? e.message : 'błąd składni'}). Wpisz pozycje ręcznie.` };
  }
  if (root.name !== 'Faktura') {
    return { ok: false, reason: 'unsupported_form', message: 'Ta faktura ma format inny niż FA (np. PEF) — pozycje wpisz ręcznie.' };
  }
  const code = child(child(root, 'Naglowek'), 'KodFormularza');
  const system = (code?.attrs.kodSystemowy ?? '').replace(/\s+/g, '');
  const formText = code?.text.trim();
  if (formText !== 'FA' || (system !== '' && !/^FA\([23]\)$/.test(system))) {
    return { ok: false, reason: 'unsupported_form', message: `Format faktury (${system || formText || 'nieznany'}) nie jest jeszcze obsługiwany — pozycje wpisz ręcznie.` };
  }

  const fa = child(root, 'Fa');
  const seller = child(child(root, 'Podmiot1'), 'DaneIdentyfikacyjne');
  const invoiceNumber = text(fa, 'P_2');
  if (!fa || !seller || !invoiceNumber) {
    return { ok: false, reason: 'structure', message: 'Faktura ma nietypową strukturę (brak sprzedawcy lub numeru) — pozycje wpisz ręcznie.' };
  }

  const warnings: Warning[] = [];
  const type = (text(fa, 'RodzajFaktury') ?? 'VAT').toUpperCase();
  const kind = KIND_BY_TYPE[type] ?? 'invoice';
  const currency = (text(fa, 'KodWaluty') ?? 'PLN').toUpperCase().slice(0, 3);

  const sellerName = text(seller, 'Nazwa') ?? text(seller, 'PelnaNazwa')
    ?? ([text(seller, 'ImiePierwsze'), text(seller, 'Nazwisko')].filter(Boolean).join(' ') || null);

  const nets = NET_SUM_TAGS.map((t) => parseNumber(text(fa, t))).filter((n): n is number => n !== null);
  const totalNet = nets.length > 0 ? round2(nets.reduce((a, b) => a + b, 0)) : null;
  const gross = parseNumber(text(fa, 'P_15'));

  const rawNodes = childrenOf(fa, 'FaWiersz');
  if (rawNodes.length > MAX_LINES) {
    return { ok: false, reason: 'too_many_lines', message: `Faktura ma ponad ${MAX_LINES} pozycji — zapisano sam nagłówek, pozycje wpisz ręcznie.` };
  }
  const raws = rawNodes.map(readLine);

  let lines: KsefLine[];
  let droppedPriceOnly = 0;
  let defaultedQty = 0;
  let invalidLines = 0;
  if (type.startsWith('KOR')) {
    const c = correctionLines(raws, warnings);
    lines = c.lines;
    droppedPriceOnly = c.dropped;
  } else {
    lines = [];
    for (const r of raws) {
      let qty = r.qty;
      if (qty === null) { qty = 1; defaultedQty++; }
      if (qty === 0) { invalidLines++; continue; }
      lines.push(toLine({ ...r, qty }));
    }
  }
  // granice kolumn w bazie (numeric 12,3 / 12,4 / 14,2) — jedna absurdalna pozycja nie może wywrócić całego importu
  const sane = lines.filter((l) => fitsNumeric(l.qty, 9) && (l.unit_price_net === null || fitsNumeric(l.unit_price_net, 8)) && (l.total_net === null || fitsNumeric(l.total_net, 12)));
  invalidLines += lines.length - sane.length;
  lines = sane;

  if (type === 'ZAL') warnings.push({ code: 'ksef_advance', text: 'To faktura zaliczkowa — towar zwykle przyjmuje się z faktury końcowej (rozliczeniowej), nie z zaliczkowej.' });
  if (currency !== 'PLN') warnings.push({ code: 'ksef_foreign_currency', text: `Faktura jest w walucie ${currency} — kwoty nie są przeliczone na złote.` });
  if (rawNodes.length === 0) warnings.push({ code: 'ksef_no_lines', text: 'Faktura nie zawiera pozycji (zdarza się przy niektórych fakturach) — wpisz pozycje ręcznie.' });
  if (defaultedQty > 0) warnings.push({ code: 'ksef_qty_defaulted', text: `Pozycje bez ilości na fakturze: ${defaultedQty} — przyjęto 1.` });
  if (invalidLines > 0) warnings.push({ code: 'ksef_lines_dropped', text: `Pominięto pozycje o zerowej lub nierealnej ilości lub cenie: ${invalidLines}.` });
  if (droppedPriceOnly > 0) warnings.push({ code: 'ksef_correction_price_only', text: `Korekta zmienia tylko cenę w ${droppedPriceOnly} poz. (bez zmiany ilości) — nie wpływa na stan magazynu.` });
  const skipped = lines.filter((l) => l.skip).length;
  if (skipped > 0 && !warnings.some((w) => w.code === 'ksef_correction_no_before')) {
    warnings.push({ code: 'ksef_skipped_lines', text: `Pozycje oznaczone jako pomijane (transport, rabat, usługa): ${skipped}. Sprawdź, czy któraś nie jest towarem.` });
  }

  return {
    ok: true,
    form: system || 'FA',
    payload: {
      doc_kind: kind,
      supplier_name: sellerName ? sellerName.slice(0, 160) : null,
      supplier_nip: normalizeNip(text(seller, 'NIP')) || null,
      invoice_number: invoiceNumber.slice(0, 256),
      issue_date: normalizeDate(text(fa, 'P_1'), today),
      currency,
      total_net: totalNet,
      total_gross: gross === null ? null : round2(gross),
      ai_warnings: warnings.slice(0, 10),
      lines,
    },
  };
}

const KIND_BY_META_TYPE: Record<string, KsefInvoicePayload['doc_kind']> = {
  Vat: 'invoice', Roz: 'invoice', Upr: 'invoice', VatPef: 'invoice', VatPefSp: 'invoice', VatRr: 'invoice',
  Zal: 'other', Kor: 'correction', KorZal: 'correction', KorRoz: 'correction', KorPef: 'correction', KorVatRr: 'correction',
};

/** Awaryjny zapis: sam nagłówek z listy metadanych KSeF (gdy XML jest w nieobsługiwanym formacie lub uszkodzony). */
export function headerOnlyPayload(meta: KsefInvoiceMeta, reason: string, today: Date = new Date()): KsefInvoicePayload {
  return {
    doc_kind: KIND_BY_META_TYPE[meta.invoiceType] ?? 'invoice',
    supplier_name: meta.seller.name ? meta.seller.name.slice(0, 160) : null,
    supplier_nip: normalizeNip(meta.seller.nip) || null,
    invoice_number: meta.invoiceNumber ? meta.invoiceNumber.slice(0, 256) : null,
    issue_date: normalizeDate(meta.issueDate, today),
    currency: (meta.currency || 'PLN').toUpperCase().slice(0, 3),
    total_net: Number.isFinite(meta.netAmount) ? round2(meta.netAmount) : null,
    total_gross: Number.isFinite(meta.grossAmount) ? round2(meta.grossAmount) : null,
    ai_warnings: [{ code: 'ksef_header_only', text: reason }],
    lines: [],
  };
}
