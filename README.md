# TCB FotoGastos

Prototipo de interfaz de **TCB FotoGastos**, una PWA de **TCB — Tax Consulting Business** para que sus empresas clientes fotografíen facturas con comprobante fiscal (NCF, República Dominicana), las organicen automáticamente en la nube y generen el documento mensual de gastos y los datos del Formato 606.

**Prototipo en vivo:** https://ariesteban.github.io/TCB-FotoGastos/

**Maqueta original (referencia):** https://ariesteban.github.io/TCB-FotoGastos/prototipo/

En iPhone: abrir en Safari → Compartir → **Añadir a pantalla de inicio**.

> Estado: **Fase 2C.2** — revisor con Gemini: las facturas subidas incompletas o leídas con OCR local quedan "Pendiente de revisión"; al abrir la app con conexión + API key, Gemini las re-lee y completa (una PWA no procesa con la app cerrada). Tocar una factura por revisar en Gastos abre un panel editable para confirmarla. Sobre la **Fase 2B** (importación en lote) y la 2A (OCR).
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
