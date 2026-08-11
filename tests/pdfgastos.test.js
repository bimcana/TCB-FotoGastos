import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginar, columnasDe, factorEscala, anchoFisico, esCarta, cabeEnPagina,
         realceComun, RATIO_LARGA, RATIO_CARTA, REALCE_MAX, CAJA, ANCHO_UTIL, X_INI,
         HUECO, MAX_COLUMNAS, ANCHO_CARTA, ANCHO_ROLLO } from '../src/pdfgastos.js';

const f = (ratio = 2) => ({ archivo: 'a', total: 1, ratio });
const CARTA = 11 / 8.5;   // 1.29 — hoja carta completa
const GASOLINA = 2.2;     // voucher Cardnet de gasolina: papel estrecho y corto
const TICKET = 3.4;       // ticket de farmacia/restaurante, papel estrecho y largo
const SUPER = 5;          // ticket de supermercado (se divide en dos)

// Frontera calibrada MIRANDO las facturas reales, no solo los numeros:
//   240.jpg ratio 1.31 = hoja carta de verdad (BM Cargo)
//   051.jpg ratio 1.62 = GASOLINA (rollo termico de United Petroleum)
// Con el umbral viejo (1.9) el voucher de gasolina entraba como hoja y aplastaba la pagina.
test('anchoFisico: hoja carta vs rollo de caja', () => {
  assert.equal(anchoFisico(CARTA), ANCHO_CARTA);       // 1.29 carta
  assert.equal(anchoFisico(1.414), ANCHO_CARTA);       // A4
  assert.equal(anchoFisico(1.31), ANCHO_CARTA);        // 240.jpg, hoja real
  assert.equal(anchoFisico(1.62), ANCHO_ROLLO);        // 051.jpg, gasolina real
  assert.equal(anchoFisico(1.84), ANCHO_ROLLO);
  assert.equal(anchoFisico(GASOLINA), ANCHO_ROLLO);
});

test('la gasolina de ratio bajo NO se trata como hoja (caso 051.jpg)', () => {
  // Antes: ratio 1.62 → CARTA → 8.5" de ancho → salia enorme junto a facturas mayores
  const [pag] = paginar([f(1.62), f(3.2)]);   // gasolina + ticket mas largo
  const gasolina = pag[0], ticket = pag[1];
  // El ancho de PAPEL es el mismo (ambos rollos); si difieren es solo por el realce
  assert.equal(anchoFisico(gasolina.ratio), anchoFisico(ticket.ratio));
  assert.ok(gasolina.cajas[0].w < ANCHO_CARTA * gasolina.factor * 0.75,
    'ni de lejos recibe el ancho de una hoja');
  assert.ok(ticket.cajas[0].h > gasolina.cajas[0].h, 'el ticket mas largo se ve mas alto');
});

test('una hoja carta junto a una gasolina: la hoja manda y llena la altura', () => {
  const [pag] = paginar([f(1.62), f(CARTA)]);
  const gasolina = pag[0].cajas[0], carta = pag[1].cajas[0];
  assert.ok(carta.h > CAJA.h * 0.95, `la carta llena el frame (${carta.h})`);
  assert.ok(carta.w > gasolina.w * 1.7, 'y es bastante mas ancha que el voucher');
  assert.ok(carta.h > gasolina.h * 1.4, 'la gasolina crece pero no alcanza a la hoja');
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
  assert.ok(carta.w > gasolina.w * 1.5, 'la carta es bastante mas ancha');
  assert.ok(carta.h > gasolina.h * 1.2, `la carta es mas alta (${carta.h} vs ${gasolina.h})`);
  assert.ok(carta.h > CAJA.h * 0.95, 'y la hoja llena el frame');
});

test('la gasolina tampoco compite con un ticket largo del mismo ancho de papel', () => {
  const [pag] = paginar([f(TICKET), f(GASOLINA)]);
  const ticket = pag[0].cajas[0], gasolina = pag[1].cajas[0];
  assert.ok(ticket.h > gasolina.h * 1.15, `ticket ${ticket.h} vs gasolina ${gasolina.h}`);
  assert.ok(ticket.h > CAJA.h * 0.95, 'el ticket largo llena el frame');
  // Mismo papel: si el ancho difiere es solo por el realce de la mas pequeña
  assert.equal(anchoFisico(TICKET), anchoFisico(GASOLINA));
});

