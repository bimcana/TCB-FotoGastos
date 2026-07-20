// Navegación, tema y utilidades de UI. Los módulos de cámara/drive se conectan aquí en tareas siguientes.
const tabs = ['camara', 'gastos', 'ajustes'];

export function show(nombre){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('scr-' + nombre).classList.add('active');
  tabs.forEach(t => document.getElementById('tab-' + t)?.classList.toggle('on',
    t === nombre || (nombre === 'revision' && t === 'camara')));
}

let toastTimer;
export function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

export function setTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('tcb-theme', t); } catch(e){}
  document.getElementById('theme-dark').classList.toggle('on', t === 'dark');
  document.getElementById('theme-light').classList.toggle('on', t === 'light');
}

document.getElementById('theme-dark').addEventListener('click', () => setTheme('dark'));
document.getElementById('theme-light').addEventListener('click', () => setTheme('light'));
setTheme((() => { try { return localStorage.getItem('tcb-theme') || 'dark'; } catch(e){ return 'dark'; } })());

// Globales para los onclick del HTML
window.show = show;
window.toast = toast;

import { iniciarCamara, capturarFrame } from './camera.js';
import { procesar, aplicarRealce, canvasAJpeg } from './process.js';
import { get, set } from './settings.js';
import { extraerDatos, diagnosticoGemini, probarApiKey } from './gemini.js';
import { extraerDatosLocal } from './ocrlocal.js';
import { ncfValido, normalizarFecha, buscarDuplicado, montoValido, facturaCompleta, normalizarMontoTexto } from './validacion.js';
import { encolarRevision, pendientesRevision, eliminarRevision, cuentaRevision } from './revision.js';

// Muestra el overlay "Procesando…" antes de ejecutar trabajo síncrono pesado (OpenCV.js
// es síncrono, no hay await que ceda el hilo). Con doble rAF nos aseguramos de que el
// navegador pinte el overlay antes de bloquear el hilo con fn().
function conOverlay(fn){
  const ov = document.getElementById('overlay-proc');
  ov.hidden = false;
  return new Promise(res => {
    requestAnimationFrame(() => requestAnimationFrame(() => { // 2 rAF: asegura el paint del overlay
      let r; try { r = fn(); } finally { ov.hidden = true; res(r); }
    }));
  });
}

// Modo de realce — persiste en Ajustes y se re-aplica sin re-warpar. La intensidad
// del realce es fija (el contraste "fuerte" que se validó en campo).
let modo = get('modoImagen', 'color');
const intensidad = 65;

// Modelo de Gemini elegido en Ajustes (por defecto 3.5 Flash).
let geminiModelo = get('geminiModelo', 'gemini-3.5-flash');
const ETIQUETA_MODELO = {
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'gemini-3-flash': 'Gemini 3 Flash',
  'gemini-2.5-flash': 'Gemini 2.5 Flash'
};

const video = document.getElementById('cam-video');
const statusTxt = document.getElementById('cam-status-txt');

// Ajuste "Cámara": con camaraAuto=false la cámara NO se enciende (ni dispara el aviso
// de permiso de iOS) hasta que el usuario la pida tocando el estado en pantalla.
// El aviso en sí es del sistema: la web no puede suprimirlo, solo pedir menos veces.
function arrancarCamara(){
  statusTxt.textContent = 'Iniciando cámara…';
  iniciarCamara(video)
    .then(() => { statusTxt.textContent = 'Buscando documento…'; })
    .catch(err => {
      statusTxt.textContent = 'Sin acceso a la cámara';
      toast('Permite el acceso a la cámara para capturar facturas');
      console.error(err);
    });
}
if (get('camaraAuto', true)){
  arrancarCamara();
} else {
  statusTxt.textContent = 'Toca aquí para activar la cámara';
}
document.getElementById('cam-status').addEventListener('click', () => {
  const track = video.srcObject && video.srcObject.getVideoTracks()[0];
  if (!track || track.readyState === 'ended') arrancarCamara();
});

// Recuperar cámara al volver de background (iOS suele terminar el track).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const track = video.srcObject && video.srcObject.getVideoTracks()[0];
  if ((!track || track.readyState === 'ended') && get('camaraAuto', true)){
    iniciarCamara(video).catch(err => {
      statusTxt.textContent = 'Sin acceso a la cámara';
      console.error(err);
    });
  }
  // iOS reanuda la PWA sin recargar: si el token caduco en background, renovarlo aqui.
  if (!conectado()) reconectarSilencioso();
});

document.getElementById('shutter').addEventListener('click', async () => {
  if (disparando) return;
  if (!video.videoWidth) return toast('La cámara no está lista');
  const canvas = capturarFrame(video);
  window.__origenAjeno = null; // una captura nueva jamas hereda el original de una ajena abandonada
  const fx = document.getElementById('flashfx');
  fx.classList.remove('go'); void fx.offsetWidth; fx.classList.add('go');
  // Sin deteccion en vivo: reintenta sobre el still (con rescate) y luego con la IA local.
  let esquinas = ultimasEsquinas || detectarDocumento(canvas, 1200) || await detectarConIAConOverlay(canvas);
  window.__captura = { canvas, esquinas };
  procesarYRevisar();
});

function pintarEnRevision(canvas){
  const rev = document.getElementById('rev-canvas');
  rev.width = canvas.width; rev.height = canvas.height;
  rev.getContext('2d').drawImage(canvas, 0, 0);
}

const ETIQUETA_MODO = { color: 'auto-color', byn: 'blanco y negro', grises: 'grises', original: 'original' };

async function procesarYRevisar(){
  const { canvas, esquinas } = window.__captura;
  show('revision');
  let r = null;
  if (esquinas){
    r = await conOverlay(() => {
      try { return procesar(canvas, esquinas, { modo, intensidad }); }
      catch(e){ console.error(e); toast('No se pudo procesar; ajusta las esquinas'); return null; }
    });
  }
  window.__resultado = {
    canvasPlano: r ? r.plano : null,
    canvasFinal: r ? r.final : null,
    canvasOriginal: canvas,
    esquinas,
    modo,
    intensidad
  };
  pintarEnRevision((r && r.final) || canvas);
  document.getElementById('rev-file').textContent = r ? `Ortofoto · ${ETIQUETA_MODO[modo] || modo}` : 'Sin detección — ajusta las esquinas';
  document.getElementById('seg-proc').classList.toggle('on', !!r);
  document.getElementById('seg-orig').classList.toggle('on', !r);
  actualizarUIFiltros();
  motorPreferido = 'ia'; // cada factura nueva vuelve al motor por defecto
  leerDatosDeFactura(); // los datos no dependen del color; no se repite al cambiar de filtro
}
window.procesarYRevisar = procesarYRevisar;

// Tarjeta de datos de la factura: OCR con Gemini + campos editables + validación + duplicado (Task 4)
const CAMPOS_IDS = ['c-fecha', 'c-ncf', 'c-rnc', 'c-comercio', 'c-subtotal', 'c-itbis', 'c-total'];

// Token de generación: descarta lecturas de Gemini obsoletas si el usuario re-procesa
// (p. ej. ajusta esquinas) mientras una lectura previa sigue en vuelo.
let genOCR = 0;

function vaciarCampos(){
  CAMPOS_IDS.forEach(id => { document.getElementById(id).value = ''; });
  const banner = document.getElementById('dup-banner');
  banner.hidden = true; banner.textContent = '';
  document.getElementById('valid-row').innerHTML = '';
}

function normalizarEnCampos(datos){
  document.getElementById('c-fecha').value = normalizarFecha(datos.fechaEmision) || datos.fechaEmision || '';
  document.getElementById('c-ncf').value = datos.ncf || '';
  document.getElementById('c-rnc').value = datos.rncEmisor || '';
  document.getElementById('c-comercio').value = datos.nombreComercio || '';
  document.getElementById('c-subtotal').value = montoValido(datos.subtotal) ? datos.subtotal : '';
  document.getElementById('c-itbis').value = montoValido(datos.itbis) ? datos.itbis : '';
  document.getElementById('c-total').value = montoValido(datos.total) ? datos.total : '';
}

function leerCampos(){
  const num = v => normalizarMontoTexto(v);
  return {
    fechaEmision: document.getElementById('c-fecha').value.trim(),
    ncf: document.getElementById('c-ncf').value.trim(),
    rncEmisor: document.getElementById('c-rnc').value.trim(),
    nombreComercio: document.getElementById('c-comercio').value.trim(),
    subtotal: num(document.getElementById('c-subtotal').value),
    itbis: num(document.getElementById('c-itbis').value),
    total: num(document.getElementById('c-total').value)
  };
}

function okChip(txt){ return `<span class="chip ok"><span class="dot"></span>${txt}</span>`; }
function warnChip(txt){ return `<span class="chip warn"><span class="dot"></span>${txt}</span>`; }

// Deshabilita los campos mientras el motor lee (una respuesta tardia no debe pisar una
// edicion manual). El boton Confirmar queda SIEMPRE habilitado: guardar durante la
// lectura cancela la peticion y sube la factura como provisional (la IA la revisa luego).
function setCamposHabilitados(hab){
  CAMPOS_IDS.forEach(id => { document.getElementById(id).disabled = !hab; });
}

// Motor elegido para ESTA factura (se restablece a IA en cada captura). El toggle solo
// aparece con API key; sin key siempre es OCR local, como antes.
let motorPreferido = 'ia';
let abortLectura = null;

function actualizarUIMotor(){
  document.getElementById('motor-ia').classList.toggle('on', motorPreferido === 'ia');
  document.getElementById('motor-ocr').classList.toggle('on', motorPreferido === 'ocr');
}
document.getElementById('motor-ia').addEventListener('click', () => {
  if (motorPreferido === 'ia') return;
  motorPreferido = 'ia'; leerDatosDeFactura();
});
document.getElementById('motor-ocr').addEventListener('click', () => {
  if (motorPreferido === 'ocr') return;
  motorPreferido = 'ocr'; leerDatosDeFactura();
});

