import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuerpoPeticion, parseRespuesta, diagnosticoGemini, dimensionesLectura,
         filtrarModelosUtiles, MODELOS, MODELO_DEFECTO, etiquetaModelo } from '../src/gemini.js';

test('diagnosticoGemini distingue las causas por codigo HTTP', () => {
  assert.match(diagnosticoGemini(429), /cuota|límite/i);
  assert.match(diagnosticoGemini(400), /inválida/i);
  assert.match(diagnosticoGemini(401), /inválida/i);
  assert.match(diagnosticoGemini(403), /restringida|bloqueada/i);
  assert.match(diagnosticoGemini(404), /modelo/i);
  assert.equal(diagnosticoGemini(503), null); // error transitorio del servicio: sin toast de key
  assert.equal(diagnosticoGemini(0), null);   // fallo de red: sin toast de key
});

// Fase 23: el TEXTO va primero y la imagen despues (recomendacion oficial de Google
// cuando el prompt acompaña a una sola imagen con texto).
test('cuerpoPeticion pone el prompt antes de la imagen e incluye responseSchema', () => {
  const b = cuerpoPeticion('AAAA');
  assert.ok(b.contents[0].parts[0].text, 'el prompt va primero');
  assert.equal(b.contents[0].parts[1].inline_data.data, 'AAAA');
  assert.equal(b.contents[0].parts[1].inline_data.mime_type, 'image/jpeg');
  assert.equal(b.generationConfig.responseMimeType, 'application/json');
  assert.ok(b.generationConfig.responseSchema.properties.ncf);
  assert.ok(b.generationConfig.responseSchema.properties.fechaEmision);
});
test('parseRespuesta extrae y normaliza', () => {
  const fake = { candidates: [{ content: { parts: [{ text: JSON.stringify({
    fechaEmision:'2025-06-11', ncf:'B0100182291', rncEmisor:'131067603',
    nombreComercio:'Comercio X', subtotal:2910, itbis:523.8, total:3724.8 }) }] } }] };
  const d = parseRespuesta(fake);
  assert.equal(d.ncf, 'B0100182291');
  assert.equal(d.total, 3724.8);
});
test('parseRespuesta con forma inválida → null', () => {
  assert.equal(parseRespuesta({}), null);
  assert.equal(parseRespuesta({ candidates: [] }), null);
});

// --- Fase 8: el prompt conoce el RNC del cliente para no confundir emisor ---
test('cuerpoPeticion con rncCliente lo advierte en el prompt', () => {
  const b = cuerpoPeticion('AAAA', { rncCliente: '1-33-23182-4' });
  const texto = b.contents[0].parts[0].text;
  assert.match(texto, /133231824/);
  assert.match(texto, /rncEmisor/);
});

test('cuerpoPeticion sin rncCliente no agrega la advertencia', () => {
  const b = cuerpoPeticion('AAAA');
  assert.doesNotMatch(b.contents[0].parts[0].text, /ATENCI/);
});


// --- Fase 23: la imagen que se le manda al modelo --------------------------
// El bug que mas NCF arruinaba: reducir por el lado LARGO dejaba los rollos termicos
// en ~320 px de ancho. Se dimensiona por el lado CORTO y nunca se amplia.
test('dimensionesLectura: un rollo vertical conserva el ancho del papel', () => {
  // 050.jpg real: 884x3500. Antes se enviaba 323x1280.
  const d = dimensionesLectura(884, 3500);
  assert.equal(d.w, 884);            // ya esta por debajo del objetivo: no se amplia
  assert.equal(d.h, 3500);
  assert.ok(d.w > 800, 'el ancho del papel no puede quedar en 300 px');
});

test('dimensionesLectura: reduce por el lado corto, no por el largo', () => {
  const d = dimensionesLectura(2000, 6000);   // foto grande de un rollo
  assert.equal(d.w, 1280);
  assert.equal(d.h, 3840);
});

test('dimensionesLectura: nunca amplia una imagen pequeña', () => {
  const d = dimensionesLectura(600, 900);
  assert.deepEqual(d, { w: 600, h: 900 });
});

test('dimensionesLectura: respeta el tope de pixeles', () => {
  const d = dimensionesLectura(4000, 12000);  // corto 4000 -> escala a 1280x3840 = 4.9 MP
  assert.ok(d.w * d.h <= 5e6 + 1, 'no supera ~5 MP');
  const g = dimensionesLectura(3000, 30000);  // muy largo: manda el tope de pixeles
  assert.ok(g.w * g.h <= 5e6 + 1);
  assert.ok(g.w < 1280, 'con un rollo larguisimo el tope recorta tambien el ancho');
});

test('dimensionesLectura: entradas invalidas no revientan', () => {
  assert.deepEqual(dimensionesLectura(0, 100), { w: 0, h: 0 });
  assert.deepEqual(dimensionesLectura(undefined, undefined), { w: 0, h: 0 });
});

// --- Fase 23: solo modelos que existen de verdad ---------------------------
test('el catalogo no contiene gemini-3-flash (nunca llego a GA)', () => {
  assert.ok(!MODELOS.some(m => m.id === 'gemini-3-flash'),
    'gemini-3-flash solo existio como -preview: elegirlo daba 404');
  assert.equal(MODELO_DEFECTO, 'gemini-3.7-flash');
  assert.ok(MODELOS.some(m => m.id === 'gemini-3.7-flash'));
  assert.ok(MODELOS.every(m => /^gemini-\d/.test(m.id)));
});

test('filtrarModelosUtiles deja solo los que sirven para leer una factura', () => {
  const crudos = [
    { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-embedding-2', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-3.1-flash-tts-preview', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3-pro-image', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-flash-latest', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/veo-3.1-generate-preview', supportedGenerationMethods: ['generateContent'] }
  ];
  assert.deepEqual(filtrarModelosUtiles(crudos), ['gemini-3.7-flash', 'gemini-2.5-flash']);
  assert.deepEqual(filtrarModelosUtiles(null), []);
});

test('etiquetaModelo nombra los del catalogo y no inventa los desconocidos', () => {
  assert.equal(etiquetaModelo('gemini-3.7-flash'), 'Gemini 3.7 Flash');
  assert.match(etiquetaModelo('gemini-4-flash'), /4 flash/i);
});
