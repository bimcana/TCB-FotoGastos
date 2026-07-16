// PDF replica de la plantilla BIMCANA (carta horizontal). Geometria extraida del PPTX
// real (docs/superpowers/specs/2026-07-16-fase3-design.md). pdf-lib se carga perezoso.
import { cargarScript } from './carga.js';

export const PAGINA = { w: 792, h: 612 };
export const X3 = [48, 297, 545.25];
export const X2 = [159.75, 408];
export const X1 = [297];
export const CAJA = { y: 125.25, w: 198, h: 396 };  // y medido desde ARRIBA
const ETIQ_Y = 532.5;                                // y de la etiqueta RD$ desde arriba
const LOGO = { x: 48, y: 39.75, w: 168.75, h: 57 };
const MEMBRETE = { x: 246.75, y: 45 };
const RATIO_LARGA = 3; // alto/ancho mayor a esto = ticket largo → 2 columnas

export function paginar(items){
  const paginas = [];
  let actual = [];
  const ocupadas = arr => arr.reduce((s, x) => s + x.celdas, 0);
  const cierra = () => { if (actual.length){ paginas.push(actual); actual = []; } };
  for (const it of items || []){
    const celdas = it.ratio > RATIO_LARGA ? 2 : 1;
    if (ocupadas(actual) + celdas > 3) cierra();
    actual.push({ ...it, celdas });
  }
  cierra();
  return paginas.map(arr => {
    const xs = ocupadas(arr) === 3 ? X3 : ocupadas(arr) === 2 ? X2 : X1;
    let i = 0;
    return arr.map(it => { const mias = xs.slice(i, i + it.celdas); i += it.celdas; return { ...it, xs: mias }; });
  });
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
  await cargarScript('vendor/pdf-lib/pdf-lib.min.js');
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
      it.xs.forEach((x, k) => {
        const img = imgs[Math.min(k, imgs.length - 1)];
        const esc = Math.min(CAJA.w / img.width, CAJA.h / img.height);
        const w = img.width * esc, h = img.height * esc;
        p.drawImage(img, { x: x + (CAJA.w - w) / 2,
                           y: PAGINA.h - CAJA.y - CAJA.h + (CAJA.h - h) / 2,
                           width: w, height: h });
      });
      const et = fmtRD(it.total);
      const ew = fuentes.bold.widthOfTextAtSize(et, 10.5);
      const xEt = it.xs[it.xs.length - 1]; // bajo la ultima casilla (regla de la plantilla)
      p.drawText(et, { x: xEt + (CAJA.w - ew) / 2, y: PAGINA.h - ETIQ_Y - 10, size: 10.5, font: fuentes.bold, color: gris(0.15) });
    }
    dibujarPie(p, fuentes);
  }
  const bytes = await doc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
