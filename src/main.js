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
import { extraerDatos } from './gemini.js';
import { extraerDatosLocal } from './ocrlocal.js';
import { ncfValido, normalizarFecha, buscarDuplicado, montoValido, facturaCompleta } from './validacion.js';
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

iniciarCamara(video)
  .then(() => { statusTxt.textContent = 'Buscando documento…'; })
  .catch(err => {
    statusTxt.textContent = 'Sin acceso a la cámara';
    toast('Permite el acceso a la cámara para capturar facturas');
    console.error(err);
  });

// Recuperar cámara al volver de background (iOS suele terminar el track).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const track = video.srcObject && video.srcObject.getVideoTracks()[0];
  if (!track || track.readyState === 'ended'){
    iniciarCamara(video).catch(err => {
      statusTxt.textContent = 'Sin acceso a la cámara';
      console.error(err);
    });
  }
});

document.getElementById('shutter').addEventListener('click', () => {
  if (disparando) return;
  if (!video.videoWidth) return toast('La cámara no está lista');
  const canvas = capturarFrame(video);
  window.__captura = { canvas, esquinas: ultimasEsquinas };
  const fx = document.getElementById('flashfx');
  fx.classList.remove('go'); void fx.offsetWidth; fx.classList.add('go');
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
  const num = v => { const n = parseFloat(String(v).trim().replace(',', '.')); return Number.isFinite(n) ? n : null; };
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
        // Si el error es de credenciales/cuota (no de red), avisar que revise la API key
        // en vez de degradar en silencio; igual se cae a OCR local para no bloquear.
        if (/\b(400|401|403|429)\b/.test(e.message || '')) toast('Problema con la API key de Gemini — revísala en Ajustes');
        origen.textContent = 'Leyendo (OCR local)…';
        datos = await extraerDatosLocal(canvas); motor = 'local';
      } finally { abortLectura = null; }
    } else {
      datos = await extraerDatosLocal(canvas); motor = 'local';
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

CAMPOS_IDS.forEach(id => document.getElementById(id).addEventListener('change', () => validarCampos()));

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
initEditorEsquinas();

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
import { detectarDocumento, esEstable, nitidezRegion } from './detect.js';
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
    // Importacion: no es tiempo real, se trabaja a mayor resolucion para acertar mas.
    let esquinas = detectarDocumento(canvas, 1200);
    if (!esquinas){
      // Comportamiento Adobe Scan: si no hay deteccion, se muestran las esquinas para confirmar.
      esquinas = await abrirEditorEsquinas(canvas, null);
    }
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
      const esquinas = detectarDocumento(frame);
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
const inpCarpeta = document.getElementById('inp-carpeta');
inpClient.value = get('clientId', '');
inpCarpeta.value = get('carpetaRaiz', 'Gastos_NCF');
inpClient.addEventListener('change', () => set('clientId', inpClient.value.trim()));
inpCarpeta.addEventListener('change', () => { set('carpetaRaiz', inpCarpeta.value.trim() || 'Gastos_NCF'); set('carpetaRaizId', null); });

const inpGemini = document.getElementById('inp-gemini');
inpGemini.value = get('geminiKey', '');
inpGemini.addEventListener('change', () => set('geminiKey', inpGemini.value.trim()));

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
         buscarArchivo, moverYRenombrar, nombreDe } from './drive.js';

document.getElementById('btn-conectar').addEventListener('click', async () => {
  const btn = document.getElementById('btn-conectar');
  const clientId = get('clientId', '');
  if (!clientId) return toast('Pega primero tu Client ID de Google');
  btn.disabled = true;
  try {
    initAuth(clientId);
    await conectar();
    const raizId = await asegurarCarpeta(get('carpetaRaiz', 'Gastos_NCF'));
    set('carpetaRaizId', raizId);
    document.getElementById('drive-estado').textContent =
      `Conectado ✓ — carpeta «${get('carpetaRaiz', 'Gastos_NCF')}» lista`;
    document.getElementById('gastos-sub').textContent = 'Google Drive · conectado';
    toast('Google Drive conectado');
    refrescarGastos();
    procesarCola();
    revisarPendientes(); // re-lee con Gemini las facturas pendientes al conectar
  } catch(e){
    console.error(e);
    toast('No se pudo conectar: ' + e.message);
  } finally {
    btn.disabled = false;
  }
});

// Confirmar y subir + pantalla Gastos (Task 10)
import { nombreCarpetaMes, siguienteNombre, hoyISO,
         nombreProvisional, nombreUnico, esProvisional, necesitaReArchivo } from './naming.js';

// Cola offline en IndexedDB con reintento al reconectar (Task 11)
import { encolar, pendientes, eliminar, cuenta } from './queue.js';

