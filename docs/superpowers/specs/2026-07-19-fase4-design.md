# Fase 4 — Cierre profesional: carpeta compartida multi-usuario, Gastos por carpetas, "Sin procesar", regla de altura del PDF y auditoría

**Fecha:** 2026-07-19 · **Estado:** aprobado por Ari ("proceder")

## Decisiones de Ari (2026-07-19)

- **Permiso Drive amplio** (necesario para ver archivos ajenos), con la app RESTRINGIDA en
  código a la carpeta matriz: nada fuera de ella aparece ni se toca. Todos reconectan una vez.
- **Gastos por niveles de carpeta**: acordeón expandir/colapsar de la carpeta matriz
  (reemplaza el selector ‹ › de mes). Generar vive al pie de cada sección de mes.
- **Ajenas**: etiqueta "Sin procesar" → al tocar: recorte automático (clásico→IA) + editor
  manual + tarjeta de datos IA·OCR → Confirmar archiva como Compra_DDN, cruza NCF (duplicada
  si corresponde) y el **original va a la papelera**.
- **PDF — AJUSTE POR ALTURA (regla clave de Ari, verbatim):** por defecto cada factura se
  ESCALA (manteniendo proporción) para ajustarse EN ALTURA a su casilla, completa y del mayor
  tamaño legible. NO se divide. División en 2 columnas SOLO para facturas muy largas
  (supermercado) que escaladas quedarían ilegibles; un solo «RD$ {total}» para la dividida.
  El umbral se CALIBRA con las 57 facturas reales de `Facturas de prueba/`.
- **Versión Lite (futura, otra app)**: solo cámara + edición + subir a la carpeta matriz
  compartida; sin Gastos ni extracción. La arquitectura de esta fase debe soportar ese flujo
  (sus fotos crudas = "Sin procesar" en la Full). Solo se mapea; no se construye ahora.
- **Requisito transversal**: con N usuarios alimentando la MISMA carpeta compartida
  (Full, Lite o Drive directo), la app no puede duplicar ni omitir datos.

## Sección 1 — Robustez multi-usuario (la base de todo)

Problema conocido: `_gastos.json` se escribe con read-modify-write serializado por un mutex
LOCAL; dos dispositivos casi simultáneos pueden pisarse (pérdida de entradas).

Solución (sin backend):
1. **La verdad viaja con cada archivo**: al subir (y en cada actualización de metadatos) se
   escribe la entrada completa como JSON en el campo `description` del archivo en Drive —
   misma llamada, costo cero. Helpers puros `descDeEntrada(entrada)` / `entradaDeDesc(str)`
   (con versión `v:1` y tolerancia a basura).
2. **El índice es caché auto-reparable**: al listar una carpeta de mes, todo
   `Compra_*`/`Pendiente_*` ausente del índice se RESTAURA desde su `description` (bajo el
   mutex, re-chequeando duplicado por NCF al restaurar — regla de Ari). Sin `description`
   legible → se muestra "Sin procesar". Ninguna factura puede desaparecer en silencio.
3. Casos borde documentados: colisión de nombre exacta (dos dispositivos, mismo día, mismo
   correlativo, misma ventana de segundos) es posible en Drive (permite nombres repetidos);
   improbable y visible — se documenta como limitación, no se sobre-ingenia.

## Sección 2 — Permiso y alcance

- `drive.js`: scope pasa de `drive.file` a `https://www.googleapis.com/auth/drive`.
- TODA operación parte de `carpetaRaizId` (ya es así); ninguna consulta sale de la matriz.
- Al reconectar, Google pedirá el consentimiento nuevo una vez (token viejo inválido para el
  scope nuevo: la reconexión silenciosa fallará la primera vez → aviso tocable, un toque).
- Nota honesta registrada: publicar la app OAuth al público con scope amplio exige
  verificación estricta de Google (uso privado TCB: sin impacto).

## Sección 3 — Gastos por carpetas (acordeón)

