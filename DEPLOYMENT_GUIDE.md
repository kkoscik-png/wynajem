# Wynajem — wdrożenie i bezpieczeństwo

Aplikacja rozlicza trzy nieruchomości oraz liczniki gazu w trzech lokalach. `frontend/` to statyczna strona Cloudflare Pages, `worker/` to API Cloudflare Workers, a dane są w D1 (`kv_store` i `kv_store_history`).

## Przed wdrożeniem tej wersji

1. Zrób kopię istniejącej bazy **wynajem-db**. W Cloudflare D1 można użyć Time Travel, a przez Wrangler wyeksportować SQL: `npx wrangler d1 export wynajem-db --remote --output=wynajem-backup.sql`. Przechowuj kopię prywatnie, poza publicznym repozytorium.
2. W repozytorium opublikowano wcześniej `API_TOKEN` we frontendzie. Samo usunięcie go z najnowszego pliku nie usuwa go z historii Git. **Przed wdrożeniem dodaj osobny** sekret `ADMIN_TOKEN` dla importu; `API_TOKEN` wymień **po wdrożeniu obu części**, żeby stary frontend nie stracił dostępu przed aktualizacją.
3. Repozytorium jest publiczne i zawiera dawne pliki importu oraz archiwum. Ustaw je jako prywatne na GitHubie, jeśli ma pozostać repozytorium z danymi rozliczeń. Dodatkowo ogranicz dostęp do strony przez Cloudflare Access, jeśli ma być widoczna tylko dla Ciebie.

## Konfiguracja Cloudflare

- Worker: połączony z `kkoscik-png/wynajem`, katalog główny `worker`, nazwa `wynajem` zgodna z `worker/wrangler.toml`. Zweryfikuj, że binding D1 `DB` wskazuje na istniejącą bazę `wynajem-db` o ID z pliku TOML. **Nie twórz nowej pustej bazy.**
- Worker → Settings → Variables and Secrets: istniejący `API_TOKEN` pozostaw na czas wdrożenia, dodaj osobny `ADMIN_TOKEN`. Po wdrożeniu Workera i Pages wymień `API_TOKEN` na nowy, długi sekret. Żadnego z nich nie zapisuj w GitHubie ani w `wrangler.toml`.
- Pages: połączone z tym samym repozytorium, katalog główny `frontend`, bez komendy budowania, katalog wynikowy `.`. Zweryfikuj adres strony w panelu projektu. `frontend/index.html` wskazuje na `https://wynajem.scandica.workers.dev`; jeśli Twój adres Workera jest inny, popraw `API_BASE` w pliku.
- `ALLOWED_ORIGIN` w `worker/wrangler.toml` jest na razie `*`. Po ustaleniu dokładnego adresu Pages lub własnej domeny wpisz tam **pełny origin strony** (np. `https://wynajem.pages.dev`, bez końcowego `/`) i wdroż Workera ponownie. Jeśli używasz dwóch adresów frontendu, trzeba jawnie obsłużyć oba; CORS nie zastępuje uwierzytelnienia.
- Sprawdź, czy oba projekty wdrażają gałąź `main`. Nowy frontend wymaga Workera z trasą `/api/health` i zapisem `expectedValue`. Przy ręcznym wdrożeniu wdrażaj Workera przed Pages; przez czas między wdrożeniami zapisy ze starego frontendu mogą zwracać błąd. Po wdrożeniu obu części i kontroli odczytu wymień `API_TOKEN`.

Po wdrożeniu otwórz Pages, wpisz **nowy** `API_TOKEN` na ekranie wejścia i sprawdź odczyt, edycję i PDF. Token jest przechowywany w `sessionStorage` tylko do zamknięcia karty. Przy udostępnieniu tej samej karty innym osobom kliknij „Wyloguj”.

## Import i odzyskiwanie

Strona `/admin.html` na domenie Pages służy do tworzenia tabel i importu. Wymaga `ADMIN_TOKEN`; odczyt kontrolny wymaga osobno `API_TOKEN`. Import nadpisuje wskazane klucze, więc najpierw zrób kopię D1. Narzędzie działa na domenie Pages, aby mogło korzystać z ograniczonego `ALLOWED_ORIGIN`.

`import/import_from_xlsx.py` tworzy JSON lub SQL z arkusza `Storage`. Dołączone `import/import.json` i `import/import.sql` są **częściowym starym eksportem** i nie odtwarzają wszystkich miesięcy. Nie importuj ich do czynnej bazy bez porównania z aktualnym stanem.

API zwraca 409, gdy inna karta zdążyła zmienić ten sam klucz. Wtedy zachowaj swoje wartości, odśwież dane i wprowadź zmianę ponownie. Serwer zapisuje historię zmian w `kv_store_history`; nie jest to zamiennik regularnej kopii bazy.

## Kontrola lokalna

`node --test tests/*.test.mjs` sprawdza konflikt zapisu, autoryzację i przeliczenie miesięcy. Aplikacja frontendowa korzysta obecnie z React i Babel pobieranych z CDN podczas uruchamiania; do pracy wymaga dostępu do tych zasobów. To osobny obszar do późniejszej migracji na proces budowania.
