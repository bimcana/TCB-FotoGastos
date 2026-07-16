import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordenarEsquinas, esEstable, dimensionesDestino, cuadrilateroValido, areaCuadrilatero, boundingBox, escalaTrabajo,
         mapearEsquinas, tocaBorde } from '../src/detect.js';

test('mapearEsquinas escala x/y de forma independiente', () => {
  assert.deepEqual(mapearEsquinas([{x:10,y:20}], 2, 0.5), [{x:20,y:10}]);
});

test('tocaBorde detecta esquinas pegadas al borde del frame', () => {
  const dentro = [{x:50,y:50},{x:950,y:50},{x:950,y:950},{x:50,y:950}];
  assert.equal(tocaBorde(dentro, 1000, 1000), false);
  assert.equal(tocaBorde([{x:5,y:500},...dentro.slice(1)], 1000, 1000), true);  // x en el 1%
  assert.equal(tocaBorde([{x:50,y:996},...dentro.slice(1)], 1000, 1000), true); // y al fondo
});

test('escalaTrabajo limita el lado mayor a maxLado y nunca amplia', () => {
  assert.equal(escalaTrabajo(1920, 1080, 700), 700 / 1920);
  assert.equal(escalaTrabajo(4000, 3000, 1200), 1200 / 4000);
  assert.equal(escalaTrabajo(500, 400, 700), 1);
});

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

test('bounding box de un cuadrilatero inclinado', () => {
  const bb = boundingBox([{x:80,y:50},{x:320,y:55},{x:315,y:250},{x:75,y:245}]);
  assert.equal(bb.x, 75);
  assert.equal(bb.y, 50);
  assert.equal(bb.w, 320 - 75);   // 245
  assert.equal(bb.h, 250 - 50);   // 200
});
test('bounding box nunca tiene ancho/alto cero', () => {
  const bb = boundingBox([{x:10,y:10},{x:10,y:10},{x:10,y:10},{x:10,y:10}]);
  assert.ok(bb.w >= 1 && bb.h >= 1);
});
