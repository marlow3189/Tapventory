// Szablony HTML dokumentów zestawu ewaluacyjnego. Każdy układ zwraca listę stron (HTML) —
// generate.mjs robi z nich zdjęcia (PNG/JPEG) lub PDF przeglądarką Chromium (Playwright).

import { NON_DOCUMENT_HTML, type EvalCase, type PrintLine } from './cases.ts';

export type NumberStyle = EvalCase['numberStyle'];

export function fmtNum(n: number, style: NumberStyle, decimals = 2): string {
  const [i, f] = Math.abs(n).toFixed(decimals).split('.');
  const grouped = style === 'plain-comma' ? i : i.replace(/\B(?=(\d{3})+(?!\d))/g, style === 'space-comma' ? ' ' : '.');
  return `${n < 0 ? '-' : ''}${grouped}${f === undefined ? '' : `,${f}`}`;
}
const qtyText = (q: number, style: NumberStyle) => (Number.isInteger(q) ? fmtNum(q, style, 0) : fmtNum(q, style, 2));

const MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
export function fmtDate(iso: string, style: EvalCase['dateStyle']): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (style === 'iso') return iso;
  if (style === 'long-pl') return `${d} ${MONTHS[m - 1]} ${y} r.`;
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface RenderedPage { html: string; width: number; height: number; inner: string; css: string }

const A4 = { width: 794, height: 1123 };

