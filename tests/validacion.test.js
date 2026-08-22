import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ncfValido, normalizarFecha, montoValido, buscarDuplicado, facturaCompleta, estadoFactura, normalizarMontoTexto, formatearFechaDO, formatearMonto,
         rncValido, deducirMontos, afinarDatosFactura, ncfCanonico, ncfDiagnostico,
         ncfTipoConocido, corregirNcf, mismoRnc, coherenciaMontos,
         conciliarLecturas } from '../src/validacion.js';

test('NCF serie B válido', () => { assert.equal(ncfValido('B0100182291'), true); });
test('NCF serie E válido', () => { assert.equal(ncfValido('E310000083906'), true); });
test('NCF inválido (corto / vacío)', () => {
  assert.equal(ncfValido('B01001'), false);
  assert.equal(ncfValido(''), false);
  assert.equal(ncfValido(null), false);
  // Fase 23: los separadores YA no invalidan — el NCF se canoniza antes de medirlo.
  // Lo que decide es el largo, que es justo lo que la IA y el OCR se equivocan.
  assert.equal(ncfValido('B01 0018 2291'), true);
});

// --- Fase 23: la LONGITUD del NCF atrapa el cero de mas o de menos ----------
// Ari reportaba NCF con un 0 sobrante o faltante que la app daba por buenos. El largo
// es fijo: B + 2 + 8 = 11 caracteres; E + 2 + 10 = 13. Verificado contra el TXT real.
test('ncfValido rechaza el cero de más o de menos', () => {
  assert.equal(ncfValido('B0100007133'), true, 'B correcto: 11');
  assert.equal(ncfValido('B01000071330'), false, 'B con un 0 de más');
  assert.equal(ncfValido('B010000713'), false, 'B con un dígito de menos');
  assert.equal(ncfValido('E310000025067'), true, 'E correcto: 13');
  assert.equal(ncfValido('E3100000250670'), false, 'E con un 0 de más');
  assert.equal(ncfValido('E31000002506'), false, 'E con un dígito de menos');
  assert.equal(ncfValido('E310000083906'), true);
  assert.equal(ncfValido('B01000083906'), false, 'un largo de E no vale para una B');
});

test('ncfDiagnostico dice QUÉ está mal, no solo que está mal', () => {
  assert.equal(ncfDiagnostico('B0100007133').ok, true);
  assert.match(ncfDiagnostico('B01000071330').motivo, /sobra/i);
  assert.match(ncfDiagnostico('B010000713').motivo, /falta/i);
  assert.match(ncfDiagnostico('X0100007133').motivo, /B o E/);
  assert.match(ncfDiagnostico(null).motivo, /sin ncf/i);
  // Tipo fuera de la lista de la DGII: se avisa, no se bloquea en silencio.
  assert.match(ncfDiagnostico('B0900007133').motivo, /tipo/i);
});

test('corregirNcf arregla solo lo que es deducible con certeza', () => {
  // Letras en posiciones que OBLIGATORIAMENTE son dígitos: la corrección es única.
  assert.equal(corregirNcf('b01 OOOO7l33'), 'B0100007133');
  assert.equal(corregirNcf('E3l000002S067'), 'E310000025067');
  // Un 8 leído donde iba la B de la serie; un 3 donde iba la E.
  assert.equal(corregirNcf('80100007133'), 'B0100007133');
  assert.equal(corregirNcf('30100007133')[0], 'E');
  // NUNCA agrega ni quita dígitos: si el largo está mal, se deja tal cual para que se vea.
  assert.equal(corregirNcf('B010000713'), 'B010000713');
  assert.equal(corregirNcf(null), null);
});

