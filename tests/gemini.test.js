import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuerpoPeticion, parseRespuesta } from '../src/gemini.js';

test('cuerpoPeticion incluye la imagen y responseSchema', () => {
  const b = cuerpoPeticion('AAAA');
  assert.equal(b.contents[0].parts[0].inline_data.data, 'AAAA');
  assert.equal(b.contents[0].parts[0].inline_data.mime_type, 'image/jpeg');
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
