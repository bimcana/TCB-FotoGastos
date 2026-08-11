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
    propinaLegal: datos.propinaLegal ?? 0,   // columna Y del 606; 0 si la factura no la trae
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
// - imagen sin datos y fuera del indice → "Sin procesar";
// - entrada del indice cuya imagen YA NO ESTA en Drive → HUERFANA, se quita (Fase 22).
// Puro e inmutable: devuelve { indice, restauradas, sinProcesar, huerfanas }.
//
// Las huerfanas aparecen cuando alguien borra la factura directamente en Drive: antes la
// entrada se quedaba en `_gastos.json` para siempre, Gastos la seguia mostrando sin
// miniatura, no se dejaba borrar y el cierre del mes fallaba al no encontrar la imagen.
// SALVAGUARDA: si la lista de archivos llega VACIA no se quita nada — una respuesta
// incompleta de Drive (o un fallo de red) no puede vaciar el indice del mes.
export function conciliarIndice(indice, archivos){
  const base = (indice && Array.isArray(indice.facturas)) ? indice : { facturas: [] };
  let out = { ...base, facturas: [...base.facturas] };
  const indexados = new Set(out.facturas.map(f => f.archivo));
  const restauradas = [];
  const sinProcesar = [];
  const lista = archivos || [];
  for (const a of lista){
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
  // Entradas sin archivo en Drive: se sacan del indice para que la app refleje la realidad.
  let huerfanas = [];
  if (lista.length){
    const enDrive = new Set(lista.filter(a => ES_IMAGEN.test(a.mimeType || '')).map(a => a.name));
    huerfanas = out.facturas.filter(f => !enDrive.has(f.archivo));
    if (huerfanas.length) out = { ...out, facturas: out.facturas.filter(f => enDrive.has(f.archivo)) };
  }
  return { indice: out, restauradas, sinProcesar, huerfanas };
}