test('ncfTipoConocido: tipos vigentes de la DGII', () => {
  assert.equal(ncfTipoConocido('B0100007133'), true);   // B01 factura de crédito fiscal
  assert.equal(ncfTipoConocido('E310000025067'), true); // E31 factura electrónica
  assert.equal(ncfTipoConocido('E430000025067'), true); // E43 gastos menores
  assert.equal(ncfTipoConocido('B9900007133'), false);
  assert.equal(ncfTipoConocido('B010000713'), false);   // largo malo: ni se evalúa el tipo
});
test('normalizarFecha ISO', () => { assert.equal(normalizarFecha('2025-06-11'), '2025-06-11'); });
test('normalizarFecha DD/MM/AAAA', () => { assert.equal(normalizarFecha('11/06/2025'), '2025-06-11'); });
test('normalizarFecha español "11 jun. 2025"', () => { assert.equal(normalizarFecha('11 jun. 2025'), '2025-06-11'); });
test('normalizarFecha basura → null', () => { assert.equal(normalizarFecha('no es fecha'), null); });
// Fase 10: formato de la factura de Punta Cana BM Cargo — AAAA.MM.DD con puntos.
test('normalizarFecha ISO con punto o barra (2026.07.11 / 2026/07/11)', () => {
  assert.equal(normalizarFecha('2026.07.11'), '2026-07-11');
  assert.equal(normalizarFecha('2026/07/11'), '2026-07-11');
  assert.equal(normalizarFecha('2026.7.1'), '2026-07-01');
  assert.equal(normalizarFecha('11.07.2026'), '2026-07-11'); // DD.MM.AAAA sigue igual
});
test('montoValido', () => {
  assert.equal(montoValido(3724.80), true);
  assert.equal(montoValido(-1), false);
  assert.equal(montoValido('x'), false);
});
// --- Fase 22: el NCF se compara en forma canonica ---
// El OCR y la IA devuelven el mismo comprobante de formas distintas y la MISMA factura
// no se detectaba como duplicada (lo reporto Ari).
test('ncfCanonico: mismo comprobante escrito de varias formas → misma clave', () => {
  const esperado = 'B0100007133';
  for (const v of ['B0100007133', 'b0100007133', 'B01 0000 7133', 'B01-0000-7133',
                   ' B0100007133 ', 'B01.0000.7133'])
    assert.equal(ncfCanonico(v), esperado, `fallo con "${v}"`);
  assert.equal(ncfCanonico('e310000025067'), 'E310000025067');
  assert.equal(ncfCanonico(null), '');
  assert.equal(ncfCanonico(''), '');
});

test('buscarDuplicado detecta el duplicado aunque el NCF venga con espacios o minusculas', () => {
  const idx = { facturas: [{ archivo: 'Compra_020.jpg', ncf: 'B0100007133' }] };
  assert.equal(buscarDuplicado(idx, 'b01 0000 7133').archivo, 'Compra_020.jpg');
  assert.equal(buscarDuplicado(idx, 'B01-0000-7133').archivo, 'Compra_020.jpg');
  assert.equal(buscarDuplicado(idx, 'B0100007134'), null, 'un NCF distinto no es duplicado');
});

test('buscarDuplicado: sin NCF no inventa duplicados', () => {
  const idx = { facturas: [{ archivo: 'a.jpg', ncf: null }, { archivo: 'b.jpg', ncf: '' }] };
  assert.equal(buscarDuplicado(idx, null), null);
  assert.equal(buscarDuplicado(idx, ''), null);
  assert.equal(buscarDuplicado(idx, '   '), null);
});

test('buscarDuplicado encuentra por NCF', () => {
  const idx = { facturas: [{ archivo:'Compra_100.jpg', ncf:'B0100077145' }] };
  assert.equal(buscarDuplicado(idx, 'B0100077145').archivo, 'Compra_100.jpg');
  assert.equal(buscarDuplicado(idx, 'B0100182291'), null);
  assert.equal(buscarDuplicado({ facturas: [] }, 'B0100077145'), null);
});

const DATOS_COMPLETOS = { fechaEmision:'2025-06-11', ncf:'B0100182291', rncEmisor:'131067603', total:3724.8 };

