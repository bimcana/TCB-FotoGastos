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
import { procesar, canvasAJpeg } from './process.js';

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

function procesarYRevisar(){
  const { canvas, esquinas } = window.__captura;
  let procesado = null;
  if (esquinas){
    try { procesado = procesar(canvas, esquinas); }
    catch(e){ console.error(e); toast('No se pudo procesar; ajusta las esquinas'); }
  }
  window.__resultado = { canvasProcesado: procesado, canvasOriginal: canvas, esquinas };
  pintarEnRevision(procesado || canvas);
  document.getElementById('rev-file').textContent = procesado ? 'Ortofoto · auto-color' : 'Sin detección — ajusta las esquinas';
  document.getElementById('seg-proc').classList.toggle('on', !!procesado);
  document.getElementById('seg-orig').classList.toggle('on', !procesado);
  show('revision');
}
window.procesarYRevisar = procesarYRevisar;

document.getElementById('seg-proc').addEventListener('click', () => {
  if (!window.__resultado) return;
  if (window.__resultado.canvasProcesado){ pintarEnRevision(window.__resultado.canvasProcesado);
    document.getElementById('seg-proc').classList.add('on'); document.getElementById('seg-orig').classList.remove('on'); }
  else { toast('Aún no hay versión procesada — aplica las esquinas'); }
});
document.getElementById('seg-orig').addEventListener('click', () => {
  if (!window.__resultado) return;
  pintarEnRevision(window.__resultado.canvasOriginal);
  document.getElementById('seg-orig').classList.add('on'); document.getElementById('seg-proc').classList.remove('on');
});

// Arrastre de 4 esquinas sobre la imagen original; al soltar se reprocesa.
const esqCanvas = document.getElementById('rev-esquinas');
let editandoEsquinas = false, esquinasEdit = null, puntoActivo = -1;

document.getElementById('btn-esquinas').addEventListener('click', () => {
  if (!window.__resultado) return;
  if (editandoEsquinas){
    editandoEsquinas = false;
    esqCanvas.style.display = 'none';
    document.getElementById('btn-esquinas').textContent = 'Ajustar esquinas manualmente';
    window.__captura.esquinas = ordenarEsquinas(esquinasEdit);
    procesarYRevisar();
    return;
  }
  const { canvasOriginal, esquinas } = window.__resultado;
  editandoEsquinas = true;
  const m = 0.1;
  esquinasEdit = (esquinas || [
    {x: canvasOriginal.width*m,     y: canvasOriginal.height*m},
    {x: canvasOriginal.width*(1-m), y: canvasOriginal.height*m},
    {x: canvasOriginal.width*(1-m), y: canvasOriginal.height*(1-m)},
    {x: canvasOriginal.width*m,     y: canvasOriginal.height*(1-m)}
  ]).map(p => ({...p}));
  pintarEnRevision(canvasOriginal);
  esqCanvas.style.display = 'block';
  document.getElementById('btn-esquinas').textContent = 'Aplicar esquinas';
  document.getElementById('rev-file').textContent = 'Ajustando esquinas — arrastra los 4 puntos';
  document.getElementById('seg-orig').classList.add('on');
  document.getElementById('seg-proc').classList.remove('on');
  dibujarEsquinas();
});

function dibujarEsquinas(){
  const rev = document.getElementById('rev-canvas');
  esqCanvas.width = rev.width; esqCanvas.height = rev.height;
  const ctx = esqCanvas.getContext('2d');
  ctx.clearRect(0, 0, esqCanvas.width, esqCanvas.height);
  ctx.beginPath();
  esquinasEdit.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
  ctx.strokeStyle = '#4E9BEB'; ctx.lineWidth = esqCanvas.width * 0.006; ctx.stroke();
  esquinasEdit.forEach(p => {
    ctx.beginPath(); ctx.arc(p.x, p.y, esqCanvas.width * 0.03, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(78,155,235,.9)'; ctx.fill();
  });
}

function puntoDesdeEvento(ev){
  const r = esqCanvas.getBoundingClientRect();
  return { x: (ev.clientX - r.left) * esqCanvas.width / r.width,
           y: (ev.clientY - r.top) * esqCanvas.height / r.height };
}
function empezarArrastre(ev){
  if (!editandoEsquinas) return;
  const p = puntoDesdeEvento(ev);
  puntoActivo = esquinasEdit.findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) < esqCanvas.width * 0.08);
}
function mover(ev){
  if (puntoActivo < 0) return;
  ev.preventDefault();
  esquinasEdit[puntoActivo] = puntoDesdeEvento(ev);
  dibujarEsquinas();
}
function soltar(){
  if (puntoActivo < 0) return;
  puntoActivo = -1;
}
esqCanvas.addEventListener('pointerdown', empezarArrastre);
esqCanvas.addEventListener('pointermove', mover);
esqCanvas.addEventListener('pointerup', soltar);

