import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordenarEsquinas, esEstable, dimensionesDestino, cuadrilateroValido, areaCuadrilatero, boundingBox, escalaTrabajo,
         mapearEsquinas, tocaBorde, recorteConfiable, angulosInternos, ladosOpuestosParecidos,
         bordesLaterales, extenderLateralesAlMarco } from '../src/detect.js';

// --- Fase 10: guardas de forma de papel y banda lateral ---

test('angulosInternos: rectangulo → 90 grados en las 4 esquinas', () => {
  const e = [{x:0,y:0},{x:100,y:0},{x:100,y:200},{x:0,y:200}];
  angulosInternos(e).forEach(a => assert.ok(Math.abs(a - 90) < 0.001, `angulo ${a}`));
});

test('ladosOpuestosParecidos: rectangulo si, trapecio muy deforme no', () => {
  assert.equal(ladosOpuestosParecidos([{x:0,y:0},{x:100,y:0},{x:100,y:200},{x:0,y:200}]), true);
  // arriba 100 vs abajo 20: 80% de diferencia
  assert.equal(ladosOpuestosParecidos([{x:0,y:0},{x:100,y:0},{x:60,y:200},{x:40,y:200}]), false);
});

test('recorteConfiable rechaza por ANGULO (rombo alargado, esquinas en punta)', () => {
  const rombo = [{x:500,y:40},{x:700,y:640},{x:500,y:1240},{x:300,y:640}];
  const angs = angulosInternos(rombo);
  assert.ok(angs.some(a => a < 65), 'el rombo debe tener esquinas agudas');
  assert.equal(recorteConfiable(rombo, 1000, 1300), false);
});

test('recorteConfiable rechaza por LADOS desiguales (trapecio: se comio fondo)', () => {
  const trapecio = [{x:60,y:40},{x:900,y:40},{x:520,y:1240},{x:20,y:1010}];
  assert.ok(angulosInternos(trapecio).every(a => a > 65 && a < 115), 'angulos dentro de rango');
  assert.equal(ladosOpuestosParecidos(trapecio), false); // arriba 840 vs abajo 550
  assert.equal(recorteConfiable(trapecio, 1000, 1300), false);
});

// LECCION DEL FALLO DE CAMPO (ticket sobre granito): el recorte malo era un
// paralelogramo ROTADO — angulos ~90 y lados opuestos iguales — asi que pasa TODA
// guarda geometrica. Por eso el auto-recorte exige ademas `fraccionClara` (contenido
// claro dentro), que es lo unico que distingue papel de "papel + franja de granito".
test('un paralelogramo rotado pasa la geometria: la guarda real es el contenido', () => {
  const rotado = [{x:120,y:60},{x:880,y:240},{x:800,y:1240},{x:40,y:1060}];
  const angs = angulosInternos(rotado);
  assert.ok(angs.every(a => a > 65 && a < 115), 'un rotado tiene angulos casi rectos');
  assert.equal(ladosOpuestosParecidos(rotado), true);
  assert.equal(recorteConfiable(rotado, 1000, 1300), true); // geometria OK…
  // …y por eso main.js NO lo aplica sin comprobar fraccionClara >= 0.75.
});

test('bordesLaterales: usa percentiles, una veta del fondo no arrastra el borde', () => {
  const filas = [];
  for (let i = 0; i < 100; i++) filas.push({ izq: 200, der: 800 });
  filas[3] = { izq: 5, der: 995 };   // fila contaminada por una veta clara
  filas[7] = { izq: 10, der: 990 };
  const b = bordesLaterales(filas, 1000);
  assert.equal(b.izq, 200);
  assert.equal(b.der, 800);
});

test('bordesLaterales: sin filas utiles o banda angosta → null', () => {
  assert.equal(bordesLaterales([null, null], 1000), null);
  const angosta = Array.from({ length: 50 }, () => ({ izq: 500, der: 560 }));
  assert.equal(bordesLaterales(angosta, 1000), null);
});

// Pedido de Ari: laterales del papel prolongados al borde superior e inferior de la foto.
test('extenderLateralesAlMarco: ticket recto → banda de altura completa', () => {
  const e = [{x:300,y:200},{x:600,y:200},{x:600,y:1200},{x:300,y:1200}];
  const r = extenderLateralesAlMarco(e, 1600);
  assert.deepEqual(r, [{x:300,y:0},{x:600,y:0},{x:600,y:1600},{x:300,y:1600}]);
});

test('extenderLateralesAlMarco: ticket inclinado → los laterales conservan la inclinacion', () => {
  // Lado izquierdo va de (300,200) a (340,1200): pendiente 40/1000 por unidad de y
  const e = [{x:300,y:200},{x:600,y:200},{x:640,y:1200},{x:340,y:1200}];
  const r = extenderLateralesAlMarco(e, 1600);
  assert.equal(r[0].y, 0); assert.equal(r[3].y, 1600);
  assert.ok(Math.abs(r[0].x - 292) < 0.01, `izq en y=0 → ${r[0].x}`);   // 300 - 40*0.2
  assert.ok(Math.abs(r[3].x - 356) < 0.01, `izq en y=H → ${r[3].x}`);   // 300 + 40*1.4
  assert.ok(r[1].x > r[0].x && r[2].x > r[3].x, 'derecha siempre a la derecha');
});

test('extenderLateralesAlMarco: lados horizontales o entrada invalida → null', () => {
  const horizontal = [{x:0,y:100},{x:900,y:100},{x:900,y:100},{x:0,y:100}];
  assert.equal(extenderLateralesAlMarco(horizontal, 1600), null);
  assert.equal(extenderLateralesAlMarco(null, 1600), null);
  assert.equal(extenderLateralesAlMarco([{x:0,y:0}], 1600), null);
});

// --- Fase 9: confianza del recorte automatico en importacion ---

test('recorteConfiable: rectangulo grande y centrado → confiable (sin editor)', () => {
  const e = [{x:100,y:150},{x:900,y:150},{x:900,y:1100},{x:100,y:1100}];
  assert.equal(recorteConfiable(e, 1000, 1300), true);
});

test('recorteConfiable: papel en perspectiva razonable → confiable', () => {
  const e = [{x:180,y:120},{x:820,y:200},{x:880,y:1080},{x:120,y:1000}];
  assert.equal(recorteConfiable(e, 1000, 1300), true);
});

test('recorteConfiable: cuadrilatero chico (menos del 15%) → editor', () => {
  const e = [{x:400,y:500},{x:640,y:500},{x:640,y:800},{x:400,y:800}];
  assert.equal(recorteConfiable(e, 1000, 1300), false);
});

test('recorteConfiable: angulo degenerado (aguja) → editor', () => {
  // Cumple area y lados minimos pero una esquina queda casi plana (~180 grados)
  const e = [{x:20,y:640},{x:980,y:600},{x:960,y:660},{x:40,y:700}];
  assert.equal(recorteConfiable(e, 1000, 1300), false);
});

test('recorteConfiable: null o sin 4 puntos → editor', () => {
  assert.equal(recorteConfiable(null, 1000, 1300), false);
  assert.equal(recorteConfiable([{x:0,y:0},{x:1,y:0},{x:1,y:1}], 1000, 1300), false);
});

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
