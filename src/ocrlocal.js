import { ncfValido, ncfTipoConocido, corregirNcf, ncfLargoEsperado, mismoRnc,
         normalizarFecha, normalizarMontoTexto } from './validacion.js';

// --- Patrones ---
// Caracteres que pueden formar parte de un NCF tal como lo escupe el OCR: digitos y las
// letras que solo pueden ser digitos mal leidos (corregirNcf las traduce).
const RE_NCF_CUERPO = /^[BE]\d+$/;
const ES_SERIE = c => 'BE83'.includes(c.toUpperCase());
const RE_RNC_CONTEXTO = /rnc/i;
const RE_CLIENTE = /cliente/i;
const RE_EXCLUIR_FECHA = /v[aá]lido|vence|vencimiento|l[ií]mite|limite/i;
const RE_FECHA_CONTEXTO = /fecha|emisi[oó]n/i;
// ISO con guion, punto o barra: «2026-07-11», «2026.07.11» (Punta Cana BM Cargo), «2026/07/11».
const RE_FECHA_ISO = /\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}/;
const RE_FECHA_SLASH = /(?<!\d)\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}(?!\d)/;
const RE_FECHA_ES = /\d{1,2}[\s/\-.]+[a-záéíóú]{3,4}\.?[\s/\-.]+\d{2,4}/i;
const RE_MONTO = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}|\d+/g;

const CAMPOS_VACIOS = () => ({
  fechaEmision: null,
  ncf: null,
  rncEmisor: null,
  nombreComercio: null,
  subtotal: null,
  itbis: null,
  total: null,
  propinaLegal: null
});

function aLineas(texto){
  return texto.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
}

// El OCR parte el NCF de mil formas: «B0100007133», «B01 0000 7133», «e-NCF:E31001169100»,
// y encima confunde letras con digitos (O por 0, l por 1, S por 5). Fase 23: en vez de un
// patron rigido, se recorre por TOKENS y dentro de cada token se prueba a arrancar en cada
// posicion que podria ser la serie; luego se unen los tokens siguientes (si son numericos)
// hasta alcanzar el largo oficial — 11 para la serie B, 13 para la E.
//
// Un candidato solo vale si, ya corregido, es la serie seguida SOLO de digitos: asi
// «ELECTRONICO» (que empieza por E y cuyas letras son todas confundibles) no se cuela.
// Y si el candidato arranca en un digito (un 8 leido como B, un 3 como E) se exige ademas
// que dé el largo exacto: sin eso, cualquier importe que empiece por 3 seria un NCF.
//
// Se prefiere, en este orden: valido con tipo de la DGII conocido, valido a secas, y por
// ultimo el mas largo — que aunque este mal hay que ENSEÑARLO, para que la validacion diga
// que le sobra o le falta un digito. Esconderlo dejaria al usuario sin saber que corregir.
function extraerNcf(texto){
  const tokens = String(texto).split(/[\s|]+/).filter(Boolean)
                              .map(t => t.replace(/[^A-Za-z0-9]/g, ''))
                              .filter(Boolean);
  const candidatos = [];
  const proponer = (bruto, arrancaEnDigito) => {
    const c = corregirNcf(bruto);
    if (!c || c.length < 8 || !RE_NCF_CUERPO.test(c)) return null;
    if (arrancaEnDigito && !ncfValido(c)) return null;
    candidatos.push(c);
    return c;
  };
  for (let i = 0; i < tokens.length; i++){
    const tok = tokens[i];
    for (let p = 0; p < tok.length; p++){
      if (!ES_SERIE(tok[p])) continue;
      const desdeAqui = tok.slice(p);
      const enDigito = /\d/.test(tok[p]);
      proponer(desdeAqui, enDigito);
      // Unir hasta 3 tokens mas, y solo numericos: asi «B01 0000 7133» se rearma pero
      // «B01 CAJA 3» no. Se para al llegar al largo oficial para no tragarse el importe
      // que venga detras.
      const serie = corregirNcf(desdeAqui);
      if (!serie || !/^[BE]/.test(serie)) continue;
      const esperado = ncfLargoEsperado(serie[0]);
      let acumulado = desdeAqui;
      for (let j = i + 1; j < tokens.length && j <= i + 3; j++){
        const bruto = corregirNcf(acumulado) || '';
        if (bruto.length >= esperado) break;
        if (!/^[0-9OQDUILJZSGTYP]+$/i.test(tokens[j])) break;
        acumulado += tokens[j];
        proponer(acumulado, enDigito);
      }
    }
  }
  if (!candidatos.length) return null;
  return candidatos.find(c => ncfValido(c) && ncfTipoConocido(c))
      || candidatos.find(c => ncfValido(c))
      || candidatos.reduce((a, b) => (b.length > a.length ? b : a));
}