import { cvReady } from './cvready.js';
import { detectarDocumento, esEstable, nitidezRegion, ordenarEsquinas } from './detect.js';

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
import { get, set } from './settings.js';

const inpClient = document.getElementById('inp-clientid');
const inpCarpeta = document.getElementById('inp-carpeta');
inpClient.value = get('clientId', '');
inpCarpeta.value = get('carpetaRaiz', 'Gastos_NCF');
inpClient.addEventListener('change', () => set('clientId', inpClient.value.trim()));
inpCarpeta.addEventListener('change', () => { set('carpetaRaiz', inpCarpeta.value.trim() || 'Gastos_NCF'); set('carpetaRaizId', null); });

// Conexión a Google Drive (Task 9)
import { initAuth, conectar, conectado, asegurarCarpeta, listarNombres, subirJPEG } from './drive.js';

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
  } catch(e){
    console.error(e);
    toast('No se pudo conectar: ' + e.message);
  } finally {
    btn.disabled = false;
  }
});

// Confirmar y subir + pantalla Gastos (Task 10)
import { nombreCarpetaMes, siguienteNombre, hoyISO } from './naming.js';

// Cola offline en IndexedDB con reintento al reconectar (Task 11)
import { encolar, pendientes, eliminar, cuenta } from './queue.js';

async function subirFactura(blob, fechaISO){
  const raizId = get('carpetaRaizId');
  if (!conectado() || !raizId) throw new Error('sin-conexion');
  const mesId = await asegurarCarpeta(nombreCarpetaMes(fechaISO), raizId);
  const nombre = siguienteNombre(fechaISO, await listarNombres(mesId));
  await subirJPEG(blob, nombre, mesId);
  return nombre;
}

document.getElementById('confirm-btn').addEventListener('click', async () => {
  const res = window.__resultado;
  if (!res) return;
  const canvas = res.canvasProcesado || res.canvasOriginal;
  const btn = document.getElementById('confirm-btn');
  btn.disabled = true; btn.textContent = 'Subiendo…';
  let blob;
  let lockAdquirido = false;
  try {
    blob = await canvasAJpeg(canvas);
    if (colaEnProceso){
      await encolar({ blob, fechaISO: hoyISO() });
      toast('Subida en curso — factura añadida a la cola');
      actualizarBadge();
      show('camara');
      return;
    }
    colaEnProceso = true; lockAdquirido = true;
    const nombre = await subirFactura(blob, hoyISO());
    toast(`Subida: ${nombre} ✓`);
    show('gastos');
    refrescarGastos();
  } catch(e){
    console.error(e);
    if (e.message === 'sin-conexion'){
      await encolar({ blob, fechaISO: hoyISO() });
      toast('Sin conexión con Drive — en cola; reconecta en Ajustes para subirla');
      document.getElementById('gastos-sub').textContent = 'Google Drive · reconectar en Ajustes';
      actualizarBadge();
      show('camara');
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
        const nombre = await subirFactura(item.blob, item.fechaISO);
        await eliminar(item.id);
        toast(`Cola: ${nombre} subida ✓`);
      } catch(e){ break; }
    }
  } finally {
    colaEnProceso = false;
    actualizarBadge();
  }
}
window.addEventListener('online', procesarCola);
actualizarBadge();

async function refrescarGastos(){
  const raizId = get('carpetaRaizId');
  const carpetaMes = nombreCarpetaMes(hoyISO());
  document.getElementById('mes-nombre').textContent = carpetaMes;
  if (!conectado() || !raizId) return;
  try {
    const mesId = await asegurarCarpeta(carpetaMes, raizId);
    const nombres = (await listarNombres(mesId)).filter(n => /^Compra_/i.test(n));
    const num = n => { const m = n.match(/^Compra_(\d+)/i); return m ? parseInt(m[1], 10) : -1; };
    nombres.sort((a, b) => num(b) - num(a));
    document.getElementById('mes-meta').textContent = `${nombres.length} facturas este mes`;
    const lista = document.getElementById('lista-mes');
    lista.innerHTML = '';
    if (!nombres.length){
      lista.innerHTML = '<div class="gem-note">Aún no hay facturas este mes.</div>';
    } else {
      nombres.forEach(n => {
        const inv = document.createElement('div'); inv.className = 'inv';
        const thumb = document.createElement('div'); thumb.className = 'thumb'; thumb.textContent = 'JPG';
        const info = document.createElement('div');
        const nm = document.createElement('div'); nm.className = 'nm num'; nm.textContent = n;
        info.appendChild(nm);
        inv.appendChild(thumb); inv.appendChild(info);
        lista.appendChild(inv);
      });
    }
  } catch(e){ console.error(e); }
}
document.getElementById('tab-gastos').addEventListener('click', refrescarGastos);
