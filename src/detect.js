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

// Requieren OpenCV (solo navegador) ---------------------------------------
export function detectarDocumento(srcCanvas, escala = 0.35){
  const w = Math.round(srcCanvas.width * escala), h = Math.round(srcCanvas.height * escala);
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  small.getContext('2d').drawImage(srcCanvas, 0, 0, w, h);

  let mat, gray, th, kernel, contours, hier;
  try {
    mat = cv.imread(small);
    gray = new cv.Mat();
    th = new cv.Mat();
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    // Umbral de Otsu: separa el papel (brillante) del fondo. El papel queda en blanco (255) para findContours.
    cv.threshold(gray, th, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    // Cierre morfológico: rellena huecos del texto para que el papel sea una sola mancha sólida.
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
    cv.morphologyEx(th, th, cv.MORPH_CLOSE, kernel);
    cv.morphologyEx(th, th, cv.MORPH_OPEN, kernel);

    contours = new cv.MatVector();
    hier = new cv.Mat();
    cv.findContours(th, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let mejor = null, mejorArea = w * h * 0.12;
    for (let i = 0; i < contours.size(); i++){
      let c, approx;
      try {
        c = contours.get(i);
        const area = cv.contourArea(c);
        if (area > mejorArea){
          approx = new cv.Mat();
          cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true);
          if (approx.rows === 4 && cv.isContourConvex(approx)){
            const pts = [];
            for (let j = 0; j < 4; j++)
              pts.push({ x: approx.data32S[j * 2] / escala, y: approx.data32S[j * 2 + 1] / escala });
            mejorArea = area; mejor = pts;
          }
        }
      } finally {
        if (approx) approx.delete();
        if (c) c.delete();
      }
    }

    if (!mejor) return null;
    const ordenado = ordenarEsquinas(mejor);
    return cuadrilateroValido(ordenado, srcCanvas.width, srcCanvas.height) ? ordenado : null;
  } finally {
    if (mat) mat.delete();
    if (gray) gray.delete();
    if (th) th.delete();
    if (kernel) kernel.delete();
    if (hier) hier.delete();
    if (contours) contours.delete();
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
