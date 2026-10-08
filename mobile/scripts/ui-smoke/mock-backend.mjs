// ============================================================================
// Atrapa backendu Supabase dla testów interfejsu w przeglądarce (Playwright).
// ============================================================================
// Dla juniora: w tym teście NIE potrzebujesz Dockera ani prawdziwej bazy. Przeglądarka
// otwiera zbudowaną aplikację, a wszystkie zapytania do "Supabase" przechwytuje ten plik
// i odpowiada przykładowymi danymi (firma, produkty, zgłoszenia, faktura...).
// Dzięki temu sprawdzamy, czy ekrany się rysują i nie wywalają — bez zależności od sieci.
// To NIE zastępuje testów bazy (npm run db:test) ani prób na prawdziwym Supabase.
// ============================================================================

export const SUPABASE_ORIGIN = 'http://127.0.0.1:54321';
export const IDS = {
  user: '11111111-1111-4111-8111-111111111111',
  tenant: '22222222-2222-4222-8222-222222222222',
  supplier: '33333333-3333-4333-8333-333333333333',
  doc: '44444444-4444-4444-8444-444444444444',
  docPosted: '44444444-4444-4444-8444-444444444445',
  docProcessing: '44444444-4444-4444-8444-444444444446',
  req1: '55555555-5555-4555-8555-555555555551',
  req2: '55555555-5555-4555-8555-555555555552',
  req3: '55555555-5555-4555-8555-555555555553',
};
const pid = (n) => `66666666-6666-4666-8666-66666666666${n}`;

const iso = (minAgo) => new Date(Date.now() - minAgo * 60_000).toISOString();

