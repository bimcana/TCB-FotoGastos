// Realce "auto-color" tipo Adobe Scan: normalizacion LOCAL del fondo (papel) por canal
// mediante cierre morfologico + division, para neutralizar luz calida/despareja sin perder
// color, seguido de contraste fuerte en luminancia (curva S) + unsharp leve.
// Conserva color (logos, sellos) mientras deja el papel blanco y la tinta oscura y legible.

// S-curve suave: aclara por encima del punto, oscurece por debajo. Conserva monotonia.
export function curvaContraste(valor, punto = 0.55, fuerza = 0.35){
  const x = valor / 255;
  const p = punto;
  // interpolación entre identidad y una sigmoide centrada en p
  const sig = 1 / (1 + Math.exp(-(x - p) * (4 + fuerza * 16)));
  const y = x * (1 - fuerza) + sig * fuerza;
  return Math.max(0, Math.min(255, Math.round(y * 255)));
}

// LUT de contraste fuerte, calculada una sola vez (perezosa): la curva no depende de la imagen.
let _lutFuerte = null;
function lutContrasteFuerte(){
  if (_lutFuerte) return _lutFuerte;
  _lutFuerte = new cv.Mat(1, 256, cv.CV_8U);
  for (let i = 0; i < 256; i++) _lutFuerte.data[i] = curvaContraste(i, 0.6, 0.7);
  return _lutFuerte;
}

// Tamaño del kernel de cierre para estimar el fondo del papel (impar, ~1/15 del lado menor).
function kernelFondo(rows, cols){
  let k = Math.round(Math.min(rows, cols) / 15);
  if (k < 15) k = 15;
  if (k % 2 === 0) k += 1;
  return k;
}

// Auto-color tipo Adobe: normalización LOCAL del fondo por canal (papel blanco aun con
// luz cálida/despareja) + contraste fuerte en luminancia, conservando color.
export function autoColor(rgbaMat){
  const rgb = new cv.Mat();
  const canales = new cv.MatVector(), norm = new cv.MatVector();
  const unido = new cv.Mat();
  const ycc = new cv.Mat(), chY = new cv.MatVector(), nuevoY = new cv.MatVector();
  const y2 = new cv.Mat(), ycc2 = new cv.Mat(), rgb2 = new cv.Mat(), blur = new cv.Mat();
  // Mats capturados desde los MatVector (cada .get() crea un Mat a liberar).
  // Hoisteados para que el finally pueda liberarlos si un cv.* lanza a mitad.
  let kernel = null, y0 = null, cr = null, cb = null, out = null;
  try {
    cv.cvtColor(rgbaMat, rgb, cv.COLOR_RGBA2RGB);
    cv.split(rgb, canales);
    const k = kernelFondo(rgb.rows, rgb.cols);
    kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k));
    // Normalización local del fondo por canal: el cierre morfológico estima el brillo
    // del papel (la tinta, más fina que el kernel, desaparece); dividir el canal por ese
    // fondo lleva el papel a blanco uniforme y neutraliza el tinte de la luz cálida/sombra.
    for (let i = 0; i < 3; i++){
      let c = null, bg = null, div = null;
      try {
        c = canales.get(i);
        bg = new cv.Mat();
        cv.morphologyEx(c, bg, cv.MORPH_CLOSE, kernel); // estima el papel local (sin la tinta)
        div = new cv.Mat();
        cv.divide(c, bg, div, 255);   // papel -> ~255 (blanco), neutraliza luz cálida/sombra
        norm.push_back(div);
      } finally {
        if (div) div.delete();
        if (bg) bg.delete();
        if (c) c.delete();
      }
    }
    cv.merge(norm, unido);
    // Contraste fuerte SOLO en luminancia (conserva color).
    cv.cvtColor(unido, ycc, cv.COLOR_RGB2YCrCb);
    cv.split(ycc, chY);
    y0 = chY.get(0); cr = chY.get(1); cb = chY.get(2);
    cv.LUT(y0, lutContrasteFuerte(), y2);
    y0.delete(); y0 = null; // liberado inline; anular para no hacer doble-free en el finally
    nuevoY.push_back(y2); nuevoY.push_back(cr); nuevoY.push_back(cb);
    cv.merge(nuevoY, ycc2);
    cv.cvtColor(ycc2, rgb2, cv.COLOR_YCrCb2RGB);
    // Unsharp leve para nitidez de texto.
    cv.GaussianBlur(rgb2, blur, new cv.Size(0, 0), 3);
    cv.addWeighted(rgb2, 1.5, blur, -0.5, 0, rgb2);
    out = new cv.Mat();
    cv.cvtColor(rgb2, out, cv.COLOR_RGB2RGBA);
  } catch(e){
    if (out) out.delete();
    throw e;
  } finally {
    [rgb, unido, ycc, y2, ycc2, rgb2, blur].forEach(m => m.delete());
    if (kernel) kernel.delete();
    if (y0) y0.delete();
    if (cr) cr.delete();
    if (cb) cb.delete();
    canales.delete(); norm.delete(); chY.delete(); nuevoY.delete();
  }
  return out;
}
