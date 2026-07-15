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
    subidoEn: new Date().toISOString()
  };
}

export function agregarEntrada(indice, entrada){
  const base = (indice && Array.isArray(indice.facturas)) ? indice : { facturas: [] };
  return { ...base, facturas: [...base.facturas, entrada] };
}
