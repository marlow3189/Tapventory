// ============================================================================
// Minimalny, ŚCISŁY parser XML — do faktur z KSeF.
// ============================================================================
// Dlaczego własny, a nie gotowa biblioteka?
//   * Faktura trafia do nas od DOWOLNEGO sprzedawcy (każdy może wystawić fakturę na nasz NIP),
//     więc treść traktujemy jak dane z internetu. KSeF sprawdza XML względem schematu, ale my
//     i tak nie ufamy: parser odrzuca wszystko, co nie jest zwykłą fakturą.
//   * Odrzucamy DOCTYPE/DTD (podatność XXE i „billion laughs"), instrukcje przetwarzania
//     (KSeF też ich zabrania) i nieznane encje.
//   * Limity: rozmiar, głębokość, liczba elementów — faktura nie ma prawa „zjeść" pamięci funkcji.
//   * Zero zależności: ten sam plik działa w Deno (Supabase) i w Node (testy).
// Uproszczenia: prefiksy przestrzeni nazw są ucinane (`ns:Faktura` → `Faktura`), atrybuty
// xmlns pomijamy; tekst elementów zawierających elementy potomne jest ignorowany przy odczycie.

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlError';
  }
}

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export interface XmlLimits {
  maxChars: number;
  maxDepth: number;
  maxNodes: number;
}

export const DEFAULT_XML_LIMITS: XmlLimits = { maxChars: 4_000_000, maxDepth: 64, maxNodes: 100_000 };

const NAME_START = /[A-Za-z_:À-￿]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-·À-￿]/;
const WS = /\s/;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(raw: string): string {
  if (!raw.includes('&')) return raw;
  // Jedno przejście: każdy „&" musi zaczynać poprawne odwołanie (&amp; &#65; &#x41;), inaczej błąd składni.
  return raw.replace(/&(?:#x([0-9A-Fa-f]{1,6});|#([0-9]{1,7});|([A-Za-z]+);)?/g, (_m, hex?: string, dec?: string, name?: string) => {
    if (hex !== undefined || dec !== undefined) {
      const code = hex !== undefined ? parseInt(hex, 16) : parseInt(dec as string, 10);
      const ok = code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
      if (!ok) throw new XmlError('Niedozwolony znak w XML.');
      return String.fromCodePoint(code);
    }
    if (name !== undefined) {
      const v = NAMED_ENTITIES[name];
      if (v === undefined) throw new XmlError(`Nieznana encja &${name};`);
      return v;
    }
    throw new XmlError('Niepoprawny znak & w XML.');
  });
}

const localName = (qname: string): string => {
  const i = qname.lastIndexOf(':');
  return i >= 0 ? qname.slice(i + 1) : qname;
};

