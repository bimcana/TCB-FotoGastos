const MESES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, oct:10, nov:11, dic:12 };

// --- NCF / e-NCF (Fase 23) -------------------------------------------------
// LA LONGITUD ES FIJA Y NO SE NEGOCIA. Verificado contra el TXT real de la
// contabilidad (DGII_F_606_133231824_202606.txt):
//   NCF   serie B: B + 2 digitos de tipo + 8 de secuencia = 11  ->  B0100007133
//   e-NCF serie E: E + 2 digitos de tipo + 10 de secuencia = 13  ->  E310000025067
// Antes se aceptaba /^[BE]\d{2}\d{8,10}$/, que daba «NCF valido» a un B con 10
// digitos o a un E con 8: justo el error de ceros de mas o de menos que la IA y el
// OCR cometen leyendo rollos termicos. Con la longitud exacta, ese error se ve.
const RE_NCF_B = /^B\d{10}$/;   // B + 10 digitos = 11 caracteres
const RE_NCF_E = /^E\d{12}$/;   // E + 12 digitos = 13 caracteres

export function ncfValido(ncf){
  const c = ncfCanonico(ncf);
  return RE_NCF_B.test(c) || RE_NCF_E.test(c);
}

export function ncfLargoEsperado(serie){
  return String(serie || '').toUpperCase() === 'E' ? 13 : 11;
}

// Tipos vigentes de la DGII. Se usa como AVISO, no como rechazo: si la DGII habilita
// un tipo nuevo, la factura no debe bloquearse — solo pedir una mirada.
const TIPOS_B = new Set(['01','02','03','04','11','12','13','14','15','16','17']);
const TIPOS_E = new Set(['31','32','33','34','41','43','44','45','46','47']);

export function ncfTipoConocido(ncf){
  const c = ncfCanonico(ncf);
  if (!ncfValido(c)) return false;
  return (c[0] === 'B' ? TIPOS_B : TIPOS_E).has(c.slice(1, 3));
}

// Confusiones de OCR que SI se pueden arreglar sin adivinar: en un NCF sabemos que la
// posicion 0 es una letra (B o E) y TODAS las demas son digitos. Una letra donde debe
// ir un digito solo puede ser un error de lectura, y su digito es unico.
const LETRA_A_DIGITO = { O:'0', Q:'0', D:'0', U:'0', I:'1', L:'1', J:'1', Z:'2', E:'3', A:'4', S:'5', G:'6', T:'7', Y:'7', B:'8', P:'9', C:'0' };
const DIGITO_A_SERIE = { '8':'B', '6':'B', '3':'E', '13':'B' };

/**
 * Repara SOLO lo que es deducible con certeza por la forma del NCF: separadores,
 * mayusculas, letras en posiciones que obligatoriamente son numericas y un digito en
 * la posicion de la serie. NUNCA agrega ni quita digitos: si la longitud esta mal, se
 * devuelve tal cual para que la validacion lo marque y lo vea un humano.
 */
export function corregirNcf(ncf){
  let c = ncfCanonico(ncf);
  if (!c) return null;
  // Posicion de la serie: un 8 leido donde iba una B, un 3 donde iba una E.
  if (/^[0-9]/.test(c) && DIGITO_A_SERIE[c[0]]) c = DIGITO_A_SERIE[c[0]] + c.slice(1);
  if (!/^[BE]/.test(c)) return c;             // serie irreconocible: no inventarla
  const resto = c.slice(1).replace(/[A-Z]/g, ch => LETRA_A_DIGITO[ch] ?? ch);
  return c[0] + resto;
}

/**
 * Diagnostico legible del NCF, para decirle al usuario QUE esta mal en vez de un
 * «a revisar» mudo. Devuelve { ok, ncf, motivo }.
 */
export function ncfDiagnostico(ncf){
  const c = corregirNcf(ncf);
  if (!c) return { ok: false, ncf: null, motivo: 'Sin NCF' };
  if (!/^[BE]/.test(c)) return { ok: false, ncf: c, motivo: 'El NCF debe empezar por B o E' };
  const esperado = ncfLargoEsperado(c[0]);
  if (c.length !== esperado){
    const sobran = c.length - esperado;
    return { ok: false, ncf: c,
      motivo: sobran > 0 ? `Sobra${sobran > 1 ? 'n' : ''} ${sobran} digito${sobran > 1 ? 's' : ''} (${c[0]} lleva ${esperado})`
                         : `Falta${sobran < -1 ? 'n' : ''} ${-sobran} digito${sobran < -1 ? 's' : ''} (${c[0]} lleva ${esperado})` };
  }
  if (!/^[BE]\d+$/.test(c)) return { ok: false, ncf: c, motivo: 'Tiene caracteres que no son digitos' };
  if (!ncfTipoConocido(c)) return { ok: false, ncf: c, motivo: `Tipo «${c.slice(1,3)}» no esta en la lista de la DGII` };
  return { ok: true, ncf: c, motivo: '' };
}

