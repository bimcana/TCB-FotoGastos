import { test } from 'node:test';
import assert from 'node:assert/strict';
import { empresaCompleta } from '../src/empresa.js';

test('empresaCompleta exige razon social y RNC', () => {
  assert.equal(empresaCompleta({ razon: 'CLIENTE SRL', rnc: '000-0000-00' }), true);
  assert.equal(empresaCompleta({ razon: 'CLIENTE SRL' }), false);
  assert.equal(empresaCompleta({ razon: ' ', rnc: 'x' }), false);
  assert.equal(empresaCompleta(null), false);
});
