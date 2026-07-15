# TCB FotoGastos — Especificación de diseño (versión pública)

**Fecha:** 2026-07-14
**Estado:** Diseño aprobado (con adiciones: híbrido Gemini, importación en lote, modelo TCB)
**Proyecto:** PWA para captura, organización y reporte de facturas con NCF (República Dominicana). La app es producto de **TCB — Tax Consulting Business** (firma de contabilidad); cada empresa cliente de TCB la instala y configura su propio perfil.

## 1. Objetivo

Reemplazar el flujo manual actual (Adobe Scan → carpeta local → renombrado manual → montaje en PowerPoint → PDF para contabilidad) por una sola app instalable en iPhone ("Add to Home Screen" de Safari, alojada en GitHub Pages) que:

1. Fotografía facturas con detección y disparo automático.
2. Produce una ortofoto fiel (sin recreación por IA) con fondo blanco 254,254,254.
3. Lee por OCR la fecha de emisión, total, NCF, RNC emisor, subtotal e ITBIS, con confirmación rápida del usuario.
4. Sube la imagen a la nube (Google Drive u OneDrive, elegible en ajustes) organizada en `CLIENTE_Gastos/AAAA-MM_Mes/Compra_DDN.jpg` siguiendo el sistema de correlativos existente (día 11, primera factura = `110`).
5. Al cierre de mes genera con un botón: el PDF visual (réplica de la plantilla PPTX actual) y un Excel con los datos del Formato 606.

## 2. Arquitectura

- **PWA estática** en GitHub Pages. Sin servidor propio. Instalable, con service worker para uso offline tras la primera carga.
- **Procesamiento en el dispositivo:** OpenCV.js (detección de documento, homografía, limpieza de iluminación), Tesseract.js español (OCR local), pdf-lib (PDF), SheetJS (Excel 606), IndexedDB (cola offline + caché).
- **Nube:** Google Drive API (Google Identity Services + Picker, scope `drive.file`) y Microsoft Graph/OneDrive (MSAL.js). La carpeta destino se elige con el selector nativo y puede ser una carpeta compartida (varios usuarios con cuentas distintas alimentan la misma carpeta).
- **Gemini API (opcional, híbrido anti-errores):** el usuario pega su propia API key en Ajustes (mismo patrón que Fotosuma). Ver §5.

## 2b. Identidad TCB y perfil de empresa

- **Marca TCB:** logo (`TCB Logo.png` en la raíz del proyecto) y copyright de TCB en la interfaz de la app, y pie "© TCB — Tax Consulting Business" en cada página del documento generado. TCB no aparece en el membrete grande, que es siempre de la empresa cliente.
- **Perfil de empresa (Ajustes → Empresa):** logo (imagen que sube el usuario), nombre/razón social, RNC, ubicación, teléfono y correo. Ejemplo: Cliente SRL | RNC: 000-0000-00 | Ciudad, Provincia, Rep. Dom. | Tel: +1 (000) 000-0000 | correo@cliente.com.
- **Una empresa por instalación.** El perfil se guarda localmente y se replica como `_empresa.json` (+ logo) en la carpeta raíz de la nube, de modo que el documento pueda regenerarse desde cualquier dispositivo conectado a esa carpeta. Multi-empresa queda como evolución futura.
- **Onboarding:** la primera vez que se abre la app, pide completar el perfil de empresa antes de la primera subida (se puede posponer; sin perfil, el documento sale sin membrete).
- **Plantilla universal:** el diseño de página de la plantilla PPTX de referencia queda codificado en el generador como formato estándar. Cualquier empresa que empiece de cero obtiene el mismo documento con su propio logo y datos, sin plantilla PowerPoint que mantener.

## 3. Flujo de captura

1. Cámara en vivo con overlay de detección (recuadro azul sobre los bordes del documento). Soporta ratios variables: carta 8.5"×11", tickets largos de supermercado, recibos de gasolinera.
2. Auto-disparo cuando el encuadre es estable ~1 s y pasa la prueba de nitidez (varianza del Laplaciano). Botón manual siempre disponible.
3. Si la detección falla: ajuste manual de 4 esquinas arrastrables.
4. Procesado: warp homográfico a ortofoto respetando el ratio real del papel, normalización adaptativa de iluminación (elimina sombras, atenúa arrugas), fondo blanco RGB 254,254,254, salida JPEG de alta calidad. **Fidelidad estricta: nunca se regeneran píxeles con IA en la versión que se archiva por defecto.**

## 3b. Importación de imágenes existentes (individual y en lote)

Además de la cámara, la app permite subir facturas que ya existen como imagen (fotos compartidas por WhatsApp/Mail, capturas, escaneos previos):

- **Fuente:** selector nativo de iOS (Fototeca o app Archivos) mediante `<input type="file" multiple accept="image/*">`, con selección múltiple para lotes.
- **Mismo pipeline:** cada imagen importada pasa por detección de documento + ortofoto + limpieza (si la app detecta que ya es un escaneo plano y limpio, ofrece saltar el warp) y por el OCR híbrido.
- **Cola de validación uno por uno:** en lotes, la app muestra un progreso ("Validando 3 de 7") y presenta la tarjeta de confirmación de cada factura en secuencia; cada una se sube al confirmarse. Se puede pausar y retomar (la cola persiste en IndexedDB).
- **Nombrado:** el correlativo `Compra_DDN` se asigna según la fecha de emisión leída en cada factura, no según el orden de importación.
- **Trazabilidad:** en `_gastos.json` el campo de origen distingue `camara` / `importada`.
- **Límite honesto de iOS:** una PWA no puede aparecer en el menú "Compartir" de iOS (Web Share Target no está soportado en Safari). El flujo es: guardar la imagen recibida en Fototeca y luego importarla desde la app.

