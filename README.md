# TCB FotoGastos

Prototipo de interfaz de **TCB FotoGastos**, una PWA de **TCB — Tax Consulting Business** para que sus empresas clientes fotografíen facturas con comprobante fiscal (NCF, República Dominicana), las organicen automáticamente en la nube y generen el documento mensual de gastos y los datos del Formato 606.

**Prototipo en vivo:** https://ariesteban.github.io/TCB-FotoGastos/

**Maqueta original (referencia):** https://ariesteban.github.io/TCB-FotoGastos/prototipo/

En iPhone: abrir en Safari → Compartir → **Añadir a pantalla de inicio**.

> Estado: **Fase 2E** — autorecorte de importación con **IA local** (U²-Net-p sobre ONNX Runtime WASM, ~18 MB de descarga única cacheada por el service worker; funciona offline): el editor de esquinas abre siempre con el documento ya detectado, estilo Adobe Scan. Revisor con Gemini **visible**: arranca solo tras cada subida, chip animado "Leyendo con IA…" en Gastos, el panel abierto se rellena al terminar, y botón **"Leer con IA"** como reintento manual. **Reconexión automática de Drive** al abrir (o aviso tocable "Reconectar" en Gastos). El icono de cola abre un **panel** para ver/reintentar/eliminar lo que espera conexión. La cámara en vivo vuelve al criterio estricto (sin falsos positivos sobre fondos texturados). Sobre la **Fase 2D** (guardado provisional + re-archivado automático + toggle IA/OCR + esquinas con lupa).
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
