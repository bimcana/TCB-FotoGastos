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
