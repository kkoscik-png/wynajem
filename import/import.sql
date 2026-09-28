-- Wygenerowano automatycznie przez import_from_xlsx.py
-- Źródło: /root/.claude/uploads/07f3541e-8327-5906-a240-df67575ed4e7/cf18dc54-Wynajem_Storage.xlsx (arkusz: Storage)
BEGIN TRANSACTION;
INSERT INTO kv_store (key, value, updated_at) VALUES ('_diag_', 'test_1773083661368', datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
INSERT INTO kv_store (key, value, updated_at) VALUES ('rental-stawki-zdrojowa', '{"gaz":4.6,"woda":21,"nieczystosci":12,"wynajem":2000,"czynsz":473,"abonamentGaz":21}', datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
INSERT INTO kv_store (key, value, updated_at) VALUES ('rental-odczyty-zdrojowa', '[{"miesiac":"Styczeń 2026","stanGazu":4834,"stanWody":374,"prad":0,"zuzycieGazu":0,"zuzycieWody":0,"kosztGazu":0,"kosztWody":0,"nieczystosci":0,"gazZAbonamentem":21,"suma":2494,"stawkiSnapshot":{"gaz":5,"woda":21,"nieczystosci":12,"wynajem":2000,"czynsz":473,"abonamentGaz":21}},{"miesiac":"Luty 2026","stanGazu":5077,"stanWody":382,"prad":319,"zuzycieGazu":243,"zuzycieWody":8,"kosztGazu":1117.8,"kosztWody":168,"nieczystosci":96,"gazZAbonamentem":1138.8,"suma":4194.8,"stawkiSnapshot":{"gaz":4.6,"woda":21,"nieczystosci":12,"wynajem":2000,"czynsz":473,"abonamentGaz":21}}]', datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
COMMIT;
