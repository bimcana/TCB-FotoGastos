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

// Angulos internos del cuadrilatero, en grados (orden tl,tr,br,bl).
export function angulosInternos(e){
  const out = [];
  for (let i = 0; i < 4; i++){
    const a = e[(i + 3) % 4], b = e[i], c = e[(i + 1) % 4];
    const v1 = { x: a.x - b.x, y: a.y - b.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const den = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
    if (!den) return null;
    const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / den));
    out.push(Math.acos(cos) * 180 / Math.PI);
  }
  return out;
}

// Confianza del recorte automatico. Fase 10 (tras el fallo de campo de Ari: un quad
// torcido pasaba el filtro y se aplicaba SIN editor, peor que antes): el criterio se
// endurece porque el modelo real es "papel rectangular fotografiado de frente".
// Ahora exige, ademas de area: angulos cerca de 90 (+-25) Y lados opuestos de largo
// parecido (<=30% de diferencia). Un trapecio deformado por una mala deteccion falla
// aqui y abre el editor, que es el comportamiento seguro.
export function recorteConfiable(e, wFrame, hFrame){
  if (!e || e.length !== 4) return false;
  if (!cuadrilateroValido(e, wFrame, hFrame)) return false;
  if (areaCuadrilatero(e) < wFrame * hFrame * 0.15) return false;
  const angs = angulosInternos(e);
  if (!angs) return false;
  if (angs.some(a => a < 65 || a > 115)) return false;
  return ladosOpuestosParecidos(e, 0.30);
}

// Lados opuestos de largo similar: un rectangulo (aun en perspectiva suave) los tiene
// parecidos; una deteccion que se comio parte del fondo, no.
export function ladosOpuestosParecidos(e, tol = 0.30){
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const arriba = d(e[0], e[1]), abajo = d(e[3], e[2]);
  const izq = d(e[0], e[3]), der = d(e[1], e[2]);
  const dif = (p, q) => Math.abs(p - q) / Math.max(p, q, 1);
  return dif(arriba, abajo) <= tol && dif(izq, der) <= tol;
}

// --- Fase 10: recortes pensados para FACTURAS (papel rectangular) ----------
// Pedido de Ari: aunque no se identifiquen las esquinas, tomar los laterales del papel
// y extenderlos al borde superior e inferior de la foto, alineando con el texto.

// Bordes laterales robustos a partir de los extremos claros por fila: se descartan las
// filas sin papel y se usan percentiles (no min/max) para que una veta del fondo o una
// esquina doblada no arrastre el borde. Puro: testeable en Node.
export function bordesLaterales(filas, ancho, percentil = 0.1){
  const validas = filas.filter(f => f && f.der > f.izq);
  if (validas.length < 3) return null;
  const izqs = validas.map(f => f.izq).sort((a, b) => a - b);
  const ders = validas.map(f => f.der).sort((a, b) => a - b);
  const k = Math.min(izqs.length - 1, Math.max(0, Math.floor(izqs.length * percentil)));
  const izq = izqs[k];                       // percentil bajo: borde izquierdo del papel
  const der = ders[ders.length - 1 - k];      // percentil alto: borde derecho
  if (der - izq < ancho * 0.15) return null;  // banda demasiado angosta para ser un papel
  return { izq, der };
}

