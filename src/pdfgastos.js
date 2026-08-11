// PDF replica de la plantilla BIMCANA (carta horizontal). Geometria extraida del PPTX
// real (docs/superpowers/specs/2026-07-16-fase3-design.md). pdf-lib se carga perezoso.
import { cargarScript } from './carga.js';

export const PAGINA = { w: 792, h: 612 };
export const CAJA = { y: 125.25, w: 198, h: 396 };  // y medido desde ARRIBA
const ETIQ_Y = 532.5;                                // y de la etiqueta RD$ desde arriba
const LOGO = { x: 48, y: 39.75, w: 168.75, h: 57 };
const MEMBRETE = { x: 246.75, y: 45 };

// Banda horizontal util: de la 1a casilla del PPTX (x=48) al fin de la 3a (743.25),
// con el mismo hueco entre casillas. Con 3 columnas iguales sale el ancho historico 198.
export const X_INI = 48;
export const ANCHO_UTIL = 695.25;
export const HUECO = 51;
export const MAX_COLUMNAS = 3;

// REGLA DE ALTURA (Ari, 2026-07-19): por defecto cada factura se ESCALA completa a la
// altura de su casilla. Division en 2 columnas SOLO para tickets muy largos (supermercado)
// que escalados quedarian ilegibles. Umbral calibrado con 57 facturas reales: los ratios
// normales llegan a 3.80 y los de supermercado empiezan en 4.35 → corte en 4.
export const RATIO_LARGA = 4;

// TAMAÑO SEGUN EL PAPEL REAL (Ari, 2026-08-11, 2a pasada).
// 1er intento: igualar la ALTURA de todas. Error — un voucher de gasolina (papel de 2.5-3"
// y pocas lineas) se estiraba hasta parecer tan grande como una hoja carta, "compitiendo
// visualmente con las otras dos que fisicamente son mas grandes".
// AHORA: se estima el tamaño FISICO del papel y todas las facturas de una pagina se
// escalan con el MISMO factor (pt por pulgada). Asi el PDF respeta las proporciones
// reales: la carta se ve grande, el ticket de supermercado alto, y el voucher de
// gasolina pequeño — que es como estan sobre la mesa.
// El ancho fisico se deduce del ratio, calibrado con 93 facturas reales: hasta 1.9 son
// hojas (carta/A4, 8.5"), por encima son rollos de caja (~3").
export const RATIO_CARTA = 1.9;
export const ANCHO_CARTA = 8.5;   // pulgadas
export const ANCHO_ROLLO = 3;
// REGLA DE LLENADO (Ari, 2026-08-11, tras ver el PDF real): **SIEMPRE 3 facturas por
// pagina**, con solo dos excepciones — un ticket de supermercado (ocupa 2 columnas) y
// dos hojas carta juntas (llenan la pagina entre las dos).
// Antes habia un umbral `FACTOR_MIN` que cerraba la pagina si al repartir todo quedaba
// pequeño. Fue un error: dejaba facturas SOLAS en su pagina (medido con las 36 de Junio
// 2025: 6 paginas de una sola factura). El tamaño lo resuelve `factorEscala`; cuantas
// caben es una decision de maquetacion, no de escala.
// Las facturas de rollo pueden ensancharse hasta un 10% cuando sobra sitio: ayuda a leer
// el texto sin deformarlas de forma perceptible (autorizado por Ari).
export const ESTIRADO_MAX = 1.10;

export function esCarta(ratio){ return ratio < RATIO_CARTA; }

export function anchoFisico(ratio){
  return esCarta(ratio) ? ANCHO_CARTA : ANCHO_ROLLO;
}

// ¿Cabe `nuevo` en la pagina que ya tiene `actual`? Puro y testeado: es LA regla de
// maquetacion, separada del calculo de tamaños.
export function cabeEnPagina(actual, nuevo){
  const items = [...actual, nuevo];
  const columnas = items.reduce((s, x) => s + columnasDe(x.ratio).length, 0);
  if (columnas > MAX_COLUMNAS) return false;          // el supermercado se lleva 2
  // Dos hojas carta ya llenan la pagina: no entra una tercera factura.
  if (items.filter(x => esCarta(x.ratio)).length >= 2 && items.length > 2) return false;
  return true;
}

