import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginar, X3, X2, X1 } from '../src/pdfgastos.js';

const f = (ratio = 2) => ({ archivo: 'a', total: 1, ratio });

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