async function leerDatosDeFactura(){
  const miGen = ++genOCR;
  if (abortLectura){ abortLectura.abort(); abortLectura = null; } // cancela lectura previa
  const key = get('geminiKey', '');
  const origen = document.getElementById('datos-origen');
  const nota = document.getElementById('nota-verificar');
  document.getElementById('motor-seg').hidden = !key;
  actualizarUIMotor();
  vaciarCampos();
  nota.hidden = true;
  // Reset del estado ANTES del await: si el usuario confirma durante la carga, la factura
  // sube como provisional (origen 'cargando'), nunca con metadatos de una factura anterior.
  window.__datos = { origen: 'cargando' };
  // Sin esquinas no se salta la lectura: se lee la imagen original completa.
  const canvas = window.__resultado?.canvasFinal || window.__resultado?.canvasOriginal;
  if (!canvas){
    setCamposHabilitados(true);
    origen.hidden = false; origen.textContent = 'sin imagen';
    window.__datos = { origen: 'manual' };
    await validarCampos(miGen);
    return;
  }
  const usarIA = !!key && motorPreferido === 'ia';
  origen.hidden = false;
  origen.textContent = usarIA ? `Leyendo con ${ETIQUETA_MODELO[geminiModelo] || geminiModelo}…` : 'Leyendo (OCR local)…';
  setCamposHabilitados(false);
  let datos = null, motor = 'manual';
  try {
    if (usarIA){
      abortLectura = new AbortController();
      try { datos = await extraerDatos(canvas, key, geminiModelo, abortLectura.signal); motor = 'gemini'; }
      catch(e){
        // Cancelada (toggle a OCR, guardado o re-proceso): la nueva accion controla la UI.
        if (e.name === 'AbortError') return;
        console.error(e);
        // Mensaje honesto por causa (cuota / key inválida / restringida / modelo); los
        // errores de red o del servicio degradan al OCR local sin culpar a la key.
        const diag = diagnosticoGemini(e.status);
        if (diag) toast(diag);
        origen.textContent = 'Leyendo (OCR local)…';
        datos = await extraerDatosLocal(canvas, empresaGuardada().rnc); motor = 'local';
      } finally { abortLectura = null; }
    } else {
      datos = await extraerDatosLocal(canvas, empresaGuardada().rnc); motor = 'local';
    }
  } catch(e){ console.error(e); toast('No se pudo leer la factura; escribe los datos'); datos = null; motor = 'manual'; }
  if (miGen !== genOCR) return; // llegó una lectura más nueva; ella controla los campos
  setCamposHabilitados(true);
  window.__datos = { ...(datos || {}), origen: motor };
  if (datos) normalizarEnCampos(datos);
  origen.textContent = motor === 'gemini' ? (ETIQUETA_MODELO[geminiModelo] || geminiModelo) : (motor === 'local' ? 'OCR local' : 'sin lectura');
  nota.hidden = motor !== 'local'; // alerta sutil solo cuando el OCR fue local
  await validarCampos(miGen);
}

async function validarCampos(gen){
  const d = leerCampos();
  window.__datos = { ...window.__datos, ...d };
  const chips = [];
  chips.push(ncfValido(d.ncf) ? okChip('NCF válido') : warnChip('NCF a revisar'));
  chips.push(normalizarFecha(d.fechaEmision) ? okChip('Fecha OK') : warnChip('Fecha a revisar'));
  // Estado de duplicado coherente con el banner: por defecto null; solo se marca al confirmarlo.
  window.__datos.duplicadaDe = null;
  let dupText = '';
  const fechaISO = normalizarFecha(d.fechaEmision);
  if (fechaISO && conectado() && get('carpetaRaizId') && d.ncf){
    try {
      // Solo lectura: NO crear la carpeta del mes por validar (evita carpetas vacías en Drive).
      // La creación real ocurre en la subida (Task 5, con asegurarCarpeta).
      const mesId = await buscarCarpeta(nombreCarpetaMes(fechaISO), get('carpetaRaizId'));
      if (gen != null && gen !== genOCR) return; // lectura obsoleta; no pisar el DOM/__datos
      if (mesId){ // si la carpeta del mes aún no existe, no hay duplicados posibles
        const idx = await leerJSON(mesId, '_gastos.json');
        if (gen != null && gen !== genOCR) return;
        const dup = buscarDuplicado(idx, d.ncf);
        if (dup){
          dupText = `Factura Duplicada — NCF ya registrado en ${dup.archivo}`;
          window.__datos.duplicadaDe = dup.archivo;
        }
      }
    } catch(e){ console.error(e); } // no romper la revisión si Drive falla al chequear duplicados
  }
  const banner = document.getElementById('dup-banner');
  banner.hidden = !dupText;
  banner.textContent = dupText || '';
  document.getElementById('valid-row').innerHTML = chips.join('');
}

// Correccion tipo Excel: el campo entiende lo que el usuario quiso escribir con el
// teclado numerico y lo lleva al formato de la celda. Fechas: 17072026, 17/07/26,
// 17.07.2026, 17/jul/2026 → AAAA-MM-DD. Montos: 3,620.00, 3.620,00, 45,5 → 3620.00.
function normalizarCampoEntrada(id){
  const el = document.getElementById(id);
  const v = el.value.trim();
  if (!v) return;
  if (/fecha/.test(id)){
    const f = normalizarFecha(v);
    if (f) el.value = f;
  } else if (/subtotal|itbis|total/.test(id)){
    const n = normalizarMontoTexto(v);
    if (n != null) el.value = n.toFixed(2);
  }
}

CAMPOS_IDS.forEach(id => document.getElementById(id).addEventListener('change', () => {
  normalizarCampoEntrada(id);
  validarCampos();
}));

async function reprocesarRealce(){
  const res = window.__resultado;
  if (!res || !res.canvasPlano) return;
  let ok = true;
  const final = await conOverlay(() => {
    try { return aplicarRealce(res.canvasPlano, { modo, intensidad }); }
    catch(e){ console.error(e); toast('No se pudo aplicar el filtro'); ok = false; return res.canvasFinal; }
  });
  res.canvasFinal = final;
  pintarEnRevision(final);
  if (ok){ // solo reflejar el modo nuevo si el realce tuvo éxito (no mentir la etiqueta tras un error)
    res.modo = modo;
    res.intensidad = intensidad;
    document.getElementById('rev-file').textContent = `Ortofoto · ${ETIQUETA_MODO[modo] || modo}`;
  }
  document.getElementById('seg-proc').classList.add('on');
  document.getElementById('seg-orig').classList.remove('on');
}

// Selector de modo de imagen: existe en Revisión (por factura) y en Ajustes (por defecto).
// Ambos manejan el MISMO estado `modo`, así que se mantienen sincronizados.
const filtrosEl = document.getElementById('filtros');
const filtrosDefEl = document.getElementById('filtros-def');

function actualizarUIFiltros(){
  [filtrosEl, filtrosDefEl].forEach(cont =>
    cont.querySelectorAll('.filtro').forEach(b => b.classList.toggle('on', b.dataset.modo === modo)));
}
actualizarUIFiltros();

function cambiarModo(nuevo){
  modo = nuevo;
  set('modoImagen', modo);
  actualizarUIFiltros();
  if (window.__resultado && window.__resultado.canvasPlano) reprocesarRealce();
}

[filtrosEl, filtrosDefEl].forEach(cont => cont.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.filtro');
  if (btn) cambiarModo(btn.dataset.modo);
}));

// Visor a pantalla completa: tocar la imagen revisada la abre grande; la X (o el fondo) la cierra.
const visor = document.getElementById('visor');
const visorImg = document.getElementById('visor-img');
function abrirVisor(){
  const rev = document.getElementById('rev-canvas');
  if (!rev.width) return;
  visorImg.src = rev.toDataURL('image/jpeg', 0.92);
  document.getElementById('visor-recortar').hidden = false; // hay captura local: se puede recortar
  visor.hidden = false;
}
function cerrarVisor(){
  if (visorImg.src.startsWith('blob:')) URL.revokeObjectURL(visorImg.src); // liberar el blob de "Ver imagen"
  visor.hidden = true; visorImg.removeAttribute('src');
}
document.getElementById('rev-canvas').addEventListener('click', abrirVisor);
document.getElementById('visor-cerrar').addEventListener('click', cerrarVisor);
visor.addEventListener('click', (ev) => { if (ev.target === visor) cerrarVisor(); }); // toque en el fondo cierra

document.getElementById('seg-proc').addEventListener('click', () => {
  if (!window.__resultado) return;
  if (window.__resultado.canvasFinal){ pintarEnRevision(window.__resultado.canvasFinal);
    document.getElementById('seg-proc').classList.add('on'); document.getElementById('seg-orig').classList.remove('on'); }
  else { toast('Aún no hay versión procesada — aplica las esquinas'); }
});
document.getElementById('seg-orig').addEventListener('click', () => {
  if (!window.__resultado) return;
  pintarEnRevision(window.__resultado.canvasOriginal);
  document.getElementById('seg-orig').classList.add('on'); document.getElementById('seg-proc').classList.remove('on');
});

// Editor de esquinas a pantalla completa (Fase 2D): abre el overlay con lupa y
// re-procesa si el usuario aplica el recorte.
import { abrirEditorEsquinas, initEditorEsquinas } from './esquinas.js';
import { detectarConIA } from './detectia.js';
initEditorEsquinas();

// La IA tarda 2-4 s por imagen: overlay visible para que no parezca colgado.
async function detectarConIAConOverlay(canvas){
  const ov = document.getElementById('overlay-proc');
  ov.hidden = false;
  try { return await detectarConIA(canvas); }
  finally { ov.hidden = true; }
}

async function ajustarEsquinas(){
  const res = window.__resultado;
  if (!res) return;
  const esq = await abrirEditorEsquinas(res.canvasOriginal, res.esquinas || null);
  if (!esq) return;
  window.__captura = { canvas: res.canvasOriginal, esquinas: esq };
  procesarYRevisar();
}
document.getElementById('btn-esquinas').addEventListener('click', ajustarEsquinas);

