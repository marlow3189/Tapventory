// Szkielet strony HTML dla wersji webowej (PWA). Tu ustawiamy wszystko, co przeglądarka
// musi wiedzieć PRZED uruchomieniem aplikacji: nazwa, kolory paska, ikony, manifest.
// Plik działa tylko w przeglądarce — na telefonie nie jest używany.

import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="pl">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover: treść może wejść pod "notch" iPhone'a (obsługujemy to marginesami) */}
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <title>Tapventory</title>
        <meta name="description" content="Prosty magazyn dla małych firm usługowych: stany, zgłoszenia braków i faktury skanowane przez AI." />

        <meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
        <meta name="color-scheme" content="light dark" />

        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Tapventory" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />

        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: globalCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

// Tło zgodne z trybem jasnym/ciemnym już w pierwszej klatce (bez białego mignięcia w nocy),
// brak niebieskiej poświaty przy dotknięciu i brak "gumowego" przewijania całej strony.
const globalCss = `
html, body { background-color: #FFFFFF; overscroll-behavior: none; -webkit-tap-highlight-color: transparent; }
@media (prefers-color-scheme: dark) { html, body { background-color: #000000; } }
body { -webkit-text-size-adjust: 100%; }
input, textarea { font-family: inherit; }
`;
