// Helpers puros (testeables en Node) -------------------------------------
export function ordenarEsquinas(pts){
  const bySum  = [...pts].sort((a,b) => (a.x + a.y) - (b.x + b.y));
  const byDiff = [...pts].sort((a,b) => (a.x - a.y) - (b.x - b.y));
  return [bySum[0], byDiff[3], bySum[3], byDiff[0]]; // tl, tr, br, bl
}

export function esEstable(prev, curr, tolPx = 8){
  if (!prev || !curr) return false;
  return prev.every((p, i) => Math.hypot(p.x - curr[i].x, p.y - curr[i].y) <= tolPx);
}

export function dimensionesDestino(esquinas){
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const [tl, tr, br, bl] = esquinas;
  return {
    w: Math.round((d(tl, tr) + d(bl, br)) / 2),
    h: Math.round((d(tl, bl) + d(tr, br)) / 2)
  };
}

export function areaCuadrilatero(e){
  // fórmula del cordón (shoelace), valor absoluto
  let s = 0;
  for (let i = 0; i < e.length; i++){
    const a = e[i], b = e[(i + 1) % e.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function cuadrilateroValido(e, wFrame, hFrame){
  const areaFrame = wFrame * hFrame;
  const area = areaCuadrilatero(e);
  if (area < areaFrame * 0.12) return false;   // muy chico
  if (area > areaFrame * 0.98) return false;    // es casi todo el encuadre → falsa detección
  const lado = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const minLado = Math.min(
    lado(e[0], e[1]), lado(e[1], e[2]), lado(e[2], e[3]), lado(e[3], e[0]));
  if (minLado < Math.min(wFrame, hFrame) * 0.15) return false; // lado degenerado
  return true;
}

export function escalaTrabajo(w, h, maxLado = 700){
  return Math.min(1, maxLado / Math.max(w, h));
}

export function mapearEsquinas(pts, sx, sy){
  return pts.map(p => ({ x: p.x * sx, y: p.y * sy }));
}

// true si alguna esquina queda a menos de `margen` (fraccion) del borde del frame.
// La camara en vivo lo usa para descartar falsos positivos (fondos texturados que
// producen cuadrilateros pegados a los bordes del encuadre).
export function tocaBorde(esquinas, w, h, margen = 0.01){
  const mx = w * margen, my = h * margen;
  return esquinas.some(p => p.x <= mx || p.y <= my || p.x >= w - mx || p.y >= h - my);
}

// Requieren OpenCV (solo navegador) ---------------------------------------

// --- binarizaciones candidatas (cada una devuelve un Mat nuevo; el llamador lo libera) ---
function cerrarYAbrir(th){
  // Cierre: rellena huecos del texto para que el papel sea una sola mancha solida.
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
  try {
    cv.morphologyEx(th, th, cv.MORPH_CLOSE, k);
    cv.morphologyEx(th, th, cv.MORPH_OPEN, k);
  } finally { k.delete(); }
}
function binOtsu(gray){
  const th = new cv.Mat();
  cv.threshold(gray, th, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  cerrarYAbrir(th);
  return th;
}
function binAdaptativa(gray){
  const th = new cv.Mat();
  cv.adaptiveThreshold(gray, th, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 51, 10);
  cerrarYAbrir(th);
  return th;
}
function binCanny(gray){
  const th = new cv.Mat();
  cv.Canny(gray, th, 50, 150);
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  try { cv.dilate(th, th, k); } finally { k.delete(); }
  return th;
}

// Intenta reducir un contorno a 4 esquinas: primero el contorno directo y, si sale con
// mas vertices (bordes ondulados, esquinas redondeadas), su casco convexo con epsilon
// creciente. La guarda de solidez evita dar por recibo una madeja de bordes fusionados
// (p. ej. papel + brillo del fondo unidos por el dilate), cuyo casco seria basura.
function aCuatroEsquinas(c, area, rescate = true){
  let approx = new cv.Mat();
  try {
    cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true);
    if (approx.rows === 4 && cv.isContourConvex(approx)) return leerPuntos(approx);
  } finally { approx.delete(); }
  if (!rescate) return null; // camara en vivo: criterio estricto, sin casco convexo
  let hull;
  try {
    hull = new cv.Mat();
    cv.convexHull(c, hull);
    if (area / cv.contourArea(hull) < 0.8) return null; // poco solido: no es un papel
    const per = cv.arcLength(hull, true);
    for (const e of [0.02, 0.04, 0.08]){
      const ap = new cv.Mat();
      try {
        cv.approxPolyDP(hull, ap, e * per, true);
        if (ap.rows === 4 && cv.isContourConvex(ap)) return leerPuntos(ap);
      } finally { ap.delete(); }
    }
    return null;
  } finally { if (hull) hull.delete(); }
}

function leerPuntos(approx){
  const pts = [];
  for (let j = 0; j < 4; j++)
    pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
  return pts;
}

// Mayor cuadrilatero convexo del binario, en coords del canvas ORIGINAL (o null).
function cuadrilateroDeBinaria(th, escala, minArea, rescate = true){
  let contours, hier;
  try {
    contours = new cv.MatVector();
    hier = new cv.Mat();
    cv.findContours(th, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let mejor = null, mejorArea = minArea;
    for (let i = 0; i < contours.size(); i++){
      let c;
      try {
        c = contours.get(i);
        const area = cv.contourArea(c);
        if (area > mejorArea){
          const pts = aCuatroEsquinas(c, area, rescate);
          if (pts){
            mejorArea = area;
            mejor = pts.map(p => ({ x: p.x / escala, y: p.y / escala }));
          }
        }
      } finally {
        if (c) c.delete();
      }
    }
    return mejor;
  } finally {
    if (hier) hier.delete();
    if (contours) contours.delete();
  }
}

export function detectarDocumento(srcCanvas, maxLado = 700, opciones = {}){
  const { rescate = true } = opciones;
  const escala = escalaTrabajo(srcCanvas.width, srcCanvas.height, maxLado);
  const w = Math.round(srcCanvas.width * escala), h = Math.round(srcCanvas.height * escala);
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  small.getContext('2d').drawImage(srcCanvas, 0, 0, w, h);
  let mat, gray;
  try {
    mat = cv.imread(small);
    gray = new cv.Mat();
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    // Cascada: Otsu (fondos lisos oscuros) → adaptativa (brillos parejos) → Canny
    // (fondos claros/texturados como metal, donde un umbral global no separa el papel).
    for (const bin of [binOtsu, binAdaptativa, binCanny]){
      let th;
      try {
        th = bin(gray);
        const pts = cuadrilateroDeBinaria(th, escala, w * h * 0.12, rescate);
        if (pts){
          const ordenado = ordenarEsquinas(pts);
          if (cuadrilateroValido(ordenado, srcCanvas.width, srcCanvas.height)) return ordenado;
        }
      } finally { if (th) th.delete(); }
    }
    return null;
  } finally {
    if (gray) gray.delete();
    if (mat) mat.delete();
  }
}

// Mascara binaria (canvas) → 4 esquinas en coords de la imagen original. La usa el
// motor IA (Fase 2E): la mascara de U2-Net-p es limpia, asi que el contorno mayor +
// rescate bastan; se valida con la misma guarda que la deteccion clasica.
export function esquinasDeMascara(maskCanvas, wOrig, hOrig){
  let mat, gray, kernel, contours, hier;
  try {
    mat = cv.imread(maskCanvas);
    gray = new cv.Mat();
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
    cv.morphologyEx(gray, gray, cv.MORPH_CLOSE, kernel);
    cv.threshold(gray, gray, 127, 255, cv.THRESH_BINARY);
    contours = new cv.MatVector();
    hier = new cv.Mat();
    cv.findContours(gray, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let mejor = null, mejorArea = maskCanvas.width * maskCanvas.height * 0.05;
    for (let i = 0; i < contours.size(); i++){
      let c;
      try {
        c = contours.get(i);
        const area = cv.contourArea(c);
        if (area > mejorArea){
          const pts = aCuatroEsquinas(c, area);
          if (pts){ mejorArea = area; mejor = pts; }
        }
      } finally { if (c) c.delete(); }
    }
    if (!mejor) return null;
    const ordenado = ordenarEsquinas(
      mapearEsquinas(mejor, wOrig / maskCanvas.width, hOrig / maskCanvas.height));
    return cuadrilateroValido(ordenado, wOrig, hOrig) ? ordenado : null;
  } finally {
    if (kernel) kernel.delete();
    if (hier) hier.delete();
    if (contours) contours.delete();
    if (gray) gray.delete();
    if (mat) mat.delete();
  }
}

export function nitidez(canvas){
  let mat, gray, lap, mean, std;
  try {
    mat = cv.imread(canvas);
    gray = new cv.Mat();
    lap = new cv.Mat();
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    cv.Laplacian(gray, lap, cv.CV_64F);
    mean = new cv.Mat();
    std = new cv.Mat();
    cv.meanStdDev(lap, mean, std);
    return std.data64F[0] ** 2;
  } finally {
    if (mat) mat.delete();
    if (gray) gray.delete();
    if (lap) lap.delete();
    if (mean) mean.delete();
    if (std) std.delete();
  }
}

export function boundingBox(esquinas){
  const xs = esquinas.map(p => p.x), ys = esquinas.map(p => p.y);
  const x = Math.floor(Math.min(...xs)), y = Math.floor(Math.min(...ys));
  const w = Math.max(1, Math.ceil(Math.max(...xs)) - x);
  const h = Math.max(1, Math.ceil(Math.max(...ys)) - y);
  return { x, y, w, h };
}

// Nitidez (varianza del Laplaciano) medida SOLO dentro del papel detectado.
// Así una factura pequeña sobre fondo liso no queda penalizada por el fondo.
export function nitidezRegion(canvas, esquinas){
  if (!esquinas) return nitidez(canvas);
  const bb = boundingBox(esquinas);
  const cx = Math.max(0, Math.min(bb.x, canvas.width - 1));
  const cy = Math.max(0, Math.min(bb.y, canvas.height - 1));
  const cw = Math.max(1, Math.min(bb.w, canvas.width - cx));
  const ch = Math.max(1, Math.min(bb.h, canvas.height - cy));
  const recorte = document.createElement('canvas');
  recorte.width = cw; recorte.height = ch;
  recorte.getContext('2d').drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
  return nitidez(recorte);
}