test('el supermercado se ve mas grande que la gasolina (caso de la imagen 6)', () => {
  const SUPER_CORTO = 3.8;   // ticket de supermercado que aun no llega al umbral de division
  const [pag] = paginar([f(TICKET), f(GASOLINA), f(SUPER_CORTO)]);
  assert.equal(pag.length, 3, 'las tres caben en la pagina');
  // En esta maquetacion "mas grande" se percibe por la ALTURA (todas comparten banda)
  assert.ok(pag[2].cajas[0].h > pag[1].cajas[0].h, 'el supermercado se ve mas alto que la gasolina');
  assert.ok(pag[2].cajas[0].h > CAJA.h * 0.95, 'y llena el frame');
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

// --- REGLA DE LLENADO (Ari): SIEMPRE 3 por pagina, salvo supermercado o dos cartas ---

test('tres facturas normales SIEMPRE van juntas en una pagina', () => {
  const p = paginar([f(2.3), f(2.03), f(2.23)]);
  assert.equal(p.length, 1);
  assert.equal(p[0].length, 3);
});

test('NINGUNA factura normal se queda sola en su pagina (la regresion que vio Ari)', () => {
  // Mezcla real de Junio 2025 que antes producia paginas de una sola factura
  const ratios = [2.3, 2.03, 2.23, 2.1, 3.96, 1.62, 2.23, 3.23, 2.37, 2.44, 3, 3.2,
                  3.55, 1.84, 2.67, 2.96, 1.88, 2.26];
  for (const pag of paginar(ratios.map(f))){
    const soloUna = pag.length === 1 && pag[0].celdas === 1;
    assert.ok(!soloUna, `factura sola con ratio ${pag[0].ratio}`);
  }
});

test('una carta con dos tickets caben las tres', () => {
  const p = paginar([f(CARTA), f(TICKET), f(GASOLINA)]);
  assert.equal(p.length, 1);
  assert.equal(p[0].length, 3);
});

test('DOS cartas ocupan la pagina entera; una tercera no cabe', () => {
  const p = paginar([f(CARTA), f(CARTA), f(TICKET)]);
  assert.equal(p[0].length, 2);
  assert.equal(p[1].length, 1);
});

test('cabeEnPagina: la regla, en una funcion pura', () => {
  const carta = f(CARTA), rollo = f(TICKET), sup = f(SUPER);
  assert.equal(cabeEnPagina([rollo, rollo], rollo), true);    // 3 normales: si
  assert.equal(cabeEnPagina([rollo, rollo, rollo], rollo), false); // 4: no
  assert.equal(cabeEnPagina([carta, rollo], rollo), true);    // carta + 2 rollos: si
  assert.equal(cabeEnPagina([carta, carta], rollo), false);   // 2 cartas: cerrado
  assert.equal(cabeEnPagina([carta], carta), true);           // 2 cartas juntas: si
  assert.equal(cabeEnPagina([rollo], sup), true);             // rollo + supermercado (3 col)
  assert.equal(cabeEnPagina([rollo, rollo], sup), false);     // se pasaria de 3 columnas
  assert.equal(cabeEnPagina([sup], sup), false);              // dos supermercados: no
});

test('esCarta: la frontera esta en 1.45 (entre A4 y el voucher de gasolina)', () => {
  assert.equal(esCarta(1.29), true);   // carta
  assert.equal(esCarta(1.414), true);  // A4
  assert.equal(esCarta(RATIO_CARTA), false);
  assert.equal(esCarta(1.62), false);  // gasolina real
  assert.equal(esCarta(3), false);
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

// --- Realce de las pequeñas (Ari): que la pagina quede mas pareja ---

test('una gasolina junto a un ticket largo crece si sobra sitio, sin deformarse', () => {
  const [pag] = paginar([f(TICKET), f(1.62), f(1.62)]);   // dos gasolinas reales + un ticket
  const ticket = pag[0].cajas[0], gasolina = pag[1].cajas[0];
  // El ticket manda la altura; las gasolinas crecen pero sin alcanzarlo
  assert.ok(ticket.h > gasolina.h, 'la gasolina sigue siendo mas baja que el ticket');
  const sinRealce = ANCHO_ROLLO * pag[0].factor;
  assert.ok(gasolina.w > sinRealce * 1.15, `la gasolina crece (${gasolina.w} vs ${sinRealce})`);
  // Crecimiento PROPORCIONAL: la proporcion del papel se respeta
  assert.ok(Math.abs(gasolina.h / gasolina.w - 1.62) < 0.01, 'no se deforma');
});

test('el realce nunca pasa del 50% ni rebasa la altura del frame', () => {
  for (const items of [[f(1.62), f(1.62)], [f(TICKET), f(1.62), f(2.2)], [f(CARTA), f(1.62)]]){
    for (const pag of paginar(items)){
      for (const it of pag){
        for (const c of it.cajas){
          assert.ok(c.h <= CAJA.h + 0.01, `alto ${c.h} cabe en el frame`);
          const sinRealce = anchoFisico(it.ratio) * it.factor;
          assert.ok(c.w <= sinRealce * REALCE_MAX + 0.01, `no pasa del 50% (${c.w})`);
        }
      }
    }
  }
});

test('la hoja carta no se realza: ya llena la altura', () => {
  const [pag] = paginar([f(CARTA), f(GASOLINA)]);
  assert.ok(Math.abs(pag[0].cajas[0].w - ANCHO_CARTA * pag[0].factor) < 0.01,
    'la hoja conserva su tamaño exacto');
});

test('realceComun: reparte el ancho libre respetando el tope de cada una', () => {
  const cerca = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≈ ${b}`);
  // dos columnas de 100 pt: una puede crecer x1.5, la otra ya esta al maximo (tope 1)
  cerca(realceComun([100, 100], [1.5, 1], 50), 1.5);   // le sobra sitio: crece al maximo
  cerca(realceComun([100, 100], [1.5, 1], 25), 1.25);  // solo la mitad del camino
  assert.equal(realceComun([100, 100], [1.5, 1], 0), 1);  // sin sitio, no crece
  assert.equal(realceComun([100], [1], 500), 1);          // con tope 1 nunca crece
  assert.equal(realceComun([100], [1.5], -10), 1);        // ancho negativo: no revienta
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

test('factorEscala: mas facturas en la pagina → todo se escala mas pequeño', () => {
  const una = factorEscala(columnasDe(CARTA));
  const dos = factorEscala(columnasDe(CARTA).concat(columnasDe(CARTA)));
  assert.ok(una >= dos, 'con dos cartas el factor no sube');
  // Con dos cartas la altura sigue siendo la maxima posible de la banda
  assert.ok(dos * ANCHO_CARTA * CARTA >= CAJA.h - 0.01);
});

test('paginar sin items o con lista vacia no revienta', () => {
  assert.deepEqual(paginar([]), []);
  assert.deepEqual(paginar(null), []);
});
