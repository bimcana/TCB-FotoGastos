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

function lutContraste(){
  const lut = new cv.Mat(1, 256, cv.CV_8U);
  for (let i = 0; i < 256; i++) lut.data[i] = curvaContraste(i);
  return lut;
}

export function autoColor(rgbaMat){
  const rgb = new cv.Mat();
  cv.cvtColor(rgbaMat, rgb, cv.COLOR_RGBA2RGB);
  const canales = new cv.MatVector(), norm = new cv.MatVector();
  cv.split(rgb, canales);
  // Normalización de punto blanco por canal: llevar el brillo del papel (~percentil 95) a 255.
  for (let i = 0; i < 3; i++){
    const c = canales.get(i);
    let hi = 0;
    for (let k = 0; k < c.data.length; k++) if (c.data[k] > hi) hi = c.data[k];
    const escala = hi > 0 ? 255 / hi : 1;
    const esc = new cv.Mat();
    c.convertTo(esc, cv.CV_8U, escala, 0);
    norm.push_back(esc);
    c.delete();
  }
  const unido = new cv.Mat();
  cv.merge(norm, unido);
  // Contraste conservando color, vía LUT en luminancia (YCrCb).
  const ycc = new cv.Mat(), chY = new cv.MatVector();
  cv.cvtColor(unido, ycc, cv.COLOR_RGB2YCrCb);
  cv.split(ycc, chY);
  const lut = lutContraste(), y2 = new cv.Mat();
  cv.LUT(chY.get(0), lut, y2);
  const nuevoY = new cv.MatVector();
  nuevoY.push_back(y2); nuevoY.push_back(chY.get(1)); nuevoY.push_back(chY.get(2));
  const ycc2 = new cv.Mat(), rgb2 = new cv.Mat(), out = new cv.Mat();
  cv.merge(nuevoY, ycc2);
  cv.cvtColor(ycc2, rgb2, cv.COLOR_YCrCb2RGB);
  // Unsharp leve para nitidez de texto.
  const blur = new cv.Mat();
  cv.GaussianBlur(rgb2, blur, new cv.Size(0, 0), 3);
  cv.addWeighted(rgb2, 1.4, blur, -0.4, 0, rgb2);
  cv.cvtColor(rgb2, out, cv.COLOR_RGB2RGBA);
  [rgb, unido, ycc, lut, y2, ycc2, rgb2, blur].forEach(m => m.delete());
  canales.delete(); norm.delete(); chY.delete(); nuevoY.delete();
  return out;
}
