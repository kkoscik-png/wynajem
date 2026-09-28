# Wdrożenie na Cloudflare — instrukcja krok po kroku

Ten pakiet zawiera przepisaną wersję Twojej aplikacji „Zarządzanie Wynajmem”,
gotową do uruchomienia na Cloudflare zamiast Google Apps Script.

## Co się zmieniło i dlaczego

**Architektura przed:** przeglądarka → JSONP → Google Apps Script → arkusz Google Sheets „Storage”.

**Architektura po:**
- **Cloudflare Pages** — hostuje `index.html` (front-end, bez zmian wizualnych).
- **Cloudflare Worker** (`worker/src/index.js`) — proste API REST zastępujące Google Apps Script.
- **Cloudflare D1** — prawdziwa baza danych SQL (SQLite), w której trzymane są dane z wynajmu, w tabeli `kv_store` (klucz/wartość — dokładnie ten sam format co wcześniej w arkuszu „Storage”, więc migracja jest bezpośrednia).

### Znaleziony i naprawiony błąd — znikające rozliczenia gazu

Przyczyna: `store.get()` w starym kodzie **każdy błąd sieci/timeoutu Google Apps Script
zamieniał po cichu na wynik „brak danych”** (zwracał `null` identycznie jak dla klucza,
którego naprawdę nigdy nie było). Ekran „Rozliczenie Gazu” miał wbudowaną logikę
migracji, która przy takim `null` natychmiast **nadpisywała bazę pustym obiektem**.
Wystarczył jeden chwilowy timeout czy „zimny start” Google Apps Script, żeby
bezpowrotnie skasować całą historię odczytów gazu. Ten sam wzorzec (bez
auto-nadpisywania, ale z podobnym ryzykiem) znalazłem też w arkuszu rozliczeń
wynajmu (`Arkusz`) — tam akurat nie „wystrzelił”, ale był równie niebezpieczny.

**Poprawka w `frontend/index.html`:** `store.get()` teraz rzuca wyjątkiem przy błędzie
połączenia/HTTP i zwraca `null` tylko wtedy, gdy serwer wprost odpowiedział „nie
znaleziono”. Każdy ekran rozróżnia teraz te dwa przypadki: błąd połączenia → komunikat
i przycisk „Spróbuj ponownie”, niczego nie zapisuje; brak klucza → pusty stan, też bez
automatycznego zapisu. Żaden ekran nie może już przypadkiem nadpisać danych pustym
obiektem.

**Uwaga:** dostarczony plik `Wynajem_Storage.xlsx` zawiera tylko 3 wiersze danych
(wpis testowy i dane „Zdrojowa” za styczeń–luty 2026) — to najwyraźniej świeży/częściowy
eksport, nie pełne archiwum. Nie zawiera brakujących miesięcy gazu ani danych
Makuszyńskiego/Chrobrego — patrz sekcja „Odzyskiwanie brakujących danych” niżej.

---

## Zawartość paczki

```
cloudflare-migration/
├── frontend/
│   └── index.html                 ← poprawiona aplikacja (na Cloudflare Pages)
├── worker/
│   ├── src/index.js               ← kod Workera (API)
│   ├── wrangler.toml               ← konfiguracja (tylko dla ścieżki przez terminal)
│   └── schema.sql                  ← struktura bazy (dokumentacja/alternatywa)
├── import/
│   ├── import_from_xlsx.py        ← generator danych z eksportu Google Sheets
│   ├── import.sql                  ← gotowe z Twojego Wynajem_Storage.xlsx (SQL)
│   └── import.json                 ← to samo w formacie JSON (dla narzędzia poniżej)
├── narzedzie-instalacyjne.html    ← klikane narzędzie: tworzy tabele i wgrywa dane, bez terminala i bez konsoli SQL
└── DEPLOYMENT_GUIDE.md             ← ten plik
```

---

## Droga zalecana: GitHub + Cloudflare (bez wklejania kodu, bez terminala)

Wymaga tylko konta GitHub (github.com) i konta Cloudflare — obie założysz przez przeglądarkę.