// Índice _gastos.json por mes (Task 5): archiva por fecha de EMISIÓN (con respaldo a
// la fecha del dispositivo), registra metadatos y marca duplicados sin bloquear la subida.
import { agregarEntrada, entradaDeFactura, quitarEntrada } from './indice.js';

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
    const subida = await subirJPEG(blob, nombre, mesId);
    // El índice registra la fecha REALMENTE usada para archivar (fechaISO o ninguna), no el
    // texto crudo: siempre coincide con la carpeta donde quedó el archivo — trazabilidad 606.
    const entrada = entradaDeFactura(nombre, { ...datos, fechaEmision: fechaISO }, datos.origen || 'manual', !!dup);
    entrada.driveId = subida.id; // permite re-archivar sin buscar por nombre (idempotente)
    if (!fechaISO){ entrada.estado = 'pendiente'; entrada.provisional = true; }
    await guardarJSON(mesId, '_gastos.json', agregarEntrada(idx, entrada));
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
      return { nombreFinal: archivo, estado: f.estado, movidaA: null };
    }
    const carpetaDestino = nombreCarpetaMes(fechaISO);
    const destinoId = carpetaDestino === carpetaActual ? mesId
                    : await asegurarCarpeta(carpetaDestino, get('carpetaRaizId'));
    const nombreFinal = siguienteNombre(fechaISO, await listarNombres(destinoId));
    const fileId = f.driveId || await buscarArchivo(mesId, archivo);
    if (!fileId) throw new Error('No se encontró ' + archivo + ' en Drive');
    await moverYRenombrar(fileId, nombreFinal, destinoId, mesId);
    // OJO: entrada NUEVA sin mutar `f`, para que quitarEntrada (nombre viejo) si la elimine.
    const entradaFinal = { ...f, archivo: nombreFinal };
    delete entradaFinal.provisional;
    if (destinoId === mesId){
      await guardarJSON(mesId, '_gastos.json', agregarEntrada(quitarEntrada(idx, archivo), entradaFinal));
    } else {
      const idxDest = await leerJSON(destinoId, '_gastos.json');
      entradaFinal.duplicada = entradaFinal.duplicada || !!buscarDuplicado(idxDest, entradaFinal.ncf);
      await guardarJSON(destinoId, '_gastos.json', agregarEntrada(idxDest, entradaFinal));
      await guardarJSON(mesId, '_gastos.json', quitarEntrada(idx, archivo));
    }
    return { nombreFinal, estado: entradaFinal.estado, movidaA: destinoId === mesId ? null : carpetaDestino };
  });
}

