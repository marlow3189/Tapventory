# Szablony prawne Tapventory

> ⚠️ **To są WZORY, nie porada prawna.** Napisałem je na podstawie tego, co aplikacja *faktycznie robi* (kod i dokumentacja w tym repozytorium), żeby prawnik miał od czego zacząć.
> **Przed publikacją** daj je do przeglądu prawnikowi (RODO, prawo konsumenckie nie dotyczy — usługa jest dla firm, ale warto potwierdzić), uzupełnij wszystkie pola w nawiasach kwadratowych `[...]` i dostosuj do swojej działalności.

## Po co to jest

Sklepy z aplikacjami **wymagają** publicznych adresów URL:

| Adres zaszyty w aplikacji (`mobile/src/lib/links.ts`) | Dokument | Plik |
|---|---|---|
| `https://tapventory.com/prywatnosc` | Polityka prywatności | [`polityka_prywatnosci.md`](polityka_prywatnosci.md) |
| `https://tapventory.com/regulamin` | Regulamin usługi | [`regulamin.md`](regulamin.md) |
| `https://tapventory.com/usun-konto` | Jak usunąć konto i dane | [`usun_konto.md`](usun_konto.md) |
| — (dla klientów, którzy chcą umowy powierzenia) | Umowa powierzenia przetwarzania danych (art. 28 RODO) | [`umowa_powierzenia.md`](umowa_powierzenia.md) |

Te teksty wklejasz na stronę `tapventory.com` (na razie wystarczy statyczna strona; adresy muszą działać **bez logowania**).

## Co aplikacja naprawdę robi z danymi (stan kodu)

Ta tabela jest źródłem prawdy dla polityki prywatności. **Gdy dodasz SDK analityczne, reklamy, płatności albo nowego dostawcę — zaktualizuj politykę i deklaracje w sklepach** (`docs/12_BUDOWANIE_I_PUBLIKACJA.md`, rozdz. 5.2).

| Dane | Skąd | Gdzie trafiają | Po co | Jak długo |
|---|---|---|---|---|
| e‑mail, imię/nazwa wyświetlana, (opcjonalnie) telefon | rejestracja | Supabase (Auth + baza, region UE‑Frankfurt) | konto, logowanie, podpisy działań | do usunięcia konta |
| dane firmy: nazwa, NIP, branża | tworzenie firmy | Supabase | działanie aplikacji | do usunięcia firmy |
| produkty, ruchy magazynowe, zgłoszenia, komentarze | użytkownicy firmy | Supabase | działanie aplikacji; ruchy są „tylko do dopisywania” | do usunięcia firmy (konto użytkownika po usunięciu jest anonimizowane, ślad w księdze zostaje) |
| zdjęcia produktów i zgłoszeń | użytkownicy | Supabase Storage (prywatny) | działanie aplikacji | do usunięcia firmy |
| zdjęcia/PDF faktur, dane z faktur | skan użytkownika lub import z KSeF | Supabase Storage + baza; **zdjęcia do odczytu AI trafiają do Anthropic (USA) — tylko po zgodzie użytkownika** | księgowanie przyjęć magazynowych | do usunięcia firmy |
| token KSeF (zaszyfrowany) | właściciel firmy | Supabase (szyfrogram; klucz poza bazą); token służy do logowania do KSeF (Ministerstwo Finansów) | pobieranie faktur zakupu | do odłączenia KSeF lub usunięcia firmy |
| token powiadomień push, nazwa urządzenia | użytkownik włącza powiadomienia | Supabase; dostarczanie przez usługę push Expo i Apple/Google | powiadomienia | do wyłączenia/usunięcia konta |
| numer EAN | skan kodu kreskowego | Open Food Facts (publiczna baza; wysyłany jest sam numer, bez danych osobowych) | podpowiedź nazwy produktu | cache w Supabase |
| pytania do asystenta | użytkownik | Supabase (licznik) i Anthropic (treść pytania, bez danych firmy) | odpowiedź „jak to zrobić” | treść nie jest przez nas zapisywana; licznik dzienny |
| zgoda na AI | użytkownik | **tylko lokalnie na urządzeniu** (z datą) — nie na koncie | spełnienie wymogu zgody przed wysłaniem do AI | do wycofania/odinstalowania |
| dziennik zdarzeń (kto/co/kiedy) | aplikacja | Supabase (tylko do dopisywania) | bezpieczeństwo, rozliczalność | jak dane firmy |
| analityka, reklamy, śledzenie | — | **brak** | — | — |

Czego tu **nie ma**, a prawnik zapyta: okresów przechowywania kopii zapasowych (Supabase Pro: dzienne 7 dni; PITR — okno odzyskiwania), procedury naruszeń (art. 33 RODO), rejestru czynności, oceny skutków, wyznaczenia IOD (zwykle niewymagany w tej skali), umowy z dostawcami (Supabase, Anthropic, Expo) i podstawy transferu danych poza EOG.
