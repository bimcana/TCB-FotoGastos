import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nombreCarpetaMes, siguienteNombre, hoyISO,
         nombreProvisional, esProvisional, nombreCoincideConFecha, nombreUnico, necesitaReArchivo } from '../src/naming.js';

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

// --- Fase 2D: provisionales y re-archivado ---
test('nombreProvisional formatea Pendiente_AAAAMMDD-HHMMSS.jpg', () => {
  const d = new Date(2026, 6, 15, 8, 37, 5); // 15 jul 2026 08:37:05
  assert.equal(nombreProvisional(d), 'Pendiente_20260715-083705.jpg');
});

test('esProvisional reconoce nombres Pendiente_', () => {
  assert.equal(esProvisional('Pendiente_20260715-083705.jpg'), true);
  assert.equal(esProvisional('Pendiente_20260715-083705_2.jpg'), true);
  assert.equal(esProvisional('Compra_031.jpg'), false);
  assert.equal(esProvisional(null), false);
});

test('nombreCoincideConFecha compara el dia del nombre con la fecha', () => {
  assert.equal(nombreCoincideConFecha('Compra_031.jpg', '2025-06-03'), true);
  assert.equal(nombreCoincideConFecha('Compra_0312.jpeg', '2025-06-03'), true);
  assert.equal(nombreCoincideConFecha('Compra_031.jpg', '2025-06-04'), false);
  assert.equal(nombreCoincideConFecha('Pendiente_20260715-083705.jpg', '2025-06-03'), false);
});

test('nombreUnico sufija _2, _3 si el nombre ya existe', () => {
  assert.equal(nombreUnico('Pendiente_x.jpg', []), 'Pendiente_x.jpg');
  assert.equal(nombreUnico('Pendiente_x.jpg', ['pendiente_x.jpg']), 'Pendiente_x_2.jpg');
  assert.equal(nombreUnico('Pendiente_x.jpg', ['Pendiente_x.jpg', 'Pendiente_x_2.jpg']), 'Pendiente_x_3.jpg');
});

test('necesitaReArchivo: provisional siempre; mes o dia distinto tambien', () => {
  assert.equal(necesitaReArchivo('Pendiente_20260715-083705.jpg', '2026-07_Julio', '2026-07-15'), true);
  assert.equal(necesitaReArchivo('Compra_150.jpg', '2026-07_Julio', '2025-06-03'), true);  // otro mes
  assert.equal(necesitaReArchivo('Compra_150.jpg', '2026-07_Julio', '2026-07-16'), true);  // otro dia
  assert.equal(necesitaReArchivo('Compra_160.jpg', '2026-07_Julio', '2026-07-16'), false); // coincide
  assert.equal(necesitaReArchivo('Compra_160.jpg', '2026-07_Julio', null), false);          // sin fecha no se mueve
});
