import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tipoId, filas606, montoFacturado, nombreArchivo606, TIPO_BIENES, FORMA_PAGO,
         generarTXT606, lineaTXT606, montoTXT, fechaTXT, nombreTXT606,
         repartoRevision, motivoExclusion, nombreRevision606 } from '../src/f606.js';

// --- Fase 16: archivo .TXT de envio a la Oficina Virtual ---
// Contrato tomado del VBA de la propia herramienta DGII (modulo modServicios, boton
// «Generar Archivo»), extraido y descomprimido de la plantilla oficial:
//   strHeader  = "606|" & RNC & "|" & Periodo & "|" & Registros
//   strDetalle = 23 campos con "|", con Mid(...,1,2) en tipo de bienes y forma de pago
//   fechas     = ConcatFecha_one(AAAAMM, dia) = AAAAMM & Format$(dia,"00")
//   la ultima linea se imprime con `Print #1, x;` → sin salto de linea final

const FILA = {
  rnc: '131067603', tipoId: 1, tipoBienes: TIPO_BIENES, ncf: 'E310000025067', ncfModificado: '',
  fechaComprobante: 202606, dia: 6, montoFacturado: 4940.01, itbisFacturado: 889.20,
  propinaLegal: 494, formaPago: FORMA_PAGO
};

test('montoTXT: sin separador de miles, punto decimal y sin relleno de ceros', () => {
  assert.equal(montoTXT(3050), '3050');
  assert.equal(montoTXT(4940.01), '4940.01');
  assert.equal(montoTXT(0), '0');
  assert.equal(montoTXT(1234567.891), '1234567.89');   // redondea a 2 decimales
  assert.equal(montoTXT(0.1 + 0.2), '0.3');            // sin basura de coma flotante
  assert.equal(montoTXT(null), '');
  assert.equal(montoTXT(''), '');
});

test('fechaTXT: AAAAMM + dia a dos digitos (ConcatFecha_one)', () => {
  assert.equal(fechaTXT(202606, 6), '20260606');
  assert.equal(fechaTXT(202606, 15), '20260615');
  assert.equal(fechaTXT(202606, null), '202606');      // sin dia queda solo el periodo
  assert.equal(fechaTXT('', 5), '');
});

test('lineaTXT606: 23 campos y solo el CODIGO en tipo de bienes y forma de pago', () => {
  const campos = lineaTXT606(FILA).split('|');
  assert.equal(campos.length, 23);
  assert.equal(campos[0], '131067603');   // 1  RNC
  assert.equal(campos[1], '1');           // 2  tipo id
  assert.equal(campos[2], '02');          // 3  SOLO el codigo, no la etiqueta larga
  assert.equal(campos[3], 'E310000025067');
  assert.equal(campos[4], '');            // 5  NCF modificado
  assert.equal(campos[5], '20260606');    // 6  fecha comprobante AAAAMMDD
  assert.equal(campos[6], '');            // 7  fecha de pago
  assert.equal(campos[7], '4940.01');     // 8  servicios
  assert.equal(campos[8], '');            // 9  bienes
  assert.equal(campos[9], '4940.01');     // 10 total facturado
  assert.equal(campos[10], '889.2');      // 11 ITBIS facturado
  assert.equal(campos[14], '889.2');      // 15 ITBIS por adelantar = facturado
  assert.equal(campos[21], '494');        // 22 propina legal
  assert.equal(campos[22], '01');         // 23 SOLO el codigo de forma de pago
});

test('generarTXT606: cabecera 606|RNC|periodo|registros y sin salto final', () => {
  const txt = generarTXT606([FILA, { ...FILA, ncf: 'B0100007133' }],
                            { rnc: '1-33-23182-4' }, '2026-06');
  const lineas = txt.split('\r\n');
  assert.equal(lineas[0], '606|133231824|202606|2');
  assert.equal(lineas.length, 3);
  assert.ok(!txt.endsWith('\r\n'), 'la macro cierra con Print #1, x; (sin salto final)');
  assert.ok(!txt.endsWith('\n'));
});

test('generarTXT606: sin facturas deja la cabecera en 0 registros (y esa SI cierra con CRLF)', () => {
  assert.equal(generarTXT606([], { rnc: '133231824' }, '2026-06'), '606|133231824|202606|0\r\n');
});

// Campos 10 (total facturado) y 15 (ITBIS por adelantar) los CALCULA la macro, asi que
// siempre llevan numero — nunca quedan vacios, ni siquiera valiendo cero.
test('los campos calculados 10 y 15 nunca van vacios', () => {
  const campos = lineaTXT606({ ...FILA, montoFacturado: null, itbisFacturado: null }).split('|');
  assert.equal(campos[9], '0');
  assert.equal(campos[14], '0');
});

