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

export function procesar(canvas, esquinas){
  const src = cv.imread(canvas);
  let plano, realzado;
  const out = document.createElement('canvas');
  try {
    plano = ortofoto(src, esquinas);
    realzado = autoColor(plano);
    cv.imshow(out, realzado);
  } finally {
    src.delete();
    if (plano) plano.delete();
    if (realzado) realzado.delete();
  }
  return out;
}

export function canvasAJpeg(canvas, calidad = 0.92){
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', calidad));
}
