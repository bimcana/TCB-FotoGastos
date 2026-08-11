const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

export function nombreCarpetaMes(fechaISO){
  const [y, m] = fechaISO.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}_${MESES[m - 1]}`;
}

export function siguienteNombre(fechaISO, existentes){
  const dia = fechaISO.split('-')[2];
  const re = new RegExp(`^Compra_${dia}(\\d+)\\.jpe?g$`, 'i');
  let max = -1;
  for (const n of existentes){
    const m = n.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Compra_${dia}${max + 1}.jpg`;
}

export function hoyISO(d = new Date()){
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- Orden de presentacion (Fase 21) ---------------------------------------
// El indice `_gastos.json` guarda las facturas en el orden en que se SUBIERON, que no
// tiene por que ser el de sus fechas (una factura vieja puede fotografiarse despues).
// Los documentos del cierre —PDF, Excel de revision y TXT— deben ir SIEMPRE en orden
// ascendente de fecha de emision, que es justo para lo que existe el nombre `Compra_DDN`:
// DD = dia de emision, N = correlativo de ese dia.

// Correlativo N de un nombre `Compra_DDN.jpg`; lo que no lo sea va al final del dia.
export function correlativoDe(archivo){
  const m = String(archivo || '').match(/^Compra_(\d{2})(\d+)\.jpe?g$/i);
  return m ? parseInt(m[2], 10) : Number.MAX_SAFE_INTEGER;
}

// Facturas ordenadas por fecha de emision y, dentro del mismo dia, por su correlativo.
// Las que no tienen fecha (provisionales) quedan al final. No muta la lista original.
export function ordenarParaDocumento(facturas){
  const clave = f => f && f.fechaEmision ? String(f.fechaEmision) : '9999-99-99';
  return [...(facturas || [])].sort((a, b) => {
    const fa = clave(a), fb = clave(b);
    if (fa !== fb) return fa < fb ? -1 : 1;
    const ca = correlativoDe(a && a.archivo), cb = correlativoDe(b && b.archivo);
    if (ca !== cb) return ca - cb;
    return String(a && a.archivo || '').localeCompare(String(b && b.archivo || ''));
  });
}

// --- Fase 2D: nombres provisionales y re-archivado -------------------------
// Una factura guardada sin fecha de emision conocida sube como Pendiente_… y
// se renombra/mueve cuando la IA (o el usuario) fija la fecha real.

export function nombreProvisional(d = new Date()){
  const p = n => String(n).padStart(2, '0');
  return `Pendiente_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.jpg`;
}

export function esProvisional(nombre){
  return /^Pendiente_/i.test(nombre || '');
}

export function nombreCoincideConFecha(nombre, fechaISO){
  const m = String(nombre || '').match(/^Compra_(\d{2})\d+\.jpe?g$/i);
  return !!m && m[1] === String(fechaISO || '').split('-')[2];
}

export function nombreUnico(nombre, existentes){
  const hay = n => existentes.some(e => e.toLowerCase() === n.toLowerCase());
  if (!hay(nombre)) return nombre;
  const base = nombre.replace(/\.jpe?g$/i, '');
  let i = 2;
  while (hay(`${base}_${i}.jpg`)) i++;
  return `${base}_${i}.jpg`;
}

// Meses disponibles para el selector de Gastos, a partir de las carpetas AAAA-MM_Mes
// que existen en la raiz de Drive; el mes de HOY siempre esta aunque no tenga carpeta.
export function mesesDeCarpetas(nombres, hoyISOStr){
  const meses = new Set((nombres || [])
    .map(n => { const m = String(n).match(/^(\d{4}-\d{2})_/); return m ? m[1] : null; })
    .filter(Boolean));
  if (hoyISOStr) meses.add(String(hoyISOStr).slice(0, 7));
  return [...meses].sort();
}

// --- Fase 7: carpeta de archivo y acciones al deslizar en Gastos ------------
// Las carpetas archivadas se mueven a «Archivo» dentro de la carpeta matriz: siguen en
// Drive (nada se borra), pero Gastos deja de mostrarlas.
export const CARPETA_ARCHIVO = 'Archivo';

// Reglas de Ari: carpeta vacia → archivar o eliminar; carpeta del MES ACTUAL con
// facturas → intocable; cualquier otra con facturas → solo archivar.
export function accionesCarpeta({ nombre, vacia, hoyISOStr }){
  if (nombre === CARPETA_ARCHIVO) return [];
  if (vacia) return ['archivar', 'eliminar'];
  const m = String(nombre || '').match(/^(\d{4}-\d{2})_/);
  if (m && m[1] === String(hoyISOStr || '').slice(0, 7)) return [];
  return ['archivar'];
}

export function necesitaReArchivo(nombreArchivo, carpetaActual, fechaISO){
  if (!fechaISO) return false;
  if (esProvisional(nombreArchivo)) return true;
  if (nombreCarpetaMes(fechaISO) !== carpetaActual) return true;
  return !nombreCoincideConFecha(nombreArchivo, fechaISO);
}
