import { estadoFactura } from './validacion.js';

export function entradaDeFactura(nombreArchivo, datos, origen, duplicada){
  return {
    archivo: nombreArchivo,
    fechaEmision: datos.fechaEmision ?? null,
    ncf: datos.ncf ?? null,
    rncEmisor: datos.rncEmisor ?? null,
    nombreComercio: datos.nombreComercio ?? null,
    subtotal: datos.subtotal ?? null,
    itbis: datos.itbis ?? null,
    total: datos.total ?? null,
    origen: origen || 'manual',
    duplicada: !!duplicada,
    subidoEn: new Date().toISOString(),
    estado: estadoFactura(datos, origen),
    revisadaIA: false
  };
}

export function agregarEntrada(indice, entrada){
  const base = (indice && Array.isArray(indice.facturas)) ? indice : { facturas: [] };
  return { ...base, facturas: [...base.facturas, entrada] };
}

export function quitarEntrada(indice, archivo){
  const base = (indice && Array.isArray(indice.facturas)) ? indice : { facturas: [] };
  return { ...base, facturas: base.facturas.filter(f => f.archivo !== archivo) };
}
