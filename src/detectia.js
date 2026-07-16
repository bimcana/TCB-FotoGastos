// Motor IA de deteccion (Fase 2E): U2-Net-p sobre ONNX Runtime Web (WASM). Carga
// perezosa: ni el runtime (~13 MB) ni el modelo (~4.7 MB) se descargan hasta que hacen
// falta; el service worker los cachea para uso offline posterior. Si algo falla
// (sin red la primera vez, iOS sin WASM SIMD), devuelve null y el flujo sigue sin IA.
import { esquinasDeMascara } from './detect.js';

const LADO = 320;
let sesionProm = null;

function cargarScript(src){
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

function sesion(){
  if (!sesionProm){
    sesionProm = (async () => {
      if (!window.ort) await cargarScript('vendor/ort/ort.wasm.min.js');
      // URL absoluta: el loader resuelve el .mjs del runtime con import() dinamico y un
      // especificador relativo sin './' falla la resolucion de modulos.
      ort.env.wasm.wasmPaths = new URL('vendor/ort/', location.href).href;
      ort.env.wasm.numThreads = 1; // GitHub Pages no envia COOP/COEP: sin hilos
      return ort.InferenceSession.create('vendor/modelos/u2netp.onnx',
        { executionProviders: ['wasm'] });
    })().catch(e => { sesionProm = null; throw e; }); // reintentable en la proxima llamada
  }
  return sesionProm;
}

// canvas → Float32Array NCHW 1x3x320x320 (preprocesado estandar U2-Net: /255 y
// normalizacion mean/std de ImageNet, mismo pipeline que usa rembg).
function aTensor(canvas){
  const c = document.createElement('canvas');
  c.width = LADO; c.height = LADO;
  const ctx = c.getContext('2d');
  ctx.drawImage(canvas, 0, 0, LADO, LADO);
  const { data } = ctx.getImageData(0, 0, LADO, LADO);
  const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
  const t = new Float32Array(3 * LADO * LADO);
  for (let i = 0; i < LADO * LADO; i++){
    for (let ch = 0; ch < 3; ch++){
      t[ch * LADO * LADO + i] = (data[i * 4 + ch] / 255 - MEAN[ch]) / STD[ch];
    }
  }
  return t;
}

// Salida del modelo (320x320, valores ~0..1) → canvas de mascara binaria
// (normalizacion min-max + umbral 0.5, como el postprocesado de referencia).
function mascaraACanvas(salida){
  let min = Infinity, max = -Infinity;
  for (const v of salida){ if (v < min) min = v; if (v > max) max = v; }
  const rango = (max - min) || 1;
  const c = document.createElement('canvas');
  c.width = LADO; c.height = LADO;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(LADO, LADO);
  for (let i = 0; i < LADO * LADO; i++){
    const on = ((salida[i] - min) / rango) >= 0.5 ? 255 : 0;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = on;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export async function detectarConIA(canvas){
  try {
    const s = await sesion();
    const tensor = new ort.Tensor('float32', aTensor(canvas), [1, 3, LADO, LADO]);
    const out = await s.run({ [s.inputNames[0]]: tensor });
    const salida = out[s.outputNames[0]].data; // d0: 1x1x320x320
    return esquinasDeMascara(mascaraACanvas(salida), canvas.width, canvas.height);
  } catch(e){
    console.error('detectarConIA:', e);
    return null;
  }
}
