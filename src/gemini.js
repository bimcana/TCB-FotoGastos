// Lectura de facturas con Gemini (Google AI Studio).
//
// CATALOGO DE MODELOS — Fase 23. Solo entran modelos que EXISTEN de verdad, verificados
// contra la documentacion oficial de la API el 21 de agosto de 2026. Antes figuraba
// «gemini-3-flash» en Ajustes: ese id nunca llego a GA (solo existio como
// `gemini-3-flash-preview`), asi que elegirlo devolvia 404. Ya no esta.
//
// Los cuatro son multimodales (aceptan imagen), soportan salida estructurada
// (responseSchema) y estan cubiertos por el nivel gratuito de AI Studio CON LA MISMA
// API KEY — no hace falta ninguna llave nueva ni activar nada.
//
// Ademas, `listarModelos` consulta la lista REAL de la key del usuario: si Google publica
// un Flash mas nuevo aparece solo en Ajustes, y si alguno deja de estar disponible se
// marca. El catalogo de aqui es el orden de preferencia y el respaldo sin conexion.
export const MODELOS = [
  { id: 'gemini-3.7-flash', etiqueta: '3.7 Flash', nota: 'El mas nuevo y preciso (13-ago-2026)' },
  { id: 'gemini-3.6-flash', etiqueta: '3.6 Flash', nota: 'Rapido y economico' },
  { id: 'gemini-3.5-flash', etiqueta: '3.5 Flash', nota: 'El que usabas hasta ahora' },
  { id: 'gemini-2.5-flash', etiqueta: '2.5 Flash', nota: 'Respaldo: cuota aparte de la serie 3' }
];

export const MODELO_DEFECTO = 'gemini-3.7-flash';

export function etiquetaModelo(id){
  const m = MODELOS.find(x => x.id === id);
  if (m) return 'Gemini ' + m.etiqueta;
  // Un modelo descubierto por `listarModelos` que el catalogo no conoce: se muestra su id
  // limpio en vez de inventarle un nombre.
  return String(id || '').replace(/^gemini-/, 'Gemini ').replace(/-/g, ' ');
}

const ENDPOINT = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

const ESQUEMA = {
  type: 'object',
  properties: {
    fechaEmision:   { type: 'string', description: 'Fecha de emisión en formato AAAA-MM-DD. NUNCA la fecha de vencimiento o "válido hasta".' },
    ncf:            { type: 'string', description: 'Número de Comprobante Fiscal. Serie B: exactamente 11 caracteres (B + 2 dígitos de tipo + 8 de secuencia), p. ej. B0100182291. Serie E (e-NCF): exactamente 13 caracteres (E + 2 + 10), p. ej. E310000083906. Sin espacios ni guiones.' },
    rncEmisor:      { type: 'string', description: 'RNC del comercio que EMITE la factura (el proveedor), no el del cliente. 9 dígitos (RNC) u 11 (cédula).' },
    nombreComercio: { type: 'string', description: 'Nombre del comercio/proveedor que emite.' },
    subtotal:       { type: 'number', description: 'Monto gravado antes de ITBIS y antes de propina.' },
    itbis:          { type: 'number', description: 'Monto de ITBIS.' },
    total:          { type: 'number', description: 'Total a pagar impreso en la factura.' },
    propinaLegal:   { type: 'number', description: 'Propina legal del 10% (etiquetas "Propina Legal", "10% Ley", "Ley 16-92"). Solo restaurantes y servicios de comida; si no aparece impresa, null.' }
  },
  required: ['fechaEmision', 'ncf', 'total']
};

// Reglas de lectura de digitos. Van en LOS DOS prompts porque son el origen real de los
// errores de campo que reporta Ari: papel termico descolorido donde 0/6/8/9/5/3 y 8/3
// comparten silueta, y ceros de relleno que se pierden o se duplican.
const REGLAS_DIGITOS =
  'PRECISION EN LOS NUMEROS (es lo mas importante de esta tarea): ' +
  '(a) El NCF de serie B mide EXACTAMENTE 11 caracteres: la letra B, 2 dígitos de tipo y 8 de secuencia. ' +
  'El e-NCF de serie E mide EXACTAMENTE 13: la letra E, 2 dígitos de tipo y 10 de secuencia. ' +
  'CUENTA los caracteres antes de responder; si no te da 11 o 13, vuelve a mirar la imagen. ' +
  '(b) La secuencia lleva CEROS DE RELLENO a la izquierda: no quites ni añadas ceros para "cuadrar" el largo. ' +
  '(c) En papel térmico se confunden 0 con 6, 8, 9, 5 y 3; y 8 con 3; y 5 con 6; y 1 con 7. ' +
  'Mira el trazo de cada dígito uno por uno, no la forma general del número. ' +
  '(d) El RNC tiene 9 dígitos (empresa) u 11 (cédula): cuéntalos también. ' +
  '(e) Los montos van sin símbolo de moneda ni separador de miles, con punto decimal.';

