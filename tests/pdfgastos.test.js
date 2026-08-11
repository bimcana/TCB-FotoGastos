import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginar, columnasDe, alturaComun, RATIO_LARGA, ALTURA_MIN, CAJA,
         ANCHO_UTIL, X_INI, HUECO, MAX_COLUMNAS } from '../src/pdfgastos.js';

const f = (ratio = 2) => ({ archivo: 'a', total: 1, ratio });
const CARTA = 11 / 8.5;      // 1.294 — factura de formato carta en vertical
const TICKET = 3;            // gasolinera/restaurante
const SUPER = 5;             // ticket de supermercado (se divide)

// Regla de altura de Ari (calibrada con 57 facturas reales, 2026-07-19): solo los tickets
// de supermercado (ratio > 4) se dividen; gasolineras y restaurantes llegan a 3.8 y no.
test('RATIO_LARGA sigue calibrado en 4', () => {
  assert.equal(RATIO_LARGA, 4);
  assert.deepEqual(columnasDe(3.8), [3.8]);
  assert.deepEqual(columnasDe(4.35), [2.175, 2.175]); // 2 mitades, cada una la mitad de esbelta
});

test('gasolinera/restaurante largos (ratio 3.2-3.8) NO se dividen', () => {
  const p = paginar([f(3.25), f(3.8), f(3.5)]);
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].map(i => i.celdas), [1, 1, 1]);
});

// --- Fase 14: reparto de ancho para que la carta no salga diminuta ---

test('una carta sola llena la altura completa de la banda', () => {
  const [pag] = paginar([f(CARTA)]);
  assert.equal(Math.round(pag[0].alturaCaja), CAJA.h);
  // ancho necesario = alto / ratio ≈ 306 pt, muy por encima de los 198 de la casilla vieja
  assert.ok(pag[0].cajas[0].w > 300, `ancho ${pag[0].cajas[0].w}`);
});

test('la carta ya no se queda corta: misma altura que un ticket en la misma pagina', () => {
  const [pag] = paginar([f(CARTA), f(TICKET)]);
  assert.equal(pag.length, 2);
  assert.equal(pag[0].alturaCaja, pag[1].alturaCaja);      // misma altura para ambas
  assert.equal(Math.round(pag[0].alturaCaja), CAJA.h);      // y es la altura maxima
  assert.ok(pag[0].cajas[0].w > pag[1].cajas[0].w, 'la carta recibe mas ancho que el ticket');
});

test('DOS cartas ocupan la pagina entera (regla de Ari)', () => {
  const p = paginar([f(CARTA), f(CARTA), f(TICKET)]);
  assert.equal(p[0].length, 2, 'la pagina de las dos cartas no admite una tercera');
  assert.equal(Math.round(p[0][0].alturaCaja), CAJA.h);
  assert.equal(p[1].length, 1);
});

test('carta + ticket de supermercado: solo esas dos, la siguiente carta salta de pagina', () => {
  const p = paginar([f(CARTA), f(SUPER), f(CARTA)]);
  assert.equal(p.length, 2);
  assert.equal(p[0].length, 2);            // carta + supermercado (1 + 2 columnas = 3)
  assert.equal(p[0][1].celdas, 2);         // el supermercado sigue partido en dos
  assert.equal(p[1][0].ratio, CARTA);      // la carta siguiente pasa a la pagina nueva
});

test('nunca mas de 3 columnas por pagina', () => {
  for (const p of paginar([f(), f(), f(), f(SUPER), f(CARTA), f(TICKET)])){
    assert.ok(p.reduce((s, i) => s + i.celdas, 0) <= MAX_COLUMNAS);
  }
});

test('ninguna factura queda por debajo de la altura minima', () => {
  const items = [f(CARTA), f(CARTA), f(TICKET), f(SUPER), f(1.5), f(2.5)];
  for (const pag of paginar(items)){
    for (const it of pag) assert.ok(it.alturaCaja >= ALTURA_MIN, `altura ${it.alturaCaja}`);
  }
});

test('las cajas caben en la banda y van en orden, sin solaparse', () => {
  for (const pag of paginar([f(CARTA), f(TICKET)])){
    const cajas = pag.flatMap(i => i.cajas);
    assert.ok(cajas[0].x >= X_INI - 0.01, 'no se sale por la izquierda');
    const ultima = cajas[cajas.length - 1];
    assert.ok(ultima.x + ultima.w <= X_INI + ANCHO_UTIL + 0.01, 'no se sale por la derecha');
    for (let i = 1; i < cajas.length; i++){
      const separacion = cajas[i].x - (cajas[i-1].x + cajas[i-1].w);
      assert.ok(Math.abs(separacion - HUECO) < 0.01, `hueco ${separacion}`);
    }
  }
});

test('el grupo queda centrado en la banda', () => {
  const [pag] = paginar([f(TICKET), f(TICKET)]);  // dos estrechos: sobra espacio
  const cajas = pag.flatMap(i => i.cajas);
  const izq = cajas[0].x - X_INI;
  const der = (X_INI + ANCHO_UTIL) - (cajas[cajas.length-1].x + cajas[cajas.length-1].w);
  assert.ok(Math.abs(izq - der) < 0.01, `margenes ${izq} vs ${der}`);
});

test('alturaComun: 3 columnas iguales reproducen el ancho historico de 198 pt', () => {
  // 3 casillas de la plantilla: ratio 2 = 396/198 exacto
  assert.equal(Math.round(alturaComun([2, 2, 2])), CAJA.h);
  const anchoCada = alturaComun([2, 2, 2]) / 2;
  assert.ok(Math.abs(anchoCada - CAJA.w) < 0.5, `ancho ${anchoCada}`);
});

test('paginar sin items o con lista vacia no revienta', () => {
  assert.deepEqual(paginar([]), []);
  assert.deepEqual(paginar(null), []);
});
