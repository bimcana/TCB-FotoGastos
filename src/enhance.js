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

// Tamaño del kernel de cierre para estimar el fondo del papel (impar, ~1/15 del lado menor).
function kernelFondo(rows, cols){
  let k = Math.round(Math.min(rows, cols) / 15);
  if (k < 15) k = 15;
  if (k % 2 === 0) k += 1;
  return k;
}

// Mapea intensidad 0..100 a la "fuerza" de curvaContraste, en [0.35, 0.85].
// Puro (sin cv): testeable en Node sin cargar OpenCV.
export function fuerzaDesdeIntensidad(intensidad){
  const t = Math.max(0, Math.min(100, intensidad)) / 100;
  return 0.35 + t * (0.85 - 0.35);
}

// LUT de contraste según intensidad (0..100). Se reconstruye por llamada: 256 entradas
// es barato y autoColor ya no está en un bucle de vista previa a 8fps.
function lutContrasteIntensidad(intensidad){
  const fuerza = fuerzaDesdeIntensidad(intensidad);
  const lut = new cv.Mat(1, 256, cv.CV_8U);
  for (let i = 0; i < 256; i++) lut.data[i] = curvaContraste(i, 0.6, fuerza);
  return lut;
}

// Estima el fondo (papel local) sobre una versión reducida del canal y lo re-escala.
// El fondo es de baja frecuencia → reducir es seguro y hace la morfología barata sin
// importar el tamaño de la foto (antes, en hojas grandes, el cierre morfológico era lento).
function estimarFondo(canal){
  const maxLado = 800;
  const escala = Math.min(1, maxLado / Math.max(canal.rows, canal.cols));
  const bg = new cv.Mat();
  let chico = null, kernel = null, bgChico = null;
  try {
    if (escala < 1){
      chico = new cv.Mat();
      cv.resize(canal, chico, new cv.Size(Math.max(1, Math.round(canal.cols * escala)), Math.max(1, Math.round(canal.rows * escala))), 0, 0, cv.INTER_AREA);
      const k = kernelFondo(chico.rows, chico.cols);
      kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k));
      bgChico = new cv.Mat();
      cv.morphologyEx(chico, bgChico, cv.MORPH_CLOSE, kernel);
      cv.resize(bgChico, bg, new cv.Size(canal.cols, canal.rows), 0, 0, cv.INTER_LINEAR);
    } else {
      const k = kernelFondo(canal.rows, canal.cols);
      kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k));
      cv.morphologyEx(canal, bg, cv.MORPH_CLOSE, kernel);
    }
  } catch(e){
    bg.delete();
    throw e;
  } finally {
    if (chico) chico.delete();
    if (kernel) kernel.delete();
    if (bgChico) bgChico.delete();
  }
  return bg;
}

// Auto-color tipo Adobe: normalización LOCAL del fondo por canal (papel blanco aun con
// luz cálida/despareja) + contraste según intensidad en luminancia, conservando color.
// opts.modo: 'color' (default, conserva color), 'grises' (color->gris tras el realce),
// 'byn' (umbral adaptativo blanco/negro sobre el gris). 'original' no debe llamar a esta
// función (ver aplicarRealce en process.js, que copia el plano sin pasar por aquí).
export function autoColor(rgbaMat, opts = {}){
  const { modo = 'color', intensidad = 65 } = opts;
  const rgb = new cv.Mat();
  const canales = new cv.MatVector(), norm = new cv.MatVector();
  const unido = new cv.Mat();
  const ycc = new cv.Mat(), chY = new cv.MatVector(), nuevoY = new cv.MatVector();
  const y2 = new cv.Mat(), ycc2 = new cv.Mat(), rgb2 = new cv.Mat(), blur = new cv.Mat();
  // Mats capturados desde los MatVector (cada .get() crea un Mat a liberar), o creados
  // condicionalmente según el modo. Hoisteados para que el finally pueda liberarlos si
  // un cv.* lanza a mitad.
  let y0 = null, cr = null, cb = null, lut = null, out = null;
  let gris = null, bw = null;
  try {
    cv.cvtColor(rgbaMat, rgb, cv.COLOR_RGBA2RGB);
    cv.split(rgb, canales);
    // Normalización local del fondo por canal: el cierre morfológico (sobre una versión
    // reducida, ver estimarFondo) estima el brillo del papel (la tinta, más fina que el
    // kernel, desaparece); dividir el canal por ese fondo lleva el papel a blanco uniforme
    // y neutraliza el tinte de la luz cálida/sombra.
    for (let i = 0; i < 3; i++){
      let c = null, bg = null, div = null;
      try {
        c = canales.get(i);
        bg = estimarFondo(c);
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
    // Contraste según intensidad SOLO en luminancia (conserva color).
    cv.cvtColor(unido, ycc, cv.COLOR_RGB2YCrCb);
    cv.split(ycc, chY);
    y0 = chY.get(0); cr = chY.get(1); cb = chY.get(2);
    lut = lutContrasteIntensidad(intensidad);
    cv.LUT(y0, lut, y2);
    y0.delete(); y0 = null; // liberado inline; anular para no hacer doble-free en el finally
    lut.delete(); lut = null;
    nuevoY.push_back(y2); nuevoY.push_back(cr); nuevoY.push_back(cb);
    cv.merge(nuevoY, ycc2);
    cv.cvtColor(ycc2, rgb2, cv.COLOR_YCrCb2RGB);
    // Unsharp leve para nitidez de texto.
    cv.GaussianBlur(rgb2, blur, new cv.Size(0, 0), 3);
    cv.addWeighted(rgb2, 1.5, blur, -0.5, 0, rgb2);

    if (modo === 'grises' || modo === 'byn'){
      gris = new cv.Mat();
      cv.cvtColor(rgb2, gris, cv.COLOR_RGB2GRAY);
      if (modo === 'byn'){
        bw = new cv.Mat();
        const lado = Math.min(gris.rows, gris.cols);
        let blockSize = Math.round(lado * 0.15);
        if (blockSize < 15) blockSize = 15;
        if (blockSize % 2 === 0) blockSize += 1;
        cv.adaptiveThreshold(gris, bw, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, blockSize, 10);
        out = new cv.Mat();
        cv.cvtColor(bw, out, cv.COLOR_GRAY2RGBA);
      } else {
        out = new cv.Mat();
        cv.cvtColor(gris, out, cv.COLOR_GRAY2RGBA);
      }
    } else {
      out = new cv.Mat();
      cv.cvtColor(rgb2, out, cv.COLOR_RGB2RGBA);
    }
  } catch(e){
    if (out) out.delete();
    throw e;
  } finally {
    [rgb, unido, ycc, y2, ycc2, rgb2, blur].forEach(m => m.delete());
    if (y0) y0.delete();
    if (cr) cr.delete();
    if (cb) cb.delete();
    if (lut) lut.delete();
    if (gris) gris.delete();
    if (bw) bw.delete();
    canales.delete(); norm.delete(); chY.delete(); nuevoY.delete();
  }
  return out;
}
