import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nombreCarpetaMes, siguienteNombre, hoyISO,
         nombreProvisional, esProvisional, nombreCoincideConFecha, nombreUnico, necesitaReArchivo,
         mesesDeCarpetas, accionesCarpeta, CARPETA_ARCHIVO,
         ordenarParaDocumento, correlativoDe } from '../src/naming.js';

// --- Fase 21: los documentos del cierre van por fecha de emision ascendente ---
// El indice guarda las facturas en el orden en que se SUBIERON: una factura vieja puede
// fotografiarse despues, y el PDF salia desordenado.

const fact = (archivo, fechaEmision) => ({ archivo, fechaEmision, estado: 'completa' });

test('ordenarParaDocumento: por fecha, aunque se hayan subido en otro orden', () => {
  const subidas = [
    fact('Compra_150.jpg', '2026-06-15'),
    fact('Compra_020.jpg', '2026-06-02'),   // vieja, fotografiada al final
    fact('Compra_270.jpg', '2026-06-27'),
    fact('Compra_090.jpg', '2026-06-09')
  ];
  assert.deepEqual(ordenarParaDocumento(subidas).map(f => f.archivo),
    ['Compra_020.jpg', 'Compra_090.jpg', 'Compra_150.jpg', 'Compra_270.jpg']);
});

test('ordenarParaDocumento: dentro del mismo dia manda el correlativo, no el texto', () => {
  const mismoDia = [
    fact('Compra_1110.jpg', '2026-06-11'),  // correlativo 10
    fact('Compra_112.jpg',  '2026-06-11'),  // correlativo 2
    fact('Compra_110.jpg',  '2026-06-11')   // correlativo 0
  ];
  assert.deepEqual(ordenarParaDocumento(mismoDia).map(f => f.archivo),
    ['Compra_110.jpg', 'Compra_112.jpg', 'Compra_1110.jpg']);
});

test('ordenarParaDocumento: las provisionales sin fecha quedan al final', () => {
  const lista = [
    fact('Pendiente_20260610-101500.jpg', null),
    fact('Compra_270.jpg', '2026-06-27'),
    fact('Compra_020.jpg', '2026-06-02')
  ];
  assert.deepEqual(ordenarParaDocumento(lista).map(f => f.archivo),
    ['Compra_020.jpg', 'Compra_270.jpg', 'Pendiente_20260610-101500.jpg']);
});

test('ordenarParaDocumento: no muta la lista original y aguanta vacios', () => {
  const original = [fact('Compra_270.jpg', '2026-06-27'), fact('Compra_020.jpg', '2026-06-02')];
  const copia = [...original];
  ordenarParaDocumento(original);
  assert.deepEqual(original, copia, 'la lista de entrada no se toca');
  assert.deepEqual(ordenarParaDocumento([]), []);
  assert.deepEqual(ordenarParaDocumento(null), []);
});

test('correlativoDe: extrae la N de Compra_DDN', () => {
  assert.equal(correlativoDe('Compra_110.jpg'), 0);
  assert.equal(correlativoDe('Compra_1112.jpg'), 12);
  assert.equal(correlativoDe('Pendiente_20260610-101500.jpg'), Number.MAX_SAFE_INTEGER);
  assert.equal(correlativoDe(null), Number.MAX_SAFE_INTEGER);
});

test('mesesDeCarpetas: unicos, ordenados, incluye el mes actual', () => {
  const nombres = ['2025-06_Junio', '2026-07_Julio', '2025-06_Junio', 'Gastos_x.pdf'];
  assert.deepEqual(mesesDeCarpetas(nombres, '2026-08-01'), ['2025-06', '2026-07', '2026-08']);
  assert.deepEqual(mesesDeCarpetas([], '2026-07-16'), ['2026-07']);
});

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

// --- Fase 7: acciones al deslizar una carpeta en Gastos ---
test('accionesCarpeta: vacia → archivar+eliminar; mes actual → ninguna; anterior → archivar', () => {
  assert.deepEqual(accionesCarpeta({ nombre: '2026-05_Mayo', vacia: true, hoyISOStr: '2026-07-21' }), ['archivar', 'eliminar']);
  assert.deepEqual(accionesCarpeta({ nombre: '2026-07_Julio', vacia: true, hoyISOStr: '2026-07-21' }), ['archivar', 'eliminar']);
  assert.deepEqual(accionesCarpeta({ nombre: '2026-07_Julio', vacia: false, hoyISOStr: '2026-07-21' }), []);
  assert.deepEqual(accionesCarpeta({ nombre: '2026-05_Mayo', vacia: false, hoyISOStr: '2026-07-21' }), ['archivar']);
  assert.deepEqual(accionesCarpeta({ nombre: 'Otra carpeta', vacia: false, hoyISOStr: '2026-07-21' }), ['archivar']);
  assert.deepEqual(accionesCarpeta({ nombre: 'Archivo', vacia: false, hoyISOStr: '2026-07-21' }), []); // nunca se archiva a si misma
});
