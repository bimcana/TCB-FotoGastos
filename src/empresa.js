// Perfil de la empresa cliente (membrete del documento de gastos). Se guarda local y
// como _empresa.json en la raiz de Drive: toda instalacion conectada a la misma carpeta
// hereda el membrete. El logo va como dataURL PNG reescalado (≤460px de ancho).
import { get, set } from './settings.js';

export function empresaGuardada(){ return get('empresa', null) || {}; }
export function guardarEmpresaLocal(e){ set('empresa', e); }

export function empresaCompleta(e){
  return !!(e && String(e.razon || '').trim() && String(e.rnc || '').trim());
}

export function archivoALogoB64(file, maxAncho = 460){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const esc = Math.min(1, maxAncho / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * esc));
      c.height = Math.max(1, Math.round(img.naturalHeight * esc));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer el logo')); };
    img.src = url;
  });
}
