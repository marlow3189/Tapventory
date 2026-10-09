# Polityka prywatności Tapventory

> **WZÓR — wymaga przeglądu prawnika i uzupełnienia pól `[...]`.** Opis przetwarzania odpowiada stanowi aplikacji z dnia 9.10.2026 (patrz tabela w `README.md`). Wersja: [DATA]. Obowiązuje od: [DATA].

## 1. Kim jesteśmy (administrator danych)

Administratorem danych osobowych **użytkowników aplikacji** (konta, logowanie, powiadomienia, korzystanie z aplikacji) jest **[PEŁNA NAZWA FIRMY / IMIĘ I NAZWISKO PROWADZĄCEGO DZIAŁALNOŚĆ]**, [ADRES], NIP [NIP], e‑mail: **kontakt@tapventory.com** („**my**”).

W odniesieniu do danych, które **Twoja firma** wprowadza do Tapventory (produkty, faktury, dane kontrahentów i pracowników firmy), to **Twoja firma jest administratorem**, a my przetwarzamy je **na jej zlecenie** (jako podmiot przetwarzający) na podstawie umowy powierzenia — wzór: [`umowa_powierzenia.md`] / dostępny na życzenie.

## 2. Jakie dane przetwarzamy, po co i na jakiej podstawie

| Cel | Dane | Podstawa prawna (RODO) |
|---|---|---|
| założenie i prowadzenie konta, logowanie, bezpieczeństwo konta | e‑mail, imię/nazwa wyświetlana, (opcjonalnie) telefon, hasło (w postaci zaszyfrowanej przez usługę uwierzytelniania), identyfikatory sesji | art. 6 ust. 1 lit. b (wykonanie umowy) |
| działanie aplikacji dla firmy: magazyn, zgłoszenia, czat, faktury, spisy, zespół | dane wprowadzane przez użytkowników, podpisy działań (kto i kiedy) | art. 6 ust. 1 lit. b; wobec danych powierzonych — art. 28 |
| odczyt faktur przez sztuczną inteligencję | zdjęcia/PDF faktur wybrane przez użytkownika i zawarte w nich dane (m.in. nazwy i adresy kontrahentów, NIP, kwoty) | **zgoda** (art. 6 ust. 1 lit. a) wyrażana w aplikacji przed pierwszym użyciem; można ją wycofać w Ustawieniach |
| import faktur z KSeF | token KSeF właściciela (szyfrowany), faktury zakupu firmy | art. 6 ust. 1 lit. b (na polecenie właściciela firmy) |
| powiadomienia push | token urządzenia, nazwa urządzenia | art. 6 ust. 1 lit. b / zgoda systemowa na powiadomienia |
| asystent AI „jak to zrobić” | treść pytań użytkownika | zgoda (jak wyżej) |
| zapewnienie bezpieczeństwa i rozliczalności (dziennik zdarzeń), ochrona przed nadużyciami (limity) | identyfikatory, znaczniki czasu, liczniki | art. 6 ust. 1 lit. f (prawnie uzasadniony interes: bezpieczeństwo usługi) |
| obsługa zgłoszeń i kontakt | treść wiadomości do nas, adres e‑mail | art. 6 ust. 1 lit. f |
| rozliczenia i obowiązki podatkowe [po uruchomieniu płatności] | dane do faktury | art. 6 ust. 1 lit. c |

Nie stosujemy zautomatyzowanego podejmowania decyzji wywołujących skutki prawne. Wynik odczytu faktury przez AI jest **szkicem do sprawdzenia** — nic nie jest księgowane bez zatwierdzenia przez człowieka.
Nie używamy narzędzi analitycznych ani reklamowych i nie śledzimy użytkowników między aplikacjami.

## 3. Komu przekazujemy dane (odbiorcy i podmioty przetwarzające)

| Odbiorca | Rola | Cel | Lokalizacja |
|---|---|---|---|
| **Supabase** (Supabase Inc.) | podmiot przetwarzający | baza danych, uwierzytelnianie, przechowywanie plików, funkcje serwerowe | region UE (Frankfurt) [potwierdź w ustawieniach projektu] |
| **Anthropic** (Anthropic PBC) | podmiot przetwarzający | odczyt faktur i odpowiedzi asystenta — **tylko po Twojej zgodzie** | USA [podstawa transferu: …] |
| **Expo** (650 Industries, Inc.) | podmiot przetwarzający | dostarczanie powiadomień push (tokeny urządzeń) | USA [podstawa transferu: …] |
| **Apple / Google** | niezależni administratorzy / dostawcy usług push | dostarczenie powiadomień na urządzenie; dystrybucja aplikacji | zależnie od usługi |
| [hosting aplikacji w przeglądarce, np. Netlify/Cloudflare/Vercel] | podmiot przetwarzający | udostępnianie plików aplikacji internetowej | [UE/USA] |
| [dostawca poczty, np. Resend/Postmark] | podmiot przetwarzający | wiadomości e‑mail (potwierdzenie konta, reset hasła, zaproszenia) | [UE/USA] |
| **Ministerstwo Finansów (KSeF)** | źródło danych (organ publiczny) | pobieranie faktur zakupu na polecenie właściciela firmy | Polska |
| **Open Food Facts** | usługa publiczna | podpowiedź nazwy produktu po kodzie EAN (wysyłamy tylko numer kodu) | UE |
| [Stripe — po uruchomieniu płatności] | niezależny administrator / podmiot przetwarzający | płatności za plany | [UE/USA] |

