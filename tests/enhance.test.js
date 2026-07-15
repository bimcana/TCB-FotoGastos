import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curvaContraste } from '../src/enhance.js';

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