### Krok 1 — wrzuć pliki na GitHub

1. Wejdź na github.com → zaloguj się (lub załóż konto) → **New repository** → nazwij np. `wynajem` → **Create repository**.
2. Na stronie nowego, pustego repozytorium kliknij **uploading an existing file** (albo „Add file” → „Upload files”).
3. Przeciągnij tam **całą zawartość** folderu `cloudflare-migration` (zachowaj podfoldery `frontend/` i `worker/`) i zatwierdź (**Commit changes**).

### Krok 2 — podłącz Workera (backend) do repozytorium

1. dash.cloudflare.com → **Workers & Pages** → **Create** → zakładka **Workers** → **Import a repository** (albo „Connect to Git”).
2. Wybierz repozytorium `wynajem`, jako **Root directory** ustaw `worker`.
3. Cloudflare rozpozna `wrangler.toml` i zaproponuje ustawienia budowania — zatwierdź (**Save and Deploy**). Powstanie Worker o adresie typu `https://wynajem-api.<konto>.workers.dev`.

### Krok 3 — utwórz bazę D1 i podepnij ją do Workera

1. Ten sam panel Cloudflare → **Workers & Pages** → zakładka **D1** → **Create database** → nazwa `wynajem-db`.
2. Wejdź w ustawienia utworzonego Workera → **Settings → Bindings → Add → D1 database**. Nazwa zmiennej: `DB`. Wybierz bazę `wynajem-db`. Zapisz.

### Krok 4 — ustaw token i pochodzenie

W tym samym miejscu → **Settings → Variables and Secrets**:
- **Secret** o nazwie `API_TOKEN` — wpisz dowolny długi, losowy ciąg (np. z generatora haseł). Zapamiętaj go.
- Zwykła zmienna `ALLOWED_ORIGIN` — wpisz `*`.

  *Dlaczego `*` jest tu OK:* prawdziwą ochroną Twoich danych jest token (`API_TOKEN`),
  nie CORS — CORS ogranicza tylko strony w przeglądarce, a nie dostęp z zewnątrz w ogóle.
  Skoro autoryzacja i tak jest przez token (a nie przez ciasteczka/sesję), zawężanie
  `ALLOWED_ORIGIN` nie dodaje realnej ochrony, a psuje działanie narzędzia
  instalacyjnego (patrz Krok 6) i testów lokalnych. Zostaw `*`.

Zapisz — Worker przeładuje się automatycznie z nowymi ustawieniami.

### Krok 5 — uzupełnij konfigurację w index.html i wrzuć na GitHub

Otwórz plik `frontend/index.html` (na swoim komputerze albo bezpośrednio na GitHub przez
ikonę ✏️ „Edit”), znajdź blok:
```js
const APP_CONFIG = {
  API_BASE: 'https://wynajem-api.TWOJ-LOGIN.workers.dev',
  API_TOKEN: 'ZMIEN_TEN_TOKEN',
};
```
i wpisz adres Workera z Kroku 2 oraz token z Kroku 4. Zapisz zmiany (jeśli edytowałeś
lokalnie, wgraj poprawiony plik ponownie na GitHub przez „Add file → Upload files”).

### Krok 6 — utwórz tabele i wgraj dane (bez konsoli SQL!)

Otwórz plik `narzedzie-instalacyjne.html` z paczki bezpośrednio w przeglądarce
(zwykły dwuklik na pliku — nie trzeba nigdzie go wgrywać).
1. Wpisz adres Workera i token (te same co wyżej).
2. Kliknij **„Utwórz tabele”**.
3. W sekcji 2 wskaż plik `import/import.json` z paczki i kliknij **„Wgraj wybrany plik”**.
4. Kliknij **„Sprawdź dane w bazie”** — powinieneś zobaczyć ✅ z liczbą wpisów dla „Zdrojowa”.

### Krok 7 — podłącz Pages (frontend) do repozytorium

