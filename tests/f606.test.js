import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tipoId, filas606, montoFacturado, nombreArchivo606, TIPO_BIENES, FORMA_PAGO } from '../src/f606.js';

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
