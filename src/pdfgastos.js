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

// REPARTO DE ANCHO (Ari, 2026-08-11): una factura de formato carta (8.5x11 → ratio 1.29)
// escalada a una casilla de 198x396 solo alcanza ~256 pt de alto: se ve diminuta al lado
// de un ticket, que si llena los 396. La causa es que la casilla es fija y estrecha.
// SOLUCION: el ancho ya no es fijo — cada factura recibe el ancho que necesita para
// llegar a una MISMA altura, y esa altura es la mayor que permita la banda. Asi una carta
// toma ~306 pt de ancho y llega a los 396 de alto, igual que los tickets.
// Una pagina se cierra cuando meter la siguiente encogeria a todas por debajo de
// ALTURA_MIN — de ahi salen solas las reglas que pidio Ari: dos cartas ocupan una pagina
// entera, y una carta con un ticket largo tambien.
export const ALTURA_MIN = 340;   // ~86% de la altura de banda; por debajo se ve pequeño

// Columnas que ocupa una factura, con el ratio de CADA columna. El ticket largo se parte
// en 2 mitades verticales, asi que cada mitad tiene la mitad de esbeltez.
export function columnasDe(ratio){
  return ratio > RATIO_LARGA ? [ratio / 2, ratio / 2] : [ratio];
}

// Altura comun maxima para un conjunto de columnas: la mayor h tal que la suma de anchos
// (h/ratio de cada una) mas los huecos quepa en la banda. Puro.
export function alturaComun(ratiosCol, alturaMax = CAJA.h, anchoUtil = ANCHO_UTIL, hueco = HUECO){
  const n = ratiosCol.length;
  if (!n) return 0;
  const disponible = anchoUtil - (n - 1) * hueco;
  if (disponible <= 0) return 0;
  const suma = ratiosCol.reduce((s, r) => s + 1 / r, 0);
  return Math.min(alturaMax, disponible / suma);
}

// Reparte una pagina ya cerrada: calcula la altura comun, el ancho de cada columna y las
// posiciones x (el grupo queda centrado en la banda).
function disponer(arr){
  const ratiosCol = arr.flatMap(it => columnasDe(it.ratio));
  const h = alturaComun(ratiosCol);
  const anchos = ratiosCol.map(r => h / r);
  const total = anchos.reduce((s, w) => s + w, 0) + (ratiosCol.length - 1) * HUECO;
  let x = X_INI + (ANCHO_UTIL - total) / 2;
  let k = 0;
  return arr.map(it => {
    const cajas = columnasDe(it.ratio).map(() => {
      const caja = { x, w: anchos[k], h };
      x += anchos[k] + HUECO;
      k++;
      return caja;
    });
    return { ...it, celdas: cajas.length, cajas, alturaCaja: h };
  });
}

export function paginar(items){
  const paginas = [];
  let actual = [];
  const cierra = () => { if (actual.length){ paginas.push(disponer(actual)); actual = []; } };
  for (const it of items || []){
    const cols = [...actual, it].flatMap(x => columnasDe(x.ratio));
    // Cabe si no pasa de 3 columnas Y si al repartir todas siguen viendose grandes.
    if (actual.length && (cols.length > MAX_COLUMNAS || alturaComun(cols) < ALTURA_MIN)) cierra();
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