const visorRecortar = document.getElementById('visor-recortar');
visorRecortar.addEventListener('click', () => { cerrarVisor(); ajustarEsquinas(); });

import { cvReady } from './cvready.js';
import { detectarDocumento, esEstable, nitidezRegion, tocaBorde } from './detect.js';
import { archivoACanvas } from './importar.js';

// ---------- Importación en lote (Fase 2B) ----------
// Recorre las imágenes elegidas de la galería una por una por el mismo pipeline
// (ortofoto + auto-color + OCR + confirmación) que una foto de cámara.
function actualizarBarraLote(){
  const bar = document.getElementById('lote-bar');
  if (!window.__lote){ bar.hidden = true; return; }
  const { files, i } = window.__lote;
  bar.hidden = false;
  document.getElementById('lote-txt').textContent = `Importación en lote — validando ${i + 1} de ${files.length}`;
  document.getElementById('lote-dots').innerHTML = files
    .map((_, k) => `<span class="d ${k < i ? 'hecha' : k === i ? 'actual' : ''}"></span>`).join('');
}

async function cargarSiguienteDelLote(){
  const lote = window.__lote;
  if (!lote){ return; }
  if (lote.i >= lote.files.length){ // lote terminado
    window.__lote = null;
    actualizarBarraLote();
    show('gastos');
    refrescarGastos();
    return;
  }
  actualizarBarraLote();
  try {
    const canvas = await archivoACanvas(lote.files[lote.i]);
    // Autorecorte: clasico (rapido) → IA local si fallo. El editor abre SIEMPRE con lo
    // detectado precargado; "Aplicar" acepta el recorte y se pasa a los datos (Adobe Scan).
    let esquinas = detectarDocumento(canvas, 1200);
    if (!esquinas) esquinas = await detectarConIAConOverlay(canvas);
    esquinas = await abrirEditorEsquinas(canvas, esquinas);
    window.__captura = { canvas, esquinas };
    procesarYRevisar();
  } catch(e){
    console.error(e);
    toast('No se pudo abrir una imagen; se omite');
    window.__lote.i++;
    cargarSiguienteDelLote();
  }
}

async function importarLote(files){
  if (!files || !files.length) return;
  window.__origenAjeno = null; // el lote de galeria no toca originales de Drive
  await cvReady();
  window.__lote = { files, i: 0 };
  cargarSiguienteDelLote();
}

// En lote, tras subir/encolar cada factura avanza a la siguiente; si no, va al destino normal.
function avanzarLoteOIr(destino){
  if (window.__lote){
    window.__lote.i++;
    cargarSiguienteDelLote();
  } else {
    show(destino);
    if (destino === 'gastos') refrescarGastos();
  }
}

// Cancelar el lote (p. ej. al volver a Cámara desde Revisión a mitad de la validación).
function cancelarLoteYVolver(){
  if (abortLectura){ abortLectura.abort(); abortLectura = null; } // no seguir leyendo en vano
  if (window.__lote){ window.__lote = null; actualizarBarraLote(); }
  window.__origenAjeno = null; // cancelar una ajena NO toca su original
  show('camara');
}
window.cancelarLoteYVolver = cancelarLoteYVolver;

document.getElementById('btn-importar').addEventListener('click', () => document.getElementById('file-import').click());
document.getElementById('file-import').addEventListener('change', (ev) => {
  const files = [...ev.target.files];
  ev.target.value = ''; // permite volver a elegir los mismos archivos luego
  importarLote(files);
});

const overlay = document.getElementById('cam-overlay');
let ultimasEsquinas = null;

function dibujarOverlay(esquinas){
  const ctx = overlay.getContext('2d');
  const cw = overlay.clientWidth, ch = overlay.clientHeight;
  if (overlay.width !== cw || overlay.height !== ch){ overlay.width = cw; overlay.height = ch; }
  ctx.clearRect(0, 0, cw, ch);
  if (!esquinas || !video.videoWidth) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  const s = Math.max(cw / vw, ch / vh);
  const ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
  const pts = esquinas.map(p => ({ x: p.x * s + ox, y: p.y * s + oy }));
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle = 'rgba(74,143,231,.10)';
  ctx.strokeStyle = '#4E9BEB';
  ctx.lineWidth = cw * 0.006;
  ctx.fill(); ctx.stroke();
}

const UMBRAL_NITIDEZ = 120;   // varianza mínima del Laplaciano (ajustable en campo)
// Bajado de 8 a 4 (~0.5 s): con la nitidez medida solo dentro del papel ya no hace
// falta esperar tanto para confirmar estabilidad; dispara más rápido en campo.
const FRAMES_ESTABLES = 4;
let estables = 0, disparando = false;

async function buclDeteccion(){
  await cvReady();
  const frame = document.createElement('canvas');
  const tick = () => {
    if (video.videoWidth && document.getElementById('scr-camara').classList.contains('active') && !disparando){
      frame.width = video.videoWidth; frame.height = video.videoHeight;
      frame.getContext('2d').drawImage(video, 0, 0);
      // En vivo: criterio estricto (sin rescate) y sin cuadrilateros pegados al borde,
      // para no marcar "Documento detectado" sobre fondos texturados (falsos positivos).
      let esquinas = detectarDocumento(frame, 700, { rescate: false });
      if (esquinas && tocaBorde(esquinas, frame.width, frame.height)) esquinas = null;
      dibujarOverlay(esquinas);
      const shutter = document.getElementById('shutter');

      if (esquinas && esEstable(ultimasEsquinas, esquinas, frame.width * 0.01)){
        estables++;
        statusTxt.textContent = 'Documento detectado — mantén firme';
        document.getElementById('cam-status').classList.add('lock');
        shutter.classList.add('arm'); // anima el anillo (CSS existente)
        if (estables >= FRAMES_ESTABLES && nitidezRegion(frame, esquinas) >= UMBRAL_NITIDEZ){
          disparando = true;
          estables = 0;
          shutter.classList.remove('arm');
          const fx = document.getElementById('flashfx');
          fx.classList.remove('go'); void fx.offsetWidth; fx.classList.add('go');
          window.__captura = { canvas: capturarFrame(video), esquinas };
          setTimeout(() => { procesarYRevisar(); disparando = false; }, 350);
        }
      } else {
        estables = 0;
        shutter.classList.remove('arm');
        statusTxt.textContent = esquinas ? 'Documento detectado — mantén firme' : 'Buscando documento…';
        document.getElementById('cam-status').classList.toggle('lock', !!esquinas);
      }
      ultimasEsquinas = esquinas;
    }
    setTimeout(() => requestAnimationFrame(tick), 120);
  };
  tick();
}
buclDeteccion();

// Ajustes persistentes (Task 7)
const inpClient = document.getElementById('inp-clientid');
inpClient.value = get('clientId', '');
inpClient.addEventListener('change', () => set('clientId', inpClient.value.trim()));

// ---------- Selector de carpeta matriz (estilo "Guardar en Drive") ----------
// Navega Mi unidad / Compartidos conmigo y vincula una carpeta EXISTENTE (o nueva).
// El vinculo se guarda por ID: renombrar/mover la carpeta o reconectar NO lo rompe.
function pintarRutaCarpeta(){
  document.getElementById('carpeta-ruta').textContent = get('carpetaRuta', '') || '— sin vincular —';
}
pintarRutaCarpeta();

let pickerPila = []; // breadcrumb [{id, nombre}]; vacio = nivel superior virtual
const PICKER_VIRTUALES = new Set(['root', '__compartidos__']);

