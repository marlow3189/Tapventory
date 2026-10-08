# Kolejka budowy Tapventory

Stan po Kroku 1. Każdy krok kończy się kryterium „działa u Ciebie",
zanim ruszy następny. Numeracja tygodni — jak w dokumencie koncepcyjnym.

- [x] **Krok 1 — Fundament** (tyg. 1–2): schemat bazy + RLS + szkielet
      aplikacji (logowanie, rejestracja, firma, pulpit) + środowiska.
      ✔ Gotowe, gdy: `supabase db reset` czysty i przejście
      rejestracja → firma → pulpit na DEV.
- [ ] **Krok 2 — Zespół**: ekran zespołu, zaproszenia e-mail (RPC
      create_invite/accept_invite już czekają w bazie), role w UI,
      przełącznik wielu firm.
- [ ] **Krok 3 — Produkty i magazyn** (tyg. 3–4): lista/karta produktu,
      skaner EAN (expo-camera), akcja „Zdejmij" w 2 tapnięcia, historia
      ruchów, minima i porządek na pulpicie.
- [ ] **Krok 4 — Zgłoszenia braków + czat** (tyg. 5–6): lista, statusy,
      czat na Realtime (publikacja już włączona w 0002).
- [ ] **Krok 5 — Dokumenty foto + AI** (tyg. 7–9): tryb skanera, kolejka
      zadań, Edge Function z Gemini, ekran weryfikacji zielone/żółte,
      księgowanie do ruchów.
- [ ] **Krok 6 — KSeF** (tyg. 10–12): tydzień prototypu na środowisku
      testowym KSeF, potem pobieranie faktur tokenem klienta.
- [ ] **Krok 7 — Inwentaryzacje + bezpieczeństwo** (tyg. 13): mini-spisy
      cykliczne, TOTP, SMS przy nowym urządzeniu.
- [ ] **Krok 8 — WWW + płatności** (równolegle od tyg. 10): Next.js na
      Vercel, cennik, Stripe, panel właściciela, program poleceń.
- [ ] **Krok 9 — Sklepy** (tyg. 14–16): ikony, zrzuty, polityki,
      TestFlight/testy wewnętrzne, publikacja.

Zadania po Twojej stronie (równolegle, już teraz):
- [ ] wniosek o **D-U-N-S** (dnb.com/pl-pl) — czeka się tygodniami;
- [ ] konto **Apple Developer** (99 USD/rok) i **Google Play Console** (25 USD);
- [ ] rezerwacja domeny, jeśli jeszcze nie masz.