// Fraccion de pixeles CLAROS dentro del recorte (0..1). La geometria no basta para
// saber si un recorte es bueno: el fallo de campo de Ari era un paralelogramo rotado
// (angulos ~90 y lados opuestos iguales, pasa toda guarda geometrica) que se habia
// comido una franja de granito. Una factura bien recortada es casi todo papel claro,
// asi que esta medida SI lo distingue. Requiere OpenCV.
export function fraccionClara(srcCanvas, esquinas, maxLado = 400){
  let p = null, mascara = null, bin = null, dentro = null;
  try {
    p = prepararGris(srcCanvas, maxLado);
    // Umbral global de la imagen: separa papel (claro) de fondo (oscuro).
    bin = new cv.Mat();
    cv.threshold(p.gray, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    mascara = new cv.Mat.zeros(p.h, p.w, cv.CV_8U);
    const pts = esquinas.map(q => [Math.round(q.x * p.escala), Math.round(q.y * p.escala)]).flat();
    const poly = cv.matFromArray(4, 1, cv.CV_32SC2, pts);
    const vec = new cv.MatVector();
    vec.push_back(poly);
    cv.fillPoly(mascara, vec, new cv.Scalar(255));
    poly.delete(); vec.delete();
    const totalDentro = cv.countNonZero(mascara);
    if (!totalDentro) return 0;
    dentro = new cv.Mat();
    cv.bitwise_and(bin, mascara, dentro);
    return cv.countNonZero(dentro) / totalDentro;
  } catch(e){
    console.warn('fraccionClara fallo:', e.message);
    return 1; // ante la duda no bloquear el recorte (lo valida la geometria)
  } finally {
    if (dentro) dentro.delete();
    if (mascara) mascara.delete();
    if (bin) bin.delete();
    if (p){ p.gray.delete(); p.mat.delete(); }
  }
}

// PEDIDO LITERAL DE ARI (Fase 10): "aun si no se identifican las esquinas, que se tomen
// por los laterales a su punto mas alto de los bordes superior e inferior de la foto".
// Toma los dos lados largos del papel, los PROLONGA hasta y=0 e y=H, y devuelve el quad
// resultante: bordes superior e inferior sobre el marco de la foto, laterales siguiendo
// la inclinacion real del papel (que en una factura es la del texto impreso).
// Puro: testeable en Node.
export function extenderLateralesAlMarco(e, H){
  if (!e || e.length !== 4 || !(H > 0)) return null;
  const [tl, tr, br, bl] = e;
  const xEn = (p, q, y) => {
    if (Math.abs(q.y - p.y) < 1e-6) return null; // lado horizontal: no se puede prolongar
    return p.x + (q.x - p.x) * (y - p.y) / (q.y - p.y);
  };
  const izqArriba = xEn(tl, bl, 0), izqAbajo = xEn(tl, bl, H);
  const derArriba = xEn(tr, br, 0), derAbajo = xEn(tr, br, H);
  if ([izqArriba, izqAbajo, derArriba, derAbajo].some(v => v == null)) return null;
  return [
    { x: izqArriba, y: 0 }, { x: derArriba, y: 0 },
    { x: derAbajo, y: H }, { x: izqAbajo, y: H }
  ];
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

// --- Fase 10: motores de recorte para papel rectangular ------------------
// Reduce el canvas a escala de trabajo y devuelve {mat, gray, escala, w, h}.
// El llamador libera mat y gray.
function prepararGris(srcCanvas, maxLado){
  const escala = escalaTrabajo(srcCanvas.width, srcCanvas.height, maxLado);
  const w = Math.round(srcCanvas.width * escala), h = Math.round(srcCanvas.height * escala);
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  small.getContext('2d').drawImage(srcCanvas, 0, 0, w, h);
  const mat = cv.imread(small);
  const gray = new cv.Mat();
  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
  return { mat, gray, escala, w, h };
}

// Contorno mas grande de un binario (Mat). Devuelve {contorno, area} o null; el
// llamador libera `contorno`.
function contornoMayor(th){
  let contours, hier;
  try {
    contours = new cv.MatVector();
    hier = new cv.Mat();
    cv.findContours(th, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let mejor = null, mejorArea = 0;
    for (let i = 0; i < contours.size(); i++){
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area > mejorArea){
        if (mejor) mejor.delete();
        mejor = c; mejorArea = area;
      } else c.delete();
    }
    return mejor ? { contorno: mejor, area: mejorArea } : null;
  } finally {
    if (hier) hier.delete();
    if (contours) contours.delete();
  }
}

// RECTANGULO MINIMO (Fase 10): el modelo correcto de una factura es un rectangulo, no
// un cuadrilatero cualquiera. `minAreaRect` da SIEMPRE 4 esquinas limpias aunque el
// borde del papel este ondulado, roto o con sombra — que es donde `approxPolyDP`
// producia los quads torcidos que Ari vio en campo. La guarda de LLENADO (area del
// contorno / area del rectangulo) rechaza manchas que no son de verdad rectangulares
// (p. ej. papel fundido con una veta clara del granito).
export function rectanguloDePapel(srcCanvas, maxLado = 1200, minLlenado = 0.82){
  let p = null;
  try {
    p = prepararGris(srcCanvas, maxLado);
    for (const bin of [binOtsu, binAdaptativa, binCanny]){
      let th = null, mayor = null;
      try {
        th = bin(p.gray);
        mayor = contornoMayor(th);
        if (!mayor || mayor.area < p.w * p.h * 0.10) continue;
        const rot = cv.minAreaRect(mayor.contorno);
        const areaRect = rot.size.width * rot.size.height;
        if (!areaRect || mayor.area / areaRect < minLlenado) continue; // no es rectangular
        const pts = cv.RotatedRect.points(rot).map(q => ({ x: q.x / p.escala, y: q.y / p.escala }));
        const ordenado = ordenarEsquinas(pts);
        if (cuadrilateroValido(ordenado, srcCanvas.width, srcCanvas.height)) return ordenado;
      } finally {
        if (mayor && mayor.contorno) mayor.contorno.delete();
        if (th) th.delete();
      }
    }
    return null;
  } finally {
    if (p){ p.gray.delete(); p.mat.delete(); }
  }
}

// ANGULO DEL TEXTO (Fase 10, pedido de Ari "reconociendo el texto, alinear con ellos
// borde superior e inferior"): las lineas de texto de una factura son franjas oscuras
// horizontales. Al rotar la imagen, el perfil de proyeccion por filas tiene MAXIMA
// varianza cuando las lineas quedan horizontales — ese angulo es la inclinacion real.
// BANDA LATERAL (Fase 10, pedido de Ari para el ticket largo que se sale del encuadre):
// cuando no hay 4 esquinas fiables, se toman los LATERALES del papel y se prolongan al
// borde superior e inferior de la FOTO.
// La inclinacion sale del propio papel (`rectanguloDePapel`), no de un analisis del
// texto: se probo medir el angulo por proyeccion de las lineas de texto y devolvia 10
// grados donde el ticket estaba a 5 — un enderezado equivocado empeora el recorte. En
// una factura el texto se imprime paralelo al borde del papel, asi que la orientacion
// del papel da el MISMO resultado visual y es fiable. Respaldo sin inclinacion: banda
// recta a partir de los extremos claros por fila.
export function bandaDePapel(srcCanvas, maxLado = 1200){
  const H = srcCanvas.height;
  // Solo se hereda la INCLINACION del papel si este se identifico con el criterio
  // ESTRICTO. Con el criterio laxo, un blob de papel + vetas del granito daba un
  // rectangulo girado ~20 grados y la banda salia disparatada (medido en pruebas):
  // ante la duda, banda recta — mejor recta que torcida.
  const rect = rectanguloDePapel(srcCanvas, maxLado);
  if (rect){
    const ext = extenderLateralesAlMarco(rect, H);
    if (ext) return ordenarEsquinas(ext);
  }
  let p = null, th = null;
  try {
    p = prepararGris(srcCanvas, maxLado);
    th = binOtsu(p.gray);
    // Extremos claros por fila (el papel es lo brillante sobre el fondo).
    const filas = [];
    for (let y = 0; y < p.h; y++){
      let izq = -1, der = -1;
      for (let x = 0; x < p.w; x++){
        if (th.ucharPtr(y, x)[0]){ if (izq < 0) izq = x; der = x; }
      }
      filas.push(izq < 0 ? null : { izq, der });
    }
    const b = bordesLaterales(filas, p.w);
    if (!b) return null;
    if (b.der - b.izq > p.w * 0.985) return null; // ocupa todo el ancho: no separo el papel
    const izq = b.izq / p.escala, der = b.der / p.escala;
    return ordenarEsquinas([
      { x: izq, y: 0 }, { x: der, y: 0 }, { x: der, y: H }, { x: izq, y: H }
    ]);
  } catch(e){
    console.warn('bandaDePapel fallo:', e.message);
    return null;
  } finally {
    if (th) th.delete();
    if (p){ p.gray.delete(); p.mat.delete(); }
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
