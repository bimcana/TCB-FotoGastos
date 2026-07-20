import { ncfValido, normalizarFecha, normalizarMontoTexto } from './validacion.js';

// --- Patrones ---
const RE_NCF_GLOBAL = /[BE]\d{2}\d{8,10}/gi;
const RE_RNC_CONTEXTO = /rnc/i;
const RE_CLIENTE = /cliente/i;
const RE_EXCLUIR_FECHA = /v[aá]lido|vence|vencimiento|l[ií]mite|limite/i;
const RE_FECHA_CONTEXTO = /fecha|emisi[oó]n/i;
const RE_FECHA_ISO = /\d{4}-\d{2}-\d{2}/;
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
  total: null
});

function aLineas(texto){
  return texto.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
}

function extraerNcf(texto){
  const candidatos = texto.match(RE_NCF_GLOBAL) || [];
  if (candidatos.length === 0) return null;
  const valido = candidatos.find(c => ncfValido(c));
  return (valido || candidatos[0]).toUpperCase();
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
    if (rncPropio && digitos === rncPropio) continue; // es el RNC del cliente, no del emisor
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

function extraerMontoPorEtiqueta(lineas, etiquetaRegex){
  for (const l of lineas){
    if (etiquetaRegex.test(l)){
      const n = ultimoMonto(l);
      if (n !== null) return n;
    }
  }
  return null;
}

function extraerNombreComercio(lineas){
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
    subtotal: extraerMontoPorEtiqueta(lineas, /\bsub\s?total\b/i),
    itbis: extraerMontoPorEtiqueta(lineas, /i\.?\s?t\.?\s?e?\.?\s?b\.?\s?i\.?\s?s|itebis|impuesto/i),
    total: extraerMontoPorEtiqueta(lineas, /\btotal\b/i)
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
