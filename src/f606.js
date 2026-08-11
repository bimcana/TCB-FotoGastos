// Formato 606 (DGII) — Compras de Bienes y Servicios.
//
// Fase 14: el Excel se genera RELLENANDO la plantilla oficial de la DGII
// (`vendor/dgii/formato606-base.xlsx`, derivada de «Formato de Envío 606 NG-07-2018 y
// 05-2019»), no un libro inventado. Asi el contador recibe la hoja que ya conoce, con
// sus encabezados y columnas exactas.
//
// MAPEO verificado contra el ejemplar real de la contabilidad
// (DGII_F_606_133231824_202606.xls, junio 2026):
//   C4  RNC/Cedula de la empresa (TEXTO)      C5  Periodo AAAAMM      C6  Cant. registros
//   Fila 11 = encabezados. Datos desde la fila 12:
//   A linea | B RNC/Cedula proveedor (TEXTO: conserva el 0 inicial de las cedulas)
//   C Tipo Id (1=RNC 9 digitos, 2=cedula 11) | D tipo de bienes/servicios (constante)
//   E NCF | F NCF modificado (vacio) | G fecha AAAAMM | H dia
//   K monto en servicios | L monto en bienes | M total facturado (=K+L, SIN ITBIS)
//   N ITBIS facturado | R ITBIS por adelantar (=N) | Y propina legal | Z forma de pago
//
// DECISIONES tomadas del ejemplar (si contabilidad las cambia, se ajustan aqui):
//   - Todo el monto va a SERVICIOS (K); bienes (L) queda vacio — asi lo hace el ejemplar
//     en sus 20 filas.
//   - M = subtotal (monto facturado sin ITBIS), NO el total pagado. Verificado: una fila
//     con K=4940.01, N=889.20 e Y=494 tiene M=4940.01.
//   - R (ITBIS por adelantar) = N (ITBIS facturado), incluido cuando N=0.
//   - Y (propina legal) solo se escribe cuando hay propina, como el ejemplar.
import { cargarScript } from './carga.js';

export const PLANTILLA_606 = 'vendor/dgii/formato606-base.xlsx';
export const HOJA_606 = 'Herramienta Formato 606';
export const FILA_DATOS = 12;              // primera fila de datos (11 = encabezados)
export const TIPO_BIENES = '02-GASTOS POR TRABAJOS, SUMINISTROS Y SERVICIOS ';  // espacio final incluido: es el valor exacto de la lista DGII
export const FORMA_PAGO = '01 - EFECTIVO';

export function tipoId(rnc){
  const d = String(rnc || '').replace(/\D/g, '');
  return d.length === 11 ? 2 : 1; // 2 = cedula (11 digitos); 1 = RNC (9)
}

// Monto facturado SIN ITBIS. Si la factura no trae subtotal (tipico de supermercados y
// gasolineras), se deduce como total - itbis; si tampoco hay ITBIS, el total es el monto.
export function montoFacturado(f){
  if (typeof f.subtotal === 'number') return f.subtotal;
  if (typeof f.total === 'number' && typeof f.itbis === 'number') return +(f.total - f.itbis).toFixed(2);
  return typeof f.total === 'number' ? f.total : null;
}

export function filas606(facturas, periodo){
  const per = String(periodo || '').replace('-', '');
  return (facturas || [])
    .filter(f => f.estado === 'completa' && !f.duplicada)
    .map(f => {
      const [aa, mm, dd] = String(f.fechaEmision || '').split('-');
      return {
        rnc: String(f.rncEmisor || '').replace(/\D/g, ''),
        tipoId: tipoId(f.rncEmisor),
        tipoBienes: TIPO_BIENES,
        ncf: f.ncf || '',
        ncfModificado: '',
        fechaComprobante: Number((aa && mm) ? `${aa}${mm}` : per) || per,
        dia: dd ? Number(dd) : null,
        montoFacturado: montoFacturado(f),
        itbisFacturado: (typeof f.itbis === 'number') ? f.itbis : 0,
        propinaLegal: (typeof f.propinaLegal === 'number' && f.propinaLegal > 0) ? f.propinaLegal : null,
        formaPago: FORMA_PAGO
      };
    });
}

// Nombre con el patron de la DGII: DGII_F_606_{RNC}_{AAAAMM}.xlsx
export function nombreArchivo606(rncEmpresa, periodo){
  const rnc = String(rncEmpresa || '').replace(/\D/g, '') || 'SIN_RNC';
  const per = String(periodo || '').replace('-', '');
  return `DGII_F_606_${rnc}_${per}.xlsx`;
}