test('facturaCompleta true con los 4 esenciales', () => {
  assert.equal(facturaCompleta(DATOS_COMPLETOS), true);
});
test('facturaCompleta false si falta fechaEmision', () => {
  assert.equal(facturaCompleta({ ...DATOS_COMPLETOS, fechaEmision: null }), false);
});
test('facturaCompleta false si falta ncf', () => {
  assert.equal(facturaCompleta({ ...DATOS_COMPLETOS, ncf: null }), false);
});
test('facturaCompleta false si falta rncEmisor', () => {
  assert.equal(facturaCompleta({ ...DATOS_COMPLETOS, rncEmisor: null }), false);
});
test('facturaCompleta false si falta total', () => {
  assert.equal(facturaCompleta({ ...DATOS_COMPLETOS, total: null }), false);
});

test('estadoFactura: completos + origen gemini → completa', () => {
  assert.equal(estadoFactura(DATOS_COMPLETOS, 'gemini'), 'completa');
});
test('estadoFactura: completos + origen manual → completa', () => {
  assert.equal(estadoFactura(DATOS_COMPLETOS, 'manual'), 'completa');
});
test('estadoFactura: completos + origen local → pendiente', () => {
  assert.equal(estadoFactura(DATOS_COMPLETOS, 'local'), 'pendiente');
});
test('estadoFactura: falta un esencial (total) → incompleta aunque origen sea gemini', () => {
  assert.equal(estadoFactura({ ...DATOS_COMPLETOS, total: null }, 'gemini'), 'incompleta');
});

// --- Fase 10: «Confirmar y subir» con la tarjeta revisada = factura validada ---
// Con el OCR local como motor por defecto (Fase 9), marcar 'pendiente' todo lo capturado
// llenaba Gastos de avisos aunque el usuario ya hubiera revisado los campos.
test('estadoFactura: OCR local CONFIRMADO por el usuario → completa (sin advertencias)', () => {
  assert.equal(estadoFactura(DATOS_COMPLETOS, 'local'), 'pendiente'); // sin confirmar
  assert.equal(estadoFactura(DATOS_COMPLETOS, 'local', { validadaPorUsuario: true }), 'completa');
});

test('estadoFactura: confirmar NO tapa un campo esencial vacio', () => {
  assert.equal(estadoFactura({ ...DATOS_COMPLETOS, ncf: null }, 'local', { validadaPorUsuario: true }), 'incompleta');
  assert.equal(estadoFactura({ ...DATOS_COMPLETOS, rncEmisor: null }, 'gemini', { validadaPorUsuario: true }), 'incompleta');
});

// --- Fase 5: entrada tipo Excel (el campo corrige lo que el usuario quiso escribir) ---
test('normalizarFecha: digitos corridos, mes en letras, punto y año corto', () => {
  assert.equal(normalizarFecha('17072026'), '2026-07-17');
  assert.equal(normalizarFecha('17/JUL/2026'), '2026-07-17');
  assert.equal(normalizarFecha('17.07.2026'), '2026-07-17');
  assert.equal(normalizarFecha('17/07/26'), '2026-07-17');
  assert.equal(normalizarFecha('VIE,17/JUL/2026'), '2026-07-17');
});

test('normalizarMontoTexto: miles, comas decimales, espacios y simbolos', () => {
  assert.equal(normalizarMontoTexto('RD$3,620.00'), 3620);
  assert.equal(normalizarMontoTexto('3, 620.00'), 3620);
  assert.equal(normalizarMontoTexto('3.620,00'), 3620);
  assert.equal(normalizarMontoTexto('45,50'), 45.5);
  assert.equal(normalizarMontoTexto('1234'), 1234);
  assert.equal(normalizarMontoTexto('abc'), null);
  assert.equal(normalizarMontoTexto(''), null);
});

