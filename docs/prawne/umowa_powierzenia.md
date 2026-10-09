# Umowa powierzenia przetwarzania danych osobowych (wzór)

> **WZÓR — wymaga przeglądu prawnika i uzupełnienia pól `[...]`.** Zawierana na podstawie art. 28 RODO między **Klientem** (administrator danych) a **Usługodawcą Tapventory** (podmiot przetwarzający). Zwykle stanowi załącznik do Regulaminu lub jest akceptowana w panelu.

Zawarta w dniu [DATA] pomiędzy:

**Administratorem**: [NAZWA, ADRES, NIP KLIENTA] („**Administrator**”),
a
**Podmiotem przetwarzającym**: [PEŁNA NAZWA FIRMY], [ADRES], NIP [NIP] („**Procesor**”).

## § 1. Przedmiot i czas trwania

1. Administrator powierza Procesorowi przetwarzanie danych osobowych w zakresie niezbędnym do świadczenia usługi **Tapventory** (magazyn, zgłoszenia, faktury, zespół) zgodnie z Regulaminem.
2. Umowa obowiązuje przez czas korzystania z usługi i wygasa z jej zakończeniem, z zastrzeżeniem § 8.

## § 2. Charakter, cel, rodzaj danych i osób

| | |
|---|---|
| **Charakter przetwarzania** | przechowywanie, odczyt, edycja, usuwanie; automatyczny odczyt dokumentów (OCR/AI) na polecenie Administratora; import faktur z KSeF na polecenie Administratora |
| **Cel** | świadczenie usługi zarządzania magazynem i dokumentami zakupu |
| **Rodzaje danych** | imię i nazwisko/nazwa wyświetlana, e‑mail, telefon (opcjonalnie) pracowników Administratora; dane kontrahentów na fakturach (nazwy, adresy, NIP, numery rachunków [jeśli występują]); dziennik działań użytkowników; zdjęcia (mogą zawierać dane osobowe) |
| **Kategorie osób** | pracownicy i współpracownicy Administratora; osoby fizyczne prowadzące działalność jako kontrahenci Administratora; osoby wskazane na zdjęciach/dokumentach |

## § 3. Obowiązki Procesora

Procesor zobowiązuje się:
1. przetwarzać dane **wyłącznie na udokumentowane polecenie** Administratora (Regulamin, ustawienia konta, polecenia wydawane w aplikacji); jeśli prawo UE/PL nakłada inny obowiązek — poinformować Administratora, o ile prawo tego nie zabrania;
2. zapewnić, że osoby upoważnione do przetwarzania są związane tajemnicą;
3. wdrożyć środki techniczne i organizacyjne z art. 32 RODO, w szczególności: szyfrowanie transmisji (HTTPS), izolację danych firm na poziomie bazy (RLS), kontrolę dostępu według ról, szyfrowanie tokenów KSeF kluczem poza bazą danych, dziennik zdarzeń, limity i kopie zapasowe [dopisz zgodnie ze stanem wdrożenia];
4. nie korzystać z innego podmiotu przetwarzającego bez zgody Administratora (zgoda ogólna na podmioty z § 4 i na ich zmiany po powiadomieniu — Administrator może sprzeciwić się w terminie [14] dni);
5. pomagać Administratorowi w realizacji praw osób, których dane dotyczą (np. eksport i usunięcie danych poprzez funkcje aplikacji);
6. pomagać w wypełnianiu obowiązków z art. 32–36 RODO (bezpieczeństwo, zgłaszanie naruszeń, ocena skutków);
7. **zgłaszać naruszenie ochrony danych** Administratorowi **bez zbędnej zwłoki, nie później niż w ciągu [48] godzin** od stwierdzenia;
8. po zakończeniu świadczenia usługi **usunąć dane** (funkcja „Usuń firmę” lub na żądanie) albo zwrócić je Administratorowi — wg jego wyboru — oraz usunąć istniejące kopie, o ile prawo nie nakazuje ich przechowywania; kopie zapasowe wygasają w ciągu [7–30] dni;
9. udostępniać informacje niezbędne do wykazania zgodności i umożliwić **audyty** (w tym inspekcje) prowadzone przez Administratora lub upoważnionego audytora, po uprzednim uzgodnieniu terminu [i zakresu; koszty — ustalić].

## § 4. Dalsi podmioty przetwarzające (podprocesory)

Administrator zgadza się na korzystanie przez Procesora z poniższych podmiotów **[zweryfikuj z aktualnymi umowami dostawców]**:

| Podmiot | Zakres | Lokalizacja |
|---|---|---|
| Supabase Inc. | baza danych, uwierzytelnianie, pliki, funkcje serwerowe | UE (Frankfurt) |
| Anthropic PBC | odczyt dokumentów i asystent AI — **tylko po zgodzie użytkownika w aplikacji** | USA [podstawa transferu] |
| Expo (650 Industries, Inc.) | dostarczanie powiadomień push | USA [podstawa transferu] |
| [hosting aplikacji internetowej] | pliki statyczne PWA | [lokalizacja] |
| [dostawca poczty] | wiadomości systemowe | [lokalizacja] |

Procesor nakłada na podprocesorów obowiązki równoważne tym z niniejszej umowy i odpowiada za ich wykonanie.

## § 5. Transfer poza EOG

Przekazanie danych poza EOG odbywa się na podstawie [standardowych klauzul umownych / decyzji o adekwatności] oraz, w przypadku funkcji AI, wyłącznie po wyrażeniu zgody przez użytkownika w aplikacji.

## § 6. Odpowiedzialność

[Zasady odpowiedzialności stron — do ustalenia z prawnikiem; z zachowaniem art. 82 RODO wobec osób, których dane dotyczą.]

## § 7. Postanowienia końcowe

Umowa podlega prawu polskiemu. W sprawach nieuregulowanych stosuje się RODO i Regulamin. Zmiany wymagają formy pisemnej lub dokumentowej.

## § 8. Dane po zakończeniu umowy

Obowiązki z § 3 pkt 2, 7, 8 i 9 oraz § 6 obowiązują także po wygaśnięciu umowy w niezbędnym zakresie.

---
**Administrator:** ______________   **Procesor:** ______________