// El archivo que se sube a la Oficina Virtual va en MAYUSCULAS y termina en .TXT.
export function nombreTXT606(rncEmpresa, periodo){
  return nombreArchivo606(rncEmpresa, periodo).replace(/\.xlsx$/, '.TXT');
}

// --- ARCHIVO DE ENVIO .TXT (Fase 16) --------------------------------------
// ESTE es el entregable real: la herramienta Excel de la DGII solo sirve para producirlo
// con su boton «Generar Archivo». La app lo genera directo, sin Excel ni macros.
//
// FUENTE DE VERDAD: el codigo VBA de la propia herramienta oficial (modulo `modServicios`,
// `Sub` del boton `cmdGenerarArchivo`), extraido y descomprimido de la plantilla. De ahi
// salen, literalmente:
//   Cabecera:  "606|" & RNC & "|" & Periodo & "|" & CantidadRegistros
//   Detalle:   23 campos separados por "|" en el orden de las columnas B..Z
//   Fechas:    ConcatFecha_one(AAAAMM, dia) = AAAAMM & Format$(dia,"00")  → AAAAMMDD
//   Recortes:  Tipo de bienes, tipo de retencion y forma de pago van con `Mid(...,1,2)`,
//              es decir SOLO el codigo de dos digitos ("02", "01"), no la etiqueta.
//   Cierre:    la ultima linea se imprime con `Print #1, x;` (punto y coma) → el archivo
//              NO termina en salto de linea. Las demas llevan CRLF.

// Monto tal como lo escribe VBA (`Trim(.Cells(...))` = valor, no texto con formato):
// sin separador de miles, con punto decimal y sin decimales de relleno. Vacio si no hay.
export function montoTXT(n){
  if (n == null || n === '') return '';
  const v = Math.round(Number(n) * 100) / 100;
  return Number.isFinite(v) ? String(v) : '';
}

// AAAAMM + dia a 2 digitos (equivalente a ConcatFecha_one). Sin dia, queda solo AAAAMM.
export function fechaTXT(aaaamm, dia){
  const base = String(aaaamm || '');
  if (!base) return '';
  return dia == null || dia === '' ? base : base + String(dia).padStart(2, '0');
}

// Los 23 campos de una linea de detalle, en el orden exacto de la macro.
export function lineaTXT606(f){
  return [
    f.rnc,                                   // 1  RNC o Cedula
    f.tipoId,                                // 2  Tipo Id
    String(f.tipoBienes || '').slice(0, 2),  // 3  Tipo de bienes: SOLO el codigo
    f.ncf,                                   // 4  NCF
    f.ncfModificado || '',                   // 5  NCF o documento modificado
    fechaTXT(f.fechaComprobante, f.dia),     // 6  Fecha comprobante AAAAMMDD
    '',                                      // 7  Fecha de pago (no la maneja la app)
    montoTXT(f.montoFacturado),              // 8  Monto facturado en servicios
    '',                                      // 9  Monto facturado en bienes
    montoTXT(f.montoFacturado ?? 0),         // 10 Total monto facturado (CALCULADO 8+9: nunca vacio)
    montoTXT(f.itbisFacturado),              // 11 ITBIS facturado
    '',                                      // 12 ITBIS retenido
    '',                                      // 13 ITBIS sujeto a proporcionalidad
    '',                                      // 14 ITBIS llevado al costo
    montoTXT(f.itbisFacturado ?? 0),         // 15 ITBIS por adelantar (CALCULADO 11-14: nunca vacio)
    '',                                      // 16 ITBIS percibido en compras
    '',                                      // 17 Tipo de retencion en ISR
    '',                                      // 18 Monto retencion renta
    '',                                      // 19 ISR percibido en compras
    '',                                      // 20 Impuesto selectivo al consumo
    '',                                      // 21 Otros impuestos/tasas
    montoTXT(f.propinaLegal),                // 22 Monto propina legal
    String(f.formaPago || '').slice(0, 2)    // 23 Forma de pago: SOLO el codigo
  ].join('|');
}

/**
 * Archivo de envio completo. Devuelve el texto tal cual lo escribiria la herramienta:
 * cabecera + una linea por factura, separadas por CRLF y SIN salto final.
 */
