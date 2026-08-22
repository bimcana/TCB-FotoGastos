// Formato 606 (DGII) — Compras de Bienes y Servicios.
//
// Cada cierre de mes produce TRES archivos, cada uno con su papel:
//   1. El PDF con las facturas (pdfgastos.js).
//   2. Un Excel de REVISION (`generarXLSXRevision`): para repasar el mes antes de enviar.
//      NO imita la plantilla de la DGII a proposito — ese papel lo cumple el .TXT.
//   3. El **.TXT de envio** (`generarTXT606`): lo que de verdad se sube a la Oficina
//      Virtual. Verificado IDENTICO byte a byte contra un archivo real generado por la
//      herramienta oficial (DGII_F_606_133231824_202606.txt, 20 facturas de junio 2026).
//
// Se intento antes rellenar la plantilla .xls oficial, pero se descarto: sus macros —que
// son las que producen el TXT— no sobreviven a ninguna via automatica, y Office bloquea
// los archivos con macros bajados de internet. Generando el TXT directo, toda esa cadena
// deja de hacer falta.
import { cargarScript } from './carga.js';

// Valor exacto de la lista de la DGII (con su espacio final). Al TXT solo va el codigo.
export const TIPO_BIENES = '02-GASTOS POR TRABAJOS, SUMINISTROS Y SERVICIOS ';
export const FORMA_PAGO = '01 - EFECTIVO';

export function tipoId(rnc){
  const d = String(rnc || '').replace(/\D/g, '');
  return d.length === 11 ? 2 : 1; // 2 = cedula (11 digitos); 1 = RNC (9)
}

