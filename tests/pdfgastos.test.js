import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginar, columnasDe, factorEscala, anchoFisico, RATIO_LARGA, RATIO_CARTA,
         FACTOR_MIN, ESTIRADO_MAX, CAJA, ANCHO_UTIL, X_INI, HUECO, MAX_COLUMNAS,
         ANCHO_CARTA, ANCHO_ROLLO } from '../src/pdfgastos.js';

const f = (ratio = 2) => ({ archivo: 'a', total: 1, ratio });
const CARTA = 11 / 8.5;   // 1.29 — hoja carta completa
const GASOLINA = 2.2;     // voucher Cardnet de gasolina: papel estrecho y corto
const TICKET = 3.4;       // ticket de farmacia/restaurante, papel estrecho y largo
const SUPER = 5;          // ticket de supermercado (se divide en dos)

// Calibrado con 93 facturas reales: hasta 1.9 son hojas (8.5"), por encima rollos (~3").
test('anchoFisico: hoja carta vs rollo de caja', () => {
  assert.equal(anchoFisico(CARTA), ANCHO_CARTA);
  assert.equal(anchoFisico(1.85), ANCHO_CARTA);
  assert.equal(anchoFisico(RATIO_CARTA), ANCHO_ROLLO);
  assert.equal(anchoFisico(GASOLINA), ANCHO_ROLLO);
});

test('RATIO_LARGA sigue en 4: solo el supermercado se divide', () => {
  assert.equal(RATIO_LARGA, 4);
  assert.equal(columnasDe(3.8).length, 1);
  assert.equal(columnasDe(4.35).length, 2);
  // cada mitad mide la mitad de alto que el ticket entero
  assert.equal(columnasDe(4.35)[0].h, (ANCHO_ROLLO * 4.35) / 2);
});

// --- Lo que pidio Ari: el tamaño en la hoja debe reflejar el tamaño del papel ---

test('el voucher de gasolina NO compite con una hoja carta', () => {
  const [pag] = paginar([f(CARTA), f(GASOLINA)]);
  const carta = pag[0].cajas[0], gasolina = pag[1].cajas[0];
  assert.ok(carta.w > gasolina.w * 2, 'la carta es mucho mas ancha');
  assert.ok(carta.h > gasolina.h * 1.5, `la carta es mas alta (${carta.h} vs ${gasolina.h})`);
});

test('la gasolina tampoco compite con un ticket largo del mismo ancho de papel', () => {
  const [pag] = paginar([f(TICKET), f(GASOLINA)]);
  const ticket = pag[0].cajas[0], gasolina = pag[1].cajas[0];
  assert.ok(ticket.h > gasolina.h * 1.4, `ticket ${ticket.h} vs gasolina ${gasolina.h}`);
  // mismo papel → practicamente el mismo ancho (salvo el estirado)
  assert.ok(Math.abs(ticket.w - gasolina.w) < 1, 'ambos son rollos: mismo ancho');
});

test('el supermercado se ve mas grande que la gasolina (caso de la imagen 6)', () => {
  const SUPER_CORTO = 3.8;   // ticket de supermercado que aun no llega al umbral de division
  const [pag] = paginar([f(TICKET), f(GASOLINA), f(SUPER_CORTO)]);
  assert.equal(pag.length, 3, 'las tres caben en la pagina');
  const areaDe = it => it.cajas.reduce((s, c) => s + c.w * c.h, 0);
  assert.ok(areaDe(pag[2]) > areaDe(pag[1]), 'el supermercado ocupa mas que la gasolina');
  assert.ok(pag[2].cajas[0].h > pag[1].cajas[0].h * 1.5, 'y es claramente mas alto');
});

test('el supermercado dividido ocupa 2 columnas: solo cabe una factura mas', () => {
  const p = paginar([f(TICKET), f(GASOLINA), f(SUPER)]);
  assert.equal(p[0].length, 2, 'ticket + gasolina llenarian 2 columnas…');
  assert.equal(p[1][0].celdas, 2, '…y el supermercado se lleva 2 en la pagina siguiente');
});