// --- Fase 7: formato dominicano de presentacion (se guarda ISO, se muestra DD-MM-AAAA) ---
test('formatearFechaDO: ISO → DD-MM-AAAA; tolera basura', () => {
  assert.equal(formatearFechaDO('2026-07-17'), '17-07-2026');
  assert.equal(formatearFechaDO('17-07-2026'), '17-07-2026'); // ya formateada, idempotente
  assert.equal(formatearFechaDO(''), '');
  assert.equal(formatearFechaDO(null), '');
  assert.equal(formatearFechaDO('texto raro'), 'texto raro'); // no destruye lo que el usuario escribio
});

test('formatearMonto: miles con coma y 2 decimales', () => {
  assert.equal(formatearMonto(2500), '2,500.00');
  assert.equal(formatearMonto(3620.5), '3,620.50');
  assert.equal(formatearMonto(45), '45.00');
  assert.equal(formatearMonto(1234567.891), '1,234,567.89');
  assert.equal(formatearMonto(null), '');
  assert.equal(formatearMonto('abc'), '');
});

test('ida y vuelta: lo mostrado se vuelve a leer igual', () => {
  assert.equal(normalizarMontoTexto(formatearMonto(2500)), 2500);
  assert.equal(normalizarFecha(formatearFechaDO('2026-07-17')), '2026-07-17');
});

// --- Fase 8: digito verificador de RNC/cedula (sin red, sin IA) ---

test('rncValido: RNC juridicos reales (mod 11)', () => {
  assert.equal(rncValido('101796822'), true);   // Grupo Ramos (voucher Sirena)
  assert.equal(rncValido('1-33-23182-4'), true); // BIMCANA SRL, con guiones
  assert.equal(rncValido('133231824'), true);
});

test('rncValido: un digito cambiado (error tipico de OCR) falla', () => {
  assert.equal(rncValido('101796823'), false);
  assert.equal(rncValido('102796822'), false);
  assert.equal(rncValido('131231824'), false);
});

test('rncValido: largos invalidos, vacio y basura', () => {
  assert.equal(rncValido(''), false);
  assert.equal(rncValido(null), false);
  assert.equal(rncValido('12345'), false);
  assert.equal(rncValido('sin numeros'), false);
});

test('rncValido: cedula de 11 digitos (Luhn)', () => {
  // Cedula sintetica con digito verificador correcto segun la variante Luhn
  const base = '00112345678'.slice(0, 10);
  let suma = 0;
  for (let i = 0; i < 10; i++){
    let p = Number(base[i]) * (i % 2 === 0 ? 1 : 2);
    if (p > 9) p -= 9;
    suma += p;
  }
  const dv = (10 - (suma % 10)) % 10;
  assert.equal(rncValido(base + dv), true);
  assert.equal(rncValido(base + ((dv + 1) % 10)), false);
});

// --- Fase 8: deduccion de montos (total = subtotal + itbis) ---

test('deducirMontos: total desde subtotal + itbis', () => {
  const d = deducirMontos({ subtotal: 2910, itbis: 523.8, total: null });
  assert.equal(d.total, 3433.8);
});

test('deducirMontos: subtotal desde total - itbis', () => {
  const d = deducirMontos({ subtotal: null, itbis: 523.8, total: 3433.8 });
  assert.equal(d.subtotal, 2910);
});

test('deducirMontos: itbis desde total - subtotal', () => {
  const d = deducirMontos({ subtotal: 2910, itbis: null, total: 3433.8 });
  assert.equal(d.itbis, 523.8);
});

test('deducirMontos: no pisa valores ya leidos', () => {
  const d = deducirMontos({ subtotal: 100, itbis: 18, total: 200 });
  assert.equal(d.total, 200); // aunque no cuadre, el valor leido manda (el usuario revisa)
});

test('deducirMontos: resultado negativo se descarta', () => {
  const d = deducirMontos({ subtotal: 500, itbis: null, total: 300 });
  assert.equal(d.itbis, null);
});

test('deducirMontos: con solo un monto no inventa nada', () => {
  const d = deducirMontos({ subtotal: null, itbis: null, total: 300 });
  assert.equal(d.subtotal, null);
  assert.equal(d.itbis, null);
});