// Acepta lo que la gente (y el OCR) escribe de verdad y lo lleva a AAAA-MM-DD:
// ISO, DD/MM/AAAA (con /, -, .), año corto (26→2026), dígitos corridos (17072026),
// mes en letras con espacios o separadores (09 jul. 2026, 17/JUL/2026) y prefijos de
// día de semana (VIE,17/JUL/2026). Lo no reconocible devuelve null (nunca inventa).
export function normalizarFecha(str){
  if (typeof str !== 'string') return null;
  let s = str.trim().toLowerCase();
  s = s.replace(/^[a-záéíóú]{3,4}[.,]\s*/i, ''); // "vie," / "lun." delante de la fecha
  let m;
  // AAAA-MM-DD y tambien AAAA.MM.DD / AAAA/MM/DD (Fase 10: la factura de Punta Cana BM
  // Cargo imprime «FECHA 2026.07.11» y la fecha se perdia por no aceptar el punto).
  if ((m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/)))
    return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)))
    return `${anio4(m[3])}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  if ((m = s.match(/^(\d{1,2})[\s\/\-.]+([a-záéíóú]{3,4})\.?[\s\/\-.]+(\d{2,4})$/))){
    const mes = MESES[m[2].slice(0,3)];
    if (mes) return `${anio4(m[3])}-${String(mes).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  }
  if ((m = s.match(/^(\d{2})(\d{2})(\d{4})$/))) // 17072026 (teclado numérico sin separadores)
    return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function anio4(a){ return a.length === 2 ? '20' + a : a; }