async function renderPicker(){
  const lista = document.getElementById('carpeta-lista');
  const rutaEl = document.getElementById('carpeta-ruta-actual');
  const tope = pickerPila[pickerPila.length - 1] || null;
  rutaEl.textContent = pickerPila.length ? pickerPila.map(p => p.nombre).join(' / ') : 'Elige dónde vive tu carpeta de gastos';
  const virtual = !tope || PICKER_VIRTUALES.has(tope.id);
  document.getElementById('carpeta-usar').disabled = virtual;
  document.getElementById('carpeta-nueva').disabled = !tope || tope.id === '__compartidos__';
  lista.innerHTML = '<div class="gem-note">Cargando…</div>';
  try {
    let carpetas;
    if (!tope){
      carpetas = [{ id: 'root', nombre: 'Mi unidad' }, { id: '__compartidos__', nombre: 'Compartidos conmigo' }];
    } else if (tope.id === '__compartidos__'){
      carpetas = (await carpetasCompartidas()).map(c => ({ id: c.id, nombre: c.name }));
    } else {
      carpetas = (await listarCarpetas(tope.id)).map(c => ({ id: c.id, nombre: c.name }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
    }
    lista.innerHTML = '';
    if (pickerPila.length){
      const up = document.createElement('button');
      up.className = 'carpeta-item';
      up.textContent = '‹ Atrás';
      up.addEventListener('click', () => { pickerPila.pop(); renderPicker(); });
      lista.appendChild(up);
    }
    for (const c of carpetas){
      const b = document.createElement('button');
      b.className = 'carpeta-item';
      b.innerHTML = '<span>📁</span><span class="carpeta-nom num"></span><span style="color:var(--dim)">›</span>';
      b.querySelector('.carpeta-nom').textContent = c.nombre;
      b.addEventListener('click', () => { pickerPila.push(c); renderPicker(); });
      lista.appendChild(b);
    }
    if (!carpetas.length) lista.insertAdjacentHTML('beforeend', '<div class="gem-note">Sin subcarpetas aquí.</div>');
  } catch(e){ console.error(e); lista.innerHTML = '<div class="gem-note">No se pudo listar — revisa la conexión.</div>'; }
}

document.getElementById('btn-carpeta').addEventListener('click', () => {
  if (!conectado()) return toast('Conecta Google Drive primero');
  pickerPila = [];
  document.getElementById('carpeta-panel').hidden = false;
  renderPicker();
});
document.getElementById('carpeta-cerrar').addEventListener('click', () => {
  document.getElementById('carpeta-panel').hidden = true;
});
document.getElementById('carpeta-nueva').addEventListener('click', async () => {
  const tope = pickerPila[pickerPila.length - 1];
  if (!tope || tope.id === '__compartidos__') return;
  const nombre = (prompt('Nombre de la carpeta nueva:') || '').trim();
  if (!nombre) return;
  try {
    const id = await crearCarpeta(nombre, tope.id === 'root' ? null : tope.id);
    pickerPila.push({ id, nombre });
    renderPicker();
  } catch(e){ console.error(e); toast('No se pudo crear la carpeta'); }
});
document.getElementById('carpeta-usar').addEventListener('click', () => {
  const tope = pickerPila[pickerPila.length - 1];
  if (!tope || PICKER_VIRTUALES.has(tope.id)) return;
  set('carpetaRaizId', tope.id);
  set('carpetaRaiz', tope.nombre);
  set('carpetaRuta', pickerPila.map(p => p.nombre).join(' / '));
  document.getElementById('carpeta-panel').hidden = true;
  pintarRutaCarpeta();
  toast(`Carpeta «${tope.nombre}» vinculada ✓`);
  refrescarGastos(); procesarCola();
});

// Perfil de empresa (membrete del documento de gastos) — Fase 3.
import { empresaGuardada, guardarEmpresaLocal, empresaCompleta, archivoALogoB64 } from './empresa.js';

const EMP_CAMPOS = { 'emp-razon':'razon', 'emp-rnc':'rnc', 'emp-ubicacion':'ubicacion', 'emp-tel':'tel', 'emp-correo':'correo' };

function pintarEmpresa(){
  const e = empresaGuardada();
  for (const [id, campo] of Object.entries(EMP_CAMPOS)) document.getElementById(id).value = e[campo] || '';
  const prev = document.getElementById('emp-logo-prev');
  prev.hidden = !e.logoB64;
  if (e.logoB64) prev.src = e.logoB64;
}
pintarEmpresa();

async function guardarEmpresa(cambios){
  const e = { ...empresaGuardada(), ...cambios };
  guardarEmpresaLocal(e);
  pintarEmpresa();
  // Replica el membrete a la nube para que otras instalaciones lo hereden.
  if (conectado() && get('carpetaRaizId')){
    try { await guardarJSON(get('carpetaRaizId'), '_empresa.json', e); } catch(err){ console.error(err); }
  }
}
for (const [id, campo] of Object.entries(EMP_CAMPOS)){
  document.getElementById(id).addEventListener('change', ev => guardarEmpresa({ [campo]: ev.target.value.trim() }));
}
document.getElementById('emp-logo-btn').addEventListener('click', () => document.getElementById('emp-logo-file').click());
document.getElementById('emp-logo-file').addEventListener('change', async ev => {
  const f = ev.target.files[0]; ev.target.value = '';
  if (!f) return;
  try { await guardarEmpresa({ logoB64: await archivoALogoB64(f) }); toast('Logo guardado ✓'); }
  catch(e){ console.error(e); toast('No se pudo leer el logo'); }
});

// "Otros ajustes": credenciales avanzadas (API key + Client ID) plegadas tras un PIN de
// 4 numeros, para que el usuario normal no las toque por accidente. Es un candado de
// conveniencia, no seguridad fuerte: la app entera corre en el telefono del usuario.
const otrosPanel = document.getElementById('otros-ajustes');
document.getElementById('btn-otros').addEventListener('click', () => {
  if (!otrosPanel.hidden){ otrosPanel.hidden = true; return; } // segundo toque: plegar
  const pinGuardado = get('pinAjustes', null);
  if (!pinGuardado){
    const nuevo = (prompt('Crea un PIN de 4 números para proteger estos ajustes:') || '').trim();
    if (!/^\d{4}$/.test(nuevo)) return toast('El PIN debe ser de 4 números');
    set('pinAjustes', nuevo);
    toast('PIN creado ✓ — guárdalo bien');
    otrosPanel.hidden = false;
    return;
  }
  const pin = (prompt('PIN de 4 números:') || '').trim();
  if (pin !== pinGuardado) return toast('PIN incorrecto');
  otrosPanel.hidden = false;
});

// Toggle "Cámara al abrir" (tcb:camaraAuto). "Solo al tocar" evita pedir la cámara (y su
// aviso de permiso de iOS) en cada apertura cuando el usuario solo viene a Gastos/Ajustes.
function actualizarUICamaraAuto(){
  const auto = get('camaraAuto', true);
  document.getElementById('cam-auto-si').classList.toggle('on', auto);
  document.getElementById('cam-auto-no').classList.toggle('on', !auto);
}
document.getElementById('cam-auto-si').addEventListener('click', () => { set('camaraAuto', true); actualizarUICamaraAuto(); });
document.getElementById('cam-auto-no').addEventListener('click', () => { set('camaraAuto', false); actualizarUICamaraAuto(); toast('La cámara solo se encenderá cuando la toques'); });
actualizarUICamaraAuto();

const inpGemini = document.getElementById('inp-gemini');
inpGemini.value = get('geminiKey', '');
inpGemini.addEventListener('change', () => set('geminiKey', inpGemini.value.trim()));

// Prueba la key contra el listado de modelos (barato, sin gastar cuota) y dice EXACTAMENTE
// que pasa: valida, invalida, restringida, o cuota agotada — para no adivinar en campo.
document.getElementById('btn-probar-gemini').addEventListener('click', async () => {
  const btn = document.getElementById('btn-probar-gemini');
  const nota = document.getElementById('gemini-estado');
  const key = get('geminiKey', '') || inpGemini.value.trim();
  if (!key){ nota.hidden = false; nota.textContent = 'Pega primero tu API key.'; return; }
  btn.disabled = true; btn.textContent = 'Probando…';
  try {
    const res = await probarApiKey(key, geminiModelo);
    nota.hidden = false;
    nota.textContent = res.mensaje;
  } finally {
    btn.disabled = false; btn.textContent = 'Probar la API key';
  }
});

// Selector de modelo de Gemini
const modeloEl = document.getElementById('modelo-gemini');
function actualizarUIModelo(){
  modeloEl.querySelectorAll('.filtro').forEach(b => b.classList.toggle('on', b.dataset.modelo === geminiModelo));
}
actualizarUIModelo();
modeloEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.filtro');
  if (!btn) return;
  geminiModelo = btn.dataset.modelo;
  set('geminiModelo', geminiModelo);
  actualizarUIModelo();
});

// Conexión a Google Drive (Task 9)
import { initAuth, conectar, conectado, asegurarCarpeta, buscarCarpeta, listarNombres, subirJPEG, leerJSON, guardarJSON, descargarImagen,
         buscarArchivo, moverYRenombrar, nombreDe, alDesconectar, subirOReemplazar,
         listarArchivos, listarCarpetas, descargarPorId, moverAPapelera, ponerDescripcion,
         carpetasCompartidas, crearCarpeta } from './drive.js';
import { paginar, generarPDF, RATIO_LARGA } from './pdfgastos.js';
import { filas606, generarXLSX606 } from './f606.js';

import { CLIENT_ID_APP } from './config.js';

// Client ID efectivo: el de Ajustes (si el usuario puso uno) o el integrado en la app.
function clientIdActivo(){
  return get('clientId', '') || CLIENT_ID_APP;
}

// Pasos comunes tras conectar (boton de Ajustes, aviso tocable o reconexion silenciosa).
// La carpeta matriz se re-vincula por ID (duradero); si nunca se eligio una, se crea la
// carpeta por defecto en Mi unidad. Elegir otra: Ajustes → «Elegir carpeta…».
async function postConexion(){
  let raizId = get('carpetaRaizId');
  if (raizId){
    try { await nombreDe(raizId); } // ¿sigue existiendo y accesible?
    catch(e){ console.warn('Carpeta vinculada inaccesible; se re-crea la por defecto'); raizId = null; }
  }
  if (!raizId){
    raizId = await asegurarCarpeta(get('carpetaRaiz', 'Gastos_NCF'));
    set('carpetaRuta', 'Mi unidad / ' + get('carpetaRaiz', 'Gastos_NCF'));
  }
  set('carpetaRaizId', raizId);
  pintarRutaCarpeta();
  set('driveConectadoAntes', true); // habilita la reconexion silenciosa al abrir
  // Hereda el membrete guardado en la nube si esta instalacion no lo tiene aun.
  if (!empresaCompleta(empresaGuardada())){
    try {
      const e = await leerJSON(raizId, '_empresa.json');
      if (e){ guardarEmpresaLocal(e); pintarEmpresa(); }
    } catch(err){ console.error(err); }
  }
  document.getElementById('drive-estado').textContent =
    `Conectado ✓ — carpeta «${get('carpetaRaiz', 'Gastos_NCF')}» lista`;
  const sub = document.getElementById('gastos-sub');
  sub.textContent = 'Google Drive · conectado';
  sub.classList.remove('accion');
  refrescarGastos();
  procesarCola();
}

document.getElementById('btn-conectar').addEventListener('click', async () => {
  const btn = document.getElementById('btn-conectar');
  const clientId = clientIdActivo();
  if (!clientId) return toast('Pega primero tu Client ID de Google');
  btn.disabled = true;
  try {
    initAuth(clientId);
    await conectar();
    await postConexion();
    toast('Google Drive conectado');
  } catch(e){
    console.error(e);
    toast('No se pudo conectar: ' + e.message);
  } finally {
    btn.disabled = false;
  }
});

function mostrarAvisoReconectar(){
  const sub = document.getElementById('gastos-sub');
  sub.textContent = 'Reconectar Google Drive ▸';
  sub.classList.add('accion');
}
alDesconectar(mostrarAvisoReconectar);

