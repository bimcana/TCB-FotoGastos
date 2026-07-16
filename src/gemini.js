const MODELO_DEFECTO = 'gemini-3.5-flash';
const ENDPOINT = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

const ESQUEMA = {
  type: 'object',
  properties: {
    fechaEmision:   { type: 'string', description: 'Fecha de emisión en formato AAAA-MM-DD. NUNCA la fecha de vencimiento o "válido hasta".' },
    ncf:            { type: 'string', description: 'Número de Comprobante Fiscal (NCF/e-NCF), p. ej. B0100182291 o E310000083906.' },
    rncEmisor:      { type: 'string', description: 'RNC del comercio que EMITE la factura (el proveedor), no el del cliente.' },
    nombreComercio: { type: 'string', description: 'Nombre del comercio/proveedor que emite.' },
    subtotal:       { type: 'number' },
    itbis:          { type: 'number', description: 'Monto de ITBIS.' },
    total:          { type: 'number', description: 'Total a pagar.' }
  },
  required: ['fechaEmision', 'ncf', 'total']
};

const PROMPT =
  'Eres un asistente contable dominicano. Extrae los datos de esta factura con comprobante fiscal (NCF) ' +
  'de República Dominicana. Reglas: (1) fechaEmision es la fecha en que se emitió la factura, NUNCA "Válido hasta", ' +
  '"Fecha límite" ni vencimiento; devuélvela como AAAA-MM-DD. (2) rncEmisor y nombreComercio son del COMERCIO que emite ' +
  '(el proveedor), no del cliente que compra. (3) ncf es el comprobante fiscal (serie B o E). (4) Los montos son números ' +
  'sin símbolo de moneda ni separador de miles. Si un dato no aparece, usa null.';

export function cuerpoPeticion(base64Jpeg){
  return {
    contents: [{ parts: [
      { inline_data: { mime_type: 'image/jpeg', data: base64Jpeg } },
      { text: PROMPT }
    ] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: ESQUEMA }
  };
}

export function parseRespuesta(json){
  try {
    const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text;
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
      total: num(d.total)
    };
  } catch(e){ return null; }
}

function canvasABase64(canvas){
  // Reducir a lado máximo ~1600px acelera la subida y el análisis (sobre todo con conexión
  // inestable) sin perder legibilidad del texto para el modelo. dataURL → solo el base64.
  const maxLado = 1600;
  const escala = Math.min(1, maxLado / Math.max(canvas.width, canvas.height));
  let fuente = canvas;
  if (escala < 1){
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * escala);
    c.height = Math.round(canvas.height * escala);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    fuente = c;
  }
  return fuente.toDataURL('image/jpeg', 0.85).split(',')[1];
}

export async function extraerDatos(canvas, apiKey, modelo = MODELO_DEFECTO, signal = undefined){
  const b64 = canvasABase64(canvas);
  const r = await fetch(`${ENDPOINT(modelo)}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpoPeticion(b64)),
    signal
  });
  if (!r.ok){
    const e = new Error('Gemini ' + r.status + ': ' + await r.text());
    e.status = r.status; // para diagnosticoGemini en la UI
    throw e;
  }
  return parseRespuesta(await r.json());
}

// Mensaje claro por causa (o null si no es un problema de la key: red caida, error
// transitorio del servicio). Cada codigo tiene un remedio distinto — no confundir al
// usuario con "revisa la API key" cuando en realidad se agoto la cuota del nivel gratis.
export function diagnosticoGemini(status){
  if (status === 429) return 'Límite de uso de Gemini alcanzado (cuota del nivel gratis) — espera unos minutos o cambia de modelo en Ajustes';
  if (status === 400 || status === 401) return 'API key de Gemini inválida — revísala en Ajustes';
  if (status === 403) return 'API key restringida o bloqueada para este dominio — revisa sus restricciones en Google AI Studio';
  if (status === 404) return 'El modelo elegido no está disponible para tu key — prueba otro modelo en Ajustes';
  return null;
}

// Prueba la key (y el modelo elegido) contra el listado de modelos: barato y sin gastar
// cuota de generacion. Devuelve { ok, mensaje }.
export async function probarApiKey(apiKey, modelo = MODELO_DEFECTO){
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=1000`);
  } catch(e){
    return { ok: false, mensaje: 'Sin conexión — no se pudo probar la key' };
  }
  if (!r.ok) return { ok: false, mensaje: diagnosticoGemini(r.status) || ('Error ' + r.status + ' al validar la key') };
  try {
    const j = await r.json();
    const nombres = (j.models || []).map(m => (m.name || '').replace(/^models\//, ''));
    if (!nombres.includes(modelo)){
      return { ok: false, mensaje: `Key válida ✓ pero el modelo «${modelo}» no aparece disponible — elige otro modelo` };
    }
    return { ok: true, mensaje: `Key válida ✓ — modelo «${modelo}» disponible` };
  } catch(e){
    return { ok: true, mensaje: 'Key válida ✓' };
  }
}
