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
import { procesar } from './process.js';

const video = document.getElementById('cam-video');
const statusTxt = document.getElementById('cam-status-txt');

iniciarCamara(video)
  .then(() => { statusTxt.textContent = 'Buscando documento…'; })
  .catch(err => {
    statusTxt.textContent = 'Sin acceso a la cámara';
    toast('Permite el acceso a la cámara para capturar facturas');
    console.error(err);
  });

document.getElementById('shutter').addEventListener('click', () => {
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
  document.getElementById('rev-file').textContent = procesado ? 'Ortofoto · fondo 254' : 'Sin detección — ajusta las esquinas';
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
import { detectarDocumento, esEstable, nitidez, ordenarEsquinas } from './detect.js';

const overlay = document.getElementById('cam-overlay');
let ultimasEsquinas = null;

function dibujarOverlay(esquinas){
  const ctx = overlay.getContext('2d');
  overlay.width = video.videoWidth; overlay.height = video.videoHeight;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!esquinas) return;
  ctx.beginPath();
  esquinas.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle = 'rgba(74,143,231,.10)';
  ctx.strokeStyle = '#4E9BEB'; ctx.lineWidth = overlay.width * 0.006;
  ctx.fill(); ctx.stroke();
}

const UMBRAL_NITIDEZ = 120;   // varianza mínima del Laplaciano (ajustable en campo)
const FRAMES_ESTABLES = 8;    // ~1 s a 8 fps de análisis
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
        if (estables >= FRAMES_ESTABLES && nitidez(frame) >= UMBRAL_NITIDEZ){
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
  } catch(e){
    console.error(e);
    toast('No se pudo conectar: ' + e.message);
  } finally {
    btn.disabled = false;
  }
});

// Confirmar y subir + pantalla Gastos (Task 10)
import { nombreCarpetaMes, siguienteNombre, hoyISO } from './naming.js';
import { canvasAJpeg } from './process.js';

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
  try {
    const blob = await canvasAJpeg(canvas);
    const nombre = await subirFactura(blob, hoyISO());
    toast(`Subida: ${nombre} ✓`);
    show('gastos');
    refrescarGastos();
  } catch(e){
    console.error(e);
    toast(e.message === 'sin-conexion'
      ? 'Sin conexión a Drive — conecta en Ajustes'   // Task 11 la encola aquí
      : 'Error al subir: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmar y subir';
  }
});

async function refrescarGastos(){
  const raizId = get('carpetaRaizId');
  const carpetaMes = nombreCarpetaMes(hoyISO());
  document.getElementById('mes-nombre').textContent = carpetaMes;
  if (!conectado() || !raizId) return;
  try {
    const mesId = await asegurarCarpeta(carpetaMes, raizId);
    const nombres = (await listarNombres(mesId)).filter(n => /^Compra_/i.test(n)).sort().reverse();
    document.getElementById('mes-meta').textContent = `${nombres.length} facturas este mes`;
    document.getElementById('lista-mes').innerHTML = nombres.map(n =>
      `<div class="inv"><div class="thumb">JPG</div><div><div class="nm num">${n}</div></div></div>`).join('')
      || '<div class="gem-note">Aún no hay facturas este mes.</div>';
  } catch(e){ console.error(e); }
}
document.getElementById('tab-gastos').addEventListener('click', refrescarGastos);
