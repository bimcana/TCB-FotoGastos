import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nombreCarpetaMes, siguienteNombre, hoyISO } from '../src/naming.js';

test('carpeta de junio 2025', () => {
  assert.equal(nombreCarpetaMes('2025-06-11'), '2025-06_Junio');
});
test('carpeta de enero (mes 1 con cero)', () => {
  assert.equal(nombreCarpetaMes('2026-01-05'), '2026-01_Enero');
});
test('primera factura del día 11', () => {
  assert.equal(siguienteNombre('2025-06-11', []), 'Compra_110.jpg');
});
test('segunda factura del día 11', () => {
  assert.equal(siguienteNombre('2025-06-11', ['Compra_110.jpg']), 'Compra_111.jpg');
});
test('ignora archivos de otros días y otros nombres', () => {
  assert.equal(
    siguienteNombre('2025-06-11', ['Compra_100.jpg', 'Compra_090.jpg', '_gastos.json']),
    'Compra_110.jpg');
});
test('día 01: tercera factura', () => {
  assert.equal(siguienteNombre('2025-06-01', ['Compra_010.jpg', 'Compra_011.jpg']), 'Compra_012.jpg');
});
test('acepta .jpeg y mayúsculas en existentes', () => {
  assert.equal(siguienteNombre('2025-06-11', ['COMPRA_110.JPEG']), 'Compra_111.jpg');
});
test('hoyISO formatea una fecha dada', () => {
  assert.equal(hoyISO(new Date(2025, 5, 1)), '2025-06-01');
});
test('correlativo de dos digitos (decima factura del dia)', () => {
  const existentes = Array.from({length: 10}, (_, i) => `Compra_11${i}.jpg`);
  assert.equal(siguienteNombre('2025-06-11', existentes), 'Compra_1110.jpg');
});