- Se elimina el selector ‹ › (Fase 3). Gastos lista la carpeta matriz como acordeón:
  - Secciones de MES (`AAAA-MM_Mes`) ordenadas descendente; el mes actual expandido.
  - Secciones para cualquier otra subcarpeta (alfabético, tras los meses).
  - Grupo «Carpeta principal» con archivos de imagen sueltos en la raíz (si hay).
- Encabezado de sección: nombre, nº de facturas, «N por revisar»; chevron ▸/▾. El contenido
  de una sección se carga AL EXPANDIR (una llamada de listado + índice por carpeta, con caché
  de sesión que se refresca al re-expandir).
- Dentro de un mes: filas como hoy (chips de estado, tocables) + las "Sin procesar".
- «Generar documento de Gastos» al pie de CADA sección de mes (genera ese mes). El aviso de
  no-validadas, exclusión de duplicadas y destino (Drive + compartir) no cambian.
- `window.__gastosMes` deja de ser global implícito del "mes visto": el contexto (mesId,
  carpeta, idx) se pasa por sección a `abrirRevisar`/`generarDocumento`.

## Sección 4 — Flujo "Sin procesar"

- Detección: imagen (jpeg/png/webp/heic) dentro de la matriz que no está en el índice de su
  carpeta. PDFs y otros tipos no se listan.
- Al tocar: descarga por id → pipeline EXISTENTE completo: `detectarDocumento` → si null
  `detectarConIA` → editor de esquinas SIEMPRE (precargado) → auto-color → pantalla Revisión
  con tarjeta de datos (toggle IA·OCR, confirmar sin esperar, todo lo ya construido).
- «Confirmar y subir»: `subirFactura` normal (archiva por fecha de emisión en su mes, chequeo
  de duplicado por NCF, cola de revisión si aplica, `description` incluida) y después el
  **original a la papelera** (`trashed: true`); si la papelera falla, toast honesto y el
  original seguirá visible como "Sin procesar" (reintentable).
- HEIC: se intenta decodificar; si el navegador no puede → toast «Formato HEIC no compatible
  en este dispositivo — conviértelo a JPG».
- Origen en el índice: `origen: 'importada'` + `procesadaDesde: {nombre original}`.

## Sección 5 — PDF: regla de ajuste por altura calibrada

- El render ya escala contain (altura manda en facturas verticales): se conserva.
- `RATIO_LARGA` deja de ser 3: se calibra midiendo la proporción alto/ancho post-recorte de
  las 57 facturas reales; el umbral se fija en el hueco entre el grupo normal
  (carta/gasolinera/restaurante) y el grupo supermercado, y queda documentado en el código
  con la tabla de calibración en el spec/plan. La dividida conserva UN solo RD$.

## Sección 6 — Auditoría integral

Pasada módulo por módulo (main.js completo + todos los src/) con corrección inmediata:
concurrencia y estados de la cola/revisor, fugas de objectURL, escape de comillas/backslash
en consultas Drive (`buscarCarpeta`), reintento de `guardarJSON` tras subida (el huérfano
ahora además se auto-sana por la Sección 1), elementos de UI muertos, mensajes honestos.
Todo arreglo con test cuando la lógica sea pura. Verificación end-to-end en navegador con
las facturas reales (detección, filtros, PDF, 606). SW `fase4-v1`. Deploy main+gh-pages.

## Pruebas

- Node: `descDeEntrada`/`entradaDeDesc` (ida y vuelta, basura, versión), conciliación pura
  (`conciliarIndice(idx, archivos)` → restauradas/sin-procesar), umbral `RATIO_LARGA`
  actualizado en tests de `paginar`, más los arreglos de auditoría.
- Navegador: calibración con las 57 reales (tabla de ratios + tasas de detección), acordeón,
  flujo Sin procesar simulado, PDF/606 reales.
- Campo (Ari): reconectar (consentimiento nuevo), soltar una foto cruda en la carpeta desde
  Drive → verla "Sin procesar" → procesarla completa → original a papelera → generar el mes.