// El subtitulo de Gastos es tocable cuando hay que reconectar (sin pasar por Ajustes).
document.getElementById('gastos-sub').addEventListener('click', async () => {
  if (conectado()) return;
  const clientId = clientIdActivo();
  if (!clientId) return toast('Pega tu Client ID de Google en Ajustes');
  try {
    initAuth(clientId);
    await conectar();
    await postConexion();
    toast('Google Drive conectado');
  } catch(e){ console.error(e); toast('No se pudo conectar: ' + e.message); }
});

// Al abrir la app: si ya hubo consentimiento antes, renovar el acceso sin molestar.
// Google lo permite con prompt:'' mientras la sesion siga viva; si exige interaccion
// (o el popup se bloquea), queda el aviso tocable en Gastos.
async function reconectarSilencioso(){
  const clientId = clientIdActivo();
  if (!clientId || !get('driveConectadoAntes', false)) return;
  if (conectado()){
    // Token restaurado de localStorage (vive ~1 h): sin popup ni permiso, directo a trabajar.
    try { if (window.google) initAuth(clientId); } catch(e){ console.warn(e); }
    try { await postConexion(); } catch(e){ console.warn(e); mostrarAvisoReconectar(); }
    return;
  }
  if (!window.google){ mostrarAvisoReconectar(); return; } // GIS aun no cargo
  try {
    initAuth(clientId);
    await conectar({ silencioso: true });
    await postConexion();
    toast('Google Drive reconectado ✓');
  } catch(e){
    console.warn('Reconexion silenciosa fallo:', e.message);
    mostrarAvisoReconectar();
  }
}
window.addEventListener('load', () => setTimeout(reconectarSilencioso, 600));

// El token de Google vive 60 min (limite fijo de Google para apps sin servidor). La
// renovacion silenciosa al abrir FALLA en iOS si no hay gesto del usuario (bloqueo de
// popups). Solucion: el PRIMER toque en cualquier parte renueva el token — como el
// consentimiento ya existe, es instantaneo. Throttle de 30 s para no insistir si Google
// de verdad exige interaccion.
let _ultimoIntentoRenovar = 0;
document.addEventListener('pointerdown', () => {
  if (conectado()) return;
  if (!get('driveConectadoAntes', false) || !clientIdActivo() || !window.google) return;
  const ahora = Date.now();
  if (ahora - _ultimoIntentoRenovar < 30000) return;
  _ultimoIntentoRenovar = ahora;
  reconectarSilencioso();
}, true);

// Confirmar y subir + pantalla Gastos (Task 10)
import { nombreCarpetaMes, siguienteNombre, hoyISO,
         nombreProvisional, nombreUnico, esProvisional, necesitaReArchivo } from './naming.js';

// Cola offline en IndexedDB con reintento al reconectar (Task 11)
import { encolar, pendientes, eliminar, cuenta } from './queue.js';

// Índice _gastos.json por mes (Task 5): archiva por fecha de EMISIÓN (con respaldo a
// la fecha del dispositivo), registra metadatos y marca duplicados sin bloquear la subida.
import { agregarEntrada, entradaDeFactura, quitarEntrada, descDeEntrada, conciliarIndice } from './indice.js';

function refrescarGastosSiVisible(){
  if (document.getElementById('scr-gastos').classList.contains('active')) refrescarGastos();
}

// Mutex que serializa TODAS las escrituras a _gastos.json (subida, revisor con Gemini y
// confirmación del usuario): cada una hace su read-modify-write sin que otra la pise
// entre medias, evitando perder entradas del índice del 606.
let _lockIndice = Promise.resolve();
function conLockIndice(fn){
  const corrida = _lockIndice.then(fn, fn);
  _lockIndice = corrida.catch(() => {});
  return corrida;
}

function subirFactura(blob, datos){
  return conLockIndice(async () => {
    const raizId = get('carpetaRaizId');
    if (!conectado() || !raizId) throw new Error('sin-conexion');
    const fechaISO = normalizarFecha(datos.fechaEmision); // null → subida provisional
    const carpetaMes = nombreCarpetaMes(fechaISO || hoyISO());
    const mesId = await asegurarCarpeta(carpetaMes, raizId);
    const idx = await leerJSON(mesId, '_gastos.json');
    // Re-chequeo definitivo contra el índice actual (cubre reintentos de la cola offline,
    // donde el duplicado pudo registrarse después de que la factura se encoló).
    const dup = buscarDuplicado(idx, datos.ncf);
    const nombres = await listarNombres(mesId);
    // Sin fecha de emision el nombre es provisional; el revisor lo re-archiva al conocerla.
    const nombre = fechaISO ? siguienteNombre(fechaISO, nombres)
                            : nombreUnico(nombreProvisional(), nombres);
    // El índice registra la fecha REALMENTE usada para archivar (fechaISO o ninguna), no el
    // texto crudo: siempre coincide con la carpeta donde quedó el archivo — trazabilidad 606.
    const entrada = entradaDeFactura(nombre, { ...datos, fechaEmision: fechaISO }, datos.origen || 'manual', !!dup);
    if (datos.procesadaDesde) entrada.procesadaDesde = datos.procesadaDesde; // trazabilidad de ajenas
    if (!fechaISO){ entrada.estado = 'pendiente'; entrada.provisional = true; }
    // La entrada viaja TAMBIEN en la description del archivo (multi-usuario: si el indice
    // pierde esta entrada por una escritura concurrente, la conciliacion la restaura).
    const subida = await subirJPEG(blob, nombre, mesId, descDeEntrada(entrada));
    entrada.driveId = subida.id; // permite re-archivar sin buscar por nombre (idempotente)
    // Si el guardado del indice falla tras subir el JPEG, un reintento; si aun asi falla,
    // el archivo NO se pierde: su description lo restaura en la proxima conciliacion.
    try { await guardarJSON(mesId, '_gastos.json', agregarEntrada(idx, entrada)); }
    catch(e){ console.error(e); await guardarJSON(mesId, '_gastos.json', agregarEntrada(idx, entrada)); }
    // Si quedó incompleta, provisional o leída por OCR local, Gemini la revisa luego.
    if (entrada.estado !== 'completa'){
      try { await encolarRevision({ blob, mesId, archivo: nombre }); } catch(e){ console.error(e); }
    }
    return { nombre, duplicada: !!dup, duplicadaDe: dup ? dup.archivo : null };
  });
}

// Aplica `mutador(f)` a la entrada del indice y, si la fecha de emision ya no coincide
// con la carpeta/nombre actual (o el nombre es provisional), renombra y mueve el archivo
// en Drive y transfiere la entrada al indice del mes destino. Orden seguro: primero el
// archivo, despues los indices; driveId hace la operacion re-ejecutable si algo falla a
// mitad. Devuelve null si la entrada ya no existe.
function actualizarEntradaConReArchivo(mesId, archivo, mutador){
  return conLockIndice(async () => {
    const idx = await leerJSON(mesId, '_gastos.json');
    const f = idx?.facturas?.find(x => x.archivo === archivo);
    if (!f) return null;
    mutador(f);
    const fechaISO = normalizarFecha(f.fechaEmision);
    if (fechaISO) f.fechaEmision = fechaISO;
    const carpetaActual = await nombreDe(mesId);
    if (!fechaISO || !necesitaReArchivo(archivo, carpetaActual, fechaISO)){
      await guardarJSON(mesId, '_gastos.json', idx);
      // Mantener los metadatos que viajan con el archivo (mejor esfuerzo).
      try {
        const fid = f.driveId || await buscarArchivo(mesId, archivo);
        if (fid) await ponerDescripcion(fid, descDeEntrada(f));
      } catch(e){ console.error(e); }
      return { nombreFinal: archivo, estado: f.estado, movidaA: null, entrada: f };
    }
    const carpetaDestino = nombreCarpetaMes(fechaISO);
    const destinoId = carpetaDestino === carpetaActual ? mesId
                    : await asegurarCarpeta(carpetaDestino, get('carpetaRaizId'));
    const nombreFinal = siguienteNombre(fechaISO, await listarNombres(destinoId));
    const fileId = f.driveId || await buscarArchivo(mesId, archivo);
    if (!fileId) throw new Error('No se encontró ' + archivo + ' en Drive');
    // OJO: entrada NUEVA sin mutar `f`, para que quitarEntrada (nombre viejo) si la elimine.
    const entradaFinal = { ...f, archivo: nombreFinal, driveId: fileId };
    delete entradaFinal.provisional;
    await moverYRenombrar(fileId, nombreFinal, destinoId, mesId, descDeEntrada(entradaFinal));
    if (destinoId === mesId){
      await guardarJSON(mesId, '_gastos.json', agregarEntrada(quitarEntrada(idx, archivo), entradaFinal));
    } else {
      const idxDest = await leerJSON(destinoId, '_gastos.json');
      entradaFinal.duplicada = entradaFinal.duplicada || !!buscarDuplicado(idxDest, entradaFinal.ncf);
      await guardarJSON(destinoId, '_gastos.json', agregarEntrada(idxDest, entradaFinal));
      await guardarJSON(mesId, '_gastos.json', quitarEntrada(idx, archivo));
    }
    return { nombreFinal, estado: entradaFinal.estado, movidaA: destinoId === mesId ? null : carpetaDestino, entrada: entradaFinal };
  });
}

