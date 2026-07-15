import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage falso para Node
globalThis.localStorage = (() => {
  let m = {};
  return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } };
})();

const { get, set } = await import('../src/settings.js');

test('devuelve el valor por defecto si no existe', () => {
  assert.equal(get('carpetaRaiz', 'Gastos_NCF'), 'Gastos_NCF');
});
test('persiste y recupera', () => {
  set('clientId', 'abc.apps.googleusercontent.com');
  assert.equal(get('clientId', ''), 'abc.apps.googleusercontent.com');
});
