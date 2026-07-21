const MESES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, oct:10, nov:11, dic:12 };

export function ncfValido(ncf){
  if (typeof ncf !== 'string') return false;
  return /^[BE]\d{2}\d{8,10}$/i.test(ncf.trim());
}

// Acepta lo que la gente (y el OCR) escribe de verdad y lo lleva a AAAA-MM-DD:
// ISO, DD/MM/AAAA (con /, -, .), año corto (26→2026), dígitos corridos (17072026),
// mes en letras con espacios o separadores (09 jul. 2026, 17/JUL/2026) y prefijos de
// día de semana (VIE,17/JUL/2026). Lo no reconocible devuelve null (nunca inventa).
export function normalizarFecha(str){
  if (typeof str !== 'string') return null;
  let s = str.trim().toLowerCase();
  s = s.replace(/^[a-záéíóú]{3,4}[.,]\s*/i, ''); // "vie," / "lun." delante de la fecha
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)))
    return `${anio4(m[3])}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  if ((m = s.match(/^(\d{1,2})[\s\/\-.]+([a-záéíóú]{3,4})\.?[\s\/\-.]+(\d{2,4})$/))){
    const mes = MESES[m[2].slice(0,3)];
    if (mes) return `${anio4(m[3])}-${String(mes).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  }
  if ((m = s.match(/^(\d{2})(\d{2})(\d{4})$/))) // 17072026 (teclado numérico sin separadores)
    return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function anio4(a){ return a.length === 2 ? '20' + a : a; }

// Monto escrito por humanos u OCR → número: tolera RD$, espacios (incluso dentro del
// número, típico del OCR), miles con coma o punto, y decimal con coma o punto.
export function normalizarMontoTexto(v){
  if (v == null) return null;
  let s = String(v).replace(/[^\d.,-]/g, ''); // fuera moneda, letras y espacios
  if (!/\d/.test(s)) return null;
  const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.');
  if (coma >= 0 && punto >= 0){
    // ambos presentes: el ÚLTIMO es el decimal, el otro es separador de miles
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (coma >= 0){
    // solo comas: decimal si el último grupo no parece millar (≠3 dígitos)
    const grupos = s.split(',');
    s = grupos[grupos.length - 1].length === 3 && grupos.length > 1 && grupos[0].length <= 3
      ? s.replace(/,/g, '')
      : s.replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function montoValido(n){ return typeof n === 'number' && Number.isFinite(n) && n >= 0; }

// --- Presentacion (Fase 7) -------------------------------------------------
// REGLA: internamente TODO se guarda en ISO (AAAA-MM-DD) porque de ahi salen los nombres
// de carpeta, el orden y el Formato 606. Estas dos funciones son SOLO para mostrar y
// escribir en pantalla, al estilo dominicano: fechas DD-MM-AAAA y montos 2,500.00.

export function formatearFechaDO(valor){
  if (valor == null) return '';
  const s = String(valor).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); // ya esta en formato dominicano
  if (dmy) return `${String(dmy[1]).padStart(2,'0')}-${String(dmy[2]).padStart(2,'0')}-${dmy[3]}`;
  return s; // no reconocida: se respeta lo que haya (no destruir lo que el usuario escribio)
}

export function formatearMonto(n){
  const v = typeof n === 'number' ? n : parseFloat(n);
  if (!Number.isFinite(v)) return '';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function facturaCompleta(datos){
  return !!(normalizarFecha(datos.fechaEmision) && datos.ncf && datos.rncEmisor && montoValido(datos.total));
}

export function estadoFactura(datos, origen){
  if (!facturaCompleta(datos)) return 'incompleta';
  if (origen === 'local') return 'pendiente'; // OCR local: menos confiable, a verificar con Gemini
  return 'completa'; // gemini o manual con esenciales
}

export function buscarDuplicado(indice, ncf){
  if (!indice || !Array.isArray(indice.facturas) || !ncf) return null;
  const objetivo = String(ncf).trim().toLowerCase();
  return indice.facturas.find(f => f.ncf && String(f.ncf).trim().toLowerCase() === objetivo) || null;
}