document.getElementById('confirm-btn').addEventListener('click', async () => {
  const res = window.__resultado;
  if (!res) return;
  // Guardar durante la lectura: se cancela la peticion en vuelo y la factura sube como
  // provisional (origen 'cargando'); la IA en background la lee y la re-archiva despues.
  if (abortLectura){ abortLectura.abort(); abortLectura = null; setCamposHabilitados(true); }
  const origenAjeno = window.__origenAjeno || null; // factura llegada por fuera de la app
  const canvas = res.canvasFinal || res.canvasOriginal;
  // Se congelan los datos ANTES del await de la subida: si el usuario edita los campos
  // mientras la factura sube, no queremos que un cambio a mitad de camino contamine
  // el registro fiscal que se está escribiendo en _gastos.json.
  const datos = { ...(window.__datos || {}) };
  if (origenAjeno) datos.procesadaDesde = origenAjeno.nombre; // el origen (gemini/local/manual) lo pone el motor que leyo
  const btn = document.getElementById('confirm-btn');
  btn.disabled = true; btn.textContent = 'Subiendo…';
  let blob;
  let lockAdquirido = false;
  try {
    blob = await canvasAJpeg(canvas);
    if (colaEnProceso){
      await encolar({ blob, datos });
      toast('Subida en curso — factura añadida a la cola');
      actualizarBadge();
      avanzarLoteOIr('camara');
      return;
    }
    colaEnProceso = true; lockAdquirido = true;
    const { nombre, duplicada } = await subirFactura(blob, datos);
    toast(duplicada ? `Subida: ${nombre} — marcada como DUPLICADA (revísala en Gastos)`
        : esProvisional(nombre) ? 'Subida ✓ — la IA leerá los datos y la renombrará'
        : `Subida: ${nombre} ✓`);
    if (origenAjeno){
      // La procesada ya esta a salvo en Drive: el original crudo va a la papelera.
      try { await moverAPapelera(origenAjeno.fileId); }
      catch(e){ console.error(e); toast('El original sigue en la carpeta — puedes reintentarlo luego'); }
      window.__origenAjeno = null;
    }
    avanzarLoteOIr('gastos');
  } catch(e){
    console.error(e);
    if (e.message === 'sin-conexion'){
      await encolar({ blob, datos });
      toast('Sin conexión con Drive — en cola; reconecta en Ajustes para subirla');
      document.getElementById('gastos-sub').textContent = 'Google Drive · reconectar en Ajustes';
      actualizarBadge();
      avanzarLoteOIr('camara');
    } else {
      toast('Error al subir: ' + e.message);
    }
  } finally {
    if (lockAdquirido) colaEnProceso = false;
    btn.disabled = false; btn.textContent = 'Confirmar y subir';
  }
});

// Panel de cola de subida (Fase 2E): ver, reintentar y eliminar lo que espera Drive.
let colaURLs = [];
async function abrirCola(){
  const lista = document.getElementById('cola-lista');
  colaURLs.forEach(u => URL.revokeObjectURL(u)); colaURLs = [];
  lista.innerHTML = '';
  const items = await pendientes();
  document.getElementById('cola-subir').disabled = !items.length;
  if (!items.length){
    lista.innerHTML = '<div class="gem-note">Nada en cola — todo está en Drive.</div>';
  }
  for (const it of items){
    const fila = document.createElement('div');
    fila.className = 'cola-item';
    const img = document.createElement('img');
    const u = URL.createObjectURL(it.blob); colaURLs.push(u);
    img.src = u; img.alt = 'Miniatura';
    const d = it.datos || {};
    const partes = [d.nombreComercio, normalizarFecha(d.fechaEmision),
      d.total != null ? 'RD$ ' + Number(d.total).toLocaleString('es-DO', { minimumFractionDigits: 2 }) : null];
    const info = document.createElement('div');
    info.className = 'cola-info';
    info.innerHTML = '<b class="num"></b><span>Esperando conexión con Drive</span>';
    info.querySelector('b').textContent = partes.filter(Boolean).join(' · ') || 'Sin datos leídos';
    const del = document.createElement('button');
    del.className = 'cola-borrar'; del.textContent = '🗑';
    del.setAttribute('aria-label', 'Eliminar de la cola');
    del.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta factura de la cola? La foto se descartará (aún no está en Drive).')) return;
      await eliminar(it.id);
      actualizarBadge();
      abrirCola(); // re-render
    });
    fila.appendChild(img); fila.appendChild(info); fila.appendChild(del);
    lista.appendChild(fila);
  }
  document.getElementById('cola-panel').hidden = false;
}
function cerrarCola(){
  document.getElementById('cola-panel').hidden = true;
  colaURLs.forEach(u => URL.revokeObjectURL(u)); colaURLs = [];
}
document.getElementById('btn-cola').addEventListener('click', abrirCola);
document.getElementById('cola-cerrar').addEventListener('click', cerrarCola);
document.getElementById('cola-subir').addEventListener('click', async () => {
  if (!conectado()) return toast('Sin conexión con Drive — usa "Reconectar" en Gastos');
  cerrarCola();
  await procesarCola();
  refrescarGastosSiVisible();
  toast('Cola procesada');
});

async function actualizarBadge(){
  const n = await cuenta();
  const b = document.getElementById('cola-badge');
  b.style.display = n ? 'block' : 'none';
  b.textContent = n;
}

let colaEnProceso = false;
async function procesarCola(){
  if (colaEnProceso || !conectado()) return;
  colaEnProceso = true;
  try {
    for (const item of await pendientes()){
      try {
        // subirFactura re-chequea duplicado contra el índice _gastos.json vigente en
        // este momento (no el de cuando se encoló), por eso no se recalcula aquí.
        const { nombre, duplicada } = await subirFactura(item.blob, item.datos);
        await eliminar(item.id);
        toast(duplicada ? `Cola: ${nombre} subida — marcada como DUPLICADA` : `Cola: ${nombre} subida ✓`);
      } catch(e){ break; }
    }
  } finally {
    colaEnProceso = false;
    actualizarBadge();
  }
}
window.addEventListener('online', procesarCola);
actualizarBadge();

// DECISION DE ARI (2026-07-21): el revisor con Gemini en BACKGROUND se elimino para
// proteger la cuota gratis (llamaba a la IA por cada pendiente en cada apertura/conexion
// y reintentaba fallidas). La IA solo corre: (a) al capturar/importar una foto nueva
// (leerDatosDeFactura) y (b) al presionar "Leer con IA" en el panel (leerConIAAhora).
// La cola fotogastos-rev se conserva como almacen del blob para ese boton.

// ---------- Gastos por niveles de carpeta (Fase 4) ----------
// Acordeon de la carpeta matriz: secciones de mes (desc, actual expandido), otras
// subcarpetas y «Carpeta principal» (sueltos en la raiz). El contenido se carga al
// expandir. Cada seccion concilia su indice con los archivos reales: entradas perdidas
// se restauran desde la description del archivo; imagenes sin datos = "Sin procesar".
const seccionesAbiertas = new Set([nombreCarpetaMes(hoyISO())]);
const ES_MES = /^\d{4}-\d{2}_/;

function filaFactura(ctx, e, nombre){
  const CHIP_ESTADO = { incompleta: ['warn', 'Datos incompletos'], pendiente: ['info', 'Pendiente de revisión'] };
  const inv = document.createElement('div');
  inv.className = (e && e.duplicada) ? 'inv dup' : 'inv';
  const thumb = document.createElement('div'); thumb.className = 'thumb'; thumb.textContent = 'JPG';
  const info = document.createElement('div');
  const nm = document.createElement('div'); nm.className = 'nm num'; nm.textContent = nombre;
  info.appendChild(nm);
  if (e && (e.fechaEmision || e.nombreComercio)){
    const dt = document.createElement('div'); dt.className = 'dt num';
    dt.textContent = [e.fechaEmision, e.nombreComercio].filter(Boolean).join(' · ');
    info.appendChild(dt);
  }
  const amt = document.createElement('div'); amt.className = 'amt';
  if (e && e.total != null){
    const b = document.createElement('b'); b.className = 'num';
    b.textContent = 'RD$ ' + Number(e.total).toLocaleString('es-DO', { minimumFractionDigits: 2 });
    amt.appendChild(b);
  }
  const chip = document.createElement('span');
  chip.style.cssText = 'margin-top:4px; font-size:10px; padding:2px 8px';
  if (!e){
    chip.className = 'chip warn';
    chip.innerHTML = '<span class="dot"></span>Sin procesar';
    amt.appendChild(chip);
  } else if (CHIP_ESTADO[e.estado]){
    const est = CHIP_ESTADO[e.estado];
    chip.className = 'chip ' + est[0];
    chip.innerHTML = '<span class="dot"></span>' + est[1];
    amt.appendChild(chip);
  }
  inv.style.cursor = 'pointer';
  if (e){
    inv.addEventListener('click', () => { window.__gastosMes = ctx; abrirRevisar(e.archivo); });
  } else {
    inv.addEventListener('click', () => procesarAjena(ctx, nombre));
  }
  // Mantener presionado (600 ms) = eliminar, SOLO para filas con etiqueta de alerta
  // (sin procesar, pendiente, incompleta, duplicada). Las completas son registro fiscal.
  if (!e || e.estado !== 'completa' || e.duplicada){
    let timer = null;
    const armar = () => { timer = setTimeout(() => { timer = null; eliminarFactura(ctx, e, nombre); }, 600); };
    const soltar = () => { if (timer){ clearTimeout(timer); timer = null; } };
    inv.addEventListener('pointerdown', armar);
    inv.addEventListener('pointerup', soltar);
    inv.addEventListener('pointermove', soltar);
    inv.addEventListener('pointercancel', soltar);
    inv.addEventListener('contextmenu', ev => ev.preventDefault()); // iOS long-press
  }
  inv.appendChild(thumb); inv.appendChild(info);
  if (amt.childNodes.length) inv.appendChild(amt);
  return inv;
}

// Elimina una factura no-completa: archivo a la papelera de Drive (recuperable 30 dias),
// fuera del indice (bajo el mutex) y de la cola local de revision si estaba ahi.
async function eliminarFactura(ctx, e, nombre){
  const etiqueta = e ? (e.duplicada ? 'duplicada' : e.estado) : 'sin procesar';
  if (!confirm(`¿Eliminar «${nombre}» (${etiqueta})? La imagen irá a la papelera de Drive.`)) return;
  try {
    const fileId = (e && e.driveId) || ctx.idPorNombre?.get(nombre) || await buscarArchivo(ctx.mesId, nombre);
    if (fileId) await moverAPapelera(fileId);
    if (e){
      await conLockIndice(async () => {
        const idx = await leerJSON(ctx.mesId, '_gastos.json');
        if (idx) await guardarJSON(ctx.mesId, '_gastos.json', quitarEntrada(idx, nombre));
      });
      try {
        const item = (await pendientesRevision()).find(x => x.archivo === nombre);
        if (item) await eliminarRevision(item.id);
      } catch(err){ console.error(err); }
    }
    toast(`«${nombre}» eliminada — recuperable en la papelera de Drive`);
    refrescarGastos();
  } catch(err){ console.error(err); toast('No se pudo eliminar: ' + err.message); }
}

