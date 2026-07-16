# TCB FotoGastos

Prototipo de interfaz de **TCB FotoGastos**, una PWA de **TCB — Tax Consulting Business** para que sus empresas clientes fotografíen facturas con comprobante fiscal (NCF, República Dominicana), las organicen automáticamente en la nube y generen el documento mensual de gastos y los datos del Formato 606.

**Prototipo en vivo:** https://ariesteban.github.io/TCB-FotoGastos/

**Maqueta original (referencia):** https://ariesteban.github.io/TCB-FotoGastos/prototipo/

En iPhone: abrir en Safari → Compartir → **Añadir a pantalla de inicio**.

> Estado: **Fase 2D** — guardar sin esperar a la IA: «Confirmar y subir» funciona durante la lectura; la factura sube provisional (`Pendiente_…`) y el revisor en background la re-lee, la renombra a `Compra_DDN.jpg` y la mueve a su carpeta de mes al conocer la fecha de emisión. Toggle **IA/OCR** en la tarjeta de datos (OCR cancela a Gemini si se demora). En Gastos, TODAS las facturas se abren y editan (con miniatura); cambiar la fecha re-archiva igual. Detección de esquinas en cascada (Otsu → adaptativa → Canny) para importaciones con fondos difíciles, y editor de esquinas a **pantalla completa con lupa** estilo Adobe Scan. Sobre la **Fase 2C.2** (revisor con Gemini), la 2B (lote) y la 2A (OCR).
>
> Al desplegar cambios, sube la constante VERSION de sw.js para que los usuarios reciban la actualización.

## Pantallas

- **Cámara** — detección de documento con disparo automático e importación desde la galería (individual o en lote).
- **Revisión** — ortofoto fiel (sin IA) vs. original, mejora opcional con Gemini (comparador antes/después), datos leídos por OCR híbrido, validaciones de NCF y alerta de **Factura Duplicada** (descartar o subir marcada).
- **Gastos** — total del mes, facturas recientes (las duplicadas que subieron desde la cola sin red se resaltan en rojo) y botón «Generar documento de Gastos» (PDF con membrete de la empresa + Excel 606).
- **Ajustes** — tema de interfaz (oscuro «TCB Glass» o claro estilo iOS), perfil de la empresa cliente (logo y datos del membrete), nube (Google Drive / OneDrive), llave de Gemini y opciones de captura.

## Hoja de ruta

1. Captura + subida a Google Drive con carpetas y nombrado automático
2. OCR + confirmación + importación en lote
3. Generador de PDF + Excel 606
4. OneDrive
5. Integración Gemini (extracción híbrida y mejora de imagen)

---
© TCB — Tax Consulting Business
