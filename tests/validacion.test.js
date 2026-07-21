import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ncfValido, normalizarFecha, montoValido, buscarDuplicado, facturaCompleta, estadoFactura, normalizarMontoTexto, formatearFechaDO, formatearMonto } from '../src/validacion.js';

test('NCF serie B válido', () => { assert.equal(ncfValido('B0100182291'), true); });
test('NCF serie E válido', () => { assert.equal(ncfValido('E310000083906'), true); });
test('NCF inválido (corto / con espacios / vacío)', () => {
  assert.equal(ncfValido('B01001'), false);
  assert.equal(ncfValido('B01 0018 2291'), false);
  assert.equal(ncfValido(''), false);
  assert.equal(ncfValido(null), false);
});
test('normalizarFecha ISO', () => { assert.equal(normalizarFecha('2025-06-11'), '2025-06-11'); });
test('normalizarFecha DD/MM/AAAA', () => { assert.equal(normalizarFecha('11/06/2025'), '2025-06-11'); });
test('normalizarFecha español "11 jun. 2025"', () => { assert.equal(normalizarFecha('11 jun. 2025'), '2025-06-11'); });
test('normalizarFecha basura → null', () => { assert.equal(normalizarFecha('no es fecha'), null); });
test('montoValido', () => {
  assert.equal(montoValido(3724.80), true);
  assert.equal(montoValido(-1), false);
  assert.equal(montoValido('x'), false);
});
test('buscarDuplicado encuentra por NCF', () => {
  const idx = { facturas: [{ archivo:'Compra_100.jpg', ncf:'B0100077145' }] };
  assert.equal(buscarDuplicado(idx, 'B0100077145').archivo, 'Compra_100.jpg');
  assert.equal(buscarDuplicado(idx, 'B0100182291'), null);
  assert.equal(buscarDuplicado({ facturas: [] }, 'B0100077145'), null);
});

const DATOS_COMPLETOS = { fechaEmision:'2025-06-11', ncf:'B0100182291', rncEmisor:'131067603', total:3724.8 };

test('facturaCompleta true con los 4 esenciales', () => {
  assert.equal(facturaCompleta(DATOS_COMPLETOS), true);
});
test('facturaCompleta false si falta fechaEmision', () => {
  assert.equal(facturaCompleta({ ...DATOS_COMPLETOS, fechaEmision: null }), false);
});
test('facturaCompleta false si falta ncf', () => {
  assert.equal(facturaCompleta({ ...DATOS_COMPLETOS, ncf: null }), false);
});
test('facturaCompleta false si falta rncEmisor', () => {
  assert.equal(facturaCompleta({ ...DATOS_COMPLETOS, rncEmisor: null }), false);
});
test('facturaCompleta false si falta total', () => {
  assert.equal(facturaCompleta({ ...DATOS_COMPLETOS, total: null }), false);
});

test('estadoFactura: completos + origen gemini → completa', () => {
  assert.equal(estadoFactura(DATOS_COMPLETOS, 'gemini'), 'completa');
});
test('estadoFactura: completos + origen manual → completa', () => {
  assert.equal(estadoFactura(DATOS_COMPLETOS, 'manual'), 'completa');
});
test('estadoFactura: completos + origen local → pendiente', () => {
  assert.equal(estadoFactura(DATOS_COMPLETOS, 'local'), 'pendiente');
});
test('estadoFactura: falta un esencial (total) → incompleta aunque origen sea gemini', () => {
  assert.equal(estadoFactura({ ...DATOS_COMPLETOS, total: null }, 'gemini'), 'incompleta');
});

// --- Fase 5: entrada tipo Excel (el campo corrige lo que el usuario quiso escribir) ---
test('normalizarFecha: digitos corridos, mes en letras, punto y año corto', () => {
  assert.equal(normalizarFecha('17072026'), '2026-07-17');
  assert.equal(normalizarFecha('17/JUL/2026'), '2026-07-17');
  assert.equal(normalizarFecha('17.07.2026'), '2026-07-17');
  assert.equal(normalizarFecha('17/07/26'), '2026-07-17');
  assert.equal(normalizarFecha('VIE,17/JUL/2026'), '2026-07-17');
});

test('normalizarMontoTexto: miles, comas decimales, espacios y simbolos', () => {
  assert.equal(normalizarMontoTexto('RD$3,620.00'), 3620);
  assert.equal(normalizarMontoTexto('3, 620.00'), 3620);
  assert.equal(normalizarMontoTexto('3.620,00'), 3620);
  assert.equal(normalizarMontoTexto('45,50'), 45.5);
  assert.equal(normalizarMontoTexto('1234'), 1234);
  assert.equal(normalizarMontoTexto('abc'), null);
  assert.equal(normalizarMontoTexto(''), null);
});

// --- Fase 7: formato dominicano de presentacion (se guarda ISO, se muestra DD-MM-AAAA) ---
test('formatearFechaDO: ISO → DD-MM-AAAA; tolera basura', () => {
  assert.equal(formatearFechaDO('2026-07-17'), '17-07-2026');
  assert.equal(formatearFechaDO('17-07-2026'), '17-07-2026'); // ya formateada, idempotente
  assert.equal(formatearFechaDO(''), '');
  assert.equal(formatearFechaDO(null), '');
  assert.equal(formatearFechaDO('texto raro'), 'texto raro'); // no destruye lo que el usuario escribio
});

test('formatearMonto: miles con coma y 2 decimales', () => {
  assert.equal(formatearMonto(2500), '2,500.00');
  assert.equal(formatearMonto(3620.5), '3,620.50');
  assert.equal(formatearMonto(45), '45.00');
  assert.equal(formatearMonto(1234567.891), '1,234,567.89');
  assert.equal(formatearMonto(null), '');
  assert.equal(formatearMonto('abc'), '');
});

test('ida y vuelta: lo mostrado se vuelve a leer igual', () => {
  assert.equal(normalizarMontoTexto(formatearMonto(2500)), 2500);
  assert.equal(normalizarFecha(formatearFechaDO('2026-07-17')), '2026-07-17');
});
