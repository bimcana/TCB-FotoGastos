import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ncfValido, normalizarFecha, montoValido, buscarDuplicado } from '../src/validacion.js';

test('NCF serie B válido', () => { assert.equal(ncfValido('B0100182291'), true); });
test('NCF serie E válido', () => { assert.equal(ncfValido('E310000083906'), true); });
test('NCF inválido (corto / con espacios / vacío)', () => {
  assert.equal(ncfValido('B01001'), false);
  assert.equal(ncfValido('B01 0018 2291'), false);
  assert.equal(ncfValido(''), false);
  assert.equal(ncfValido(null), false);
});
test('normalizarFecha ISO', () => { assert.equal(normalizarFecha('2025-06-11'), '2025-06-11'); });
test('normalizarFecha DD/MM/AAAA', () => { assert.equal(normalizarFecha('11/06/2025'), '2025-06-11'); });
test('normalizarFecha español "11 jun. 2025"', () => { assert.equal(normalizarFecha('11 jun. 2025'), '2025-06-11'); });
test('normalizarFecha basura → null', () => { assert.equal(normalizarFecha('no es fecha'), null); });
test('montoValido', () => {
  assert.equal(montoValido(3724.80), true);
  assert.equal(montoValido(-1), false);
  assert.equal(montoValido('x'), false);
});
test('buscarDuplicado encuentra por NCF', () => {
  const idx = { facturas: [{ archivo:'Compra_100.jpg', ncf:'B0100077145' }] };
  assert.equal(buscarDuplicado(idx, 'B0100077145').archivo, 'Compra_100.jpg');
  assert.equal(buscarDuplicado(idx, 'B0100182291'), null);
  assert.equal(buscarDuplicado({ facturas: [] }, 'B0100077145'), null);
});
