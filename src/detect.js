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

// Requieren OpenCV (solo navegador) ---------------------------------------
export function detectarDocumento(srcCanvas, escala = 0.25){
  const w = Math.round(srcCanvas.width * escala), h = Math.round(srcCanvas.height * escala);
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  small.getContext('2d').drawImage(srcCanvas, 0, 0, w, h);

  const mat = cv.imread(small);
  const gray = new cv.Mat(), edges = new cv.Mat();
  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
  cv.Canny(gray, edges, 50, 150);
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.dilate(edges, edges, kernel);

  const contours = new cv.MatVector(), hier = new cv.Mat();
  cv.findContours(edges, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let mejor = null, mejorArea = w * h * 0.12; // el documento debe ocupar >=12% del frame
  for (let i = 0; i < contours.size(); i++){
    const c = contours.get(i);
    const approx = new cv.Mat();
    cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true);
    if (approx.rows === 4 && cv.isContourConvex(approx)){
      const a = cv.contourArea(approx);
      if (a > mejorArea){
        mejorArea = a;
        mejor = [];
        for (let j = 0; j < 4; j++){
          mejor.push({ x: approx.data32S[j * 2] / escala, y: approx.data32S[j * 2 + 1] / escala });
        }
      }
    }
    approx.delete(); c.delete();
  }
  [mat, gray, edges, kernel, hier].forEach(m => m.delete());
  contours.delete();
  return mejor ? ordenarEsquinas(mejor) : null;
}

export function nitidez(canvas){
  const mat = cv.imread(canvas);
  const gray = new cv.Mat(), lap = new cv.Mat();
  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
  cv.Laplacian(gray, lap, cv.CV_64F);
  const mean = new cv.Mat(), std = new cv.Mat();
  cv.meanStdDev(lap, mean, std);
  const v = std.data64F[0] ** 2;
  [mat, gray, lap, mean, std].forEach(m => m.delete());
  return v;
}