test('dos tickets estrechos dejan sitio para un tercero (caso de la imagen 2)', () => {
  const p = paginar([f(2.9), f(2.5), f(TICKET)]);
  assert.equal(p.length, 1, 'los tres caben en una sola pagina');
  assert.equal(p[0].length, 3);
});

test('DOS cartas ocupan la pagina entera; una tercera no cabe', () => {
  const p = paginar([f(CARTA), f(CARTA), f(TICKET)]);
  assert.equal(p[0].length, 2);
  assert.equal(p[1].length, 1);
});

test('carta + supermercado: solo esos dos, la siguiente carta salta de pagina', () => {
  const p = paginar([f(CARTA), f(SUPER), f(CARTA)]);
  assert.equal(p.length, 2);
  assert.equal(p[0].length, 2);
  assert.equal(p[0][1].celdas, 2);
  assert.equal(p[1][0].ratio, CARTA);
});

test('una carta sola aprovecha la altura completa de la banda', () => {
  const [pag] = paginar([f(CARTA)]);
  assert.ok(pag[0].cajas[0].h > CAJA.h * 0.95, `alto ${pag[0].cajas[0].h}`);
});

test('los rollos se estiran como mucho un 10% y las hojas nunca', () => {
  const [pag] = paginar([f(TICKET), f(GASOLINA)]);      // sobra sitio: se estiran
  const anchoSinEstirar = ANCHO_ROLLO * pag[0].factor;
  assert.ok(pag[0].cajas[0].w <= anchoSinEstirar * ESTIRADO_MAX + 0.01, 'no pasa del 10%');
  assert.ok(pag[0].cajas[0].w >= anchoSinEstirar - 0.01, 'nunca se encoge');
  const [pag2] = paginar([f(CARTA), f(GASOLINA)]);
  assert.ok(Math.abs(pag2[0].cajas[0].w - ANCHO_CARTA * pag2[0].factor) < 0.01,
    'la hoja carta conserva su proporcion exacta');
});

test('nada se sale de la banda y las cajas van separadas y en orden', () => {
  for (const items of [[f(CARTA), f(GASOLINA)], [f(TICKET), f(GASOLINA), f(SUPER)], [f(CARTA), f(CARTA)]]){
    for (const pag of paginar(items)){
      const cajas = pag.flatMap(i => i.cajas);
      assert.ok(cajas[0].x >= X_INI - 0.01, 'no se sale por la izquierda');
      const u = cajas[cajas.length - 1];
      assert.ok(u.x + u.w <= X_INI + ANCHO_UTIL + 0.01, 'no se sale por la derecha');
      for (const c of cajas) assert.ok(c.h <= CAJA.h + 0.01, `alto ${c.h} cabe en la banda`);
      for (let i = 1; i < cajas.length; i++){
        const sep = cajas[i].x - (cajas[i-1].x + cajas[i-1].w);
        assert.ok(sep >= HUECO - 0.01, `separacion ${sep} >= ${HUECO}`);
      }
    }
  }
});

test('el grupo queda centrado en la banda', () => {
  const [pag] = paginar([f(TICKET), f(GASOLINA)]);
  const cajas = pag.flatMap(i => i.cajas);
  const izq = cajas[0].x - X_INI;
  const der = (X_INI + ANCHO_UTIL) - (cajas[cajas.length-1].x + cajas[cajas.length-1].w);
  assert.ok(Math.abs(izq - der) < 0.01, `margenes ${izq} vs ${der}`);
});

test('nunca mas de 3 columnas por pagina', () => {
  for (const p of paginar([f(), f(), f(), f(SUPER), f(CARTA), f(TICKET)]))
    assert.ok(p.reduce((s, i) => s + i.celdas, 0) <= MAX_COLUMNAS);
});

test('factorEscala: dos cartas caben juntas, tres no (regla de Ari)', () => {
  assert.ok(factorEscala(columnasDe(CARTA).concat(columnasDe(CARTA))) >= FACTOR_MIN);
  const tres = columnasDe(CARTA).concat(columnasDe(CARTA), columnasDe(CARTA));
  assert.ok(factorEscala(tres) < FACTOR_MIN);
});

test('paginar sin items o con lista vacia no revienta', () => {
  assert.deepEqual(paginar([]), []);
  assert.deepEqual(paginar(null), []);
});
