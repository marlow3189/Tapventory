// ============================================================================
// Wyciąganie z kodu aplikacji wszystkich wywołań bazy: supabase.from('tabela')… i supabase.rpc('funkcja', {…}).
// ============================================================================
// Dla juniora: aplikacja i baza to dwa osobne światy, które łączą tylko NAZWY (tabel, kolumn, funkcji, argumentów).
// Literówka w nazwie nie wywali kompilacji — wywali się dopiero na telefonie u klienta. Ten moduł czyta kod
// aplikacji kompilatorem TypeScript (AST, nie „regexem") i zbiera, co dokładnie aplikacja prosi bazę o zrobienie.
// Następnie api-contract.test.mjs sprawdza to z prawdziwym schematem bazy.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export function loadTypeScript() {
  for (const candidate of [path.join(here, '../../mobile/node_modules/typescript'), 'typescript']) {
    try {
      return require(candidate);
    } catch {
      /* próbujemy następnej lokalizacji */
    }
  }
  throw new Error('Brak pakietu typescript — uruchom `npm install` w folderze mobile.');
}

function listSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Nazwy właściwości typu (np. Partial<TenantSettings> → klucze pól); null, gdy typ jest zbyt ogólny (Record<string, unknown>, any). */
function typeKeys(ts, checker, node) {
  if (!checker) return null;
  try {
    const type = checker.getApparentType(checker.getTypeAtLocation(node));
    const parts = type.isUnion() ? type.types : [type];
    const names = new Set();
    for (const part of parts) {
      if (part.flags & ts.TypeFlags.Any || part.flags & ts.TypeFlags.Unknown) return null;
      if (checker.getIndexInfosOfType(part).length > 0) return null;
      for (const sym of checker.getPropertiesOfType(part)) names.add(sym.name);
    }
    return names.size > 0 ? [...names] : null;
  } catch {
    return null;
  }
}

/** Argument wywołania → opis: tekst, obiekt (z nazwami kluczy), tablica obiektów albo „inny” (wtedy próbujemy typu z kompilatora). */
function describeArg(ts, node, checker) {
  if (!node) return { kind: 'none' };
  if (ts.isStringLiteralLike(node)) return { kind: 'string', value: node.text };
  if (ts.isObjectLiteralExpression(node)) {
    const keys = [];
    const spreadKeys = [];
    const values = {};   // literalne wartości tekstowe (np. onConflict: 'id')
    let dynamic = false;
    for (const p of node.properties) {
      if (ts.isPropertyAssignment(p) && p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name))) {
        if (ts.isStringLiteralLike(p.initializer)) values[p.name.text] = p.initializer.text;
        else if (p.initializer.kind === ts.SyntaxKind.TrueKeyword) values[p.name.text] = true;
        else if (p.initializer.kind === ts.SyntaxKind.FalseKeyword) values[p.name.text] = false;
      }
      if (ts.isSpreadAssignment(p)) {
        const fromType = typeKeys(ts, checker, p.expression);
        if (fromType) spreadKeys.push(...fromType);
        else dynamic = true;
      } else if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name))) keys.push(p.name.text);
      else dynamic = true;
    }
    return { kind: 'object', keys, spreadKeys, values, dynamic };
  }
  if (ts.isArrayLiteralExpression(node)) return { kind: 'array', items: node.elements.map((e) => describeArg(ts, e, checker)) };
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return describeArg(ts, node.expression, checker);
  const fromType = typeKeys(ts, checker, node);
  return fromType ? { kind: 'typed', keys: fromType } : { kind: 'other' };
}

/** Program TypeScript całej aplikacji (tak jak `tsc`), żeby poznać typy argumentów przekazywanych do bazy. */
function createProgramFor(ts, srcDir) {
  const root = path.join(srcDir, '..');
  const configPath = path.join(root, 'tsconfig.json');
  if (!fs.existsSync(configPath)) return null;
  const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, root);
  const files = parsed.fileNames.filter((f) => f.startsWith(srcDir) && !f.includes(`${path.sep}__tests__${path.sep}`));
  return ts.createProgram({ rootNames: files, options: { ...parsed.options, noEmit: true } });
}

export function extractCalls(srcDir) {
  const ts = loadTypeScript();
  const chains = [];
  const program = createProgramFor(ts, srcDir);
  const checker = program?.getTypeChecker() ?? null;
  for (const file of listSourceFiles(srcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    const sf = program?.getSourceFile(file) ?? ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const consumed = new Set();

    const visit = (node) => {
      if (ts.isCallExpression(node) && !consumed.has(node)) {
        const calls = [];
        let cur = node;
        while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
          consumed.add(cur);
          calls.unshift({ name: cur.expression.name.text, args: cur.arguments.map((a) => describeArg(ts, a, checker)) });
          cur = cur.expression.expression;
        }
        if (ts.isIdentifier(cur) && cur.text === 'supabase' && calls.length > 0 && (calls[0].name === 'from' || calls[0].name === 'rpc')) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          chains.push({ file: path.relative(path.join(srcDir, '..', '..'), file).split(path.sep).join('/'), line: line + 1, calls });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return chains;
}

// ---- składnia parametru select PostgREST: "a, b, rel(x, y), alias:col, rel!inner(*)" -------------------------------
export function parseSelect(input) {
  let i = 0;
  const s = input;
  function parseList(closing) {
    const items = [];
    let token = '';
    const flush = () => {
      const t = token.trim();
      token = '';
      if (t) items.push(t);
    };
    while (i < s.length) {
      const ch = s[i];
      if (ch === ',') { flush(); i += 1; continue; }
      if (ch === ')' ) { if (closing) { flush(); i += 1; return items; } throw new Error('Nieoczekiwany nawias w select'); }
      if (ch === '(') {
        // zagnieżdżony zasób: token (przed nawiasem) to nazwa relacji (z ewentualnym aliasem i wskazówkami)
        i += 1;
        const rel = token.trim();
        token = '';
        const inner = parseList(true);
        items.push({ rel, inner });
        continue;
      }
      token += ch;
      i += 1;
    }
    flush();
    return items;
  }
  return parseList(false);
}

/** „alias:kolumna::typ" → { name: 'kolumna' }; „rel!inner" → { name: 'rel', hints: ['inner'] } */
export function splitSelectItem(raw) {
  let t = raw.trim();
  const castAt = t.indexOf('::');
  if (castAt >= 0) t = t.slice(0, castAt);
  const aliasAt = t.indexOf(':');
  if (aliasAt >= 0) t = t.slice(aliasAt + 1);
  const [name, ...hints] = t.split('!');
  return { name: name.trim(), hints };
}