// La longitud de NCF varia: 11 en los clasicos (B01…) y 13 en los electronicos (E31…).
test('acepta NCF clasico de 11 y e-NCF de 13 caracteres', () => {
  assert.equal(lineaTXT606({ ...FILA, ncf: 'B0100007133' }).split('|')[3].length, 11);
  assert.equal(lineaTXT606({ ...FILA, ncf: 'E310000025067' }).split('|')[3].length, 13);
});

test('nombreTXT606: mayusculas y extension .TXT', () => {
  assert.equal(nombreTXT606('1-33-23182-4', '2026-06'), 'DGII_F_606_133231824_202606.TXT');
});

test('el TXT sale coherente con las filas del 606 (cedula con cero, propina solo si hay)', () => {
  const filas = filas606([
    { estado:'completa', rncEmisor:'012-0015611-3', ncf:'B0100007133', fechaEmision:'2026-06-02',
      subtotal:3050, itbis:0, total:3050, propinaLegal:0 }
  ], '2026-06');
  const campos = generarTXT606(filas, { rnc:'133231824' }, '2026-06').split('\r\n')[1].split('|');
  assert.equal(campos[0], '01200156113');  // conserva el cero inicial
  assert.equal(campos[1], '2');            // cedula
  assert.equal(campos[5], '20260602');
  assert.equal(campos[7], '3050');
  assert.equal(campos[10], '0');           // ITBIS cero se escribe como 0
  assert.equal(campos[21], '');            // sin propina → campo vacio
});

// Contrato verificado contra el ejemplar real de la contabilidad
// (DGII_F_606_133231824_202606.xls): C = numero, G = AAAAMM numerico, H = dia numerico.

test('tipoId: RNC de 9 digitos → 1, cedula de 11 → 2 (numeros, como el ejemplar)', () => {
  assert.equal(tipoId('131-06760-3'), 1);
  assert.equal(tipoId('131067603'), 1);
  assert.equal(tipoId('012-0015611-3'), 2);   // cedula real del ejemplar
  assert.equal(tipoId('01200156113'), 2);
});

test('montoFacturado: subtotal impreso manda; si no, total - itbis; si no, total', () => {
  assert.equal(montoFacturado({ subtotal: 1212.45, total: 1363.49, itbis: 151.04 }), 1212.45);
  assert.equal(montoFacturado({ total: 1363.49, itbis: 151.04 }), 1212.45); // supermercados/gasolineras
  assert.equal(montoFacturado({ total: 118 }), 118);
  assert.equal(montoFacturado({}), null);
});

test('filas606: solo completas no duplicadas, con los valores del formato DGII', () => {
  const fs = [
    { estado:'completa', duplicada:false, rncEmisor:'101796822', ncf:'E310011691003',
      fechaEmision:'2026-07-15', subtotal:5129.66, itbis:299.97, total:5429.63, propinaLegal:0 },
    { estado:'pendiente', rncEmisor:'x', ncf:'y', fechaEmision:'2026-07-15', total:1 },
    { estado:'completa', duplicada:true, rncEmisor:'x', ncf:'y', fechaEmision:'2026-07-15', total:1 }
  ];
  const filas = filas606(fs, '2026-07');
  assert.equal(filas.length, 1);
  const f = filas[0];
  assert.equal(f.rnc, '101796822');
  assert.equal(f.tipoId, 1);
  assert.equal(f.tipoBienes, TIPO_BIENES);
  assert.equal(f.fechaComprobante, 202607);   // numerico
  assert.equal(f.dia, 15);                    // numerico
  assert.equal(f.montoFacturado, 5129.66);
  assert.equal(f.itbisFacturado, 299.97);
  assert.equal(f.propinaLegal, null);         // 0 → no se escribe la celda (como el ejemplar)
  assert.equal(f.formaPago, FORMA_PAGO);
});

test('filas606: la propina legal solo viaja cuando es mayor que cero', () => {
  const base = { estado:'completa', rncEmisor:'131067603', ncf:'E310000025067', fechaEmision:'2026-06-06',
                 subtotal:4940.01, itbis:889.20, total:5829.21 };
  assert.equal(filas606([{ ...base, propinaLegal: 494 }], '2026-06')[0].propinaLegal, 494);
  assert.equal(filas606([{ ...base, propinaLegal: 0 }], '2026-06')[0].propinaLegal, null);
  assert.equal(filas606([base], '2026-06')[0].propinaLegal, null); // campo ausente (facturas viejas)
});