// Columnas que ocupa una factura, con su tamaño FISICO en pulgadas. El ticket de
// supermercado se parte en 2 mitades, asi que cada una mide la mitad de alto.
export function columnasDe(ratio){
  const w = anchoFisico(ratio);
  const h = w * ratio;
  return ratio > RATIO_LARGA ? [{ w, h: h / 2, ratio }, { w, h: h / 2, ratio }] : [{ w, h, ratio }];
}

// Puntos por pulgada con los que se dibuja una pagina: el mayor que hace que todo quepa
// a lo ancho de la banda y que la mas alta no rebase la altura de casilla. Puro.
export function factorEscala(cols, alturaMax = CAJA.h, anchoUtil = ANCHO_UTIL, hueco = HUECO){
  const n = cols.length;
  if (!n) return 0;
  const disponible = anchoUtil - (n - 1) * hueco;
  if (disponible <= 0) return 0;
  const sumaAncho = cols.reduce((s, c) => s + c.w, 0);
  const maxAlto = Math.max(...cols.map(c => c.h));
  return Math.min(disponible / sumaAncho, alturaMax / maxAlto);
}

// Reparte una pagina ya cerrada: escala con el factor comun, estira los rollos si sobra
// sitio y separa las cajas de forma uniforme (el grupo queda centrado en la banda).
function disponer(arr){
  const cols = arr.flatMap(it => columnasDe(it.ratio));
  const n = cols.length;
  const factor = factorEscala(cols);
  const anchos = cols.map(c => c.w * factor);
  const altos = cols.map(c => c.h * factor);
  // Estirado: solo los rollos, y solo con el ancho que de verdad sobra.
  const usado = anchos.reduce((s, w) => s + w, 0);
  const anchoRollos = cols.reduce((s, c, i) => s + (c.ratio >= RATIO_CARTA ? anchos[i] : 0), 0);
  const sobra = (ANCHO_UTIL - (n - 1) * HUECO) - usado;
  const estirado = (sobra > 0 && anchoRollos > 0)
    ? Math.min(ESTIRADO_MAX, 1 + sobra / anchoRollos) : 1;
  cols.forEach((c, i) => { if (c.ratio >= RATIO_CARTA) anchos[i] *= estirado; });
  // Separacion uniforme entre HUECO y el doble, con el conjunto centrado.
  const usadoFinal = anchos.reduce((s, w) => s + w, 0);
  const sep = n > 1
    ? Math.min(HUECO * 2, Math.max(HUECO, (ANCHO_UTIL - usadoFinal) / (n + 1)))
    : 0;
  let x = X_INI + (ANCHO_UTIL - (usadoFinal + sep * (n - 1))) / 2;
  let k = 0;
  return arr.map(it => {
    const cajas = columnasDe(it.ratio).map(() => {
      const caja = { x, w: anchos[k], h: altos[k] };
      x += anchos[k] + sep;
      k++;
      return caja;
    });
    return { ...it, celdas: cajas.length, cajas, alturaCaja: cajas[0].h, factor };
  });
}

export function paginar(items){
  const paginas = [];
  let actual = [];
  const cierra = () => { if (actual.length){ paginas.push(disponer(actual)); actual = []; } };
  for (const it of items || []){
    if (actual.length && !cabeEnPagina(actual, it)) cierra();
    actual.push(it);
  }
  cierra();
  return paginas;
}

function fmtRD(n){
  return 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 });
}

let _rgb = null;
const gris = v => _rgb(v, v, v);