// --- Fase 8: post-proceso comun de lectura ---

test('afinarDatosFactura: descarta el RNC propio y deduce el monto faltante', () => {
  const d = afinarDatosFactura(
    { rncEmisor: '133231824', subtotal: 100, itbis: 18, total: null },
    { rncPropio: '1-33-23182-4' });
  assert.equal(d.rncEmisor, null);
  assert.equal(d.total, 118);
});

// --- Fase 14: la propina legal siempre queda numerica (0 si la factura no la trae) ---
test('afinarDatosFactura: propina ausente → 0; propina impresa se respeta', () => {
  assert.equal(afinarDatosFactura({ total: 118 }).propinaLegal, 0);
  assert.equal(afinarDatosFactura({ total: 118, propinaLegal: null }).propinaLegal, 0);
  assert.equal(afinarDatosFactura({ total: 6323.21, propinaLegal: 494 }).propinaLegal, 494);
  assert.equal(afinarDatosFactura({ total: 118, propinaLegal: -5 }).propinaLegal, 0); // negativo no es valido
});

// --- Fase 23: la propina SI entra en la ecuacion del total ------------------
// `total` es el TOTAL A PAGAR impreso, y en un restaurante ya incluye el 10% de ley:
//     total = subtotal + itbis + propina
// Fila real del TXT de la contabilidad (E310000025067): monto facturado 4940.01,
// ITBIS 889.20 (18%), propina 494.00 (10%). El recibo cobra 6323.21.
// Antes se deducia subtotal = total - itbis y la propina se quedaba DENTRO del monto
// facturado, inflando en un 10% la columna que se declara a la DGII.
test('deduccion de montos: el total incluye la propina', () => {
  const d = afinarDatosFactura({ subtotal: 4940.01, itbis: 889.20, total: null, propinaLegal: 494 });
  assert.equal(d.total, 6323.21);
  assert.equal(d.propinaLegal, 494);
});

test('deduccion de montos: el subtotal sale del total SIN la propina', () => {
  // El caso que rompia el 606: restaurante sin subtotal impreso.
  const d = afinarDatosFactura({ subtotal: null, itbis: 889.20, total: 6323.21, propinaLegal: 494 });
  assert.equal(d.subtotal, 4940.01, 'lo que se declara a la DGII, sin propina');
});

test('deduccion de montos: sin propina se comporta como antes', () => {
  const d = afinarDatosFactura({ subtotal: null, itbis: 18, total: 118 });
  assert.equal(d.subtotal, 100);
});

// --- Fase 23: el RNC de MI empresa nunca puede quedar como emisor -----------
test('mismoRnc caza mi propio RNC con un dígito mal leído', () => {
  assert.equal(mismoRnc('133231824', '133231824'), true);
  assert.equal(mismoRnc('133231624', '133231824'), true, '8 leído como 6');
  assert.equal(mismoRnc('133231324', '133231824'), true, '8 leído como 3');
  assert.equal(mismoRnc('1-33-23182-4', '133231824'), true, 'con guiones es el mismo');
  assert.equal(mismoRnc('101796822', '133231824'), false, 'un proveedor de verdad');
  assert.equal(mismoRnc('133231825', '133231824'), false, '4 y 5 no se confunden');
  assert.equal(mismoRnc('13323182', '133231824'), false, 'otro largo: lo caza rncValido');
  assert.equal(mismoRnc('', '133231824'), false);
  assert.equal(mismoRnc(null, null), false);
});

test('afinarDatosFactura descarta mi RNC aunque venga con un dígito mal leído', () => {
  const d = afinarDatosFactura({ rncEmisor: '133231624', total: 500 }, { rncPropio: '133231824' });
  assert.equal(d.rncEmisor, null, 'jamás en un registro fiscal');
  assert.equal(d.rncPropioDescartado, '133231624', 'la UI tiene que poder explicar por qué');
});