test('filas606: cedula de 11 digitos conserva el cero inicial y marca tipo 2', () => {
  const f = filas606([{ estado:'completa', rncEmisor:'012-0015611-3', ncf:'B0100007133',
                        fechaEmision:'2026-06-02', total:3050, itbis:0 }], '2026-06')[0];
  assert.equal(f.rnc, '01200156113');
  assert.equal(f.tipoId, 2);
  assert.equal(f.montoFacturado, 3050);
});

test('filas606: sin fecha valida cae al periodo y deja el dia vacio', () => {
  const f = filas606([{ estado:'completa', rncEmisor:'131067603', ncf:'B01', fechaEmision:null, total:100 }], '2026-06')[0];
  assert.equal(f.fechaComprobante, 202606); // numerico, igual que con fecha valida
  assert.equal(f.dia, null);
});

test('nombreArchivo606: patron de la DGII', () => {
  assert.equal(nombreArchivo606('1-33-23182-4', '2026-06'), 'DGII_F_606_133231824_202606.xlsx');
  assert.equal(nombreArchivo606('', '2026-06'), 'DGII_F_606_SIN_RNC_202606.xlsx');
});

// --- Fase 17: hoja de REVISION (el Excel ya no imita la plantilla de la DGII) ---

test('repartoRevision: separa lo que va al envio de lo que queda fuera, con totales', () => {
  const r = repartoRevision([
    { estado:'completa', duplicada:false, subtotal:1000, itbis:180, propinaLegal:0,   total:1180 },
    { estado:'completa', duplicada:false, subtotal:500,  itbis:90,  propinaLegal:50,  total:640 },
    { estado:'completa', duplicada:true,  subtotal:200,  itbis:36,  total:236, ncf:'B01' },
    { estado:'pendiente', total:100 },
    { estado:'incompleta', ncf:'B02', total:70 }
  ]);
  assert.equal(r.incluidas.length, 2);
  assert.equal(r.excluidas.length, 3);
  assert.equal(r.totales.subtotal, 1500);
  assert.equal(r.totales.itbis, 270);
  assert.equal(r.totales.propina, 50);
  assert.equal(r.totales.total, 1820);
});

test('motivoExclusion: dice POR QUE quedo fuera cada factura', () => {
  assert.match(motivoExclusion({ duplicada: true, estado: 'completa' }), /Duplicada/);
  assert.match(motivoExclusion({ estado: 'pendiente' }), /Pendiente/);
  assert.match(motivoExclusion({ estado: 'incompleta', ncf: 'B01', rncEmisor: '131067603', total: 5 }), /fecha/);
  assert.match(motivoExclusion({ estado: 'incompleta', fechaEmision: '2026-06-01', rncEmisor: '1', total: 5 }), /NCF/);
  assert.match(motivoExclusion({ estado: 'incompleta', fechaEmision: '2026-06-01', ncf: 'B01', total: 5 }), /RNC/);
});

test('repartoRevision: sin facturas no revienta y da totales en cero', () => {
  const r = repartoRevision([]);
  assert.deepEqual(r.incluidas, []);
  assert.equal(r.totales.total, 0);
  assert.equal(repartoRevision(null).incluidas.length, 0);
});

test('nombreRevision606: nombre propio, no se confunde con el TXT oficial', () => {
  assert.equal(nombreRevision606('Junio 2026'), 'Revision_606_Junio_2026.xlsx');
});

// --- Fase 23: la propina sale del monto que se declara ---------------------
// Fila real del TXT de la contabilidad de junio 2026:
//   131067603|1|02|E310000025067||20260606||4940.01||4940.01|889.2|...|494|01
// El recibo cobro 4940.01 + 889.20 (ITBIS 18%) + 494.00 (propina 10%) = 6323.21.
// Sin subtotal impreso, la app declaraba 6323.21 - 889.20 = 5434.01: un 10% de mas
// en la columna del 606, en TODAS las facturas de restaurante.
test('montoFacturado: sin subtotal impreso, la propina NO se declara', () => {
  assert.equal(montoFacturado({ total: 6323.21, itbis: 889.20, propinaLegal: 494 }), 4940.01);
  // Con subtotal impreso manda el subtotal, como siempre.
  assert.equal(montoFacturado({ subtotal: 4940.01, total: 6323.21, itbis: 889.20, propinaLegal: 494 }), 4940.01);
  // Sin propina, el comportamiento de siempre.
  assert.equal(montoFacturado({ total: 1363.49, itbis: 151.04 }), 1212.45);
  assert.equal(montoFacturado({ total: 118 }), 118);
  assert.equal(montoFacturado({}), null);
});

test('montoFacturado: solo total y propina (rollo de restaurante sin ITBIS impreso)', () => {
  assert.equal(montoFacturado({ total: 1100, propinaLegal: 100 }), 1000);
});
