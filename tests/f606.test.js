import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tipoId, filas606 } from '../src/f606.js';

test('tipoId: 9 digitos RNC → 1, 11 digitos cedula → 2', () => {
  assert.equal(tipoId('131-06760-3'), '1');
  assert.equal(tipoId('00112345678'), '2');
});

test('filas606 solo completas no duplicadas, fecha AAAAMM + dia', () => {
  const fs = [
    { estado:'completa', duplicada:false, rncEmisor:'101796822', ncf:'E310011691003', fechaEmision:'2026-07-15', subtotal:5129.66, itbis:299.97, total:5429.63 },
    { estado:'pendiente', rncEmisor:'x', ncf:'y', fechaEmision:'2026-07-15', total:1 },
    { estado:'completa', duplicada:true, rncEmisor:'x', ncf:'y', fechaEmision:'2026-07-15', total:1 }
  ];
  const filas = filas606(fs, '2026-07');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].fechaComprobante, '202607');
  assert.equal(filas[0].dia, '15');
  assert.equal(filas[0].montoFacturado, 5129.66);
  assert.equal(filas[0].itbisFacturado, 299.97);
  assert.equal(filas[0].tipoBienes, '');
});

test('filas606 respaldo de monto: total-itbis, o total', () => {
  const base = { estado:'completa', rncEmisor:'101796822', ncf:'B01', fechaEmision:'2026-07-01' };
  assert.equal(filas606([{ ...base, total: 118, itbis: 18 }], '2026-07')[0].montoFacturado, 100);
  assert.equal(filas606([{ ...base, total: 118 }], '2026-07')[0].montoFacturado, 118);
});