const PROMPT =
  'Eres un asistente contable dominicano. Extrae los datos de esta factura con comprobante fiscal (NCF) ' +
  'de República Dominicana. Reglas: (1) fechaEmision es la fecha en que se emitió la factura, NUNCA "Válido hasta", ' +
  '"Fecha límite" ni vencimiento; devuélvela como AAAA-MM-DD. (2) rncEmisor y nombreComercio son del COMERCIO que emite ' +
  '(el proveedor), no del cliente que compra. (3) ncf es el comprobante fiscal (serie B o E). (4) Los montos son números ' +
  'sin símbolo de moneda ni separador de miles. (5) nombreComercio es el nombre comercial destacado en la cabecera ' +
  '(el texto grande o del logo), NO la dirección, la sucursal ni frases genéricas; si hay razón social (SRL, SAS, EIRL), prefiérela. ' +
  '(6) Los vouchers suelen imprimir también el RNC del CLIENTE que compra: ese NUNCA es rncEmisor. ' +
  '(7) Devuelve subtotal e itbis solo si están impresos (no los calcules). ' +
  '(8) La cabecera de un voucher de tarjeta trae la marca del verifón/procesador (CARDNET, VERIFONE, ' +
  '«NOS UNE», PORTAL, VisaNet): eso NUNCA es nombreComercio — el comercio aparece después. ' +
  '(9) propinaLegal es la propina legal del 10% que cobran restaurantes y servicios de comida, ' +
  'impresa como "Propina Legal", "10% Ley", "% Ley" o "Ley 16-92"; devuélvela SOLO si está impresa ' +
  'como línea aparte, nunca la calcules ni la confundas con el ITBIS. ' +
  REGLAS_DIGITOS + ' ' +
  'Si un dato no aparece, usa null. No inventes ningún dato que no puedas leer en la imagen.';

// Segunda pasada. NO es repetir la primera: se le da otra imagen (el mismo documento
// renderizado en alto contraste) y otro encargo — transcribir lo impreso carácter a
// carácter en vez de "entender la factura". Dos caminos distintos hacia el mismo dato es
// lo que hace que el desacuerdo signifique algo.
const PROMPT_VERIFICACION =
  'Actúa como un transcriptor perito, no como un asistente. Esta es una factura dominicana. ' +
  'Tu único trabajo es TRANSCRIBIR literalmente lo que está impreso, carácter por carácter, sin interpretar ' +
  'ni completar ni corregir nada. Localiza y transcribe: el comprobante fiscal (NCF/e-NCF), el RNC del ' +
  'comercio emisor, la fecha de emisión, y los montos impresos (subtotal, ITBIS, propina legal y total a pagar). ' +
  REGLAS_DIGITOS + ' ' +
  'El RNC del emisor está en la cabecera, junto al nombre del comercio; si abajo aparece otro RNC etiquetado ' +
  'como cliente, ese NO es. Si un dato no está impreso o no lo puedes leer con seguridad, devuelve null: ' +
  'un null es una respuesta correcta, una suposición no.';

function conRncCliente(prompt, opciones){
  const rncCliente = String(opciones?.rncCliente || '').replace(/\D/g, '');
  if (!rncCliente) return prompt;
  return prompt + ` ATENCIÓN: el RNC ${rncCliente} es el del CLIENTE que compra — nunca lo devuelvas como rncEmisor.`;
}

// `media_resolution` (Gemini 3) fija cuántos tokens de visión recibe la imagen. HIGH es
// el nivel que la documentación asocia a leer texto fino; se manda EXPLICITO para que el
// comportamiento no dependa del modelo elegido. `thinking_level` solo existe en la serie
// 3: mandarselo a un 2.5 seria un parametro inventado, asi que se omite (y aun asi
// `pedir` reintenta sin extras si algun modelo los rechaza).
function extrasDeModelo(modelo){
  const extras = { mediaResolution: 'MEDIA_RESOLUTION_HIGH' };
  if (/^gemini-3/.test(String(modelo || ''))) extras.thinkingLevel = 'low';
  return extras;
}

// El texto va ANTES de la imagen: es la recomendación oficial cuando el prompt acompaña
// a una sola imagen con texto.
export function cuerpoPeticion(base64Jpeg, opciones = {}){
  const prompt = conRncCliente(opciones.verificacion ? PROMPT_VERIFICACION : PROMPT, opciones);
  return {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: 'image/jpeg', data: base64Jpeg } }
    ] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: ESQUEMA,
      ...extrasDeModelo(opciones.modelo)
    }
  };
}