document.getElementById('confirm-btn').addEventListener('click', async () => {
  const res = window.__resultado;
  if (!res) return;
  // Guardar durante la lectura: se cancela la peticion en vuelo y la factura sube como
  // provisional (origen 'cargando'); la IA en background la lee y la re-archiva despues.
  if (abortLectura){ abortLectura.abort(); abortLectura = null; setCamposHabilitados(true); }
  const canvas = res.canvasFinal || res.canvasOriginal;
  // Se congelan los datos ANTES del await de la subida: si el usuario edita los campos
  // mientras la factura sube, no queremos que un cambio a mitad de camino contamine
  // el registro fiscal que se está escribiendo en _gastos.json.
  const datos = window.__datos || {};
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

// Revisor con Gemini: al abrir la app con conexión + API key, re-lee las facturas de la
// cola de revisión (incompletas o de OCR local), rellena con Gemini y las deja "pendiente"
// (a la espera de que el usuario confirme). Una PWA no corre esto con la app cerrada.
let revisando = false;
async function revisarPendientes(){
  if (revisando || !conectado()) return;
  const key = get('geminiKey', '');
  if (!key) return;
  revisando = true; // síncrono, antes de cualquier await: evita dos corridas en paralelo
  try {
    const items = await pendientesRevision();
    for (const item of items){
      let canvas;
      try { canvas = await archivoACanvas(item.blob); }
      catch(e){ // imagen ilegible: no dejar que bloquee la cola; descartar tras 3 intentos
        console.error(e);
        const intentos = (item.intentos || 0) + 1;
        await eliminarRevision(item.id);
        if (intentos < 3) await encolarRevision({ blob: item.blob, mesId: item.mesId, archivo: item.archivo, intentos });
        continue;
      }
      let datos = null;
      try { datos = await extraerDatos(canvas, key, geminiModelo); }
      catch(e){ console.error(e); break; } // error de red/HTTP con Gemini: reintentar todo luego
      try {
        // read-modify-write atómico contra el índice VIGENTE en Drive; si Gemini fijó la
        // fecha, el helper renombra/mueve el archivo (Pendiente_… → Compra_DDN en su mes).
        await actualizarEntradaConReArchivo(item.mesId, item.archivo, f => {
          if (datos){
            for (const c of ['fechaEmision', 'ncf', 'rncEmisor', 'nombreComercio', 'subtotal', 'itbis', 'total']){
              if (datos[c] != null && datos[c] !== '') f[c] = datos[c];
            }
          }
          f.revisadaIA = true;
          f.estado = facturaCompleta(f) ? 'pendiente' : 'incompleta'; // el usuario confirma después
        });
        await eliminarRevision(item.id);
      } catch(e){ console.error(e); break; } // fallo de Drive: reintentar en la próxima corrida
    }
  } finally {
    revisando = false;
    if (document.getElementById('scr-gastos').classList.contains('active')) refrescarGastos();
  }
}
window.addEventListener('online', revisarPendientes);

async function refrescarGastos(){
  const raizId = get('carpetaRaizId');
  const carpetaMes = nombreCarpetaMes(hoyISO());
  document.getElementById('mes-nombre').textContent = carpetaMes;
  if (!conectado() || !raizId) return;
  try {
    const mesId = await asegurarCarpeta(carpetaMes, raizId);
    // El índice es opcional (mes recién creado o _gastos.json aún inexistente); si falla
    // la lectura, se sigue mostrando la lista sin el marcado de duplicadas.
    const [nombres, idx] = await Promise.all([
      listarNombres(mesId).then(ns => ns.filter(n => /^(Compra|Pendiente)_/i.test(n))),
      leerJSON(mesId, '_gastos.json').catch(() => null)
    ]);
    const entradaPorArchivo = new Map((idx?.facturas || []).map(f => [f.archivo, f]));
    window.__gastosMes = { mesId, idx }; // contexto para confirmar una factura pendiente
    const num = n => { const m = n.match(/^Compra_(\d+)/i); return m ? parseInt(m[1], 10) : -1; };
    nombres.sort((a, b) => num(b) - num(a));
    const nPend = (idx?.facturas || []).filter(f => f.estado === 'incompleta' || f.estado === 'pendiente').length;
    document.getElementById('mes-meta').textContent =
      `${nombres.length} facturas este mes` + (nPend ? ` · ${nPend} por revisar` : '');
    const lista = document.getElementById('lista-mes');
    lista.innerHTML = '';
    if (!nombres.length){
      lista.innerHTML = '<div class="gem-note">Aún no hay facturas este mes.</div>';
    } else {
      const CHIP_ESTADO = { incompleta: ['warn', 'Datos incompletos'], pendiente: ['info', 'Pendiente de revisión'] };
      nombres.forEach(n => {
        const e = entradaPorArchivo.get(n);
        const inv = document.createElement('div');
        inv.className = (e && e.duplicada) ? 'inv dup' : 'inv';
        const thumb = document.createElement('div'); thumb.className = 'thumb'; thumb.textContent = 'JPG';
        const info = document.createElement('div');
        const nm = document.createElement('div'); nm.className = 'nm num'; nm.textContent = n;
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
        const est = e && CHIP_ESTADO[e.estado];
        if (est){
          const chip = document.createElement('span');
          chip.className = 'chip ' + est[0];
          chip.style.cssText = 'margin-top:4px; font-size:10px; padding:2px 8px';
          chip.innerHTML = '<span class="dot"></span>' + est[1];
          amt.appendChild(chip);
        }
        if (e){ // toda factura con entrada en el indice se puede abrir y editar
          inv.style.cursor = 'pointer';
          inv.addEventListener('click', () => abrirRevisar(e.archivo));
        }
        inv.appendChild(thumb); inv.appendChild(info);
        if (amt.childNodes.length) inv.appendChild(amt);
        lista.appendChild(inv);
      });
    }
  } catch(e){ console.error(e); }
}
document.getElementById('tab-gastos').addEventListener('click', () => { refrescarGastos(); revisarPendientes(); });

// ---------- Confirmación de una factura pendiente (panel de revisión) ----------
const RV_CAMPOS = { 'rv-fecha':'fechaEmision','rv-ncf':'ncf','rv-rnc':'rncEmisor','rv-comercio':'nombreComercio','rv-subtotal':'subtotal','rv-itbis':'itbis','rv-total':'total' };
let rvArchivo = null;

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

function abrirRevisar(archivo){
  const idx = window.__gastosMes?.idx;
  const f = idx?.facturas?.find(x => x.archivo === archivo);
  if (!f) return;
  rvArchivo = archivo;
  document.getElementById('revisar-titulo').textContent = `Revisar ${archivo}`;
  for (const [id, campo] of Object.entries(RV_CAMPOS)){
    document.getElementById(id).value = f[campo] != null ? f[campo] : '';
  }
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
  const num = v => { const n = parseFloat(String(v).trim().replace(',', '.')); return Number.isFinite(n) ? n : null; };
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

document.getElementById('revisar-cerrar').addEventListener('click', cerrarRevisar);
document.getElementById('rv-confirmar').addEventListener('click', confirmarRevision);
document.getElementById('rv-ver-imagen').addEventListener('click', verImagenRevision);
