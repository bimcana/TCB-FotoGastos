import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curvaContraste, fuerzaDesdeIntensidad } from '../src/enhance.js';

test('la curva mantiene los extremos', () => {
  assert.ok(curvaContraste(0) < 5);
  assert.ok(curvaContraste(255) > 250);
});
test('aclara los tonos altos (papel gris -> mas blanco)', () => {
  assert.ok(curvaContraste(200) > 200);
});
test('oscurece los tonos bajos (tinta gris -> mas negra)', () => {
  assert.ok(curvaContraste(60) < 60);
});
test('es monotona creciente', () => {
  let prev = -1;
  for (let v = 0; v <= 255; v += 15){ const y = curvaContraste(v); assert.ok(y >= prev); prev = y; }
});

test('intensidad 0 -> fuerza minima', () => { assert.ok(Math.abs(fuerzaDesdeIntensidad(0) - 0.35) < 1e-9); });
test('intensidad 100 -> fuerza maxima', () => { assert.ok(Math.abs(fuerzaDesdeIntensidad(100) - 0.85) < 1e-9); });
test('intensidad 50 -> intermedia y monotona', () => {
  assert.ok(fuerzaDesdeIntensidad(50) > fuerzaDesdeIntensidad(0));
  assert.ok(fuerzaDesdeIntensidad(50) < fuerzaDesdeIntensidad(100));
});