export function parseRespuesta(json){
  try {
    const txt = json?.candidates?.[0]?.content?.parts?.map(p => p?.text).filter(Boolean).join('');
    if (!txt) return null;
    const d = JSON.parse(txt);
    const num = v => (typeof v === 'number' && Number.isFinite(v)) ? v : (v == null ? null : Number(v));
    return {
      fechaEmision: d.fechaEmision ?? null,
      ncf: d.ncf ?? null,
      rncEmisor: d.rncEmisor ?? null,
      nombreComercio: d.nombreComercio ?? null,
      subtotal: num(d.subtotal),
      itbis: num(d.itbis),
      total: num(d.total),
      propinaLegal: num(d.propinaLegal)
    };
  } catch(e){ return null; }
}

// --- La imagen que se le manda al modelo (Fase 23) --------------------------
// ANTES: se reducía al LADO LARGO (1280 px). Con las facturas reales de Ari eso era
// demoledor — son rollos térmicos verticales:
//     050.jpg  884x3500  ->  se enviaba a  323x1280
//     110.jpg  985x3500  ->  se enviaba a  360x1280
// Un NCF de 11 caracteres dentro de 323 px de ancho son ~10 px por dígito: ahí es
// físicamente imposible distinguir un 0 de un 8. 30 de las 36 facturas de junio tienen
// proporción mayor que 2, así que era el caso NORMAL, no el raro.
//
// AHORA se dimensiona por el LADO CORTO (el ancho del papel, que es donde vive el texto)
// y se limita el total de píxeles para que la subida siga siendo razonable. Nunca se
// amplía: agrandar no añade información y solo engorda el envío.
export const ANCHO_LECTURA = 1280;   // px objetivo del lado corto
export const MAX_PIXELES = 5e6;      // ~5 MP: tope de la subida

/** Tamaño final de la imagen de lectura. Puro (sin DOM): testeable. */
export function dimensionesLectura(w, h, opciones = {}){
  const anchoObjetivo = opciones.anchoObjetivo || ANCHO_LECTURA;
  const maxPixeles = opciones.maxPixeles || MAX_PIXELES;
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const corto = Math.min(w, h);
  let escala = Math.min(1, anchoObjetivo / corto);   // nunca ampliar
  let W = Math.max(1, Math.round(w * escala));
  let H = Math.max(1, Math.round(h * escala));
  if (W * H > maxPixeles){
    const k = Math.sqrt(maxPixeles / (W * H));
    W = Math.max(1, Math.round(W * k));
    H = Math.max(1, Math.round(H * k));
  }
  return { w: W, h: H };
}

// Calidad 0.92 en vez de 0.85: los artefactos de JPEG a 0.85 se comen precisamente los
// trazos finos que separan un 8 de un 3 en papel térmico.
export const CALIDAD_LECTURA = 0.92;

function canvasABase64(canvas){
  const { w, h } = dimensionesLectura(canvas.width, canvas.height);
  let fuente = canvas;
  if (w !== canvas.width || h !== canvas.height){
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, w, h);
    fuente = c;
  }
  return fuente.toDataURL('image/jpeg', CALIDAD_LECTURA).split(',')[1];
}

// Una peticion, con un reintento defensivo: si el modelo rechaza los parametros de ajuste
// (`mediaResolution` / `thinkingLevel`) con un 400, se repite SIN ellos antes de darse por
// vencido. Asi un modelo nuevo o distinto nunca deja al usuario sin lectura.
async function pedir(modelo, apiKey, cuerpo, signal){
  const url = `${ENDPOINT(modelo)}?key=${encodeURIComponent(apiKey)}`;
  const enviar = c => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c), signal
  });
  let r = await enviar(cuerpo);
  if (r.status === 400 && cuerpo.generationConfig){
    const { mediaResolution, thinkingLevel, ...resto } = cuerpo.generationConfig;
    if (mediaResolution || thinkingLevel){
      r = await enviar({ ...cuerpo, generationConfig: resto });
    }
  }
  if (!r.ok){
    const e = new Error('Gemini ' + r.status + ': ' + await r.text());
    e.status = r.status; // para diagnosticoGemini en la UI
    throw e;
  }
  return parseRespuesta(await r.json());
}

export async function extraerDatos(canvas, apiKey, modelo = MODELO_DEFECTO, signal = undefined, opciones = {}){
  const b64 = canvasABase64(canvas);
  return pedir(modelo, apiKey, cuerpoPeticion(b64, { ...opciones, modelo }), signal);
}

