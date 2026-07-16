// Formato 606 (DGII) basico: una fila por factura completa no duplicada con lo capturado.
// La columna "tipo de bienes y servicios" queda VACIA a proposito: la completa TCB
// (decision de Ari, 2026-07-16). El Excel se arma con SheetJS cargado perezoso.
import { cargarScript } from './carga.js';

export function tipoId(rnc){
  const d = String(rnc || '').replace(/\D/g, '');
  return d.length === 11 ? '2' : '1'; // 2 = cedula (11 digitos); 1 = RNC
}

export function filas606(facturas, periodo){
  const per = String(periodo || '').replace('-', '');
  return (facturas || [])
    .filter(f => f.estado === 'completa' && !f.duplicada)
    .map(f => {
      const [aa, mm, dd] = String(f.fechaEmision || '').split('-');
      const monto = (typeof f.subtotal === 'number') ? f.subtotal
        : (typeof f.total === 'number' && typeof f.itbis === 'number') ? +(f.total - f.itbis).toFixed(2)
        : (typeof f.total === 'number' ? f.total : null);
      return {
        rnc: String(f.rncEmisor || '').replace(/\D/g, ''),
        tipoId: tipoId(f.rncEmisor),
        tipoBienes: '',
        ncf: f.ncf || '',
        ncfModificado: '',
        fechaComprobante: (aa && mm) ? `${aa}${mm}` : per,
        dia: dd || '',
        montoFacturado: monto,
        itbisFacturado: (typeof f.itbis === 'number') ? f.itbis : 0
      };
    });
}

export async function generarXLSX606(filas, empresa, periodo, mesTexto){
  await cargarScript('vendor/sheetjs/xlsx.full.min.js');
  const enc = [
    ['Formato 606 — Compras de bienes y servicios'],
    [empresa.razon || '', 'RNC: ' + (empresa.rnc || '')],
    ['Período', String(periodo || '').replace('-', ''), mesTexto || ''],
    [],
    ['RNC/Cédula proveedor', 'Tipo Id', 'Tipo bienes/servicios', 'NCF', 'NCF modificado', 'Fecha comprobante (AAAAMM)', 'Día', 'Monto facturado', 'ITBIS facturado']
  ];
  const cuerpo = filas.map(f => [f.rnc, f.tipoId, f.tipoBienes, f.ncf, f.ncfModificado, f.fechaComprobante, f.dia, f.montoFacturado, f.itbisFacturado]);
  const ws = XLSX.utils.aoa_to_sheet([...enc, ...cuerpo]);
  ws['!cols'] = [{wch:18},{wch:7},{wch:20},{wch:16},{wch:14},{wch:13},{wch:5},{wch:14},{wch:14}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '606');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
