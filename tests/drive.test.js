import { test } from 'node:test';
import assert from 'node:assert/strict';

// drive.js lee localStorage al importarse (restaura el token persistido): se simula
// antes del import dinamico. Cada caso usa ?v= para obtener una instancia limpia.
function conAlmacen(token){
  const m = new Map([['tcb:scopeV', '2']]);
  if (token) m.set('tcb:driveToken', JSON.stringify(token));
  globalThis.localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
  return import('../src/drive.js?v=' + Math.random());
}

const min = n => n * 60 * 1000;

test('porExpirar: fresco no, por expirar si, vencido no, sin token no', async () => {
  let d = await conAlmacen({ accessToken: 'x', expiraEn: Date.now() + min(60) });
  assert.equal(d.conectado(), true);
  assert.equal(d.porExpirar(), false);

  d = await conAlmacen({ accessToken: 'x', expiraEn: Date.now() + min(3) });
  assert.equal(d.conectado(), true);
  assert.equal(d.porExpirar(), true);          // dispara la renovacion anticipada
  assert.equal(d.porExpirar(min(1)), false);   // con margen mas corto, aun no

  d = await conAlmacen({ accessToken: 'x', expiraEn: Date.now() - min(1) });
  assert.equal(d.conectado(), false);
  assert.equal(d.porExpirar(), false);

  d = await conAlmacen(null);
  assert.equal(d.conectado(), false);
  assert.equal(d.porExpirar(), false);
});

// Fase 10: el boton «Reconectar a Drive» no puede quedar visible estando conectado.
test('debeMostrarReconectar: solo desconectado Y con conexion previa', async () => {
  const d = await conAlmacen(null);
  assert.equal(d.debeMostrarReconectar(true, true), false);   // conectado → jamas
  assert.equal(d.debeMostrarReconectar(true, false), false);
  assert.equal(d.debeMostrarReconectar(false, true), true);   // caso del aviso
  assert.equal(d.debeMostrarReconectar(false, false), false); // nunca conecto: va a Ajustes
});