function extraerFechaDeLinea(linea){
  const m = linea.match(RE_FECHA_ISO) || linea.match(RE_FECHA_SLASH) || linea.match(RE_FECHA_ES);
  if (!m) return null;
  return normalizarFecha(m[0]);
}

function extraerFechaEmision(lineas){
  const candidatas = lineas.filter(l => !RE_EXCLUIR_FECHA.test(l));
  // Preferir líneas cercanas a "fecha"/"emisión"
  for (const l of candidatas){
    if (RE_FECHA_CONTEXTO.test(l)){
      const f = extraerFechaDeLinea(l);
      if (f) return f;
    }
  }
  // Si no, la primera fecha válida no excluida
  for (const l of candidatas){
    const f = extraerFechaDeLinea(l);
    if (f) return f;
  }
  return null;
}

// El RNC del comercio EMISOR. Trampa real de campo (vouchers Cardnet): el bloque final
// trae el RNC del CLIENTE (la empresa del usuario) — si conocemos ese RNC (perfil de
// Empresa), se excluye. Mejor devolver null que un RNC equivocado en un registro fiscal.
function extraerRncEmisor(lineas, rncPropio){
  for (const l of lineas){
    if (!RE_RNC_CONTEXTO.test(l)) continue;
    if (RE_CLIENTE.test(l)) continue;
    const m = l.match(/\d[\d-]{7,}\d/);
    if (!m) continue;
    const digitos = m[0].replace(/\D/g, '');
    if (digitos.length !== 9 && digitos.length !== 11) continue;
    // Tambien cuando difiere en un solo digito confundible: es mi RNC mal leido.
    if (rncPropio && mismoRnc(digitos, rncPropio)) continue; // es el del cliente, no del emisor
    return digitos;
  }
  return null;
}

// El OCR suele partir los numeros con espacios ("RD$3, 620.00"): se re-unen antes de
// buscar montos, y el parseo final tolera miles/decimales con coma o punto.
function ultimoMonto(linea){
  const unida = linea.replace(/(\d[.,])\s+(?=\d)/g, '$1').replace(/(\d)\s+(?=[.,]\d)/g, '$1');
  const matches = unida.match(RE_MONTO);
  if (!matches || matches.length === 0) return null;
  return normalizarMontoTexto(matches[matches.length - 1]);
}

function extraerMontoPorEtiqueta(lineas, etiquetaRegex, excluirRegex = null){
  for (const l of lineas){
    if (excluirRegex && excluirRegex.test(l)) continue;
    if (etiquetaRegex.test(l)){
      const n = ultimoMonto(l);
      if (n !== null) return n;
    }
  }
  return null;
}

// "TOTAL" aparece en muchas lineas que NO son el total a pagar (sub-total, total de
// descuento, total de articulos, total ITBIS...). Primero se busca la etiqueta fuerte
// ("TOTAL A PAGAR", "GRAN TOTAL"...); si no existe, un "total" pelado excluyendo esas.
const RE_TOTAL_FUERTE = /total\s+a\s+pagar|total\s+general|gran\s+total|monto\s+total|total\s+rd/i;
const RE_TOTAL_NO = /sub\s*-?\s*total|descuento|ahorro|art[ií]culos|items?\b|puntos|balance|itbis|itebis|impuesto|propina|efectivo|cambio|devuelta/i;

// Propina legal del 10% (Ley 16-92) en restaurantes y servicios de comida. Etiquetas
// reales: "Propina Legal", "10% Ley", "% Ley", "Ley 16-92". Va al 606 en la columna Y.
const RE_PROPINA = /propina|ley\s*16\s*-?\s*92|\d{1,2}\s*%\s*ley|%\s*de\s*ley|\bley\b\s*\d{1,2}\s*%/i;
// "Propina NO incluida"/"voluntaria" no es un monto facturado: no debe capturarse.
const RE_PROPINA_NO = /no\s+inclu|voluntari|sin\s+propina|excluye/i;

function extraerTotal(lineas){
  const fuerte = extraerMontoPorEtiqueta(lineas, RE_TOTAL_FUERTE);
  if (fuerte !== null) return fuerte;
  return extraerMontoPorEtiqueta(lineas, /\btotal\b/i, RE_TOTAL_NO);
}

// Lineas que NO son el nombre del comercio: contactos, direcciones, encabezados
// fiscales y texto administrativo tipico de la cabecera de un voucher. Fase 9 (lista
// negra pedida por Ari): CARDNET / VERIFONE / "NOS UNE" / PORTAL son la marca y el
// eslogan del verifon (procesador de tarjetas) impresos arriba del voucher — jamas
// son el comercio.
const RE_NO_COMERCIO = /rnc|tel[ef.:\s]|tel$|fax|www\.|\.com|\.do\b|@|factura|cr[eé]dito|consumidor|fiscal|ncf|fecha|caja|cajero|calle|\bav\b|avenida|aut\.|autopista|carretera|\bkm\b|esq(uina|\.)|plaza|centro comercial|local\b|sucursal|cliente|orden|mesa\b|cardnet|verifone|nos\s+une|\bportal\b|visanet/i;
const RE_SUFIJO_EMPRESA = /\b(srl|s\.?\s?r\.?\s?l|s\.?\s?a\.?\s?s?|eirl|e\.?\s?i\.?\s?r\.?\s?l)\b\.?/i;

