import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordenarEsquinas, esEstable, dimensionesDestino, cuadrilateroValido, areaCuadrilatero } from '../src/detect.js';

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

test('area de un rectangulo 100x200 = 20000', () => {
  assert.equal(areaCuadrilatero([{x:0,y:0},{x:100,y:0},{x:100,y:200},{x:0,y:200}]), 20000);
});
test('rechaza cuadrilatero que abarca casi todo el frame', () => {
  const casiTodo = [{x:1,y:1},{x:399,y:1},{x:399,y:299},{x:1,y:299}];
  assert.equal(cuadrilateroValido(casiTodo, 400, 300), false);
});
test('rechaza cuadrilatero diminuto', () => {
  const chico = [{x:10,y:10},{x:40,y:10},{x:40,y:40},{x:10,y:40}];
  assert.equal(cuadrilateroValido(chico, 400, 300), false);
});
test('acepta un papel razonable centrado', () => {
  const papel = [{x:80,y:50},{x:320,y:55},{x:315,y:250},{x:75,y:245}];
  assert.equal(cuadrilateroValido(papel, 400, 300), true);
});