Dane przekazywane poza Europejski Obszar Gospodarczy (np. do USA) chronimy [standardowymi klauzulami umownymi / decyzją o adekwatności (EU‑US Data Privacy Framework) — uzupełnij wg dokumentów dostawców].

## 4. Jak długo przechowujemy dane

* **Konto użytkownika** — do jego usunięcia. Po usunięciu konta dane identyfikujące są **anonimizowane**; wpisy w księdze ruchów magazynowych zostają jako „Usunięty użytkownik” (to zapis zdarzeń firmy).
* **Dane firmy** (produkty, ruchy, faktury, zdjęcia, spisy) — do usunięcia firmy przez jej właściciela (funkcja w Ustawieniach), potem usuwamy je bezpowrotnie.
* **Token KSeF** — do odłączenia integracji lub usunięcia firmy.
* **Kopie zapasowe** bazy — usuwane automatycznie w ciągu [7–30] dni od usunięcia danych z systemu głównego.
* **Dane rozliczeniowe** — [okres wynikający z przepisów podatkowych].
* **Wiadomości do nas** — [okres przedawnienia roszczeń / do załatwienia sprawy].
* **Zgoda na AI** — zapisana lokalnie na urządzeniu do wycofania zgody lub odinstalowania aplikacji.

## 5. Twoje prawa

Masz prawo do: dostępu do danych, sprostowania, usunięcia („bycia zapomnianym”), ograniczenia przetwarzania, przenoszenia danych, sprzeciwu wobec przetwarzania opartego na prawnie uzasadnionym interesie oraz **wycofania zgody** w dowolnym momencie (bez wpływu na zgodność z prawem wcześniejszego przetwarzania).
Konto możesz usunąć sam: **Ustawienia → Usuń moje konto** (opis: [`usun_konto.md`] → `https://tapventory.com/usun-konto`). Pozostałe żądania wyślij na **kontakt@tapventory.com**; odpowiemy w ciągu miesiąca.
Masz prawo wniesienia skargi do **Prezesa Urzędu Ochrony Danych Osobowych** (ul. Stawki 2, 00‑193 Warszawa, uodo.gov.pl).

## 6. Bezpieczeństwo

Dane są przesyłane szyfrowanym połączeniem (HTTPS). Dostęp do danych firmy mają tylko jej członkowie, zgodnie z rolami (właściciel, kierownik, pracownik); pracownicy nie widzą faktur i cen zakupu. Izolację danych firm wymusza baza danych (reguły RLS), a nie sama aplikacja.
Token KSeF jest szyfrowany (AES‑256‑GCM) kluczem przechowywanym poza bazą danych i służy wyłącznie do odczytu faktur — nie umożliwia wystawiania faktur. Klucze dostępowe do usług zewnętrznych nigdy nie trafiają do aplikacji w telefonie.
[Dopisz: procedura zgłaszania naruszeń, kopie zapasowe, testy bezpieczeństwa — gdy będą wdrożone.]

## 7. Pliki w przeglądarce i na urządzeniu

Aplikacja internetowa (PWA) i aplikacje mobilne zapisują lokalnie na urządzeniu: sesję logowania (w aplikacji mobilnej — w bezpiecznym magazynie systemu), ustawienia (np. zgoda na AI, wybrana firma) oraz pamięć podręczną plików aplikacji. Nie używamy plików cookie do celów reklamowych ani analitycznych.

## 8. Dzieci

Usługa jest przeznaczona dla firm i osób dorosłych; nie kierujemy jej do dzieci.

## 9. Zmiany polityki

O istotnych zmianach poinformujemy w aplikacji lub e‑mailem [z wyprzedzeniem X dni]. Aktualna wersja jest zawsze pod adresem `https://tapventory.com/prywatnosc`.

## 10. Kontakt

**kontakt@tapventory.com** • [ADRES KORESPONDENCYJNY]