const BASE_CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #444;padding:5px 6px;font-size:12px;vertical-align:top}
th{background:#eee;font-weight:700;text-align:center}
td.n{text-align:right;white-space:nowrap}
td.c{text-align:center}
.small{font-size:11px;color:#333}
`;

/** Opakowanie strony w „zdjęcie": tło stołu, przechylenie, perspektywa, ziarno, cień (patrz Degrade w cases.ts). */
function wrap(inner: string, css: string, c: EvalCase, size: { width: number; height: number }): RenderedPage {
  const d = c.degrade;
  const photo = Boolean(d.rotate || d.perspective || d.shadow);
  const filters = [d.blur ? `blur(${d.blur}px)` : '', d.grayscale ? 'grayscale(1) contrast(1.15)' : ''].filter(Boolean).join(' ');
  const noise = d.noise
    ? `<div style="position:absolute;inset:0;pointer-events:none;mix-blend-mode:multiply;opacity:.55;background-image:url(&quot;data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='${c.seed % 50}'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>&quot;)"></div>`
    : '';
  const shadow = d.shadow ? `<div style="position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,rgba(0,0,0,0) 30%,rgba(0,0,0,.42) 100%)"></div>` : '';
  const margin = photo ? 90 : 0;
  const transform = [d.perspective ? 'perspective(1300px) rotateX(9deg) rotateY(-7deg)' : '', d.rotate ? `rotate(${d.rotate}deg)` : ''].filter(Boolean).join(' ');
  const W = size.width + margin * 2;
  const H = size.height + margin * 2;
  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>${BASE_CSS}${css}
body{width:${W}px;height:${H}px;overflow:hidden;position:relative;${photo ? 'background:radial-gradient(circle at 30% 20%,#7a644d,#3f3328);' : ''}}
.sheet{position:absolute;left:${margin}px;top:${margin}px;width:${size.width}px;height:${size.height}px;background:#fff;overflow:hidden;${photo ? 'box-shadow:0 10px 40px rgba(0,0,0,.55);' : ''}transform-origin:center;${transform ? `transform:${transform};` : ''}${filters ? `filter:${filters};` : ''}}
</style></head><body><div class="sheet">${inner}${shadow}${noise}</div></body></html>`;
  return { html, width: W, height: H, inner, css };
}

// ---- układy ------------------------------------------------------------------------------------------------
function partyBoxes(c: EvalCase, headingSeller = 'Sprzedawca', headingBuyer = 'Nabywca'): string {
  const nip = `${c.seller.nipPrefix ? c.seller.nipPrefix + ' ' : ''}${c.seller.nip.replace(/^(\d{3})(\d{3})(\d{2})(\d{2})$/, c.seller.nipPrefix ? '$1-$2-$3-$4' : '$1-$2-$3-$4')}`;
  return `<div style="display:flex;gap:14px;margin:12px 0"><div style="flex:1;border:1px solid #444;padding:8px;font-size:12px"><div class="small"><b>${headingSeller}</b></div><b>${esc(c.seller.name)}</b><br>${esc(c.seller.address)}<br>NIP: ${nip}</div>
<div style="flex:1;border:1px solid #444;padding:8px;font-size:12px"><div class="small"><b>${headingBuyer}</b></div><b>${esc(c.buyer.name)}</b><br>${esc(c.buyer.address)}<br>NIP: ${c.buyer.nip.replace(/^(\d{3})(\d{3})(\d{2})(\d{2})$/, '$1-$2-$3-$4')}</div></div>`;
}

function vatSummary(c: EvalCase): string {
  const groups = new Map<string, { net: number; vat: number; gross: number }>();
  for (const l of c.printLines) {
    const key = l.vat_rate === null ? 'zw' : `${l.vat_rate}%`;
    const g = groups.get(key) ?? { net: 0, vat: 0, gross: 0 };
    g.net += l.total_net ?? 0;
    groups.set(key, g);
  }
  let netSum = 0;
  let vatSum = 0;
  const rows = [...groups.entries()].map(([k, g]) => {
    const rate = k === 'zw' ? 0 : Number(k.replace('%', ''));
    const net = Math.round(g.net * 100) / 100;
    const vat = Math.round(net * rate) / 100;
    netSum += net;
    vatSum += vat;
    return `<tr><td class="c">${k}</td><td class="n">${fmtNum(net, c.numberStyle)}</td><td class="n">${fmtNum(vat, c.numberStyle)}</td><td class="n">${fmtNum(net + vat, c.numberStyle)}</td></tr>`;
  });
  const total = Math.round((netSum + vatSum) * 100) / 100;
  return `<div style="display:flex;justify-content:flex-end;margin-top:14px"><table style="width:55%"><tr><th>Stawka VAT</th><th>Wartość netto</th><th>Kwota VAT</th><th>Wartość brutto</th></tr>${rows.join('')}
<tr><td class="c"><b>Razem</b></td><td class="n"><b>${fmtNum(netSum, c.numberStyle)}</b></td><td class="n"><b>${fmtNum(vatSum, c.numberStyle)}</b></td><td class="n"><b>${fmtNum(total, c.numberStyle)}</b></td></tr></table></div>
<div style="text-align:right;margin-top:10px;font-size:16px"><b>Do zapłaty: ${fmtNum(total, c.numberStyle)} ${c.currency === 'PLN' ? 'zł' : c.currency}</b></div>
<div class="small" style="margin-top:8px">Forma płatności: przelew · Nr rachunku: ${c.seller.bank}</div>`;
}

const noteBlock = (c: EvalCase) => (c.extraNote ? `<div style="margin-top:22px;border-top:1px dashed #777;padding-top:8px;font-size:12px"><b>Uwagi:</b> ${esc(c.extraNote)}</div>` : '');
const signature = `<div style="display:flex;justify-content:space-between;margin-top:46px;font-size:11px;color:#444"><div style="border-top:1px solid #444;width:38%;padding-top:4px;text-align:center">Osoba upoważniona do wystawienia</div><div style="border-top:1px solid #444;width:38%;padding-top:4px;text-align:center">Osoba upoważniona do odbioru</div></div>`;

function chunk<T>(xs: T[], pages: number): T[][] {
  const per = Math.ceil(xs.length / pages);
  return Array.from({ length: pages }, (_v, i) => xs.slice(i * per, (i + 1) * per));
}

function classicTable(c: EvalCase, lines: PrintLine[], offset: number, compact: boolean): string {
  const s = c.numberStyle;
  const disc = c.discountMode;
  const head = `<tr><th>Lp.</th><th style="width:34%">Nazwa towaru lub usługi</th><th>Jm.</th><th>Ilość</th>${disc === 'none' ? '<th>Cena netto</th>' : `<th>Cena katalogowa</th><th>Rabat %</th>${disc === 'after' ? '<th>Cena netto po rabacie</th>' : ''}`}<th>Wartość netto</th><th>VAT</th><th>Kwota VAT</th><th>Wartość brutto</th></tr>`;
  const rows = lines.map((l, i) => {
    const vat = l.vat_rate === null ? 'zw' : `${l.vat_rate}%`;
    const vatAmt = Math.round((l.total_net ?? 0) * (l.vat_rate ?? 0)) / 100;
    const ean = c.showEan && l.ean ? `<div class="small">EAN: ${l.ean}</div>` : '';
    const price = disc === 'none'
      ? `<td class="n">${fmtNum(l.unit_price_net ?? 0, s)}</td>`
      : `<td class="n">${fmtNum(l.list_price ?? l.unit_price_net ?? 0, s)}</td><td class="c">${l.discount_pct ?? 0}%</td>${disc === 'after' ? `<td class="n">${fmtNum(l.unit_price_net ?? 0, s)}</td>` : ''}`;
    return `<tr><td class="c">${offset + i + 1}</td><td>${esc(l.name)}${ean}</td><td class="c">${esc(l.unit ?? '')}</td><td class="n">${qtyText(l.qty, s)}</td>${price}<td class="n">${fmtNum(l.total_net ?? 0, s)}</td><td class="c">${vat}</td><td class="n">${fmtNum(vatAmt, s)}</td><td class="n">${fmtNum((l.total_net ?? 0) + vatAmt, s)}</td></tr>`;
  });
  return `<table style="${compact ? 'font-size:10px' : ''}">${head}${rows.join('')}</table>`;
}

function classicPages(c: EvalCase, compact: boolean): RenderedPage[] {
  const parts = chunk(c.printLines, c.pages);
  const css = compact ? 'th,td{font-size:10px!important;padding:3px 4px!important}h1{font-size:20px!important}' : '';
  let offset = 0;
  return parts.map((lines, pi) => {
    const last = pi === parts.length - 1;
    const head = pi === 0
      ? `<div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h1 style="margin:0;font-size:28px">Faktura VAT</h1><div style="font-size:16px;margin-top:4px">Nr ${esc(c.invoiceNumber)}</div></div>
<div style="font-size:12px;text-align:right;line-height:1.6">Data wystawienia: <b>${fmtDate(c.issueDate, c.dateStyle)}</b><br>Data sprzedaży: ${fmtDate(c.issueDate, c.dateStyle)}<br>Termin płatności: ${fmtDate(addDays(c.issueDate, 14), c.dateStyle)}</div></div>${partyBoxes(c)}`
      : `<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:10px"><b>Faktura VAT Nr ${esc(c.invoiceNumber)}</b><span>${esc(c.seller.name)}</span></div>`;
    const table = classicTable(c, lines, offset, compact);
    offset += lines.length;
    const foot = last ? `${vatSummary(c)}${noteBlock(c)}${signature}` : '<div class="small" style="margin-top:12px;text-align:right">c.d.n.</div>';
    const inner = `<div style="padding:42px 44px">${head}${table}${foot}<div class="small" style="position:absolute;bottom:20px;right:44px">Strona ${pi + 1}/${parts.length}</div></div>`;
    return wrap(inner, css, c, A4);
  });
}

function modernPages(c: EvalCase): RenderedPage[] {
  const s = c.numberStyle;
  const css = `.band{background:#1f3a5f;color:#fff;padding:26px 44px}.band h1{margin:0;font-size:30px;letter-spacing:1px}
.pr td,.pr th{border:none;border-bottom:1px solid #d5d9e0;padding:8px 6px}.pr th{background:#f1f4f9;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px}`;
  const parts = chunk(c.printLines, c.pages);
  let offset = 0;
  return parts.map((lines, pi) => {
    const last = pi === parts.length - 1;
    const disc = c.discountMode;
    const rows = lines.map((l) => {
      const sub = [l.sku ? `SKU: ${l.sku}` : '', c.showEan && l.ean ? `EAN: ${l.ean}` : ''].filter(Boolean).join(' · ');
      const vat = l.vat_rate === null ? 'zw' : `${l.vat_rate}%`;
      const vatAmt = Math.round((l.total_net ?? 0) * (l.vat_rate ?? 0)) / 100;
      const price = disc === 'none'
        ? `<td class="n">${fmtNum(l.unit_price_net ?? 0, s)}</td>`
        : `<td class="n">${fmtNum(l.list_price ?? l.unit_price_net ?? 0, s)}</td><td class="c">-${l.discount_pct ?? 0}%</td>${disc === 'after' ? `<td class="n">${fmtNum(l.unit_price_net ?? 0, s)}</td>` : ''}`;
      offset++;
      return `<tr><td><div><b>${esc(l.name)}</b></div>${sub ? `<div class="small" style="color:#667">${sub}</div>` : ''}</td><td class="n">${qtyText(l.qty, s)} ${esc(l.unit ?? '')}</td>${price}<td class="c">${vat}</td><td class="n">${fmtNum(l.total_net ?? 0, s)}</td><td class="n">${fmtNum((l.total_net ?? 0) + vatAmt, s)}</td></tr>`;
    });
    const head = pi === 0
      ? `<div class="band"><h1>FAKTURA</h1><div style="margin-top:6px;font-size:14px;opacity:.9">${esc(c.invoiceNumber)} · wystawiona ${fmtDate(c.issueDate, c.dateStyle)}</div></div><div style="padding:0 44px">${partyBoxes(c, 'Sprzedawca', 'Nabywca')}</div>`
      : `<div class="band" style="padding:12px 44px"><b>FAKTURA ${esc(c.invoiceNumber)}</b></div>`;
    const table = `<div style="padding:0 44px"><table class="pr"><tr><th>Produkt</th><th>Ilość</th>${disc === 'none' ? '<th>Cena netto</th>' : `<th>Cena kat.</th><th>Rabat</th>${disc === 'after' ? '<th>Cena po rabacie</th>' : ''}`}<th>VAT</th><th>Netto</th><th>Brutto</th></tr>${rows.join('')}</table></div>`;
    const foot = last ? `<div style="padding:0 44px 30px">${vatSummary(c)}${noteBlock(c)}</div>` : '<div class="small" style="padding:10px 44px;text-align:right">ciąg dalszy na następnej stronie</div>';
    return wrap(`${head}${table}${foot}<div class="small" style="position:absolute;bottom:18px;right:44px">${pi + 1}/${parts.length}</div>`, css, c, A4);
  });
}

function receiptPages(c: EvalCase): RenderedPage[] {
  const s = c.numberStyle;
  const css = `.rc{font-family:"Courier New",monospace;font-size:14px;line-height:1.35;padding:18px 16px;width:380px}.rc hr{border:none;border-top:1px dashed #333;margin:8px 0}.rc .r{display:flex;justify-content:space-between}`;
  const nip = c.seller.nip;
  const rows = c.printLines.map((l) => `<div>${esc(l.name.toUpperCase().slice(0, 30))}</div><div class="r"><span>&nbsp;&nbsp;${qtyText(l.qty, s)} x ${fmtNum((l.gross ?? 0) / l.qty, s)}</span><span>${fmtNum(l.gross ?? 0, s)} ${l.letter ?? 'A'}</span></div>`).join('');
  const total = Math.round(c.printLines.reduce((a, l) => a + (l.gross ?? 0), 0) * 100) / 100;
  const groups = [...new Set(c.printLines.map((l) => l.letter ?? 'A'))].sort();
  const rate = (letter: string) => (letter === 'A' ? 23 : letter === 'B' ? 8 : letter === 'C' ? 5 : 0);
  const ptu = groups.map((g) => {
    const gross = c.printLines.filter((l) => (l.letter ?? 'A') === g).reduce((a, l) => a + (l.gross ?? 0), 0);
    const vat = Math.round((gross - gross / (1 + rate(g) / 100)) * 100) / 100;
    return `<div class="r"><span>Sprzedaż opod. ${g} ${rate(g)}%</span><span>${fmtNum(gross, s)}</span></div><div class="r"><span>Kwota PTU ${g}</span><span>${fmtNum(vat, s)}</span></div>`;
  }).join('');
  const inner = `<div class="rc"><div style="text-align:center"><b>${esc(c.seller.name)}</b><br>${esc(c.seller.address)}<br>NIP ${nip}</div><hr><div style="text-align:center"><b>PARAGON FISKALNY</b></div><div class="r"><span>${fmtDate(c.issueDate, 'dotted')} 14:32</span><span>Nr 00${(c.seed % 900) + 100}</span></div><hr>${rows}<hr>${ptu}<hr><div class="r" style="font-size:18px"><b>SUMA PLN</b><b>${fmtNum(total, s)}</b></div><div class="r"><span>GOTÓWKA</span><span>${fmtNum(Math.ceil(total / 10) * 10, s)}</span></div><div class="r"><span>RESZTA</span><span>${fmtNum(Math.ceil(total / 10) * 10 - total, s)}</span></div><hr><div style="text-align:center;font-size:12px">Kasjer: Ewa · Kasa 2<br>DZIĘKUJEMY ZA ZAKUPY<br>${c.seed % 7}B${String(c.seed * 977).slice(0, 8)}</div></div>`;
  return [wrap(inner, css, c, { width: 380, height: 540 + c.printLines.length * 44 })];
}

function deliveryPages(c: EvalCase): RenderedPage[] {
  const s = c.numberStyle;
  const rows = c.printLines.map((l, i) => `<tr><td class="c">${i + 1}</td><td>${esc(l.name)}</td><td class="c">${esc(l.unit ?? '')}</td><td class="n">${qtyText(l.qty, s)}</td><td>${l.ean ?? ''}</td></tr>`).join('');
  const inner = `<div style="padding:42px 44px"><h1 style="margin:0;font-size:26px">Wydanie zewnętrzne WZ</h1><div style="margin-top:4px;font-size:15px">Nr WZ ${esc(c.invoiceNumber.replace(/^(FV|FS|FA)/, 'WZ'))} · ${fmtDate(c.issueDate, c.dateStyle)}</div>${partyBoxes(c, 'Wydający', 'Odbiorca')}
<table><tr><th>Lp.</th><th style="width:48%">Nazwa towaru</th><th>Jm.</th><th>Ilość</th><th>Kod EAN</th></tr>${rows}</table>${noteBlock(c)}${signature}</div>`;
  return [wrap(inner, '', c, A4)];
}

function correctionPages(c: EvalCase): RenderedPage[] {
  const s = c.numberStyle;
  const rows = c.printLines.map((l, i) => {
    const vat = l.vat_rate === null ? 'zw' : `${l.vat_rate}%`;
    const b = l.before as { qty: number; net: number };
    const a = l.after as { qty: number; net: number };
    return `<tr><td class="c" rowspan="2">${i + 1}</td><td rowspan="2">${esc(l.name)}</td><td class="c" rowspan="2">${esc(l.unit ?? '')}</td><td class="c"><i>przed korektą</i></td><td class="n">${qtyText(b.qty, s)}</td><td class="n">${fmtNum(l.unit_price_net ?? 0, s)}</td><td class="n">${fmtNum(b.net, s)}</td><td class="c">${vat}</td></tr>
<tr><td class="c"><b>po korekcie</b></td><td class="n">${qtyText(a.qty, s)}</td><td class="n">${fmtNum(l.unit_price_net ?? 0, s)}</td><td class="n">${fmtNum(a.net, s)}</td><td class="c">${vat}</td></tr>`;
  }).join('');
  const diffNet = Math.round(c.printLines.reduce((acc, l) => acc + ((l.after as { net: number }).net - (l.before as { net: number }).net), 0) * 100) / 100;
  const diffGross = Math.round(c.printLines.reduce((acc, l) => acc + ((l.after as { net: number }).net - (l.before as { net: number }).net) * (1 + (l.vat_rate ?? 0) / 100), 0) * 100) / 100;
  const inner = `<div style="padding:42px 44px"><h1 style="margin:0;font-size:26px">Faktura korygująca</h1><div style="margin-top:4px;font-size:15px">Nr ${esc(c.invoiceNumber)} · z dnia ${fmtDate(c.issueDate, c.dateStyle)}</div><div class="small" style="margin-top:4px">Korekta do faktury nr FV/2026/09/${(c.seed % 800) + 100}. Przyczyna korekty: zwrot towaru.</div>${partyBoxes(c)}
<table><tr><th>Lp.</th><th style="width:36%">Nazwa towaru</th><th>Jm.</th><th>Stan</th><th>Ilość</th><th>Cena netto</th><th>Wartość netto</th><th>VAT</th></tr>${rows}</table>
<div style="text-align:right;margin-top:14px;font-size:13px">Razem różnica netto: <b>${fmtNum(diffNet, s)}</b><br>Razem różnica brutto: <b>${fmtNum(diffGross, s)}</b></div><div style="text-align:right;margin-top:10px;font-size:16px"><b>Do zwrotu: ${fmtNum(Math.abs(diffGross), s)} zł</b></div>${noteBlock(c)}${signature}</div>`;
  return [wrap(inner, '', c, A4)];
}

export function renderPages(c: EvalCase): RenderedPage[] {
  if (c.id === 'non-document') return [wrap(NON_DOCUMENT_HTML, '', c, A4)];
  switch (c.layout) {
    case 'modern': return modernPages(c);
    case 'compact': return classicPages(c, true);
    case 'receipt': return receiptPages(c);
    case 'delivery': return deliveryPages(c);
    case 'correction': return correctionPages(c);
    default: return classicPages(c, false);
  }
}

/** Jeden dokument HTML z wieloma stronami do wydruku na PDF (każda strona = osobna kartka). */
export function pdfHtml(pages: RenderedPage[]): string {
  const css = [...new Set(pages.map((p) => p.css))].join('\n');
  const w = A4.width;
  const h = A4.height;
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>@page{size:${w}px ${h}px;margin:0}${BASE_CSS}${css}
body{margin:0}.sheet{position:relative;width:${w}px;height:${h}px;overflow:hidden;break-after:page;page-break-after:always}</style></head><body>${pages.map((p) => `<div class="sheet">${p.inner}</div>`).join('')}</body></html>`;
}
