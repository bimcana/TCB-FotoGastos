import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puntosMedios, desplazarLado } from '../src/esquinas.js';

// Cuadrilatero de prueba en orden TL, TR, BR, BL (el que produce ordenarEsquinas).
const cuadro = () => [
  { x: 100, y: 100 }, { x: 500, y: 100 },
  { x: 500, y: 400 }, { x: 100, y: 400 }
];

test('puntosMedios: centro de cada lado en orden arriba/derecha/abajo/izquierda', () => {
  const m = puntosMedios(cuadro());
  assert.deepEqual(m[0], { x: 300, y: 100 }); // arriba (TL-TR)
  assert.deepEqual(m[1], { x: 500, y: 250 }); // derecha (TR-BR)
  assert.deepEqual(m[2], { x: 300, y: 400 }); // abajo (BR-BL)
  assert.deepEqual(m[3], { x: 100, y: 250 }); // izquierda (BL-TL)
});

test('desplazarLado mueve las DOS esquinas del lado y solo esas', () => {
  const e = cuadro();
  desplazarLado(e, 0, 10, -20, 600, 500); // lado de arriba
  assert.deepEqual(e[0], { x: 110, y: 80 });
  assert.deepEqual(e[1], { x: 510, y: 80 });
  assert.deepEqual(e[2], { x: 500, y: 400 }); // intactas
  assert.deepEqual(e[3], { x: 100, y: 400 });
});

test('desplazarLado recorta el delta para no salir del lienzo', () => {
  const e = cuadro();
  const { dx, dy } = desplazarLado(e, 3, -150, 0, 600, 500); // izquierda hacia afuera
  assert.equal(dx, -100); // las esquinas x=100 se frenan en 0
  assert.equal(dy, 0);
  assert.equal(e[3].x, 0);
  assert.equal(e[0].x, 0);
});

test('desplazarLado con lado inclinado: el recorte respeta la esquina mas cercana al borde', () => {
  const e = [
    { x: 50, y: 100 }, { x: 500, y: 120 },
    { x: 500, y: 400 }, { x: 60, y: 380 }
  ];
  const { dx } = desplazarLado(e, 3, -80, 0, 600, 500); // izquierda (indices 3 y 0)
  assert.equal(dx, -50); // la esquina en x=50 limita el movimiento
  assert.equal(e[0].x, 0);
  assert.equal(e[3].x, 10);
});