async function renderSeccion(carpeta, bodyEl, metaEl){
  bodyEl.innerHTML = '<div class="gem-note">Cargando…</div>';
  try {
    const archivos = await listarArchivos(carpeta.id);
    const idx = carpeta.esMes ? await leerJSON(carpeta.id, '_gastos.json').catch(() => null) : null;
    const conc = conciliarIndice(idx, archivos);
    // Persistir restauraciones (bajo el mutex, re-leyendo fresco para no pisar a nadie).
    if (carpeta.esMes && conc.restauradas.length){
      conLockIndice(async () => {
        let vivo = await leerJSON(carpeta.id, '_gastos.json');
        const hay = new Set((vivo?.facturas || []).map(f => f.archivo));
        let cambio = false;
        for (const r of conc.restauradas){
          if (!hay.has(r.archivo)){ vivo = agregarEntrada(vivo, r); cambio = true; }
        }
        if (cambio) await guardarJSON(carpeta.id, '_gastos.json', vivo);
      }).catch(e => console.error(e));
      toast(`Se restauraron ${conc.restauradas.length} factura(s) del índice de ${carpeta.name}`);
    }
    const ctx = { mesId: carpeta.id, idx: conc.indice, carpetaNombre: carpeta.name, esMes: carpeta.esMes };
    const idPorNombre = new Map(archivos.map(a => [a.name, a.id]));
    ctx.idPorNombre = idPorNombre;
    const entradas = (conc.indice?.facturas || []);
    const num = n => { const m = String(n).match(/^Compra_(\d+)/i); return m ? parseInt(m[1], 10) : -1; };
    entradas.sort((a, b) => num(b.archivo) - num(a.archivo));
    bodyEl.innerHTML = '';
    if (!entradas.length && !conc.sinProcesar.length){
      bodyEl.innerHTML = '<div class="gem-note">Sin facturas aquí.</div>';
    }
    for (const n of conc.sinProcesar) bodyEl.appendChild(filaFactura(ctx, null, n)); // primero lo que pide accion
    for (const e of entradas) bodyEl.appendChild(filaFactura(ctx, e, e.archivo));
    if (carpeta.esMes){
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.style.cssText = 'margin-top:12px; width:100%';
      btn.textContent = 'Generar documento de Gastos';
      btn.addEventListener('click', () => { window.__gastosMes = ctx; generarDocumento(ctx); });
      bodyEl.appendChild(btn);
    }
    const nPend = entradas.filter(f => f.estado === 'incompleta' || f.estado === 'pendiente').length;
    metaEl.textContent = `${entradas.length + conc.sinProcesar.length}` +
      (nPend ? ` · ${nPend} por revisar` : '') +
      (conc.sinProcesar.length ? ` · ${conc.sinProcesar.length} sin procesar` : '');
  } catch(e){
    console.error(e);
    bodyEl.innerHTML = '<div class="gem-note">No se pudo cargar esta carpeta.</div>';
  }
}

