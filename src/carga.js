// Carga perezosa de scripts UMD vendorizados (pdf-lib, SheetJS, ONNX Runtime).
// Idempotente: cada src se pide una sola vez y las llamadas siguientes reutilizan la promesa.
const cargados = new Map();
export function cargarScript(src){
  if (!cargados.has(src)){
    cargados.set(src, new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res;
      s.onerror = () => { cargados.delete(src); rej(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    }));
  }
  return cargados.get(src);
}
