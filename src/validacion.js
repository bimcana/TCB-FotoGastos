const MESES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, oct:10, nov:11, dic:12 };

export function ncfValido(ncf){
  if (typeof ncf !== 'string') return false;
  return /^[BE]\d{2}\d{8,10}$/i.test(ncf.trim());
}

export function normalizarFecha(str){
  if (typeof str !== 'string') return null;
  const s = str.trim().toLowerCase();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)))
    return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  if ((m = s.match(/^(\d{1,2})\s+([a-záéíóú]{3})\.?\s+(\d{4})$/))){
    const mes = MESES[m[2].slice(0,3)];
    if (mes) return `${m[3]}-${String(mes).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  }
  return null;
}

export function montoValido(n){ return typeof n === 'number' && Number.isFinite(n) && n >= 0; }

export function buscarDuplicado(indice, ncf){
  if (!indice || !Array.isArray(indice.facturas) || !ncf) return null;
  const objetivo = String(ncf).trim().toLowerCase();
  return indice.facturas.find(f => f.ncf && String(f.ncf).trim().toLowerCase() === objetivo) || null;
}