export function generarTXT606(filas, empresa, periodo){
  const rnc = String(empresa?.rnc || '').replace(/\D/g, '');
  const per = String(periodo || '').replace('-', '');
  const cabecera = `606|${rnc}|${per}|${filas.length}`;
  // Sin filas, la macro solo hace `Print #1, strHeader` — que SI cierra con CRLF.
  if (!filas.length) return cabecera + '\r\n';
  return [cabecera, ...filas.map(lineaTXT606)].join('\r\n');
}

export function blobTXT606(texto){
  return new Blob([texto], { type: 'text/plain;charset=utf-8' });
}

// Anchos de columna (se pierden al derivar la plantilla; se reponen para que la hoja
// abra legible). Indices 0..25 = A..Z.
const ANCHOS = [
  { wch: 7 }, { wch: 14 }, { wch: 7 }, { wch: 42 }, { wch: 16 }, { wch: 16 },
  { wch: 10 }, { wch: 5 }, { wch: 10 }, { wch: 5 }, { wch: 15 }, { wch: 15 },
  { wch: 15 }, { wch: 14 }, { wch: 13 }, { wch: 15 }, { wch: 14 }, { wch: 14 },
  { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
  { wch: 14 }, { wch: 20 }
];

/**
 * Rellena la plantilla oficial de la DGII con las filas del periodo.
 * `fetchPlantilla` se inyecta en las pruebas; en la app es fetch del vendor.
 */
export async function generarXLSX606(filas, empresa, periodo, mesTexto, opciones = {}){
  // Si SheetJS ya esta cargado (o inyectado en pruebas) no se vuelve a pedir.
  if (typeof XLSX === 'undefined') await cargarScript('vendor/sheetjs/xlsx.full.min.js');
  const traer = opciones.fetchPlantilla || (async () => {
    const r = await fetch(PLANTILLA_606);
    if (!r.ok) throw new Error('No se encontró la plantilla 606 de la DGII');
    return new Uint8Array(await r.arrayBuffer());
  });
  const wb = XLSX.read(await traer(), { type: 'array', cellNF: true });
  const ws = wb.Sheets[HOJA_606];
  if (!ws) throw new Error('La plantilla 606 no tiene la hoja «' + HOJA_606 + '»');

  const per = String(periodo || '').replace('-', '');
  const set = (dir, v, t, z) => { ws[dir] = { v, t, ...(z ? { z } : {}) }; };
  // Cabecera: el RNC va como TEXTO (formato @) para no perder ceros a la izquierda.
  set('C4', String(empresa?.rnc || '').replace(/\D/g, ''), 's', '@');
  set('C5', Number(per) || per, 'n', '@');
  set('C6', filas.length, 'n');

  const DIN = '#,##0.00';
  filas.forEach((f, i) => {
    const r = FILA_DATOS + i;
    set('A' + r, i + 1, 'n');
    set('B' + r, f.rnc, 's');                 // TEXTO: las cedulas empiezan por 0
    set('C' + r, f.tipoId, 'n');
    set('D' + r, f.tipoBienes, 's');
    set('E' + r, f.ncf, 's');
    if (f.ncfModificado) set('F' + r, f.ncfModificado, 's');
    set('G' + r, f.fechaComprobante, 'n', '@');
    if (f.dia != null) set('H' + r, f.dia, 'n');
    if (f.montoFacturado != null){
      set('K' + r, f.montoFacturado, 'n', DIN); // servicios
      set('M' + r, f.montoFacturado, 'n', DIN); // total facturado = servicios + bienes
    }
    set('N' + r, f.itbisFacturado, 'n', DIN);
    set('R' + r, f.itbisFacturado, 'n', DIN);   // ITBIS por adelantar
    if (f.propinaLegal != null) set('Y' + r, f.propinaLegal, 'n', DIN);
    set('Z' + r, f.formaPago, 's');
  });

  // Ampliar el rango declarado para que Excel vea las filas nuevas.
  const finCol = 'AF';
  const ultima = Math.max(FILA_DATOS + filas.length - 1, 12);
  const refPrevio = ws['!ref'] || 'A1:AF12';
  const filasPrevias = Number(String(refPrevio).split(':')[1].replace(/\D/g, '')) || 12;
  ws['!ref'] = `A1:${finCol}${Math.max(ultima, filasPrevias)}`;
  ws['!cols'] = ANCHOS;

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