async function refrescarGastos(){
  const raizId = get('carpetaRaizId');
  const arbol = document.getElementById('gastos-arbol');
  if (!conectado() || !raizId){
    arbol.innerHTML = '<div class="gem-note">Conecta Google Drive en Ajustes.</div>';
    return;
  }
  try {
    // Asegura la carpeta del mes actual (las capturas nuevas van ahi) y lista el arbol.
    await asegurarCarpeta(nombreCarpetaMes(hoyISO()), raizId);
    const [carpetas, sueltosTodos] = await Promise.all([listarCarpetas(raizId), listarArchivos(raizId)]);
    const meses = carpetas.filter(c => ES_MES.test(c.name)).sort((a, b) => b.name.localeCompare(a.name));
    const otras = carpetas.filter(c => !ES_MES.test(c.name)).sort((a, b) => a.name.localeCompare(b.name));
    const sueltos = sueltosTodos.filter(a => /image\//i.test(a.mimeType || ''));
    const secciones = [
      ...meses.map(c => ({ id: c.id, name: c.name, esMes: true })),
      ...otras.map(c => ({ id: c.id, name: c.name, esMes: false }))
    ];
    if (sueltos.length) secciones.push({ id: raizId, name: 'Carpeta principal', esMes: false, soloSueltos: true });
    arbol.innerHTML = '';
    for (const sec of secciones){
      const head = document.createElement('button');
      head.className = 'acc-head';
      const abierta = seccionesAbiertas.has(sec.name);
      head.innerHTML = `<span class="acc-chev">${abierta ? '▾' : '▸'}</span><span class="acc-nom num">${sec.name}</span><span class="acc-meta num"></span>`;
      const body = document.createElement('div');
      body.className = 'acc-body';
      body.hidden = !abierta;
      const metaEl = head.querySelector('.acc-meta');
      head.addEventListener('click', async () => {
        if (body.hidden){
          seccionesAbiertas.add(sec.name);
          body.hidden = false;
          head.querySelector('.acc-chev').textContent = '▾';
          await renderSeccion(sec, body, metaEl);
        } else {
          seccionesAbiertas.delete(sec.name);
          body.hidden = true;
          head.querySelector('.acc-chev').textContent = '▸';
        }
      });
      arbol.appendChild(head);
      arbol.appendChild(body);
      if (abierta) renderSeccion(sec, body, metaEl);
    }
    if (!secciones.length) arbol.innerHTML = '<div class="gem-note">Aún no hay facturas en la carpeta.</div>';
  } catch(e){ console.error(e); }
}
document.getElementById('tab-gastos').addEventListener('click', () => { refrescarGastos(); });

// ---------- Generar documento de Gastos (Fase 3) ----------
// Ticket largo → 2 columnas con los recortes de la plantilla (sup 0–48%, inf 50–100%).
async function prepararImagen(blob){
  const canvas = await archivoACanvas(blob);
  const ratio = canvas.height / canvas.width;
  if (ratio <= RATIO_LARGA) return { ratio, partes: [blob] }; // JPEG original tal cual (mismo umbral que paginar)
  const partes = [];
  for (const [t, b] of [[0, 0.48], [0.5, 1]]){
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = Math.round(canvas.height * (b - t));
    c.getContext('2d').drawImage(canvas, 0, Math.round(canvas.height * t), canvas.width, c.height, 0, 0, canvas.width, c.height);
    partes.push(await canvasAJpeg(c));
  }
  return { ratio, partes };
}

async function generarDocumento(ctx){
  if (!conectado() || !ctx || !ctx.mesId) return toast('Conecta Google Drive para generar');
  const emp = empresaGuardada();
  if (!empresaCompleta(emp)){ toast('Configura la Empresa en Ajustes (razón social y RNC)'); show('ajustes'); return; }
  const idx = await leerJSON(ctx.mesId, '_gastos.json').catch(() => null);
  const todas = idx?.facturas || [];
  if (!todas.length) return toast('Este mes no tiene facturas registradas');
  const completas = todas.filter(f => f.estado === 'completa' && !f.duplicada);
  const sinValidar = todas.filter(f => f.estado !== 'completa').length;
  if (!completas.length) return toast('No hay facturas completas — valida las pendientes primero');
  if (sinValidar && !confirm(`Hay ${sinValidar} factura(s) sin validar. ¿Generar solo con las ${completas.length} completas?`)) return;
  const periodo = ctx.carpetaNombre.slice(0, 7);                                  // '2025-06'
  const mesTexto = `${ctx.carpetaNombre.split('_')[1]} ${periodo.slice(0, 4)}`;   // 'Junio 2025'
  const bar = document.getElementById('lote-bar'), txtBar = document.getElementById('lote-txt');
  bar.hidden = false; document.getElementById('lote-dots').innerHTML = '';
  try {
    const items = [];
    for (let i = 0; i < completas.length; i++){
      const f = completas[i];
      txtBar.textContent = `Generando — descargando ${i + 1} de ${completas.length}…`;
      const blob = thumbCache.get(f.archivo) || await descargarImagen(ctx.mesId, f.archivo);
      if (!blob){ toast(`No se pudo leer ${f.archivo}; el PDF sale sin ella`); continue; }
      thumbCache.set(f.archivo, blob);
      const prep = await prepararImagen(blob);
      items.push({ archivo: f.archivo, total: f.total, ratio: prep.ratio,
                   partes: await Promise.all(prep.partes.map(async b => new Uint8Array(await b.arrayBuffer()))) });
    }
    if (!items.length) throw new Error('no se pudo leer ninguna imagen');
    txtBar.textContent = 'Generando — armando el PDF…';
    const pdfBlob = await generarPDF(paginar(items), emp, mesTexto);
    txtBar.textContent = 'Generando — armando el Excel 606…';
    const xlsxBlob = await generarXLSX606(filas606(todas, periodo), emp, periodo, mesTexto);
    txtBar.textContent = 'Generando — subiendo a Drive…';
    const nombrePDF = `Gastos_${mesTexto.replace(' ', '_')}.pdf`;
    const nombreXLSX = `606_${mesTexto.replace(' ', '_')}.xlsx`;
    await subirOReemplazar(pdfBlob, nombrePDF, ctx.mesId);
    await subirOReemplazar(xlsxBlob, nombreXLSX, ctx.mesId);
    const archivos = [
      new File([pdfBlob], nombrePDF, { type: 'application/pdf' }),
      new File([xlsxBlob], nombreXLSX, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    ];
    if (navigator.canShare && navigator.canShare({ files: archivos })){
      try { await navigator.share({ files: archivos, title: `Gastos ${mesTexto}` }); } catch(e){ /* usuario cancelo */ }
    }
    toast(`Documento de ${mesTexto} generado y guardado en Drive ✓`);
  } catch(e){ console.error(e); toast('No se pudo generar: ' + e.message); }
  finally { bar.hidden = true; actualizarBarraLote(); }
}

// ---------- Factura ajena "Sin procesar" (Fase 4) ----------
// Imagen que llego a la carpeta por fuera de la app (Drive directo, version Lite futura):
// se descarga y entra al MISMO pipeline (recorte automatico → editor → datos IA/OCR).
// Al confirmar, el original va a la papelera (recuperable 30 dias).
async function procesarAjena(ctx, nombre){
  const fileId = ctx.idPorNombre?.get(nombre);
  if (!fileId) return toast('No se encontró el archivo en Drive');
  toast('Descargando imagen…');
  let canvas;
  try {
    const blob = await descargarPorId(fileId);
    if (!blob) return toast('No se pudo descargar la imagen');
    canvas = await archivoACanvas(blob);
  } catch(e){
    console.error(e);
    return toast('Formato no compatible en este dispositivo — conviértelo a JPG');
  }
  await cvReady();
  let esquinas = detectarDocumento(canvas, 1200);
  if (!esquinas) esquinas = await detectarConIAConOverlay(canvas);
  esquinas = await abrirEditorEsquinas(canvas, esquinas);
  window.__captura = { canvas, esquinas };
  window.__origenAjeno = { fileId, nombre }; // al confirmar: original a la papelera
  procesarYRevisar();
}

// ---------- Confirmación de una factura pendiente (panel de revisión) ----------
const RV_CAMPOS = { 'rv-fecha':'fechaEmision','rv-ncf':'ncf','rv-rnc':'rncEmisor','rv-comercio':'nombreComercio','rv-subtotal':'subtotal','rv-itbis':'itbis','rv-total':'total' };
let rvArchivo = null;

// El panel de revision corrige la entrada igual que la tarjeta de captura (tipo Excel).
Object.keys(RV_CAMPOS).forEach(id =>
  document.getElementById(id).addEventListener('change', () => normalizarCampoEntrada(id)));

// Miniaturas del panel de revision: cache por sesion para no re-descargar de Drive.
const thumbCache = new Map(); // archivo → Blob
let rvThumbURL = null;

async function cargarMiniatura(mesId, archivo){
  const img = document.getElementById('rv-thumb');
  img.hidden = true;
  if (rvThumbURL){ URL.revokeObjectURL(rvThumbURL); rvThumbURL = null; }
  try {
    let blob = thumbCache.get(archivo);
    if (!blob){
      blob = await descargarImagen(mesId, archivo);
      if (blob) thumbCache.set(archivo, blob);
    }
    if (!blob || rvArchivo !== archivo) return; // panel cerrado o cambiado mientras bajaba
    rvThumbURL = URL.createObjectURL(blob);
    img.src = rvThumbURL;
    img.hidden = false;
  } catch(e){ console.error(e); }
}
document.getElementById('rv-thumb').addEventListener('click', () => {
  const blob = thumbCache.get(rvArchivo);
  if (!blob) return;
  document.getElementById('visor-recortar').hidden = true; // imagen de Drive: sin recorte
  document.getElementById('visor-img').src = URL.createObjectURL(blob);
  document.getElementById('visor').hidden = false;
});

function rellenarPanel(f){
  document.getElementById('revisar-titulo').textContent = `Revisar ${f.archivo}`;
  for (const [id, campo] of Object.entries(RV_CAMPOS)){
    document.getElementById(id).value = f[campo] != null ? f[campo] : '';
  }
}

function abrirRevisar(archivo){
  const idx = window.__gastosMes?.idx;
  const f = idx?.facturas?.find(x => x.archivo === archivo);
  if (!f) return;
  rvArchivo = archivo;
  rellenarPanel(f);
  const esCompleta = f.estado === 'completa';
  document.getElementById('rv-leer').hidden = esCompleta;
  document.getElementById('rv-ocr').hidden = esCompleta;
  document.getElementById('rv-eliminar').hidden = esCompleta && !f.duplicada; // completas: registro fiscal
  document.getElementById('revisar-panel').hidden = false;
  cargarMiniatura(window.__gastosMes.mesId, archivo);
}
function cerrarRevisar(){
  document.getElementById('revisar-panel').hidden = true;
  rvArchivo = null;
  if (rvThumbURL){ URL.revokeObjectURL(rvThumbURL); rvThumbURL = null; }
  document.getElementById('rv-thumb').hidden = true;
}

async function confirmarRevision(){
  const ctx = window.__gastosMes;
  if (!ctx || !rvArchivo) return;
  const archivo = rvArchivo;
  const num = v => normalizarMontoTexto(v);
  const edits = {};
  for (const [id, campo] of Object.entries(RV_CAMPOS)){
    const v = document.getElementById(id).value.trim();
    edits[campo] = ['subtotal','itbis','total'].includes(campo) ? num(v) : (v || null);
  }
  const btn = document.getElementById('rv-confirmar');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    // Read-modify-write atómico: re-lee el índice fresco de Drive y aplica SOLO esta entrada.
    // Si el usuario cambió la fecha de emisión, el helper re-archiva (renombra/mueve) igual
    // que el revisor en background.
    const res = await actualizarEntradaConReArchivo(ctx.mesId, archivo, f => {
      Object.assign(f, edits);
      f.estado = facturaCompleta(f) ? 'completa' : 'incompleta';
    });
    if (!res) throw new Error('La factura ya no está en el índice');
    toast(res.movidaA ? `Guardada como ${res.nombreFinal} en ${res.movidaA} ✓`
        : res.estado === 'completa' ? 'Factura confirmada ✓' : 'Guardada — aún faltan datos');
    cerrarRevisar();
    refrescarGastos();
  } catch(e){ console.error(e); toast('No se pudo guardar: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = 'Confirmar'; }
}

async function verImagenRevision(){
  const ctx = window.__gastosMes;
  if (!ctx || !rvArchivo) return;
  toast('Cargando imagen…');
  try {
    let blob = thumbCache.get(rvArchivo);
    if (!blob){
      blob = await descargarImagen(ctx.mesId, rvArchivo);
      if (blob) thumbCache.set(rvArchivo, blob);
    }
    if (!blob) return toast('No se encontró la imagen en Drive');
    const visorImg = document.getElementById('visor-img');
    visorImg.src = URL.createObjectURL(blob);
    document.getElementById('visor-recortar').hidden = true; // imagen de Drive: sin recorte
    document.getElementById('visor').hidden = false;
  } catch(e){ console.error(e); toast('No se pudo cargar la imagen'); }
}

// Reintento manual (idea de Ari): lee ESTA factura al momento y deja el resultado
// 'pendiente' para que el usuario valide. motor 'auto' = Gemini con respaldo OCR;
// motor 'ocr' = directo al OCR local (boton "Reintentar OCR").
async function leerConIAAhora(motor = 'auto'){
  const ctx = window.__gastosMes;
  if (!ctx || !rvArchivo) return;
  const archivo = rvArchivo;
  const btn = document.getElementById(motor === 'ocr' ? 'rv-ocr' : 'rv-leer');
  const rotulo = btn.textContent;
  btn.disabled = true; btn.textContent = 'Leyendo…';
  try {
    const item = (await pendientesRevision()).find(x => x.archivo === archivo);
    let blob = item ? item.blob : thumbCache.get(archivo);
    if (!blob){
      blob = await descargarImagen(ctx.mesId, archivo);
      if (blob) thumbCache.set(archivo, blob);
    }
    if (!blob) return toast('No se encontró la imagen de la factura');
    const canvas = await archivoACanvas(blob);
    const key = get('geminiKey', '');
    let datos = null, motorUsado = null;
    if (key && motor !== 'ocr'){
      try { datos = await extraerDatos(canvas, key, geminiModelo); motorUsado = 'gemini'; }
      catch(e){
        console.error(e);
        const diag = diagnosticoGemini(e.status);
        if (diag) toast(diag);
      }
    }
    if (!datos){
      try { datos = await extraerDatosLocal(canvas, empresaGuardada().rnc); motorUsado = 'local'; }
      catch(e){ console.error(e); }
    }
    if (!datos) return toast('Sin conexión y sin OCR disponible — intenta luego');
    const res = await actualizarEntradaConReArchivo(ctx.mesId, archivo, f => {
      for (const c of ['fechaEmision', 'ncf', 'rncEmisor', 'nombreComercio', 'subtotal', 'itbis', 'total']){
        if (datos[c] != null && datos[c] !== '') f[c] = datos[c];
      }
      if (motorUsado === 'gemini') f.revisadaIA = true;
      f.estado = facturaCompleta(f) ? 'pendiente' : 'incompleta';
    });
    if (!res) return toast('La factura ya no está en el índice');
    if (item) await eliminarRevision(item.id); // ya leida: fuera de la cola de revision
    rvArchivo = res.nombreFinal;
    rellenarPanel(res.entrada);
    refrescarGastos();
    toast(motorUsado === 'local' ? 'Datos leídos con OCR — revisa bien y confirma' : 'Datos leídos — revisa y confirma');
  } catch(e){ console.error(e); toast('No se pudo leer: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = rotulo; }
}
document.getElementById('rv-leer').addEventListener('click', () => leerConIAAhora('auto'));
document.getElementById('rv-ocr').addEventListener('click', () => leerConIAAhora('ocr'));
document.getElementById('rv-eliminar').addEventListener('click', async () => {
  const ctx = window.__gastosMes;
  if (!ctx || !rvArchivo) return;
  const f = ctx.idx?.facturas?.find(x => x.archivo === rvArchivo) || null;
  const archivo = rvArchivo;
  cerrarRevisar();
  await eliminarFactura(ctx, f, archivo);
});

document.getElementById('revisar-cerrar').addEventListener('click', cerrarRevisar);
document.getElementById('rv-confirmar').addEventListener('click', confirmarRevision);
document.getElementById('rv-ver-imagen').addEventListener('click', verImagenRevision);
