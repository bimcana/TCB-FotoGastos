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
  // dataURL "data:image/jpeg;base64,XXXX" → solo la parte base64
  return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
}

export async function extraerDatos(canvas, apiKey, modelo = MODELO_DEFECTO){
  const b64 = canvasABase64(canvas);
  const r = await fetch(`${ENDPOINT(modelo)}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpoPeticion(b64))
  });
  if (!r.ok) throw new Error('Gemini ' + r.status + ': ' + await r.text());
  return parseRespuesta(await r.json());
}
