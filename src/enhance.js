// Realce "auto-color": normaliza punto blanco por canal + contraste en luminancia (curva S) + unsharp leve.
// Conserva color (logos, sellos) mientras deja el papel blanco y la tinta oscura y legible.

// S-curve suave: aclara por encima del punto, oscurece por debajo. Conserva monotonía.
export function curvaContraste(valor, punto = 0.55, fuerza = 0.35){
  const x = valor / 255;
  const p = punto;
  // interpolación entre identidad y una sigmoide centrada en p
  const sig = 1 / (1 + Math.exp(-(x - p) * (4 + fuerza * 16)));
  const y = x * (1 - fuerza) + sig * fuerza;
  return Math.max(0, Math.min(255, Math.round(y * 255)));
}

// LUT de contraste calculada una sola vez (perezosa): la curva no depende de la imagen.
let _lut = null;
function lutContraste(){
  if (_lut === null){
    _lut = new cv.Mat(1, 256, cv.CV_8U);
    for (let i = 0; i < 256; i++) _lut.data[i] = curvaContraste(i);
  }
  return _lut;
}

// Percentil alto (por defecto 95) de un canal de 8 bits vía histograma.
// Se usa como punto blanco: ignora reflejos/ruido JPEG que casi siempre dejan
// algún píxel a ~255 y harían que el máximo absoluto no aclarara el papel.
function percentilCanal(c, frac = 0.05){
  const hist = new Uint32Array(256);
  const d = c.data;
  for (let k = 0; k < d.length; k++) hist[d[k]]++;
  const objetivo = d.length * frac; // 5% de los píxeles más brillantes
  let acum = 0;
  for (let v = 255; v >= 0; v--){
    acum += hist[v];
    if (acum >= objetivo) return v;
  }
  return 0;
}

export function autoColor(rgbaMat){
  const rgb = new cv.Mat();
  const canales = new cv.MatVector(), norm = new cv.MatVector();
  const unido = new cv.Mat();
  const ycc = new cv.Mat(), chY = new cv.MatVector();
  const y2 = new cv.Mat();
  const nuevoY = new cv.MatVector();
  const ycc2 = new cv.Mat(), rgb2 = new cv.Mat();
  const blur = new cv.Mat();
  // Mats capturados desde los MatVector (cada .get() crea un Mat a liberar).
  // Hoisteados para que el finally pueda liberarlos si un cv.* lanza a mitad.
  let y0 = null, cr = null, cb = null;
  let out = null;
  try {
    cv.cvtColor(rgbaMat, rgb, cv.COLOR_RGBA2RGB);
    cv.split(rgb, canales);
    // Normalización de punto blanco por canal: llevar el brillo del papel (~percentil 95) a 255.
    // Por canal ⇒ hace balance de blancos y neutraliza el tinte de la luz.
    for (let i = 0; i < 3; i++){
      let c = null, esc = null;
      try {
        c = canales.get(i);
        const p95 = percentilCanal(c, 0.05);
        const escala = p95 > 0 ? 255 / p95 : 1;
        esc = new cv.Mat();
        c.convertTo(esc, cv.CV_8U, escala, 0);
        norm.push_back(esc); // push_back copió el header (refcount compartido); liberar el nuestro
      } finally {
        if (esc) esc.delete();
        if (c) c.delete();
      }
    }
    cv.merge(norm, unido);
    // Contraste conservando color, vía LUT en luminancia (YCrCb).
    cv.cvtColor(unido, ycc, cv.COLOR_RGB2YCrCb);
    cv.split(ycc, chY);
    y0 = chY.get(0);
    cr = chY.get(1);
    cb = chY.get(2);
    cv.LUT(y0, lutContraste(), y2);
    y0.delete(); y0 = null; // liberado inline; anular para no hacer doble-free en el finally
    nuevoY.push_back(y2); nuevoY.push_back(cr); nuevoY.push_back(cb);
    cv.merge(nuevoY, ycc2);
    cv.cvtColor(ycc2, rgb2, cv.COLOR_YCrCb2RGB);
    // Unsharp leve para nitidez de texto.
    cv.GaussianBlur(rgb2, blur, new cv.Size(0, 0), 3);
    cv.addWeighted(rgb2, 1.4, blur, -0.4, 0, rgb2);
    out = new cv.Mat();
    cv.cvtColor(rgb2, out, cv.COLOR_RGB2RGBA);
  } catch(e){
    if (out) out.delete();
    throw e;
  } finally {
    [rgb, unido, ycc, y2, ycc2, rgb2, blur].forEach(m => m.delete());
    if (y0) y0.delete();
    if (cr) cr.delete();
    if (cb) cb.delete();
    canales.delete(); norm.delete(); chY.delete(); nuevoY.delete();
  }
  return out;
}
