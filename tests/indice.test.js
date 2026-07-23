import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entradaDeFactura as _entradaF10 } from '../src/indice.js';

test('entradaDeFactura: propaga validadaPorUsuario al estado (Fase 10)', () => {
  const d = { fechaEmision:'2026-07-11', ncf:'B0100033899', rncEmisor:'131642918', total:1363.49 };
  assert.equal(_entradaF10('Compra_110.jpg', d, 'local', false).estado, 'pendiente');
  assert.equal(_entradaF10('Compra_110.jpg', d, 'local', false, { validadaPorUsuario: true }).estado, 'completa');
});
import { entradaDeFactura, agregarEntrada, quitarEntrada, descDeEntrada, entradaDeDesc, conciliarIndice, repiteNCF } from '../src/indice.js';

// --- Fase 12: deteccion de duplicado al leer el NCF de una factura (tipico de Lite) ---
const IDX_DUP = { facturas: [
  { archivo: 'Compra_100.jpg', ncf: 'B0100077145', duplicada: false },
  { archivo: 'Compra_101.jpg', ncf: 'E310000001', duplicada: false }
]};

test('repiteNCF: la nueva copia repite un NCF existente → true', () => {
  assert.equal(repiteNCF(IDX_DUP, 'B0100077145', 'Pendiente_x.jpg'), true);
});
test('repiteNCF: NCF nuevo → false', () => {
  assert.equal(repiteNCF(IDX_DUP, 'B0100099999', 'Pendiente_x.jpg'), false);
});
test('repiteNCF: excluye la propia factura (no se marca a si misma)', () => {
  assert.equal(repiteNCF(IDX_DUP, 'B0100077145', 'Compra_100.jpg'), false);
});
test('repiteNCF: el original NO se marca cuando la otra ya es duplicada', () => {
  const idx = { facturas: [
    { archivo: 'Compra_100.jpg', ncf: 'B0100077145', duplicada: false }, // original
    { archivo: 'Compra_105.jpg', ncf: 'B0100077145', duplicada: true }   // copia ya marcada
  ]};
  assert.equal(repiteNCF(idx, 'B0100077145', 'Compra_100.jpg'), false); // editar el original no lo marca
});
test('repiteNCF: sin NCF o indice vacio → false', () => {
  assert.equal(repiteNCF(IDX_DUP, null, 'x.jpg'), false);
  assert.equal(repiteNCF({ facturas: [] }, 'B0100077145', 'x.jpg'), false);
  assert.equal(repiteNCF(null, 'B0100077145', 'x.jpg'), false);
});

test('descDeEntrada/entradaDeDesc: ida y vuelta con version', () => {
  const e = { archivo: 'Compra_031.jpg', fechaEmision: '2025-06-03', ncf: 'B0100182291', rncEmisor: '131067603',
              nombreComercio: 'X', subtotal: 100, itbis: 18, total: 118, estado: 'completa', origen: 'gemini', duplicada: false };
  const vuelta = entradaDeDesc(descDeEntrada(e));
  assert.equal(vuelta.ncf, 'B0100182291');
  assert.equal(vuelta.total, 118);
  assert.equal(vuelta.estado, 'completa');
  assert.equal(vuelta.archivo, 'Compra_031.jpg');
});

test('entradaDeDesc tolera basura y descripciones ajenas', () => {
  assert.equal(entradaDeDesc('cualquier texto humano'), null);
  assert.equal(entradaDeDesc('{"sin":"version"}'), null);
  assert.equal(entradaDeDesc(''), null);
  assert.equal(entradaDeDesc(null), null);
});

test('conciliarIndice restaura entradas perdidas desde description', () => {
  const idx = { facturas: [{ archivo: 'Compra_010.jpg', ncf: 'B01A', estado: 'completa' }] };
  const archivos = [
    { name: 'Compra_010.jpg', mimeType: 'image/jpeg', description: '' },              // ya indexada
    { name: 'Compra_011.jpg', mimeType: 'image/jpeg',
      description: descDeEntrada({ archivo: 'Compra_011.jpg', ncf: 'B01B', estado: 'pendiente', total: 5 }) }, // perdida → restaurar
    { name: 'IMG_9999.jpeg', mimeType: 'image/jpeg', description: 'nota humana' },    // ajena
    { name: '_gastos.json', mimeType: 'application/json', description: '' }           // no imagen
  ];
  const r = conciliarIndice(idx, archivos);
  assert.equal(r.restauradas.length, 1);
  assert.equal(r.restauradas[0].archivo, 'Compra_011.jpg');
  assert.deepEqual(r.sinProcesar, ['IMG_9999.jpeg']);
  assert.equal(r.indice.facturas.length, 2);
  assert.equal(idx.facturas.length, 1); // sin mutar
});

test('conciliarIndice marca duplicada la restaurada si su NCF ya existe', () => {
  const idx = { facturas: [{ archivo: 'Compra_010.jpg', ncf: 'B0100182291', estado: 'completa' }] };
  const archivos = [{ name: 'Compra_011.jpg', mimeType: 'image/jpeg',
    description: descDeEntrada({ archivo: 'Compra_011.jpg', ncf: 'B0100182291', estado: 'completa' }) }];
  const r = conciliarIndice(idx, archivos);
  assert.equal(r.restauradas[0].duplicada, true);
});

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