export function parseXml(input: string, limits: Partial<XmlLimits> = {}): XmlNode {
  const lim = { ...DEFAULT_XML_LIMITS, ...limits };
  if (typeof input !== 'string') throw new XmlError('Brak treści XML.');
  if (input.length > lim.maxChars) throw new XmlError('Dokument XML jest zbyt duży.');
  let pos = input.charCodeAt(0) === 0xfeff ? 1 : 0;       // BOM tolerujemy (KSeF go zabrania, ale to nie nasz problem)
  const n = input.length;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let nodes = 0;

  const fail = (msg: string): never => {
    throw new XmlError(`${msg} (pozycja ${pos}).`);
  };

  // deklaracja <?xml ...?> dozwolona wyłącznie na samym początku
  if (input.startsWith('<?xml', pos) && (WS.test(input[pos + 5] ?? '') || input[pos + 5] === '?')) {
    const end = input.indexOf('?>', pos);
    if (end < 0) fail('Niezamknięta deklaracja XML');
    const decl = input.slice(pos, end);
    const enc = /encoding\s*=\s*["']([^"']+)["']/i.exec(decl);
    if (enc && !/^utf-?8$/i.test(enc[1])) fail('Obsługiwane jest wyłącznie kodowanie UTF-8');
    pos = end + 2;
  }

  while (pos < n) {
    const lt = input.indexOf('<', pos);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > pos) {
      const raw = input.slice(pos, textEnd);
      const top = stack[stack.length - 1];
      if (top) {
        top.text += decodeEntities(raw);
      } else if (raw.trim() !== '') {
        fail('Tekst poza głównym elementem');
      }
      pos = textEnd;
    }
    if (lt < 0) break;

    if (input.startsWith('<!--', pos)) {
      const end = input.indexOf('-->', pos + 4);
      if (end < 0) fail('Niezamknięty komentarz');
      pos = end + 3;
    } else if (input.startsWith('<![CDATA[', pos)) {
      const end = input.indexOf(']]>', pos + 9);
      if (end < 0) fail('Niezamknięta sekcja CDATA');
      const top = stack[stack.length - 1];
      if (!top) fail('CDATA poza głównym elementem');
      top!.text += input.slice(pos + 9, end);
      pos = end + 3;
    } else if (input.startsWith('<!', pos)) {
      fail('Deklaracje DOCTYPE/DTD są niedozwolone');
    } else if (input.startsWith('<?', pos)) {
      fail('Instrukcje przetwarzania XML są niedozwolone');
    } else if (input.startsWith('</', pos)) {
      let p = pos + 2;
      const start = p;
      while (p < n && NAME_CHAR.test(input[p])) p++;
      const name = localName(input.slice(start, p));
      while (p < n && WS.test(input[p])) p++;
      if (input[p] !== '>') fail('Niepoprawny znacznik zamykający');
      const open = stack.pop();
      if (!open || open.name !== name) fail(`Znacznik zamykający </${name}> nie pasuje do otwierającego`);
      pos = p + 1;
    } else {
      // znacznik otwierający: <name attr="v" ...> lub <name .../>
      let p = pos + 1;
      if (!NAME_START.test(input[p] ?? '')) fail('Niepoprawna nazwa elementu');
      const start = p;
      while (p < n && NAME_CHAR.test(input[p])) p++;
      const node: XmlNode = { name: localName(input.slice(start, p)), attrs: {}, children: [], text: '' };
      if (++nodes > lim.maxNodes) fail('Zbyt wiele elementów XML');

      for (;;) {
        while (p < n && WS.test(input[p])) p++;
        if (p >= n) fail('Niezamknięty znacznik');
        const ch = input[p];
        if (ch === '>' || ch === '/') break;
        const aStart = p;
        if (!NAME_START.test(ch)) fail('Niepoprawna nazwa atrybutu');
        while (p < n && NAME_CHAR.test(input[p])) p++;
        const aName = input.slice(aStart, p);
        while (p < n && WS.test(input[p])) p++;
        if (input[p] !== '=') fail('Atrybut bez wartości');
        p++;
        while (p < n && WS.test(input[p])) p++;
        const quote = input[p];
        if (quote !== '"' && quote !== "'") fail('Wartość atrybutu musi być w cudzysłowie');
        const vEnd = input.indexOf(quote, p + 1);
        if (vEnd < 0) fail('Niezamknięta wartość atrybutu');
        const aValue = input.slice(p + 1, vEnd);
        if (aValue.includes('<')) fail('Znak < w wartości atrybutu');
        if (aName !== 'xmlns' && !aName.startsWith('xmlns:')) node.attrs[localName(aName)] = decodeEntities(aValue);
        p = vEnd + 1;
      }

      const selfClosing = input[p] === '/';
      if (selfClosing) {
        p++;
        if (input[p] !== '>') fail('Niepoprawne zamknięcie znacznika');
      }
      pos = p + 1;

      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(node);
      else if (root) fail('Dokument ma więcej niż jeden element główny');
      else root = node;

      if (!selfClosing) {
        if (stack.length >= lim.maxDepth) fail('Zbyt głębokie zagnieżdżenie XML');
        stack.push(node);
      }
    }
  }

  if (stack.length > 0) throw new XmlError(`Niezamknięty element <${stack[stack.length - 1].name}>.`);
  if (!root) throw new XmlError('Pusty dokument XML.');
  return root;
}

// --- wygodne odczyty ---------------------------------------------------------

export const child = (node: XmlNode | undefined, name: string): XmlNode | undefined =>
  node?.children.find((c) => c.name === name);

export const childrenOf = (node: XmlNode | undefined, name: string): XmlNode[] =>
  node ? node.children.filter((c) => c.name === name) : [];

/** Tekst elementu na końcu ścieżki (np. text(root, 'Fa', 'P_2')) albo undefined, gdy brak lub pusty. */
export function text(node: XmlNode | undefined, ...path: string[]): string | undefined {
  let cur = node;
  for (const p of path) cur = child(cur, p);
  const t = cur?.text.trim();
  return t ? t : undefined;
}