## 4. Confirmación rápida (OCR)

- Se extraen: **Fecha de emisión** (nunca "Válido hasta"/"Fecha de vencimiento"), Total, NCF, RNC del emisor, Subtotal, ITBIS.
- Tarjeta editable de confirmación de un toque antes de subir.
- Validaciones en la tarjeta: formato de NCF (serie B + tipo), fecha de emisión dentro de la vigencia, y **detección de duplicados** por NCF contra el índice del mes.
- Si el OCR falla, los campos quedan vacíos para captura manual; nunca bloquea.

## 5. Híbrido Gemini (anti-errores)

Dos usos separados y opcionales, activables en Ajustes:

**a) Extracción de datos (recomendado activar).** Con API key presente y conexión, la imagen se envía a Gemini (modelo Flash) para extraer los campos; Tesseract.js corre en paralelo como contraste y como único motor offline. Regla de confianza: si ambos coinciden en un campo → verde (alta confianza); si difieren → el campo se resalta en ámbar para revisión del usuario. Este es el "híbrido anti-errores".

**b) Mejora de imagen ("Mejorar con Gemini").** La pantalla de revisión muestra siempre la factura **como se guardaría sin intervención de IA**. Debajo, un botón opcional "Mejorar con Gemini" genera una versión mejorada y la muestra en comparación lado a lado (slider antes/después). El usuario decide cuál archivar; por defecto se archiva la versión sin IA. La app advierte que en la versión IA debe verificarse que cifras y texto coincidan (riesgo de alucinación de caracteres en documentos fiscales).

**Privacidad:** al usar Gemini las imágenes viajan a la API de Google. Costo: el nivel gratuito de AI Studio cubre holgadamente el volumen (~30–40 facturas/mes).

## 6. Organización en la nube

- Carpeta raíz: `CLIENTE_Gastos` (propia o compartida, elegida por el usuario).
- Subcarpeta mensual: `AAAA-MM_Mes` (p. ej. `2025-06_Junio`), creada automáticamente con la primera factura del mes. Orden cronológico natural al ordenar por nombre.
- Archivo: `Compra_DDN.jpg` donde DD = día de emisión y N = correlativo del día (0, 1, 2…). La app consulta los archivos existentes del día para asignar N.
- Índice `_gastos.json` en la carpeta del mes con los metadatos confirmados de cada factura (archivo, fecha, total, subtotal, ITBIS, NCF, RNC emisor, nombre comercio, origen de datos OCR/Gemini/manual). Alimenta el generador, el 606 y los duplicados.
- Sin conexión: cola en IndexedDB; sube automáticamente al reabrir con internet.

## 7. Botón "Generar documento de Gastos"

Para el mes elegido, produce y sube a la carpeta del mes:

1. **PDF** réplica de la plantilla actual: páginas 11"×8.5" horizontal; portada con **membrete completo de la empresa** (logo a la izquierda, datos a la derecha, línea divisoria — como el papel timbrado de la empresa) y título "Facturas NCF | {Mes} {Año}"; **encabezado reducido del membrete** en cada página de facturas; **pie "© TCB — Tax Consulting Business"** en todas las páginas; hasta 3 facturas por página, cada una con etiqueta "RD$ {total}"; facturas largas (ratio alto, p. ej. supermercado) divididas automáticamente en dos columnas con un solo monto (como el slide 9 de la plantilla).
2. **Excel Formato 606**: una fila por factura con RNC emisor, NCF, fecha, subtotal, ITBIS y total.

La pantalla principal muestra el total acumulado del mes en tiempo real.

## 8. Manejo de errores

- OCR/Gemini fallan → campos vacíos editables.
- Detección de documento falla → esquinas manuales.
- Token OAuth expirado → renovación silenciosa; si no es posible, re-login.
- Sin conexión → cola offline; los assets (OpenCV/Tesseract) quedan cacheados tras la primera carga.
- Conflicto de correlativo (dos usuarios suben a la vez) → reintento con el siguiente número libre.

## 9. Fases de construcción

1. **Fase 1:** captura + auto-disparo + ortofoto/limpieza + subida a Google Drive con carpetas y nombrado automático.
2. **Fase 2:** OCR local + tarjeta de confirmación + índice `_gastos.json` + duplicados + importación individual y en lote con cola de validación.
3. **Fase 3:** generador de PDF + Excel 606.
4. **Fase 4:** OneDrive.
5. **Fase 5:** integración Gemini (extracción híbrida + "Mejorar con Gemini").

## 10. Requisitos de configuración (una sola vez)

- Repositorio GitHub + GitHub Pages.
- Client ID OAuth en Google Cloud Console (Drive API + Picker).
- Registro de app en Azure (Microsoft Graph) para OneDrive (Fase 4).
- API key de Gemini en AI Studio (Fase 5, opcional por usuario).

## 11. Prototipo de interfaz

Prototipo navegable (HTML estático) con las pantallas: Cámara (detección + auto-disparo), Revisión (procesada vs original, híbrido Gemini, tarjeta OCR, validaciones), Gastos (mes, listado, Generar documento) y Ajustes (nube, carpeta, Gemini, captura). Publicado como Artifact para probarlo también desde el iPhone.
