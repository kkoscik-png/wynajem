-- Schemat bazy danych D1 dla aplikacji "Zarządzanie Wynajmem"
--
-- Model danych: tabela klucz-wartość (kv_store), odwzorowująca 1:1 sposób,
-- w jaki aplikacja frontendowa już przechowuje dane (dokładnie tak samo jak
-- wcześniej robił to arkusz Google "Storage" — kolumny key/value).
--
-- Klucze używane przez aplikację (dla orientacji, nic nie trzeba w tym pliku
-- zmieniać, to tylko dokumentacja):
--   rental-stawki-<id>     -- stawki (gaz/woda/czynsz/...) dla nieruchomości <id>
--   rental-odczyty-<id>    -- historia rozliczeń dla nieruchomości <id>
--   gaz-odczyty-all        -- wspólny obiekt {chrobrego1:[...], chrobrego2:[...], chrobrego3:[...]}
--   _diag_                 -- klucz testowy używany przez przycisk "Testuj połączenie"
--
-- <id> ∈ {zdrojowa, makuszynskiego, chrobrego}

CREATE TABLE IF NOT EXISTS kv_store (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prosty log zmian (opcjonalny, ale przydatny) — co najwyżej ostatnie 500 zapisów,
-- żeby móc zobaczyć historię i ewentualnie odtworzyć dane po pomyłce.
CREATE TABLE IF NOT EXISTS kv_store_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  written_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kv_history_key ON kv_store_history(key, written_at);
