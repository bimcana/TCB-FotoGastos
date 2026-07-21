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

// --- Fase 8: total a pagar vs otras lineas con "total" (patron Sirena/supermercado) ---
const SIRENA = `Sirena
SAN JUAN Tel: 809-472-4444
GRUPO RAMOS S.A.
RNC: 101796822
15/07/26 18:24:36
e-NCF:E310011691003
BIMCANA SRL
FACTURA DE CREDITO FISCAL ELECTRONICO
CUCHARA BAMBO 9.15 60.00
SUB-TOTAL 5,129.66
TOTAL A PAGAR 299.97 5,429.63
MASTERCA 5,429.63
TOTAL DE DESCUENTO PROMO. 3.00-
TOTAL ITBIS 299.97
NUMERO ARTICULOS VENDIDOS - 29`;

test('total = TOTAL A PAGAR (ultimo monto), no el descuento ni el total de ITBIS', () => {
  assert.equal(parsearTextoFactura(SIRENA).total, 5429.63);
});

test('SUB-TOTAL con guion se extrae como subtotal', () => {
  assert.equal(parsearTextoFactura(SIRENA).subtotal, 5129.66);
});

test('e-NCF electronico se extrae del recibo', () => {
  assert.equal(parsearTextoFactura(SIRENA).ncf, 'E310011691003');
});

test('nombreComercio: salta telefono/direccion y prefiere la razon social', () => {
  // "Sirena" es la primera linea, pero GRUPO RAMOS S.A. lleva sufijo societario
  assert.equal(parsearTextoFactura(SIRENA).nombreComercio, 'GRUPO RAMOS S.A.');
});

test('nombreComercio: sin sufijo societario cae a la primera linea con cara de nombre', () => {
  const t = `FERRETERIA EL MARTILLO
Av. Espana #45, Punta Cana
Tel: 809-555-1234
RNC: 101234567
NCF: B0100000009
TOTAL 500.00`;
  assert.equal(parsearTextoFactura(t).nombreComercio, 'FERRETERIA EL MARTILLO');
});

// Fase 10: factura real de Ari (Punta Cana BM Cargo) — fecha AAAA.MM.DD y "VALIDA HASTA".
test('factura Punta Cana BM Cargo: fecha 2026.07.11, no la de validez', () => {
  const t = `PUNTA CANA BM CARGO SRL
DO - PUNTA CANA
Rnc 131642918
BIMCANA
RNC 1-33-23182-4
FACTURA   FT32-371202
FECHA     2026.07.11
NCF       B0100033899
VALIDA HASTA 2026.12.31
SUB-TOTAL 1212.45
ITBIS      151.04
TOTAL     1363.49`;
  const d = parsearTextoFactura(t, { rncPropio: '1-33-23182-4' });
  assert.equal(d.fechaEmision, '2026-07-11');
  assert.equal(d.ncf, 'B0100033899');
  assert.equal(d.rncEmisor, '131642918');       // el del emisor, no el de BIMCANA
  assert.equal(d.nombreComercio, 'PUNTA CANA BM CARGO SRL');
  assert.equal(d.subtotal, 1212.45);
  assert.equal(d.itbis, 151.04);
  assert.equal(d.total, 1363.49);
});

test('total pelado sigue funcionando cuando no hay etiqueta fuerte', () => {
  const t = 'COMERCIO X\nSUB-TOTAL 100.00\nTOTAL 118.00';
  assert.equal(parsearTextoFactura(t).total, 118);
});

// --- Fase 9: lista negra del verifon (CARDNET / VERIFONE / NOS UNE / PORTAL) ---

test('nombreComercio: CARDNET (marca del verifon) nunca es el comercio', () => {
  const d = parsearTextoFactura(VOUCHER);
  assert.notEqual(d.nombreComercio, 'CARDNET');
});

test('nombreComercio: salta la cabecera VERIFONE / NOS UNE / PORTAL del voucher', () => {
  const t = `VERIFONE
NOS UNE PORTAL
FARMACIA LA ECONOMICA SRL
AV. BARCELO, BAVARO
RNC 131000000
NCF B0100000123
TOTAL RD$ 850.00`;
  assert.equal(parsearTextoFactura(t).nombreComercio, 'FARMACIA LA ECONOMICA SRL');
});