/** Niepodpisany token JWT — klient Supabase nie weryfikuje podpisu, sprawdza tylko termin ważności. */
export function fakeJwt(role = 'authenticated') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: IDS.user, email: 'anna@warsztat.pl', role, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  })}.signature`;
}

export function sessionPayload() {
  const access = fakeJwt();
  return {
    access_token: access,
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: 7 * 24 * 3600,
    expires_at: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    user: {
      id: IDS.user, aud: 'authenticated', role: 'authenticated', email: 'anna@warsztat.pl',
      user_metadata: { display_name: 'Anna Kowalska' }, app_metadata: {}, created_at: iso(10000),
    },
  };
}

const product = (n, name, unit, stock, min, extra = {}) => ({
  id: pid(n), tenant_id: IDS.tenant, name, ean: null, unit, pack_size: 1, min_stock: min, photo_path: null, active: true,
  default_supplier_id: null, default_supplier_name: null, stock, below_min: Number(stock) < Number(min),
  last_movement_at: iso(90), created_at: iso(5000), ...extra,
});

export function buildData(role = 'owner') {
  const products = [
    product(1, 'Rękawice nitrylowe L', 'op.', 2, 5, { ean: '5901234123457', default_supplier_id: IDS.supplier, default_supplier_name: 'Hurtownia ABC' }),
    product(2, 'Płyn do szyb 5 l', 'szt.', 1, 3),
    product(3, 'Filtr oleju Bosch', 'szt.', 14, 4, { ean: '4047024120112' }),
    product(4, 'Szmatki z mikrofibry', 'szt.', 40, 20),
    product(5, 'Olej silnikowy 5W30 1 l', 'l', 36, 12),
    product(6, 'Taśma malarska 50 mm', 'szt.', 8, 5),
  ];
  const mkReq = (id, status, o) => ({
    id, tenant_id: IDS.tenant, status, qty: 3, note: null, free_name: null, photo_path: null, created_at: iso(60), updated_at: iso(30),
    accepted_at: null, ordered_at: null, delivered_at: null, received_at: null, reporter_id: '77777777-7777-4777-8777-777777777777',
    reporter_name: 'Marek Nowak', reporter_deleted: false, product_id: null, product_name: null, product_unit: null,
    product_photo_path: null, project_id: null, project_name: null, supplier_id: null, supplier_name: null, message_count: 0,
    last_message_at: null, vote_count: 0, voted_by_me: false, ...o,
  });
  const requests = [
    mkReq(IDS.req1, 'reported', { product_id: pid(1), product_name: 'Rękawice nitrylowe L', product_unit: 'op.', qty: 4, note: 'Kończą się, bierzemy czarne.', vote_count: 2, message_count: 2, created_at: iso(25) }),
    mkReq(IDS.req2, 'ordered', { free_name: 'Lakier bezbarwny w sprayu', qty: 2, ordered_at: iso(200), accepted_at: iso(300), reporter_id: IDS.user, reporter_name: 'Anna Kowalska', supplier_name: 'Hurtownia ABC', created_at: iso(600) }),
    mkReq(IDS.req3, 'delivered', { product_id: pid(2), product_name: 'Płyn do szyb 5 l', product_unit: 'szt.', qty: 6, delivered_at: iso(40), ordered_at: iso(400), accepted_at: iso(500), created_at: iso(900), project_name: 'Audi A4 WX 1234' }),
  ];
  const team = [
    { membership_id: 'm1', user_id: IDS.user, role, can_manage_managers: false, can_manage_billing: false, display_name: 'Anna Kowalska', email: 'anna@warsztat.pl', created_at: iso(9000) },
    { membership_id: 'm2', user_id: '77777777-7777-4777-8777-777777777777', role: 'employee', can_manage_managers: false, can_manage_billing: false, display_name: 'Marek Nowak', email: 'marek@warsztat.pl', created_at: iso(8000) },
  ];
  const docLines = [
    { id: 'l1', document_id: IDS.doc, line_no: 1, raw_name: 'RĘKAWICE NITRYL. L A100', qty: 3, unit: 'op.', unit_price_net: 24.5, total_net: 73.5, vat_rate: 23, ean: null, product_id: pid(1), match_confidence: 92, ai_confidence: 96, skip: false, project_id: null },
    { id: 'l2', document_id: IDS.doc, line_no: 2, raw_name: 'Płyn do szyb zimowy 5L', qty: 4, unit: 'szt.', unit_price_net: 18, total_net: 72, vat_rate: 23, ean: null, product_id: null, match_confidence: null, ai_confidence: 88, skip: false, project_id: null },
    { id: 'l3', document_id: IDS.doc, line_no: 3, raw_name: 'Transport', qty: 1, unit: 'usł.', unit_price_net: 15, total_net: 15, vat_rate: 23, ean: null, product_id: null, match_confidence: null, ai_confidence: 54, skip: true, project_id: null },
  ];
  const mkDoc = (id, status, o) => ({
    id, tenant_id: IDS.tenant, source: 'photo', status, doc_kind: 'invoice', supplier_id: IDS.supplier, supplier_name: 'Hurtownia ABC Sp. z o.o.',
    supplier_nip: '5260250995', invoice_number: 'FV/2026/10/0451', issue_date: '2026-10-05', currency: 'PLN', total_net: 160.5, total_gross: 197.42,
    file_paths: [`${IDS.tenant}/documents/${id}/page-1.jpg`], page_count: 1, error_message: null, ai_model: 'claude-haiku-5-5', ai_confidence: 91,
    ai_warnings: [{ code: 'low_conf', text: 'Pozycja „Transport” odczytana z małą pewnością.' }], revision: 1, created_by_name: 'Anna Kowalska',
    posted_at: null, created_at: iso(30), line_count: 3, unmatched_count: 1, ...o,
  });
  const documents = [
    mkDoc(IDS.doc, 'draft', {}),
    mkDoc(IDS.docPosted, 'posted', { invoice_number: 'FV/2026/09/0388', supplier_name: 'Auto-Części Kowalski', posted_at: iso(3000), unmatched_count: 0, created_at: iso(3100) }),
    mkDoc(IDS.docProcessing, 'processing', { supplier_name: null, invoice_number: null, line_count: 0, unmatched_count: 0, created_at: iso(1) }),
  ];
  const notifications = [
    { id: 'n1', kind: 'low_stock', title: 'Płyn do szyb 5 l: poniżej minimum', body: 'Zostało 1 szt., minimum 3.', data: { product_id: pid(2) }, read_at: null, created_at: iso(15) },
    { id: 'n2', kind: 'request_new', title: 'Nowe zgłoszenie od Marek Nowak', body: 'Rękawice nitrylowe L — 4 op.', data: { request_id: IDS.req1 }, read_at: null, created_at: iso(25) },
    { id: 'n3', kind: 'document_ready', title: 'Faktura gotowa do sprawdzenia', body: 'Hurtownia ABC — FV/2026/10/0451', data: { document_id: IDS.doc }, read_at: iso(5), created_at: iso(70) },
  ];
  const dashboard = {
    role, plan: 'team', trial_days_left: 12, products_total: products.length, below_min: products.filter((p) => p.below_min).length,
    below_min_top: products.filter((p) => p.below_min).map((p) => ({ id: p.id, name: p.name, unit: p.unit, stock: p.stock, min_stock: p.min_stock, photo_path: null })),
    requests_open: 3, requests_to_accept: 1, requests_to_confirm: 1, requests_mine_open: 1, documents_to_verify: 1, documents_processing: 1, documents_failed: 0,
    count_stale: 6, count_batch_size: 5, count_frequency: 'weekly', unread_notifications: 2,
  };
  return {
    memberships: [{ id: 'm1', tenant_id: IDS.tenant, role, can_manage_managers: false, can_manage_billing: role === 'owner', tenants: { id: IDS.tenant, name: 'Warsztat u Marka', nip: '5260250995', plan: 'team' } }],
    product_overview: products,
    request_feed: requests,
    request_message_feed: [
      { id: 'c1', request_id: IDS.req1, author_id: '77777777-7777-4777-8777-777777777777', author_name: 'Marek Nowak', author_deleted: false, body: 'Wziąłbym czarne, są mocniejsze.', created_at: iso(20) },
      { id: 'c2', request_id: IDS.req1, author_id: IDS.user, author_name: 'Anna Kowalska', author_deleted: false, body: 'OK, zamówię w poniedziałek.', created_at: iso(10) },
    ],
    request_event_feed: [{ id: 1, request_id: IDS.req1, from_status: null, to_status: 'reported', actor_name: 'Marek Nowak', created_at: iso(25) }],
    movement_feed: [
      { id: 'mv1', product_id: pid(1), product_name: 'Rękawice nitrylowe L', product_unit: 'op.', movement_type: 'issue', qty: -1, reason: 'use', note: null, author_name: 'Marek Nowak', author_deleted: false, created_at: iso(120) },
      { id: 'mv2', product_id: pid(1), product_name: 'Rękawice nitrylowe L', product_unit: 'op.', movement_type: 'receipt', qty: 5, reason: null, note: 'Faktura FV/2026/09/0388', author_name: 'Anna Kowalska', author_deleted: false, created_at: iso(3000) },
    ],
    notifications,
    document_overview: documents,
    document_lines: docLines,
    team_members: team,
    team_invites: [{ id: 'i1', email: 'ewa@warsztat.pl', role: 'employee', status: 'pending', expires_at: iso(-60 * 24 * 5), invited_by_name: 'Anna Kowalska' }],
    suppliers: [{ id: IDS.supplier, name: 'Hurtownia ABC', nip: '5260250995' }],
    projects: [{ id: 'pr1', name: 'Audi A4 WX 1234', ref_number: 'WX 1234', type: 'vehicle', status: 'open' }],
    tenant_settings: [{ tenant_id: IDS.tenant, count_frequency: 'weekly', count_batch_size: 5, count_question_cap: 2, count_stale_days: 30, low_stock_push: true }],
    rpc: {
      dashboard_summary: dashboard,
      next_count_candidates: products.slice(0, 3).map((p) => ({ product_id: p.id, name: p.name, unit: p.unit, photo_path: null, expected_qty: p.stock, last_counted_at: null })),
      ai_quota: { plan: 'team', limit: 150, used: 12, remaining: 138, resets_at: new Date(Date.now() + 20 * 86400_000).toISOString() },
      should_ask_count: false,
      record_stock_check: { expected: 2, counted: 3, diff: 1, movement_id: 'mv9', repeated: false },
      post_document: 2,
      match_products: [],
    },
  };
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-expose-headers': '*',
};

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SVG_PHOTO = (label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6e4f0"/><stop offset="1" stop-color="#8fb3d9"/></linearGradient></defs><rect width="800" height="800" fill="url(#g)"/><text x="400" y="420" font-size="56" text-anchor="middle" fill="#27425f" font-family="sans-serif">${label}</text></svg>`;

