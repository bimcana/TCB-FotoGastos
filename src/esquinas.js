// Editor de esquinas a pantalla completa con lupa (Fase 2D). Sustituye al ajuste
// en-sitio: imagen grande, 4 puntos con zona de toque amplia y lupa que amplia la
// region bajo el dedo (desplazada para que el dedo no la tape), estilo Adobe Scan.
import { ordenarEsquinas } from './detect.js';

const RADIO_TOQUE_CSS = 44; // px de pantalla alrededor de cada esquina para agarrarla
const LUPA_ZOOM = 2.5;      // aumento respecto a los pixeles del canvas original

let estado = null; // { original, esquinas, resolve, activo }
const el = id => document.getElementById(id);

export function abrirEditorEsquinas(canvasOriginal, esquinasIniciales){
  return new Promise(resolve => {
    if (estado) cerrar(null); // solo un editor a la vez
    const m = 0.1;
    const esquinas = (esquinasIniciales || [
      { x: canvasOriginal.width * m,       y: canvasOriginal.height * m },
      { x: canvasOriginal.width * (1 - m), y: canvasOriginal.height * m },
      { x: canvasOriginal.width * (1 - m), y: canvasOriginal.height * (1 - m) },
      { x: canvasOriginal.width * m,       y: canvasOriginal.height * (1 - m) }
    ]).map(p => ({ ...p }));
    estado = { original: canvasOriginal, esquinas, resolve, activo: -1 };
    const lienzo = el('esq-canvas');
    lienzo.width = canvasOriginal.width; lienzo.height = canvasOriginal.height;
    el('esq-editor').hidden = false;
    dibujar();
  });
}

function cerrar(valor){
  el('esq-editor').hidden = true;
  el('esq-lupa').hidden = true;
  const r = estado && estado.resolve;
  estado = null;
  if (r) r(valor);
}

function dibujar(){
  const { original, esquinas } = estado;
  const lienzo = el('esq-canvas');
  const ctx = lienzo.getContext('2d');
  ctx.drawImage(original, 0, 0);
  // Oscurece lo que queda FUERA del recorte (regla evenodd: rect + poligono)
  ctx.beginPath();
  ctx.rect(0, 0, lienzo.width, lienzo.height);
  esquinas.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle = 'rgba(4,8,16,.45)';
  ctx.fill('evenodd');
  const g = Math.max(2, lienzo.width * 0.004);
  ctx.beginPath();
  esquinas.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
  ctx.strokeStyle = '#4E9BEB'; ctx.lineWidth = g; ctx.stroke();
  esquinas.forEach(p => {
    ctx.beginPath(); ctx.arc(p.x, p.y, g * 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(78,155,235,.95)'; ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, g * 2, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
  });
}

function coordsCanvas(ev){
  const lienzo = el('esq-canvas');
  const r = lienzo.getBoundingClientRect();
  return {
    x: (ev.clientX - r.left) * lienzo.width / r.width,
    y: (ev.clientY - r.top) * lienzo.height / r.height,
    porPx: lienzo.width / r.width // pixeles de canvas por pixel de pantalla
  };
}

function bajar(ev){
  if (!estado) return;
  const p = coordsCanvas(ev);
  const radio = RADIO_TOQUE_CSS * p.porPx;
  estado.activo = estado.esquinas.findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) < radio);
  if (estado.activo >= 0){
    ev.preventDefault();
    el('esq-canvas').setPointerCapture(ev.pointerId);
    moverA(p, ev);
  }
}

function mover(ev){
  if (!estado || estado.activo < 0) return;
  ev.preventDefault();
  moverA(coordsCanvas(ev), ev);
}

function moverA(p, ev){
  const lienzo = el('esq-canvas');
  estado.esquinas[estado.activo] = {
    x: Math.max(0, Math.min(lienzo.width, p.x)),
    y: Math.max(0, Math.min(lienzo.height, p.y))
  };
  dibujar();
  dibujarLupa(estado.esquinas[estado.activo], ev);
}

function dibujarLupa(punto, ev){
  const lupa = el('esq-lupa');
  const ctx = lupa.getContext('2d');
  const lado = lupa.width / LUPA_ZOOM; // region del original que se amplia
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, lupa.width, lupa.height);
  ctx.drawImage(estado.original,
    punto.x - lado / 2, punto.y - lado / 2, lado, lado,
    0, 0, lupa.width, lupa.height);
  ctx.strokeStyle = '#4E9BEB'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(lupa.width / 2, lupa.height / 2 - 12); ctx.lineTo(lupa.width / 2, lupa.height / 2 + 12);
  ctx.moveTo(lupa.width / 2 - 12, lupa.height / 2); ctx.lineTo(lupa.width / 2 + 12, lupa.height / 2);
  ctx.stroke();
  // Posicion: encima del dedo; si no cabe, debajo. Nunca fuera de pantalla.
  const marco = el('esq-editor').getBoundingClientRect();
  const x = Math.max(8, Math.min(marco.width - 140, ev.clientX - marco.left - 66));
  const arriba = ev.clientY - marco.top - 160;
  lupa.style.left = x + 'px';
  lupa.style.top = (arriba > 8 ? arriba : ev.clientY - marco.top + 40) + 'px';
  lupa.hidden = false;
}

function soltar(){
  if (!estado) return;
  estado.activo = -1;
  el('esq-lupa').hidden = true;
}

export function initEditorEsquinas(){
  const lienzo = el('esq-canvas');
  lienzo.addEventListener('pointerdown', bajar);
  lienzo.addEventListener('pointermove', mover);
  lienzo.addEventListener('pointerup', soltar);
  lienzo.addEventListener('pointercancel', soltar);
  el('esq-aplicar').addEventListener('click', () => estado && cerrar(ordenarEsquinas(estado.esquinas)));
  el('esq-cancelar').addEventListener('click', () => estado && cerrar(null));
}
