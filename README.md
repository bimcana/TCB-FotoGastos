# TCB FotoGastos

Prototipo de interfaz de **TCB FotoGastos**, una PWA de **TCB — Tax Consulting Business** para que sus empresas clientes fotografíen facturas con comprobante fiscal (NCF, República Dominicana), las organicen automáticamente en la nube y generen el documento mensual de gastos y los datos del Formato 606.

**Prototipo en vivo:** https://ariesteban.github.io/TCB-FotoGastos/

**Maqueta original (referencia):** https://ariesteban.github.io/TCB-FotoGastos/prototipo/

En iPhone: abrir en Safari → Compartir → **Añadir a pantalla de inicio**.

> Estado: **Fase 2A** — OCR con Gemini (`gemini-2.5-flash`): al capturar, lee fecha de emisión, NCF, RNC emisor, ITBIS y total en una tarjeta de confirmación editable; archiva por la fecha de emisión, registra los metadatos en `_gastos.json` en la carpeta del mes y detecta duplicados por NCF. Requiere pegar la API key de Gemini en Ajustes. Sobre las fases 1.5 (captura + auto-color + 4 modos + visor) y la Fase 1 (Google Drive). La maqueta de referencia sigue en `/prototipo/`.
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
