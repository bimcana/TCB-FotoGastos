import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entradaDeFactura, agregarEntrada, quitarEntrada } from '../src/indice.js';

test('quitarEntrada elimina por nombre de archivo sin mutar', () => {
  const idx = { facturas: [{ archivo: 'a.jpg' }, { archivo: 'b.jpg' }] };
  const out = quitarEntrada(idx, 'a.jpg');
  assert.deepEqual(out.facturas.map(f => f.archivo), ['b.jpg']);
  assert.equal(idx.facturas.length, 2);
});

test('quitarEntrada tolera indice nulo', () => {
  assert.deepEqual(quitarEntrada(null, 'a.jpg'), { facturas: [] });
});

test('entradaDeFactura normaliza campos', () => {
  const e = entradaDeFactura('Compra_110.jpg',
    { fechaEmision:'2025-06-11', ncf:'B0100182291', rncEmisor:'131067603', nombreComercio:'X', subtotal:2910, itbis:523.8, total:3724.8 },
    'gemini', false);
  assert.equal(e.archivo, 'Compra_110.jpg');
  assert.equal(e.ncf, 'B0100182291');
  assert.equal(e.origen, 'gemini');
  assert.equal(e.duplicada, false);
  assert.ok(e.subidoEn); // timestamp ISO
  assert.equal(e.estado, 'completa');
  assert.equal(e.revisadaIA, false);
});
test('entradaDeFactura: estado pendiente cuando origen local y datos completos', () => {
  const e = entradaDeFactura('Compra_111.jpg',
    { fechaEmision:'2025-06-11', ncf:'B0100182291', rncEmisor:'131067603', nombreComercio:'X', subtotal:2910, itbis:523.8, total:3724.8 },
    'local', false);
  assert.equal(e.estado, 'pendiente');
  assert.equal(e.revisadaIA, false);
});
test('entradaDeFactura: estado incompleta cuando falta un esencial', () => {
  const e = entradaDeFactura('Compra_112.jpg',
    { fechaEmision:'2025-06-11', ncf:'B0100182291', rncEmisor:'131067603', nombreComercio:'X', subtotal:2910, itbis:523.8, total:null },
    'gemini', false);
  assert.equal(e.estado, 'incompleta');
});
test('agregarEntrada crea estructura si no existe', () => {
  const idx = agregarEntrada(null, { archivo:'a.jpg', ncf:'B01' });
  assert.equal(idx.facturas.length, 1);
  const idx2 = agregarEntrada(idx, { archivo:'b.jpg', ncf:'B02' });
  assert.equal(idx2.facturas.length, 2);
});