function dibujarEncabezado(p, fuentes, empresa, logo){
  const { font } = fuentes;
  if (logo){
    const esc = Math.min(LOGO.w / logo.width, LOGO.h / logo.height);
    p.drawImage(logo, { x: LOGO.x, y: PAGINA.h - LOGO.y - LOGO.h + (LOGO.h - logo.height * esc) / 2,
                        width: logo.width * esc, height: logo.height * esc });
  }
  const lineas = [
    `${empresa.razon || ''} | RNC: ${empresa.rnc || ''}`,
    empresa.ubicacion || '',
    [empresa.tel ? 'Tel: ' + empresa.tel : '', empresa.correo ? 'Correo: ' + empresa.correo : ''].filter(Boolean).join('  |  ')
  ].filter(Boolean);
  lineas.forEach((t, i) => p.drawText(t, {
    x: MEMBRETE.x, y: PAGINA.h - MEMBRETE.y - 9 - i * 12, size: 10, font, color: gris(0.25)
  }));
}

function dibujarPie(p, fuentes){
  const t = '© TCB — Tax Consulting Business';
  const w = fuentes.font.widthOfTextAtSize(t, 8);
  p.drawText(t, { x: (PAGINA.w - w) / 2, y: 16, size: 8, font: fuentes.font, color: gris(0.45) });
}

export async function generarPDF(paginas, empresa, mesTexto){
  // Si pdf-lib ya esta cargado (o inyectado en pruebas) no se vuelve a pedir.
  if (typeof PDFLib === 'undefined') await cargarScript('vendor/pdf-lib/pdf-lib.min.js');
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  _rgb = rgb;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fuentes = { font, bold };
  let logo = null;
  if (empresa.logoB64){
    try { logo = await doc.embedPng(empresa.logoB64); }
    catch(e){ try { logo = await doc.embedJpg(empresa.logoB64); } catch(e2){ console.error('logo:', e2); } }
  }
  // Portada: titulo centrado + logo abajo-izquierda (geometria del layout2 del PPTX)
  const p0 = doc.addPage([PAGINA.w, PAGINA.h]);
  const titulo = `Facturas NCF | ${mesTexto}`;
  const tw = fuentes.bold.widthOfTextAtSize(titulo, 32);
  p0.drawText(titulo, { x: (PAGINA.w - tw) / 2, y: 295, size: 32, font: fuentes.bold, color: gris(0.12) });
  if (logo){
    const esc = Math.min(173.25 / logo.width, 58.5 / logo.height);
    p0.drawImage(logo, { x: 57, y: PAGINA.h - 516.75 - 58.5, width: logo.width * esc, height: logo.height * esc });
  }
  dibujarPie(p0, fuentes);
  // Paginas de facturas
  for (const items of paginas){
    const p = doc.addPage([PAGINA.w, PAGINA.h]);
    dibujarEncabezado(p, fuentes, empresa, logo);
    for (const it of items){
      const imgs = [];
      for (const bytes of it.partes) imgs.push(await doc.embedJpg(bytes));
      // Cada caja trae su ancho/alto ya repartidos (ver `disponer`): la imagen se escala
      // a lo que quepa dentro y se centra, asi que nunca se deforma ni se sale.
      it.cajas.forEach((caja, k) => {
        const img = imgs[Math.min(k, imgs.length - 1)];
        const esc = Math.min(caja.w / img.width, caja.h / img.height);
        const w = img.width * esc, h = img.height * esc;
        p.drawImage(img, { x: caja.x + (caja.w - w) / 2,
                           y: PAGINA.h - CAJA.y - CAJA.h + (CAJA.h - h) / 2,
                           width: w, height: h });
      });
      const et = fmtRD(it.total);
      const ew = fuentes.bold.widthOfTextAtSize(et, 10.5);
      const ult = it.cajas[it.cajas.length - 1]; // bajo la ultima casilla (regla de la plantilla)
      p.drawText(et, { x: ult.x + (ult.w - ew) / 2, y: PAGINA.h - ETIQ_Y - 10, size: 10.5, font: fuentes.bold, color: gris(0.15) });
    }
    dibujarPie(p, fuentes);
  }
  const bytes = await doc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
