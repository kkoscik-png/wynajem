import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
const calculationCode = html.split('    const oblicz = ')[1]?.split('    // ══════ KARTA LICZNIKA GAZU')[0];
assert.ok(calculationCode, 'Financial calculation block exists');
const defaults = { gaz:5, woda:21, nieczystosci:12, wynajem:2000, czynsz:473, abonamentGaz:21, garaz:0 };
const { recalculateReadings, validAmount } = new Function('DEFAULT_STAWKI', 'MIESIACE',
  'const oblicz = ' + calculationCode + '\nreturn { recalculateReadings, validAmount };'
)(defaults, ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień']);

test('changing an older meter reading recalculates the following month at its saved rates', () => {
  const readings = [
    { miesiac:'Styczeń 2026', stanGazu:100, stanWody:10, prad:0, stawkiSnapshot:{ ...defaults, gaz:4 } },
    { miesiac:'Luty 2026', stanGazu:130, stanWody:12, prad:0, stawkiSnapshot:{ ...defaults, gaz:5 } },
    { miesiac:'Marzec 2026', stanGazu:160, stanWody:15, prad:0, stawkiSnapshot:{ ...defaults, gaz:6 } },
  ];
  readings[1].stanGazu = 140;
  const corrected = recalculateReadings(readings, 'zdrojowa');
  assert.equal(corrected[1].zuzycieGazu, 40);
  assert.equal(corrected[2].zuzycieGazu, 20);
  assert.equal(corrected[2].kosztGazu, 120);
  assert.equal(corrected[2].stawkiSnapshot.gaz, 6);
  assert.equal(corrected[2].suma, 2000 + 473 + 120 + 21 + 63 + 36);
  const afterDeletion = recalculateReadings([readings[0], readings[2]], 'zdrojowa');
  assert.equal(afterDeletion[1].zuzycieGazu, 60);
});

test('invalid or negative meter values are rejected', () => {
  for (const value of ['', '-1', 'NaN', 'Infinity']) assert.equal(validAmount(value), false);
  assert.equal(validAmount('0'), true);
});
