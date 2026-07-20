import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearTextoFactura } from '../src/ocrlocal.js';

const ticket = `SOLUCIONES AUTOMOTRICES SA
RNC: 124028663
FACTURA PARA CREDITO FISCAL
Fecha de emision: 09/07/2026
Valido hasta: 09/08/2026
NCF: B0100182291
Cliente: CLIENTE SRL RNC: 000000000
Subtotal 2910.00
ITBIS 523.80
Total 3724.80`;

test('extrae NCF', () => { assert.equal(parsearTextoFactura(ticket).ncf, 'B0100182291'); });

test('extrae fecha de emision, no la de vencimiento', () => {
  assert.equal(parsearTextoFactura(ticket).fechaEmision, '2026-07-09');
});

test('extrae total e ITBIS', () => {
  const d = parsearTextoFactura(ticket);
  assert.equal(d.total, 3724.80);
  assert.equal(d.itbis, 523.80);
});

test('RNC emisor = el primero (arriba), no el del cliente', () => {
  assert.equal(parsearTextoFactura(ticket).rncEmisor, '124028663');
});

test('texto vacío → campos null', () => {
  const d = parsearTextoFactura('');
  assert.equal(d.ncf, null); assert.equal(d.total, null);
});

// --- Tests adicionales para afinar heurísticas ---

test('subtotal no se confunde con total', () => {
  const d = parsearTextoFactura(ticket);
  assert.equal(d.subtotal, 2910.00);
});

test('nombreComercio: primera línea con letras', () => {
  assert.equal(parsearTextoFactura(ticket).nombreComercio, 'SOLUCIONES AUTOMOTRICES SA');
});

test('monto con separador de miles (12,345.67)', () => {
  const t = `COMERCIO XYZ\nRNC: 130000001\nNCF: B0100000001\nFecha: 01/01/2026\nTotal RD$ 12,345.67`;
  assert.equal(parsearTextoFactura(t).total, 12345.67);
});

test('fecha de emisión en español ("09 jul. 2026")', () => {
  const t = `COMERCIO ABC\nRNC: 130000002\nFecha de emision: 09 jul. 2026\nNCF: B0100000002\nTotal 100.00`;
  assert.equal(parsearTextoFactura(t).fechaEmision, '2026-07-09');
});

test('RNC único sin línea de cliente → se usa igualmente', () => {
  const t = `COMERCIO SOLO\nRNC: 101234567\nNCF: E310000083906\nTotal 50.00`;
  assert.equal(parsearTextoFactura(t).rncEmisor, '101234567');
});

test('texto sin datos reconocibles → todos null', () => {
  const d = parsearTextoFactura('texto random sin campos de factura');
  assert.equal(d.ncf, null);
  assert.equal(d.fechaEmision, null);
  assert.equal(d.rncEmisor, null);
  assert.equal(d.subtotal, null);
  assert.equal(d.itbis, null);
  assert.equal(d.total, null);
});

// --- Fase 5: casos reales de campo (voucher Cardnet/Shell del 2026-07-17) ---
const VOUCHER = `CARDNET
JOSE FRANCISCO FARIAS ADAMES
012-0015611-3
SHELL EST JUAN DE HERRERA
FECHA:VIE,17/JUL/2026 HORA:06:54:23 PM
COMPROBANTE FISCAL
02 Producto Exento 1 RD$1.00
TOTAL: RD$3, 620.00
TIPO DE NCF Fiscal
NCF B0100007577
RNC 133231824
NOMBRE BIMCANA
FECHA DE VENCIMIENTO 31/12/2027`;

test('fecha con dia de semana y mes en letras (VIE,17/JUL/2026)', () => {
  assert.equal(parsearTextoFactura(VOUCHER).fechaEmision, '2026-07-17');
});

test('total con miles aunque el OCR meta espacios (RD$3, 620.00 → 3620)', () => {
  assert.equal(parsearTextoFactura(VOUCHER).total, 3620);
});

test('rncPropio (el RNC de la empresa del usuario) NO se toma como emisor', () => {
  const d = parsearTextoFactura(VOUCHER, { rncPropio: '1-33-23182-4' });
  assert.equal(d.rncEmisor, null); // mejor null que el RNC del cliente
});

test('ITBIS con variantes de etiqueta del OCR', () => {
  const t = 'COMERCIO X\nSUBTOTAL 100.00\nI.T.B.I.S. 18.00\nTOTAL 118.00';
  assert.equal(parsearTextoFactura(t).itbis, 18);
  const t2 = 'COMERCIO X\nITEBIS 18% 36.00\nTOTAL 236.00';
  assert.equal(parsearTextoFactura(t2).itbis, 36);
});

test('monto europeo (3.620,00) y decimal con coma', () => {
  assert.equal(parsearTextoFactura('X\nTOTAL 3.620,00').total, 3620);
  assert.equal(parsearTextoFactura('X\nTOTAL 45,50').total, 45.5);
});
