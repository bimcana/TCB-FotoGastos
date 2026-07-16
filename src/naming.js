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

export function necesitaReArchivo(nombreArchivo, carpetaActual, fechaISO){
  if (!fechaISO) return false;
  if (esProvisional(nombreArchivo)) return true;
  if (nombreCarpetaMes(fechaISO) !== carpetaActual) return true;
  return !nombreCoincideConFecha(nombreArchivo, fechaISO);
}