1. **Workers & Pages** → **Create** → zakładka **Pages** → **Import a repository (Connect to Git)**.
2. Wybierz repozytorium `wynajem`, jako **Root directory** ustaw `frontend`, **Build command** zostaw puste, **Build output directory**: `/` (albo `.`).
3. **Save and Deploy**. Po chwili dostaniesz adres typu `https://wynajem.pages.dev`.

Od teraz każda zmiana w plikach na GitHub (np. edycja `frontend/index.html`) automatycznie
przebuduje i wdroży stronę na nowo — bez ręcznego przesyłania czegokolwiek.

### Krok 8 — test końcowy

Wejdź na swoją stronę Pages i kliknij **„Testuj połączenie z bazą danych (Cloudflare)”**
na stronie głównej aplikacji. Powinieneś zobaczyć same ✅, w tym dane „Zdrojowa” ze
stycznia/lutego 2026.

---

## Odzyskiwanie brakujących miesięcy rozliczeń gazu

Ponieważ przesłany `Wynajem_Storage.xlsx` nie zawiera tych danych, żeby je odzyskać:
1. W Google Sheets otwórz arkusz „Storage”, który zasilał Twój stary Google Apps Script.
2. Sprawdź historię wersji (Plik → Historia wersji → Zobacz historię wersji) — Google
   Sheets zwykle trzyma poprzednie wersje sprzed nadpisania.
3. Znajdź wersję, w której klucz `gaz-odczyty-all` (lub stare `gaz-odczyty-chrobrego1/2/3`)
   miał jeszcze pełne dane, i wyeksportuj tę wersję jako .xlsx.
4. Uruchom na niej (na komputerze z Pythonem): `python3 import_from_xlsx.py Twoj_Eksport.xlsx --json > import_gaz.json`,
   a potem wgraj `import_gaz.json` przez `narzedzie-instalacyjne.html` (Krok 6, punkt 3)
   — nadpisze tylko te klucze, reszta bazy zostaje nietknięta.

Jeśli historia wersji w Google Sheets też nie sięga wystarczająco daleko wstecz, te
konkretne miesiące niestety mogły zostać utracone bezpowrotnie — ale dzięki poprawce
w kodzie taka sytuacja nie powtórzy się na nowym systemie.

---

## Alternatywa: przez terminal (wrangler CLI)

Jeśli wolisz wiersz poleceń zamiast GitHub:

```bash
npm install -g wrangler
wrangler login

cd worker
wrangler d1 create wynajem-db
# skopiuj zwrócony database_id do wrangler.toml (WKLEJ_TUTAJ_DATABASE_ID)

wrangler d1 execute wynajem-db --remote --file=schema.sql
wrangler d1 execute wynajem-db --remote --file=../import/import.sql

wrangler secret put API_TOKEN
wrangler deploy
# zapisz adres Workera, uzupełnij APP_CONFIG w frontend/index.html

cd ../frontend
wrangler pages deploy . --project-name=wynajem
```

## Rozwiązywanie problemów

- **„unauthorized”** → token w `index.html` / w narzędziu instalacyjnym nie zgadza się
  z tym ustawionym w Cloudflare (Settings → Variables and Secrets → `API_TOKEN`).
- **Błąd CORS w konsoli przeglądarki (F12)** → sprawdź, czy `ALLOWED_ORIGIN` w
  ustawieniach Workera to `*` (patrz Krok 4).
- **„Baza danych (D1) nie jest podpięta”** → w ustawieniach Workera, Settings →
  Bindings, brakuje wpisu D1 o nazwie zmiennej `DB` albo wskazuje na złą bazę.
- **„The request is malformed: Requests without any query are not supported”** → ten
  błąd pochodzi z ręcznej konsoli SQL w panelu D1, gdy pole zapytania jest puste
  (np. wklejanie nie zadziałało). Użyj zamiast tego `narzedzie-instalacyjne.html`
  (Krok 6) — omija ten problem całkowicie.
- **Chcesz zobaczyć wszystkie dane w bazie** → `GET https://<adres-workera>/api/export?token=<TWÓJ_TOKEN>`
  zwróci wszystkie wiersze jako JSON.