/** Instaluje przechwytywanie żądań Supabase na stronie. `calls` zbiera wywołane adresy (do asercji). */
export async function installMock(page, { role = 'owner', calls = [], overrides = {} } = {}) {
  const data = buildData(role);
  Object.assign(data.rpc, overrides.rpc ?? {});

  await page.route(`${SUPABASE_ORIGIN}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();
    calls.push(`${method} ${p}${url.search ? '?…' : ''}`);

    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const json = (body, status = 200) =>
      route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });

    if (p.startsWith('/auth/v1/token')) return json(sessionPayload());
    if (p.startsWith('/auth/v1/user')) return json(sessionPayload().user);
    if (p.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204, headers: CORS });
    if (p.startsWith('/auth/v1/')) return json({});

    if (p.startsWith('/storage/v1/object/sign/')) {
      return json({ signedURL: `${p.replace('/storage/v1', '')}?token=fake` });
    }
    if (p.startsWith('/storage/v1/object/')) {
      if (method === 'POST') return json({ Key: 'ok' });
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/svg+xml' }, body: SVG_PHOTO('zdjęcie') });
    }

    if (p.startsWith('/functions/v1/')) {
      if (p.endsWith('/assistant')) return json({ reply: 'Aby zdjąć towar, otwórz produkt i dotknij „Zdejmij”. Możesz też zeskanować kod kreskowy.' });
      if (p.endsWith('/barcode-lookup')) return json({ found: true, name: 'Mleko UHT 3,2% 1 l' });
      return json({ ok: true });
    }

    if (p.startsWith('/rest/v1/rpc/')) {
      const name = p.replace('/rest/v1/rpc/', '');
      const val = data.rpc[name];
      return json(val === undefined ? null : val);
    }

    if (p.startsWith('/rest/v1/')) {
      const table = p.replace('/rest/v1/', '');
      if (method !== 'GET') {
        if (req.headers()['prefer']?.includes('return=representation')) return json([], 201);
        return route.fulfill({ status: 204, headers: CORS });
      }
      let rows = data[table];
      if (!rows) return json([]);
      for (const [k, v] of url.searchParams) {
        if (typeof v === 'string' && v.startsWith('eq.') && !['tenant_id', 'status', 'active', 'user_id'].includes(k)) {
          const want = v.slice(3);
          rows = rows.filter((r) => String(r[k]) === want);
        }
      }
      const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      if (single) return rows[0] ? json(rows[0]) : json({ code: 'PGRST116', message: 'no rows', details: null, hint: null }, 406);
      return json(rows);
    }

    return route.fulfill({ status: 404, headers: CORS, body: 'not mocked' });
  });

  // Realtime (WebSocket): przyjmujemy połączenie i odpowiadamy na „dołączenie do kanału", żeby nie spamować błędami.
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((raw) => {
      try {
        const m = JSON.parse(String(raw));
        const obj = Array.isArray(m)
          ? { join_ref: m[0], ref: m[1], topic: m[2], event: m[3] }
          : m;
        if (obj.event === 'phx_join' || obj.event === 'heartbeat') {
          const reply = { status: 'ok', response: obj.event === 'phx_join' ? { postgres_changes: [] } : {} };
          ws.send(Array.isArray(m) ? JSON.stringify([obj.join_ref, obj.ref, obj.topic, 'phx_reply', reply]) : JSON.stringify({ topic: obj.topic, event: 'phx_reply', payload: reply, ref: obj.ref }));
        }
      } catch {
        // ignorujemy
      }
    });
  });
  return data;
}

export { PNG_1PX };