// Monto facturado: lo que se declara en la columna del 606. Es el importe SIN ITBIS y
// SIN PROPINA. Si la factura no trae subtotal (tipico de supermercados, gasolineras y
// restaurantes de rollo), se deduce del total a pagar restando las dos cosas.
//
// Fase 23 — la propina faltaba en esta resta. Fila real del TXT de la contabilidad:
//   E310000025067 -> monto 4940.01 | ITBIS 889.20 (18%) | propina 494.00 (10%)
// El recibo cobra 6323.21. Sin subtotal impreso, la app declaraba 6323.21 - 889.20 =
// 5434.01 en vez de 4940.01: un 10% de mas en el 606, en TODOS los restaurantes.
export function montoFacturado(f){
  if (typeof f.subtotal === 'number') return f.subtotal;
  const propina = (typeof f.propinaLegal === 'number' && f.propinaLegal > 0) ? f.propinaLegal : 0;
  if (typeof f.total !== 'number') return null;
  const itbis = (typeof f.itbis === 'number') ? f.itbis : 0;
  return +(f.total - itbis - propina).toFixed(2);
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

// --- HOJA DE REVISION (Fase 17) -------------------------------------------
// El Excel dejo de imitar la plantilla de la DGII: ese papel ya lo hace el .TXT, que se
// genera identico al oficial. Aqui lo util es OTRA cosa — que el usuario pueda repasar el
// mes antes de subir: datos en formato dominicano, el nombre del comercio (que el 606 no
// lleva), el archivo de la foto para ir a verla, los totales para cuadrar y, sobre todo,
// LAS FACTURAS QUE QUEDARON FUERA con su motivo.

export function motivoExclusion(f){
  if (f.duplicada) return 'Duplicada (NCF repetido)';
  if (f.estado === 'pendiente') return 'Pendiente de validar';
  if (f.estado === 'incompleta'){
    const faltan = [];
    if (!f.fechaEmision) faltan.push('fecha');
    if (!f.ncf) faltan.push('NCF');
    if (!f.rncEmisor) faltan.push('RNC');
    if (typeof f.total !== 'number') faltan.push('total');
    return faltan.length ? 'Falta ' + faltan.join(', ') : 'Datos incompletos';
  }
  return 'No incluida';
}

// Separa lo que va al envio de lo que se queda fuera (con el motivo). Puro.
export function repartoRevision(facturas){
  const todas = facturas || [];
  const incluidas = todas.filter(f => f.estado === 'completa' && !f.duplicada);
  const excluidas = todas.filter(f => !(f.estado === 'completa' && !f.duplicada))
                         .map(f => ({ ...f, motivo: motivoExclusion(f) }));
  const suma = (arr, campo) => arr.reduce((s, f) => s + (typeof f[campo] === 'number' ? f[campo] : 0), 0);
  const r2 = n => Math.round(n * 100) / 100;
  return {
    incluidas, excluidas,
    totales: {
      subtotal: r2(incluidas.reduce((s, f) => s + (montoFacturado(f) || 0), 0)),
      itbis: r2(suma(incluidas, 'itbis')),
      propina: r2(suma(incluidas, 'propinaLegal')),
      total: r2(suma(incluidas, 'total'))
    }
  };
}

export function nombreRevision606(mesTexto){
  return `Revision_606_${String(mesTexto || '').replace(/\s+/g, '_')}.xlsx`;
}

const ENCABEZADOS = ['#', 'Archivo', 'Fecha', 'NCF', 'RNC / Cédula', 'Tipo', 'Comercio',
                     'Subtotal', 'ITBIS', 'Propina', 'Total', 'Forma de pago'];

/**
 * Excel de revision del mes. Una hoja legible, no la plantilla de la DGII.
 * `fmtFecha` y `fmtMonto` se inyectan desde validacion.js (formato dominicano).
 */
export async function generarXLSXRevision(facturas, empresa, periodo, mesTexto, fmt = {}){
  if (typeof XLSX === 'undefined') await cargarScript('vendor/sheetjs/xlsx.full.min.js');
  const fecha = fmt.fecha || (v => v || '');
  const monto = fmt.monto || (v => (typeof v === 'number' ? v : ''));
  const { incluidas, excluidas, totales } = repartoRevision(facturas);
  const per = String(periodo || '').replace('-', '');

  const filas = [
    [`Revisión del Formato 606 — ${mesTexto || ''}`],
    [`${empresa?.razon || ''}`, `RNC: ${empresa?.rnc || ''}`],
    [`Período ${per}`, `${incluidas.length} factura(s) en el envío`,
     excluidas.length ? `${excluidas.length} fuera del envío` : ''],
    [],
    ['ESTAS FACTURAS VAN EN EL ARCHIVO DGII_F_606_' + String(empresa?.rnc || '').replace(/\D/g, '') + '_' + per + '.TXT'],
    ENCABEZADOS
  ];
  incluidas.forEach((f, i) => filas.push([
    i + 1,
    f.archivo || '',
    fecha(f.fechaEmision),
    f.ncf || '',
    String(f.rncEmisor || '').replace(/\D/g, ''),
    tipoId(f.rncEmisor) === 2 ? 'Cédula' : 'RNC',
    f.nombreComercio || '',
    monto(montoFacturado(f)),
    monto(typeof f.itbis === 'number' ? f.itbis : 0),
    monto(typeof f.propinaLegal === 'number' ? f.propinaLegal : 0),
    monto(f.total),
    FORMA_PAGO
  ]));
  filas.push([]);
  filas.push(['', '', '', '', '', '', 'TOTALES',
    monto(totales.subtotal), monto(totales.itbis), monto(totales.propina), monto(totales.total), '']);

  if (excluidas.length){
    filas.push([]);
    filas.push(['NO ENTRAN EN EL ENVÍO — revísalas en la app si corresponde']);
    filas.push(['#', 'Archivo', 'Fecha', 'NCF', 'RNC / Cédula', 'Motivo', 'Comercio', '', '', '', 'Total', '']);
    excluidas.forEach((f, i) => filas.push([
      i + 1, f.archivo || '', fecha(f.fechaEmision), f.ncf || '',
      String(f.rncEmisor || '').replace(/\D/g, ''), f.motivo, f.nombreComercio || '',
      '', '', '', monto(f.total), ''
    ]));
  }

  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws['!cols'] = [{ wch: 4 }, { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 22 },
                 { wch: 30 }, { wch: 13 }, { wch: 11 }, { wch: 10 }, { wch: 13 }, { wch: 15 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Revisión 606');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