/**
 * Segunda lectura, para contrastar con la primera. `canvas` deberia ser un render
 * DISTINTO del mismo documento (p. ej. alto contraste en grises): si se le manda la
 * misma imagen y el mismo prompt, coincidir no demuestra nada.
 */
export async function verificarDatos(canvas, apiKey, modelo = MODELO_DEFECTO, signal = undefined, opciones = {}){
  const b64 = canvasABase64(canvas);
  return pedir(modelo, apiKey, cuerpoPeticion(b64, { ...opciones, modelo, verificacion: true }), signal);
}

// Mensaje claro por causa (o null si no es un problema de la key: red caida, error
// transitorio del servicio). Cada codigo tiene un remedio distinto — no confundir al
// usuario con "revisa la API key" cuando en realidad se agoto la cuota del nivel gratis.
export function diagnosticoGemini(status){
  if (status === 429) return 'Límite de uso de Gemini alcanzado (cuota del nivel gratis) — espera unos minutos o cambia de modelo en Ajustes';
  if (status === 400 || status === 401) return 'API key de Gemini inválida — revísala en Ajustes';
  if (status === 403) return 'API key restringida o bloqueada para este dominio — revisa sus restricciones en Google AI Studio';
  if (status === 404) return 'El modelo elegido no está disponible para tu key — pulsa «Comprobar modelos» en Ajustes';
  return null;
}

// --- Modelos REALES de la key (Fase 23) ------------------------------------
// Peticion de Ari: «no incluir en ajustes modelos que no existen en realidad». La unica
// forma de garantizarlo con el tiempo es no fiarse de una lista escrita a mano: se le
// pregunta a la API cuales existen PARA ESTA KEY y se filtran los que sirven aqui
// (soportan generateContent). Es una llamada barata que no gasta cuota de generacion.
export function filtrarModelosUtiles(lista){
  return (lista || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, ''))
    .filter(id => /^gemini-/.test(id))
    // Fuera lo que no sirve para leer una factura: variantes de audio/voz/imagen/video,
    // embeddings y los alias moviles («-latest», «-001»…) que solo duplican la lista.
    .filter(id => !/(embedding|aqa|tts|audio|native-audio|live|image|video|veo|lyria|computer-use|deep-research|thinking-exp)/.test(id))
    .filter(id => !/-(latest|\d{3})$/.test(id));
}

/**
 * Modelos que la key puede usar, ordenados: primero los del catalogo (orden de
 * preferencia) y despues los que Google haya publicado y aqui no se conozcan todavia.
 * Devuelve { ok, modelos, mensaje }.
 */
export async function listarModelos(apiKey){
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=1000`);
  } catch(e){
    return { ok: false, modelos: [], mensaje: 'Sin conexión — no se pudo consultar la lista de modelos' };
  }
  if (!r.ok) return { ok: false, modelos: [], mensaje: diagnosticoGemini(r.status) || ('Error ' + r.status + ' al consultar los modelos') };
  let disponibles;
  try { disponibles = filtrarModelosUtiles((await r.json()).models); }
  catch(e){ return { ok: false, modelos: [], mensaje: 'Respuesta inesperada de Google al listar modelos' }; }
  const set = new Set(disponibles);
  const delCatalogo = MODELOS.filter(m => set.has(m.id)).map(m => ({ ...m, disponible: true }));
  const conocidos = new Set(MODELOS.map(m => m.id));
  const nuevos = disponibles
    .filter(id => !conocidos.has(id) && /flash|pro/.test(id))
    .sort()
    .reverse()
    .map(id => ({ id, etiqueta: id.replace(/^gemini-/, ''), nota: 'Publicado por Google después de esta versión', disponible: true }));
  return { ok: true, modelos: [...delCatalogo, ...nuevos], mensaje: `${delCatalogo.length + nuevos.length} modelo(s) disponibles con tu key` };
}

// Prueba la key (y el modelo elegido) contra el listado de modelos: barato y sin gastar
// cuota de generacion. Devuelve { ok, mensaje }.
export async function probarApiKey(apiKey, modelo = MODELO_DEFECTO){
  const r = await listarModelos(apiKey);
  if (!r.ok) return { ok: false, mensaje: r.mensaje };
  if (!r.modelos.some(m => m.id === modelo)){
    return { ok: false, mensaje: `Key válida ✓ pero el modelo «${modelo}» no aparece disponible — elige otro modelo` };
  }
  return { ok: true, mensaje: `Key válida ✓ — ${etiquetaModelo(modelo)} disponible` };
}