// --- Fase 23: coherencia aritmetica de los montos ---------------------------
test('coherenciaMontos avisa cuando la suma no cuadra', () => {
  assert.deepEqual(coherenciaMontos({ subtotal: 4940.01, itbis: 889.20, total: 6323.21, propinaLegal: 494 }), []);
  const av = coherenciaMontos({ subtotal: 4940.01, itbis: 889.20, total: 5323.21, propinaLegal: 494 });
  assert.equal(av.length, 1);
  assert.equal(av[0].campo, 'total');
});

test('coherenciaMontos avisa de un ITBIS que casi es el 18%', () => {
  const av = coherenciaMontos({ subtotal: 1000, itbis: 189, total: 1189 });
  assert.ok(av.some(a => a.campo === 'itbis'), '18.9%: huele a dígito mal leído');
  // Un supermercado con artículos exentos da mucho menos del 18% y ES legítimo.
  const ok = coherenciaMontos({ subtotal: 1000, itbis: 45, total: 1045 });
  assert.ok(!ok.some(a => a.campo === 'itbis'));
});

test('coherenciaMontos con datos incompletos no inventa avisos', () => {
  assert.deepEqual(coherenciaMontos({ total: 500 }), []);
  assert.deepEqual(coherenciaMontos(null), []);
});

// --- Fase 23: doble comprobacion (conciliar dos lecturas) -------------------
test('conciliarLecturas: lo que las dos leen igual queda confirmado', () => {
  const a = { fechaEmision: '2026-06-02', ncf: 'B0100007133', rncEmisor: '101796822', total: 3050 };
  const b = { fechaEmision: '2026-06-02', ncf: 'B01 0000 7133', rncEmisor: '101796822', total: 3050 };
  const r = conciliarLecturas(a, b);
  assert.deepEqual(r.conflictos, []);
  assert.ok(r.confirmados.includes('ncf'), 'el mismo NCF escrito distinto sigue siendo el mismo');
  assert.ok(r.confirmados.includes('total'));
});

test('conciliarLecturas: al discrepar gana el que pasa la validación estructural', () => {
  const a = { ncf: 'B01000071330', rncEmisor: '101796822' };   // NCF con un 0 de más
  const b = { ncf: 'B0100007133',  rncEmisor: '101796822' };
  const r = conciliarLecturas(a, b);
  assert.equal(r.datos.ncf, 'B0100007133');
  assert.equal(r.conflictos.length, 1);
  assert.equal(r.conflictos[0].campo, 'ncf');
  assert.equal(r.conflictos[0].elegido, 'b');
});

test('conciliarLecturas: si ninguno convence manda la primera lectura, pero se avisa', () => {
  const a = { total: 3050 }, b = { total: 3850 };
  const r = conciliarLecturas(a, b);
  assert.equal(r.datos.total, 3050);
  assert.equal(r.conflictos[0].campo, 'total');
  assert.equal(r.conflictos[0].elegido, 'a');
});

test('conciliarLecturas: un campo que solo vio un motor se toma, pero no se confirma', () => {
  const r = conciliarLecturas({ ncf: 'B0100007133', itbis: null }, { ncf: 'B0100007133', itbis: 45.33 });
  assert.equal(r.datos.itbis, 45.33);
  assert.ok(!r.confirmados.includes('itbis'));
  assert.deepEqual(r.conflictos, []);
});

test('conciliarLecturas: sin segunda lectura devuelve la primera intacta', () => {
  const a = { ncf: 'B0100007133', total: 10 };
  assert.deepEqual(conciliarLecturas(a, null).datos, a);
  assert.deepEqual(conciliarLecturas(null, null).datos, null);
});

test('afinarDatosFactura: RNC ajeno se conserva; null pasa de largo', () => {
  const d = afinarDatosFactura({ rncEmisor: '101796822', total: 50 }, { rncPropio: '133231824' });
  assert.equal(d.rncEmisor, '101796822');
  assert.equal(afinarDatosFactura(null), null);
});
