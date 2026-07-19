import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginar, X3, X2, X1, RATIO_LARGA } from '../src/pdfgastos.js';

const f = (ratio = 2) => ({ archivo: 'a', total: 1, ratio });

// Regla de altura de Ari (calibrada con 57 facturas reales, 2026-07-19): por defecto TODO
// se escala completo a la altura de su casilla; SOLO los tickets de supermercado (ratio > 4)
// se dividen. Gasolineras y restaurantes llegan hasta 3.8 y NO se dividen.
test('RATIO_LARGA calibrado en 4', () => {
  assert.equal(RATIO_LARGA, 4);
});

test('gasolinera/restaurante largos (ratio 3.2-3.8) NO se dividen', () => {
  const p = paginar([f(3.25), f(3.8), f(3.5)]);
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].map(i => i.celdas), [1, 1, 1]);
});

test('supermercado (ratio > 4) SI se divide en 2 casillas', () => {
  const p = paginar([f(4.35)]);
  assert.equal(p[0][0].celdas, 2);
});

test('paginar: 3 normales por pagina en X3', () => {
  const p = paginar([f(), f(), f(), f()]);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0].map(i => i.xs[0]), X3);
  assert.deepEqual(p[1][0].xs, [X1[0]]); // 1 sola → centrada
});

test('paginar: pagina con exactamente 2 usa X2 centradas', () => {
  const p = paginar([f(), f()]);
  assert.deepEqual(p[0].map(i => i.xs[0]), X2);
});

test('paginar: larga (ratio>3) ocupa 2 casillas contiguas', () => {
  const p = paginar([f(), f(6)]);
  assert.equal(p.length, 1);
  assert.equal(p[0][1].celdas, 2);
  assert.deepEqual(p[0][1].xs, [X3[1], X3[2]]);
});

test('paginar: larga que no cabe salta de pagina completa', () => {
  const p = paginar([f(), f(), f(6)]);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0].map(i => i.xs[0]), X2); // las 2 normales quedan centradas
  assert.deepEqual(p[1][0].xs, [X2[0], X2[1]]); // larga sola: 2 casillas centradas
});
