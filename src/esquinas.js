// Editor de esquinas a pantalla completa con lupa (Fase 2D). Sustituye al ajuste
// en-sitio: imagen grande, 4 puntos con zona de toque amplia y lupa que amplia la
// region bajo el dedo (desplazada para que el dedo no la tape), estilo Adobe Scan.
import { ordenarEsquinas } from './detect.js';

const RADIO_TOQUE_CSS = 44; // px de pantalla alrededor de cada esquina para agarrarla
const LUPA_ZOOM = 2.5;      // aumento respecto a los pixeles del canvas original

// Lados del cuadrilatero como pares de indices de esquina (orden TL,TR,BR,BL).
const LADOS = [[0, 1], [1, 2], [2, 3], [3, 0]];

// Punto medio de cada lado: ahi viven los handles laterales (estilo Adobe Scan).
export function puntosMedios(esquinas){
  return LADOS.map(([a, b]) => ({
    x: (esquinas[a].x + esquinas[b].x) / 2,
    y: (esquinas[a].y + esquinas[b].y) / 2
  }));
}

// Desplaza un lado COMPLETO (sus dos esquinas) por (dx,dy), recortando el delta para
// que ninguna esquina salga del lienzo w x h. Muta `esquinas` y devuelve el delta
// realmente aplicado. Puro respecto al DOM: testeable en Node.
export function desplazarLado(esquinas, lado, dx, dy, w, h){
  const [a, b] = LADOS[lado];
  for (const i of [a, b]){
    dx = Math.max(-esquinas[i].x, Math.min(w - esquinas[i].x, dx));
    dy = Math.max(-esquinas[i].y, Math.min(h - esquinas[i].y, dy));
  }
  for (const i of [a, b]){
    esquinas[i] = { x: esquinas[i].x + dx, y: esquinas[i].y + dy };
  }
  return { dx, dy };
}

let estado = null; // { original, esquinas, resolve, activo, lado, prev }
const el = id => document.getElementById(id);

export function abrirEditorEsquinas(canvasOriginal, esquinasIniciales){
  return new Promise(resolve => {
    if (estado) cerrar(null); // solo un editor a la vez
    // Sin deteccion previa, las esquinas arrancan casi a MARCO COMPLETO (2%): la
    // calibracion con fotos reales mostro que ese caso es tipicamente una imagen ya
    // recortada (escaneo/WhatsApp), donde "Aplicar" sin mover nada es lo correcto.
    const m = 0.02;
    const esquinas = (esquinasIniciales || [
      { x: canvasOriginal.width * m,       y: canvasOriginal.height * m },
      { x: canvasOriginal.width * (1 - m), y: canvasOriginal.height * m },
      { x: canvasOriginal.width * (1 - m), y: canvasOriginal.height * (1 - m) },
      { x: canvasOriginal.width * m,       y: canvasOriginal.height * (1 - m) }
    ]).map(p => ({ ...p }));
    estado = { original: canvasOriginal, esquinas, resolve, activo: -1, lado: -1, prev: null };
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
  // Handles laterales: pastilla alargada en el punto medio de cada lado, orientada
  // con el lado (estilo Adobe Scan). Se dibujan ANTES que las esquinas para que estas
  // queden encima donde se toquen.
  puntosMedios(esquinas).forEach((p, i) => {
    const [a, b] = LADOS[i];
    const ang = Math.atan2(esquinas[b].y - esquinas[a].y, esquinas[b].x - esquinas[a].x);
    const L = g * 9;
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(ang);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(78,155,235,.95)'; ctx.lineWidth = g * 3.4;
    ctx.beginPath(); ctx.moveTo(-L / 2, 0); ctx.lineTo(L / 2, 0); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = g * 1.2;
    ctx.beginPath(); ctx.moveTo(-L / 2 * 0.7, 0); ctx.lineTo(L / 2 * 0.7, 0); ctx.stroke();
    ctx.restore();
  });
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
  // Prioridad a las esquinas (control fino); si no, handle lateral (mueve el lado entero).
  estado.activo = estado.esquinas.findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) < radio);
  estado.lado = estado.activo >= 0 ? -1
    : puntosMedios(estado.esquinas).findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) < radio);
  if (estado.activo >= 0 || estado.lado >= 0){
    ev.preventDefault();
    estado.prev = p;
    // La captura puede fallar con punteros ya liberados; el arrastre funciona igual.
    try { el('esq-canvas').setPointerCapture(ev.pointerId); } catch(e){}
    moverA(p, ev);
  }
}

function mover(ev){
  if (!estado || (estado.activo < 0 && estado.lado < 0)) return;
  ev.preventDefault();
  moverA(coordsCanvas(ev), ev);
}

function moverA(p, ev){
  const lienzo = el('esq-canvas');
  let foco;
  if (estado.activo >= 0){
    foco = estado.esquinas[estado.activo] = {
      x: Math.max(0, Math.min(lienzo.width, p.x)),
      y: Math.max(0, Math.min(lienzo.height, p.y))
    };
  } else {
    desplazarLado(estado.esquinas, estado.lado, p.x - estado.prev.x, p.y - estado.prev.y,
      lienzo.width, lienzo.height);
    foco = puntosMedios(estado.esquinas)[estado.lado]; // la lupa sigue al centro del lado
  }
  estado.prev = p;
  dibujar();
  dibujarLupa(foco, ev);
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
  estado.lado = -1;
  estado.prev = null;
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
