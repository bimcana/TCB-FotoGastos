import { estadoFactura, buscarDuplicado } from './validacion.js';

// opciones.validadaPorUsuario: la subida viene de «Confirmar y subir» con el usuario
// mirando la tarjeta (Fase 10) → si no falta nada esencial, la factura nace completa.
export function entradaDeFactura(nombreArchivo, datos, origen, duplicada, opciones = {}){
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
    estado: estadoFactura(datos, origen, opciones),
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

// Fase 12: ¿el `ncf` repite el de OTRA factura del indice? Se excluye `archivoExcluir`
// (ella misma) y las YA marcadas duplicada — asi el ORIGINAL nunca se marca (y no sale
// del 606); solo la copia nueva. Puro. Es lo que permite detectar el duplicado de una
// factura de Lite: llega sin NCF y solo al leerla con IA se conoce y se puede comparar.
export function repiteNCF(indice, ncf, archivoExcluir){
  const otros = { facturas: (indice?.facturas || []).filter(f => f.archivo !== archivoExcluir && !f.duplicada) };
  return !!buscarDuplicado(otros, ncf);
}

// --- Fase 4: la verdad viaja con cada archivo -------------------------------
// La entrada completa se guarda ADEMAS como JSON en el campo `description` del archivo
// en Drive. Con N usuarios en una carpeta compartida, el indice _gastos.json puede
// perder una entrada por escrituras casi simultaneas; la conciliacion la restaura desde
// el archivo mismo. Ninguna factura puede desaparecer en silencio.

export function descDeEntrada(entrada){
  return JSON.stringify({ v: 1, ...entrada });
}

export function entradaDeDesc(str){
  try {
    const o = JSON.parse(str);
    if (!o || o.v !== 1 || !o.archivo) return null;
    const { v, ...entrada } = o;
    return entrada;
  } catch(e){ return null; }
}

const ES_IMAGEN = /image\/(jpeg|png|webp|heic|heif)/i;

// Compara el indice con los archivos reales de la carpeta (con sus description):
// - imagen con nombre de la app o con description valida ausente del indice → RESTAURAR
//   (re-chequeando duplicado por NCF contra el indice que se va construyendo);
// - imagen sin datos y fuera del indice → "Sin procesar".
// Puro e inmutable: devuelve { indice, restauradas, sinProcesar }.
export function conciliarIndice(indice, archivos){
  const base = (indice && Array.isArray(indice.facturas)) ? indice : { facturas: [] };
  let out = { ...base, facturas: [...base.facturas] };
  const indexados = new Set(out.facturas.map(f => f.archivo));
  const restauradas = [];
  const sinProcesar = [];
  for (const a of archivos || []){
    if (!ES_IMAGEN.test(a.mimeType || '')) continue;
    if (indexados.has(a.name)) continue;
    const entrada = entradaDeDesc(a.description);
    if (entrada){
      entrada.archivo = a.name; // el nombre real manda (pudo renombrarse)
      entrada.duplicada = entrada.duplicada || !!buscarDuplicado(out, entrada.ncf);
      out = agregarEntrada(out, entrada);
      indexados.add(a.name);
      restauradas.push(entrada);
    } else {
      sinProcesar.push(a.name);
    }
  }
  return { indice: out, restauradas, sinProcesar };
}
