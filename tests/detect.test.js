import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordenarEsquinas, esEstable, dimensionesDestino } from '../src/detect.js';

const cuad = [{x:100,y:10},{x:10,y:12},{x:12,y:200},{x:98,y:198}]; // desordenado

test('ordena tl,tr,br,bl', () => {
  const [tl,tr,br,bl] = ordenarEsquinas(cuad);
  assert.deepEqual(tl, {x:10,y:12});
  assert.deepEqual(tr, {x:100,y:10});
  assert.deepEqual(br, {x:98,y:198});
  assert.deepEqual(bl, {x:12,y:200});
});
test('estable dentro de tolerancia', () => {
  const a = ordenarEsquinas(cuad);
  const b = a.map(p => ({x:p.x+3, y:p.y-3}));
  assert.equal(esEstable(a, b, 8), true);
  assert.equal(esEstable(a, b, 2), false);
});
test('dimensiones destino ~ ancho y alto medios', () => {
  const r = dimensionesDestino([{x:0,y:0},{x:100,y:0},{x:100,y:200},{x:0,y:200}]);
  assert.deepEqual(r, {w:100, h:200});
});