// Monto escrito por humanos u OCR → número: tolera RD$, espacios (incluso dentro del
// número, típico del OCR), miles con coma o punto, y decimal con coma o punto.
export function normalizarMontoTexto(v){
  if (v == null) return null;
  let s = String(v).replace(/[^\d.,-]/g, ''); // fuera moneda, letras y espacios
  if (!/\d/.test(s)) return null;
  const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.');
  if (coma >= 0 && punto >= 0){
    // ambos presentes: el ÚLTIMO es el decimal, el otro es separador de miles
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (coma >= 0){
    // solo comas: decimal si el último grupo no parece millar (≠3 dígitos)
    const grupos = s.split(',');
    s = grupos[grupos.length - 1].length === 3 && grupos.length > 1 && grupos[0].length <= 3
      ? s.replace(/,/g, '')
      : s.replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function montoValido(n){ return typeof n === 'number' && Number.isFinite(n) && n >= 0; }

// --- RNC (Fase 8) ----------------------------------------------------------
// La consulta en linea a DGII no es viable desde una PWA estatica (la pagina de
// consultas es WebForms con postback y sin CORS; el web service movil fue retirado).
// En su lugar se valida el DIGITO VERIFICADOR oficial: detecta RNC mal leidos por el
// OCR sin gastar red ni cuota de IA. Verificado con RNC reales (101796822, 133231824).
export function rncValido(rnc){
  const d = String(rnc == null ? '' : rnc).replace(/\D/g, '');
  if (d.length === 9){ // RNC juridico: modulo 11 con pesos fijos
    const pesos = [7, 9, 8, 6, 5, 4, 3, 2];
    let suma = 0;
    for (let i = 0; i < 8; i++) suma += Number(d[i]) * pesos[i];
    const r = suma % 11;
    const dv = r === 0 ? 2 : r === 1 ? 1 : 11 - r;
    return dv === Number(d[8]);
  }
  if (d.length === 11){ // cedula: variante Luhn sobre los primeros 10 digitos
    let suma = 0;
    for (let i = 0; i < 10; i++){
      let p = Number(d[i]) * (i % 2 === 0 ? 1 : 2);
      if (p > 9) p -= 9;
      suma += p;
    }
    return (10 - (suma % 10)) % 10 === Number(d[10]);
  }
  return false;
}

// --- Deduccion de montos (Fase 8) ------------------------------------------
// Patron contable: total = subtotal + itbis. Si el motor de lectura trae DOS de los
// tres, el tercero se deduce por suma/resta (nunca se pisa un valor ya leido, y un
// resultado negativo se descarta: mejor null que un monto imposible).
// Fase 23: la PROPINA entra en la ecuacion. `total` es el TOTAL A PAGAR impreso en la
// factura, y en un restaurante ese total ya incluye el 10% de ley:
//     total = subtotal + itbis + propina
// Verificado contra el TXT real de la contabilidad — E310000025067: monto facturado
// 4940.01, ITBIS 889.20 (18% del subtotal), propina 494.00 (10% del subtotal); el
// recibo cobra 6323.21. Antes se deducia subtotal = total - itbis y la propina se
// quedaba dentro del monto facturado, inflando la columna del 606 en un 10%.
export function deducirMontos(datos){
  const d = { ...datos };
  const v = x => montoValido(x) ? x : null;
  const sub = v(d.subtotal), itb = v(d.itbis), tot = v(d.total);
  const pro = v(d.propinaLegal) || 0;
  const r2 = x => Math.round(x * 100) / 100;
  if (tot == null && sub != null && itb != null) d.total = r2(sub + itb + pro);
  else if (sub == null && tot != null && itb != null && tot - itb - pro >= 0) d.subtotal = r2(tot - itb - pro);
  else if (itb == null && tot != null && sub != null && tot - sub - pro >= 0) d.itbis = r2(tot - sub - pro);
  return d;
}

// --- El RNC de MI empresa jamas puede ser el del emisor (Fase 23) -----------
// Regla de Ari, literal: «el RNC de la empresa registrada en Ajustes NUNCA estara como
// RNC de datos recabados». Antes solo se descartaba con coincidencia EXACTA, asi que un
// solo digito mal leido lo colaba en un registro fiscal.
//
// Pares que el OCR y la IA confunden de verdad en papel termico (los que reporta Ari).
// Se comparan SOLO RNC del mismo largo y con UNA sola posicion distinta: si ademas esa
// diferencia es una confusion tipica, es mi propio RNC mal leido, no el de un proveedor.
const CONFUSIONES = [
  ['0','6'], ['0','8'], ['0','5'], ['0','9'], ['0','3'], ['0','D'], ['0','O'],
  ['3','8'], ['5','6'], ['5','8'], ['5','9'], ['6','8'], ['3','9'], ['9','8'],
  ['1','7'], ['2','7'], ['4','9'], ['1','4']
];
const PAR_CONFUNDIBLE = new Set(CONFUSIONES.flatMap(([a, b]) => [a + b, b + a]));

export function mismoRnc(a, b){
  const x = String(a == null ? '' : a).replace(/\D/g, '');
  const y = String(b == null ? '' : b).replace(/\D/g, '');
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length !== y.length) return false;   // un largo distinto ya lo caza rncValido
  let distintas = -1;
  for (let i = 0; i < x.length; i++){
    if (x[i] === y[i]) continue;
    if (distintas >= 0) return false;        // dos diferencias: son RNC distintos
    distintas = i;
  }
  if (distintas < 0) return true;
  return PAR_CONFUNDIBLE.has(x[distintas] + y[distintas]);
}

// --- Coherencia aritmetica de los montos (Fase 23) --------------------------
// Un digito mal leido en un monto casi siempre rompe la suma. Estas comprobaciones no
// bloquean nada (hay facturas con articulos exentos y el ITBIS no da el 18% redondo):
// devuelven AVISOS para que el humano mire justo el campo sospechoso.
export function coherenciaMontos(d){
  const avisos = [];
  if (!d) return avisos;
  const v = x => montoValido(x) ? x : null;
  const sub = v(d.subtotal), itb = v(d.itbis), tot = v(d.total);
  const pro = v(d.propinaLegal) || 0;
  if (sub != null && itb != null && tot != null){
    const suma = sub + itb + pro;
    if (Math.abs(suma - tot) > 0.02){
      avisos.push({ campo: 'total', texto: `Los montos no cuadran: ${formatearMonto(sub)} + ${formatearMonto(itb)}${pro ? ' + ' + formatearMonto(pro) : ''} = ${formatearMonto(suma)}, no ${formatearMonto(tot)}` });
    }
  }
  // El ITBIS es el 18% del subtotal. Solo se avisa cuando anda CERCA del 18% sin serlo:
  // eso huele a digito mal leido. Un ITBIS muy por debajo suele ser una factura con
  // articulos exentos (supermercado) y es legitimo — ahi no se molesta al usuario.
  if (sub != null && itb != null && sub > 0 && itb > 0){
    const r = itb / sub;
    if (r > 0.16 && r < 0.20 && Math.abs(r - 0.18) > 0.002){
      avisos.push({ campo: 'itbis', texto: `El ITBIS es el ${(r * 100).toFixed(1)}% del subtotal; deberia ser 18% (${formatearMonto(Math.round(sub * 18) / 100)})` });
    }
  }
  // La propina legal es el 10% del subtotal (Ley 16-92).
  if (sub != null && pro > 0 && sub > 0){
    const r = pro / sub;
    if (r > 0.08 && r < 0.12 && Math.abs(r - 0.10) > 0.002){
      avisos.push({ campo: 'propinaLegal', texto: `La propina es el ${(r * 100).toFixed(1)}% del subtotal; la de ley es 10% (${formatearMonto(Math.round(sub * 10) / 100)})` });
    }
  }
  return avisos;
}

// Post-proceso comun a TODOS los motores de lectura (Gemini, OCR local): descarta el
// RNC del comprador (perfil Empresa) que los vouchers traen como si fuera el emisor,
// y deduce el monto faltante. Un solo lugar: capture, importacion y "Leer con IA".
export function afinarDatosFactura(datos, opciones = {}){
  if (!datos) return datos;
  const d = { ...datos };
  const propio = String(opciones.rncPropio || '').replace(/\D/g, '');
  const rnc = String(d.rncEmisor || '').replace(/\D/g, '');
  // El RNC del comprador NUNCA es el del emisor. Se descarta tambien cuando difiere en
  // un solo digito confundible: es mi propio RNC mal leido (ver mismoRnc).
  if (propio && rnc && mismoRnc(rnc, propio)){
    d.rncEmisor = null;
    d.rncPropioDescartado = rnc;   // para que la UI explique POR QUE quedo vacio
  }
  // El NCF se guarda SIEMPRE en su forma oficial (sin espacios ni separadores) y con las
  // letras que solo pueden ser digitos ya corregidas: asi el control de duplicados compara
  // peras con peras y el TXT del 606 sale correcto.
  if (d.ncf) d.ncf = corregirNcf(d.ncf) || null;
  // Propina legal (Ley 16-92): solo la traen restaurantes y servicios de comida. Si no
  // viene impresa, es 0 — no "desconocida" (decision de Ari): el 606 la necesita numerica.
  d.propinaLegal = montoValido(d.propinaLegal) ? d.propinaLegal : 0;
  return deducirMontos(d);
}

// --- Presentacion (Fase 7) -------------------------------------------------
// REGLA: internamente TODO se guarda en ISO (AAAA-MM-DD) porque de ahi salen los nombres
// de carpeta, el orden y el Formato 606. Estas dos funciones son SOLO para mostrar y
// escribir en pantalla, al estilo dominicano: fechas DD-MM-AAAA y montos 2,500.00.

export function formatearFechaDO(valor){
  if (valor == null) return '';
  const s = String(valor).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); // ya esta en formato dominicano
  if (dmy) return `${String(dmy[1]).padStart(2,'0')}-${String(dmy[2]).padStart(2,'0')}-${dmy[3]}`;
  return s; // no reconocida: se respeta lo que haya (no destruir lo que el usuario escribio)
}

export function formatearMonto(n){
  const v = typeof n === 'number' ? n : parseFloat(n);
  if (!Number.isFinite(v)) return '';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function facturaCompleta(datos){
  return !!(normalizarFecha(datos.fechaEmision) && datos.ncf && datos.rncEmisor && montoValido(datos.total));
}

// Fase 10 (pedido de Ari): si el usuario pulsó «Confirmar y subir» con la tarjeta a la
// vista y no falta ningún dato esencial, la factura queda VALIDADA — sin advertencias.
// El estado 'pendiente' existía porque el OCR local era el respaldo de la IA; desde
// que el OCR es el motor por defecto (Fase 9), marcar como pendiente TODO lo capturado
// llenaba Gastos de avisos aunque el humano ya hubiera revisado los campos.
// `pendiente` queda solo para lo que NADIE ha validado: provisionales y lo que rellena
// «Leer con IA» a la espera de confirmación.
export function estadoFactura(datos, origen, opciones = {}){
  if (!facturaCompleta(datos)) return 'incompleta';
  if (opciones.validadaPorUsuario) return 'completa'; // el humano la vio y la confirmó
  if (origen === 'local') return 'pendiente'; // OCR local sin revisar: a verificar
  return 'completa'; // gemini o manual con esenciales
}

// NCF en forma canonica para comparar: sin espacios, guiones, puntos ni ningun otro
// separador, y en mayusculas. Fase 22 — el OCR y la IA devuelven el mismo comprobante de
// formas distintas ("B01 0000 7133", "b0100007133", "NCF: B0100007133", "e310000025067"),
// y comparandolos crudos la MISMA factura no se detectaba como duplicada.
export function ncfCanonico(ncf){
  return String(ncf == null ? '' : ncf).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function buscarDuplicado(indice, ncf){
  if (!indice || !Array.isArray(indice.facturas)) return null;
  const objetivo = ncfCanonico(ncf);
  if (!objetivo) return null;
  return indice.facturas.find(f => ncfCanonico(f.ncf) === objetivo) || null;
}

// --- Doble comprobacion: conciliar dos lecturas (Fase 23) ------------------
// Pedido de Ari: que la herramienta sea critica y precisa. Una sola lectura no tiene con
// que contrastarse — si la IA lee un 8 donde hay un 3, nadie se entera. Con DOS lecturas
// independientes (imagenes renderizadas distinto y prompts distintos) el desacuerdo se
// vuelve visible, que es justo lo que hay que enseñarle al humano.
//
// La regla al desempatar es conservadora y siempre la misma: gana el valor que pasa la
// validacion estructural (NCF con su largo exacto, RNC con digito verificador correcto).
// Si las dos pasan o ninguna pasa, MANDA LA PRIMERA lectura y el campo queda en conflicto
// — no se elige a la suerte, se avisa.
const CAMPOS_CONCILIAR = ['fechaEmision', 'ncf', 'rncEmisor', 'nombreComercio', 'subtotal', 'itbis', 'total', 'propinaLegal'];

function claveComparacion(campo, valor){
  if (valor == null || valor === '') return null;
  if (campo === 'ncf') return ncfCanonico(valor);
  if (campo === 'rncEmisor') return String(valor).replace(/\D/g, '');
  if (campo === 'fechaEmision') return normalizarFecha(valor) || String(valor).trim();
  if (campo === 'nombreComercio') return String(valor).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const n = typeof valor === 'number' ? valor : normalizarMontoTexto(valor);
  return montoValido(n) ? String(Math.round(n * 100)) : null;
}

// ¿Este valor supera la comprobacion estructural del campo? null = el campo no tiene una.
function apruebaEstructura(campo, valor){
  if (valor == null || valor === '') return false;
  if (campo === 'ncf') return ncfValido(valor) && ncfTipoConocido(valor);
  if (campo === 'rncEmisor') return rncValido(valor);
  if (campo === 'fechaEmision') return !!normalizarFecha(valor);
  return null;
}

/**
 * Concilia la lectura principal `a` con la de verificacion `b`.
 * Devuelve { datos, conflictos, confirmados }:
 *   - `conflictos`: [{ campo, a, b, elegido }] — los que NO coinciden (revision humana).
 *   - `confirmados`: nombres de los campos que las dos lecturas leyeron igual.
 * Puro: ni DOM ni red. `b` nulo (la verificacion fallo) devuelve `a` intacta.
 */
export function conciliarLecturas(a, b){
  if (!a) return { datos: b || null, conflictos: [], confirmados: [] };
  if (!b) return { datos: { ...a }, conflictos: [], confirmados: [] };
  const datos = { ...a };
  const conflictos = [], confirmados = [];
  for (const campo of CAMPOS_CONCILIAR){
    const va = a[campo], vb = b[campo];
    const ka = claveComparacion(campo, va), kb = claveComparacion(campo, vb);
    if (ka == null && kb == null) continue;
    if (ka != null && ka === kb){ confirmados.push(campo); continue; }
    // Un solo motor vio el dato: se toma, pero NO cuenta como confirmado.
    if (ka == null){ datos[campo] = vb; continue; }
    if (kb == null) continue;
    const okA = apruebaEstructura(campo, va), okB = apruebaEstructura(campo, vb);
    const elegido = (okB === true && okA === false) ? 'b' : 'a';
    if (elegido === 'b') datos[campo] = vb;
    conflictos.push({ campo, a: va, b: vb, elegido });
  }
  return { datos, conflictos, confirmados };
}