// El nombre del comercio suele ser de las PRIMERAS lineas (logo/encabezado). Se
// prefiere una linea con sufijo societario (SRL, SA, EIRL); si no hay, la primera
// linea "con cara de nombre": letras dominantes, sin patrones de contacto/direccion,
// sin fechas ni cifras largas. Descarte pedido por Ari: direccion o texto sin sentido.
function extraerNombreComercio(lineas){
  const cabecera = lineas.slice(0, 8);
  const candidata = l => {
    if (!/[a-záéíóúñ]/i.test(l)) return false;
    if (RE_NO_COMERCIO.test(l)) return false;
    if (RE_FECHA_ISO.test(l) || RE_FECHA_SLASH.test(l)) return false;
    const letras = (l.match(/[a-záéíóúñ]/gi) || []).length;
    const digitos = (l.match(/\d/g) || []).length;
    if (digitos >= letras) return false;    // mas numeros que letras: no es un nombre
    if (letras < 3) return false;           // restos de OCR sin sentido
    return true;
  };
  const conSufijo = cabecera.find(l => candidata(l) && RE_SUFIJO_EMPRESA.test(l));
  if (conSufijo) return conSufijo;
  const primera = cabecera.find(candidata);
  if (primera) return primera;
  // Respaldo historico: primera linea con letras, aunque no pase los filtros.
  for (const l of lineas){
    if (/[a-záéíóúñ]/i.test(l)) return l;
  }
  return null;
}

/**
 * Parser puro: extrae los campos de una factura a partir del texto crudo del OCR.
 * No accede a DOM ni a Tesseract. No inventa datos: campo no hallado → null.
 */
export function parsearTextoFactura(texto, opciones = {}){
  if (typeof texto !== 'string' || !texto.trim()) return CAMPOS_VACIOS();

  const lineas = aLineas(texto);
  const rncPropio = String(opciones.rncPropio || '').replace(/\D/g, '') || null;

  return {
    fechaEmision: extraerFechaEmision(lineas),
    ncf: extraerNcf(texto),
    rncEmisor: extraerRncEmisor(lineas, rncPropio),
    nombreComercio: extraerNombreComercio(lineas),
    subtotal: extraerMontoPorEtiqueta(lineas, /\bsub\s*-?\s*total\b/i),
    itbis: extraerMontoPorEtiqueta(lineas, /i\.?\s?t\.?\s?e?\.?\s?b\.?\s?i\.?\s?s|itebis|impuesto/i, /exento|exenta/i),
    total: extraerTotal(lineas),
    propinaLegal: extraerMontoPorEtiqueta(lineas, RE_PROPINA, RE_PROPINA_NO)
  };
}

// --- Integración con Tesseract.js (carga perezosa, solo en navegador) ---

let _tessListo = null;
let _tessWorkerPromesa = null;

function cargarScriptTesseract(){
  if (_tessListo) return _tessListo;
  _tessListo = new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.Tesseract){ resolve(); return; }
    const s = document.createElement('script');
    s.src = 'vendor/tesseract/tesseract.min.js';
    s.onload = () => resolve();
    // No cachear un fallo (p. ej. primer uso offline antes de cachear el script):
    // resetear para que un reintento posterior pueda volver a cargarlo.
    s.onerror = () => { _tessListo = null; reject(new Error('No se pudo cargar el OCR local')); };
    document.head.appendChild(s);
  });
  return _tessListo;
}

// Se cachea la PROMESA (no solo el worker resuelto): llamadas concurrentes comparten un
// único worker en vez de crear dos (~9 MB c/u). Si falla, se resetea para poder reintentar.
function obtenerWorker(){
  if (_tessWorkerPromesa) return _tessWorkerPromesa;
  _tessWorkerPromesa = (async () => {
    await cargarScriptTesseract();
    return Tesseract.createWorker('spa', 1, {
      workerPath: 'vendor/tesseract/worker.min.js',
      corePath: 'vendor/tesseract/tesseract-core.wasm.js', // archivo explícito (no-SIMD, universal) — NO usar el directorio
      langPath: 'vendor/tesseract/'
    });
  })().catch(e => { _tessWorkerPromesa = null; throw e; });
  return _tessWorkerPromesa;
}

/**
 * Corre el OCR local (Tesseract, español) sobre un canvas y devuelve los campos parseados.
 */
export async function extraerDatosLocal(canvas, rncPropio = null){
  const worker = await obtenerWorker();
  const { data } = await worker.recognize(canvas);
  return parsearTextoFactura(data.text, { rncPropio });
}
