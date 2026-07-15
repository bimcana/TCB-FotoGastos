// Procesado de la captura: ortofoto (warp homográfico) + realce auto-color (punto blanco + contraste + unsharp).
import { dimensionesDestino } from './detect.js';
import { autoColor } from './enhance.js';

export function ortofoto(srcMat, esquinas){
  const { w, h } = dimensionesDestino(esquinas);
  let src, dst, M;
  let out = null;
  try {
    out = new cv.Mat();
    src = cv.matFromArray(4, 1, cv.CV_32FC2, esquinas.flatMap(p => [p.x, p.y]));
    dst = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
    M = cv.getPerspectiveTransform(src, dst);
    cv.warpPerspective(srcMat, out, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  } catch(e){
    if (out) out.delete();
    throw e;
  } finally {
    if (src) src.delete();
    if (dst) dst.delete();
    if (M) M.delete();
  }
  return out;
}

// Aplica el realce (autoColor según opts.modo/intensidad) a un canvas ya en ortofoto
// ("plano"), sin volver a warpar. modo === 'original' devuelve una copia sin pasar por
// autoColor (no tiene sentido, y así se evita, invocar autoColor en modo 'original').
export function aplicarRealce(planoCanvas, opts = {}){
  const { modo = 'color' } = opts;
  if (modo === 'original'){
    const c = document.createElement('canvas');
    c.width = planoCanvas.width;
    c.height = planoCanvas.height;
    c.getContext('2d').drawImage(planoCanvas, 0, 0);
    return c;
  }
  const mat = cv.imread(planoCanvas);
  let out = null;
  const c = document.createElement('canvas');
  try {
    out = autoColor(mat, opts);
    cv.imshow(c, out);
  } finally {
    mat.delete();
    if (out) out.delete();
  }
  return c;
}

// Ortofoto (warp) + realce. Devuelve tanto la ortofoto sin realzar ("plano", para poder
// re-aplicar filtros sin re-warpar) como la versión ya realzada ("final") según opts.
export function procesar(canvas, esquinas, opts = {}){
  const src = cv.imread(canvas);
  let planoMat = null;
  let plano = null, final = null;
  try {
    planoMat = ortofoto(src, esquinas);
    plano = document.createElement('canvas');
    cv.imshow(plano, planoMat);
    final = aplicarRealce(plano, opts);
  } finally {
    src.delete();
    if (planoMat) planoMat.delete();
  }
  return { plano, final };
}

export function canvasAJpeg(canvas, calidad = 0.92){
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', calidad));
}
