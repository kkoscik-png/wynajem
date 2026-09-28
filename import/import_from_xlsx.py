#!/usr/bin/env python3
"""
Generuje dane do zaimportowania w Cloudflare D1 z eksportu arkusza Google
Sheets ("Storage": kolumny key, value) — do wyboru w formacie SQL albo JSON.

Użycie:
    # Format SQL (do konsoli D1 albo `wrangler d1 execute --file=...`):
    python3 import_from_xlsx.py <plik.xlsx> [nazwa_arkusza] > import.sql

    # Format JSON (do wgrania przez narzedzie-instalacyjne.html, bez terminala):
    python3 import_from_xlsx.py <plik.xlsx> [nazwa_arkusza] --json > import.json

    # domyślna nazwa arkusza: "Storage"

Skrypt jest idempotentny — zarówno SQL (ON CONFLICT DO UPDATE), jak i import
przez /api/admin/import w Workerze, można uruchomić wielokrotnie bez obawy
o duplikaty.
"""
import sys
import json

try:
    import openpyxl
except ImportError:
    sys.exit("Brakuje pakietu openpyxl. Zainstaluj: pip install openpyxl --break-system-packages")


def sql_escape(s: str) -> str:
    return s.replace("'", "''")


def parse_rows(path, sheet_name):
    """Zwraca listę {"key":..., "value":...} gotową do zapisu, po scaleniu
    starych osobnych kluczy gazu (gaz-odczyty-<id>) w jeden gaz-odczyty-all."""
    wb = openpyxl.load_workbook(path, data_only=True)
    if sheet_name not in wb.sheetnames:
        sys.exit(f"Arkusz '{sheet_name}' nie istnieje w pliku. Dostępne arkusze: {wb.sheetnames}")
    ws = wb[sheet_name]

    raw_rows = list(ws.iter_rows(values_only=True))
    if not raw_rows:
        sys.exit("Arkusz jest pusty.")

    header = [str(h).strip().lower() if h is not None else "" for h in raw_rows[0]]
    try:
        key_idx = header.index("key")
        val_idx = header.index("value")
    except ValueError:
        sys.exit(f"Nie znaleziono kolumn 'key' i 'value' w nagłówku: {raw_rows[0]}")

    out_rows = []
    skipped = 0
    merged_gaz = {}  # konsolidacja starych osobnych kluczy gaz-odczyty-<id> -> gaz-odczyty-all

    for row in raw_rows[1:]:
        if row is None or key_idx >= len(row) or val_idx >= len(row):
            continue
        key, value = row[key_idx], row[val_idx]
        if key is None or value is None:
            skipped += 1
            continue
        key = str(key).strip()
        value = str(value)
        if not key:
            skipped += 1
            continue

        # Stare, pojedyncze klucze liczników gazu (sprzed wprowadzenia gaz-odczyty-all)
        # łączymy tutaj w jeden obiekt — to samo, co kiedyś robił kod migracyjny w
        # przeglądarce, ale zrobione raz, bezpiecznie, po stronie importu, a nie
        # automatycznie przy każdym błędzie sieci (patrz DEPLOYMENT_GUIDE.md).
        if key.startswith("gaz-odczyty-") and key != "gaz-odczyty-all":
            apt_id = key[len("gaz-odczyty-"):]
            try:
                merged_gaz[apt_id] = json.loads(value)
            except json.JSONDecodeError:
                print(f"-- OSTRZEŻENIE: pominięto nieprawidłowy JSON dla klucza {key}", file=sys.stderr)
            continue

        out_rows.append({"key": key, "value": value})

    if merged_gaz:
        out_rows.append({"key": "gaz-odczyty-all", "value": json.dumps(merged_gaz, ensure_ascii=False)})

    return out_rows, skipped


def emit_sql(rows, path, sheet_name):
    print("-- Wygenerowano automatycznie przez import_from_xlsx.py")
    print("-- Źródło: %s (arkusz: %s)" % (path, sheet_name))
    print("BEGIN TRANSACTION;")
    for r in rows:
        print(
            "INSERT INTO kv_store (key, value, updated_at) VALUES ('%s', '%s', datetime('now'))\n"
            "  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;"
            % (sql_escape(r["key"]), sql_escape(r["value"]))
        )
    print("COMMIT;")


def emit_json(rows):
    print(json.dumps({"rows": rows}, ensure_ascii=False, indent=2))


def main():
    args = [a for a in sys.argv[1:] if a != "--json"]
    as_json = "--json" in sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    path = args[0]
    sheet_name = args[1] if len(args) > 1 else "Storage"

    rows, skipped = parse_rows(path, sheet_name)

    if as_json:
        emit_json(rows)
    else:
        emit_sql(rows, path, sheet_name)

    print(f"-- Wierszy do importu: {len(rows)}, pominięto pustych: {skipped}", file=sys.stderr)


if __name__ == "__main__":
    main()
