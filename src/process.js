// Procesado de la captura: ortofoto (warp homográfico) + limpieza de fondo (flat-field).
import { dimensionesDestino } from './detect.js';

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

// Corrección de iluminación por división del fondo estimado (flat-field).
// Aclara sombras y arrugas y lleva el papel a ~RGB 254 sin tocar la geometría del contenido.
export function limpiarFondo(rgbaMat){
  const rgb = new cv.Mat();
  const canales = new cv.MatVector(), limpios = new cv.MatVector();
  const merged = new cv.Mat();
  let rgba = null;
  try {
    rgba = new cv.Mat();
    cv.cvtColor(rgbaMat, rgb, cv.COLOR_RGBA2RGB);
    cv.split(rgb, canales);
    const k = Math.max(31, ((Math.min(rgb.rows, rgb.cols) / 8) | 0) | 1); // kernel impar grande
    for (let i = 0; i < 3; i++){
      const c = canales.get(i);
      const bg = new cv.Mat(), f32 = new cv.Mat(), bg32 = new cv.Mat(), div = new cv.Mat(), u8 = new cv.Mat();
      try {
        cv.GaussianBlur(c, bg, new cv.Size(k, k), 0);
        c.convertTo(f32, cv.CV_32F);
        bg.convertTo(bg32, cv.CV_32F, 1, 1); // +1 evita división por cero
        cv.divide(f32, bg32, div, 254);      // papel → ~254
        div.convertTo(u8, cv.CV_8U);
        limpios.push_back(u8);
      } finally {
        c.delete(); bg.delete(); f32.delete(); bg32.delete(); div.delete();
        u8.delete();
      }
    }
    cv.merge(limpios, merged);
    cv.cvtColor(merged, rgba, cv.COLOR_RGB2RGBA);
  } catch(e){
    if (rgba) rgba.delete();
    throw e;
  } finally {
    rgb.delete(); merged.delete();
    canales.delete(); limpios.delete();
  }
  return rgba;
}

export function procesar(canvas, esquinas){
  const src = cv.imread(canvas);
  let plano, limpio;
  const out = document.createElement('canvas');
  try {
    plano = ortofoto(src, esquinas);
    limpio = limpiarFondo(plano);
    cv.imshow(out, limpio);
  } finally {
    src.delete();
    if (plano) plano.delete();
    if (limpio) limpio.delete();
  }
  return out;
}

export function canvasAJpeg(canvas, calidad = 0.92){
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', calidad));
}
