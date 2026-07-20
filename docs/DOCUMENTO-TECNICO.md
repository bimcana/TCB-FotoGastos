# TCB FotoGastos — Documento Técnico (versión Full)

> **Para quien modifique esta app en una sesión futura (humano o agente): LEE ESTO COMPLETO
> antes de tocar código.** Contiene la arquitectura, los contratos de datos, las reglas que
> NO se pueden romper y los errores ya cometidos (para no repetirlos). Los specs/planes de
> cada fase viven en `docs/superpowers/`.

## 1. Qué es

PWA estática (sin build, ES modules) en GitHub Pages: fotografía facturas NCF dominicanas,
las recorta (clásico + IA local), lee sus datos (Gemini o OCR local), las archiva en Google
Drive (`AAAA-MM_Mes/Compra_DDN.jpg`), y genera el PDF mensual (réplica de la plantilla TCB)
y el Excel Formato 606. Multi-usuario sobre una carpeta compartida. La versión **Lite**
(repo hermano `TCB-FotoGastos-Lite`) solo alimenta la carpeta; esta Full procesa.

- Producción: `https://bimcana.github.io/TCB-FotoGastos/` · repo `bimcana/TCB-FotoGastos`
- Ramas: trabajo en `faseN` → merge --no-ff a `main` → `gh-pages` se fuerza a `main` y se empuja.

## 2. Mapa de módulos (src/)

| Módulo | Responsabilidad | Puro/Node-testeable |
|---|---|---|
| `main.js` | orquestación completa de UI y flujos (el único archivo grande) | no |
| `camera.js` | getUserMedia + captura de frame | no |
| `detect.js` | detección clásica en cascada (Otsu→adaptativa→Canny), `esquinasDeMascara`, helpers | helpers sí |
| `detectia.js` | U²-Net-p con ONNX Runtime WASM (carga perezosa) | no |
| `esquinas.js` | editor de esquinas a pantalla completa con lupa | no |
| `process.js`/`enhance.js` | ortofoto (warp) + auto-color/filtros | parcial |
| `gemini.js` | extracción con Gemini (+`diagnosticoGemini`, `probarApiKey`) | parseo sí |
| `ocrlocal.js` | Tesseract + `parsearTextoFactura(texto, {rncPropio})` | parser sí |
| `validacion.js` | NCF/fechas/montos: `normalizarFecha`, `normalizarMontoTexto`, `facturaCompleta`, `estadoFactura`, `buscarDuplicado` | sí |
| `naming.js` | `Compra_DDN`, provisionales, `necesitaReArchivo`, `mesesDeCarpetas` | sí |
| `indice.js` | `_gastos.json` + **`descDeEntrada`/`entradaDeDesc`/`conciliarIndice`** | sí |
| `drive.js` | API Drive v3: token persistente, picker de carpetas, papelera, description | no |
| `queue.js`/`revision.js` | colas IndexedDB (subida offline / revisión IA) | no |
| `pdfgastos.js` | `paginar` (puro) + `generarPDF` (pdf-lib); exporta `RATIO_LARGA` | paginar sí |
| `f606.js` | `filas606` (puro) + `generarXLSX606` (SheetJS) | filas sí |
| `empresa.js` | perfil membrete + `_empresa.json` | `empresaCompleta` sí |
| `carga.js` | loader perezoso de UMD vendorizados | no |
| `config.js` | `CLIENT_ID_APP` (público por diseño) | — |

Vendor (~40 MB, NO precacheados los grandes): `opencv.js`, `ort/` + `modelos/u2netp.onnx`
(IA recorte), `tesseract/` (OCR), `pdf-lib/`, `sheetjs/`.

## 3. Contratos de datos (romperlos = corromper datos fiscales)

- **Nombres**: `Compra_DDN.jpg` (DD=día de emisión, N=correlativo desde 0 → 2ª del día 03 =
  `Compra_031.jpg`); provisionales `Pendiente_AAAAMMDD-HHMMSS.jpg`. Carpeta `AAAA-MM_Mes`.
- **`_gastos.json`** (por carpeta de mes): `{facturas:[{archivo, fechaEmision, ncf, rncEmisor,
  nombreComercio, subtotal, itbis, total, origen, duplicada, subidoEn, estado, revisadaIA,
  driveId?, provisional?, procesadaDesde?}]}`. Estados: `completa` (4 esenciales del 606:
  fecha+NCF+RNC+total) / `incompleta` / `pendiente` (espera validación del usuario).
- **`description` del archivo en Drive** = la MISMA entrada como JSON con `v:1` — es la
  fuente de verdad que viaja con el archivo. **TODA escritura de metadatos debe actualizarla**
  (subida, `actualizarEntradaConReArchivo`, re-archivado). `conciliarIndice` restaura al
  listar lo que el índice haya perdido; imagen sin description válida = "Sin procesar".
- **Mutex `conLockIndice`**: TODA escritura a `_gastos.json` pasa por él (read-modify-write).
  Es local por dispositivo; la resiliencia multi-dispositivo la da la description.
- **`_empresa.json`** (raíz): perfil del membrete (logo dataURL PNG ≤460px + 5 campos).
- **Settings (localStorage `tcb:*`)**: `geminiKey, geminiModelo, clientId, carpetaRaizId,
  carpetaRuta, carpetaRaiz, empresa, driveConectadoAntes, driveToken, scopeV, pinAjustes,
  modoImagen, camaraAuto, tema`.
- **IndexedDB**: `fotogastos-cola` (subidas offline `{blob,datos}`) y `fotogastos-rev`
  (revisión IA `{blob,mesId,archivo}`).

## 4. Reglas de oro (violarlas rompió cosas en el pasado)

1. **Subir `VERSION` de `sw.js` en CADA despliegue** — si no, los usuarios quedan cacheados.
2. **UN push por publicación**: esperar a que la construcción de Pages termine antes de
   volver a empujar; los pushes encadenados se CANCELAN entre sí (así se congeló el sitio
   3 días en fase4). Verificar post-deploy: `curl -s .../sw.js?x=$(date +%s) | head -1`.
3. **`.nojekyll` existe y no se borra** (sin él, Jekyll procesa 40 MB y las builds mueren).
4. Scope de Drive es **`auth/drive` completo**, PERO la app solo opera dentro de
   `carpetaRaizId` (vinculada POR ID, no por nombre). No añadir consultas fuera de ella.
5. El repo público **no lleva datos de BIMCANA** (ejemplos: CLIENTE SRL, RNC 000-0000-00).
6. Identificadores ASCII; comentarios y commits en español (`git commit -F` por las tildes).
7. `RATIO_LARGA = 4` (exportado de pdfgastos.js, calibrado con 57 facturas reales — regla
   de altura de Ari: NADA se divide salvo tickets de supermercado; un solo RD$ la dividida).
8. Umbrales calibrados que no se cambian a ciegas: `UMBRAL_NITIDEZ=120`, `FRAMES_ESTABLES=4`,
   detección en vivo SIN rescate hull + `tocaBorde` (anti falsos positivos), import a 1200px,
   editor de esquinas por defecto a marco completo (inset 2%).
9. Las facturas `completa` no se pueden eliminar desde la UI (registro fiscal); solo las de
   etiqueta de alerta (pendiente/incompleta/duplicada/sin procesar), y siempre a PAPELERA.
10. `parsearTextoFactura` recibe `{rncPropio}` (RNC del perfil Empresa) para NO tomar el RNC
    del cliente como emisor (trampa real de los vouchers Cardnet).

## 5. Flujos clave (dónde tocar qué)

- **Captura**: `buclDeteccion` (vivo, estricto) → shutter → `procesarYRevisar` →
  `leerDatosDeFactura` (Gemini con AbortController → OCR local de respaldo; toggle IA·OCR)
  → confirmar (SIEMPRE habilitado; sin fecha → subida provisional) → `subirFactura`.
- **Lote/galería**: `importarLote` → por imagen: detección 1200px → IA → editor SIEMPRE.
- **Ajena ("Sin procesar")**: `procesarAjena` → mismo pipeline → al confirmar, original a
  papelera (`__origenAjeno`, se limpia en shutter/lote/cancelar — no quitar esa limpieza).
- **Revisor background: ELIMINADO (decisión de Ari 2026-07-21, protección de cuota).**
  La IA corre SOLO al capturar/importar foto nueva (`leerDatosDeFactura`) y al presionar
  «Leer con IA» (`leerConIAAhora`). NO re-agregar disparadores automáticos de Gemini.
  `actualizarEntradaConReArchivo` sigue siendo el único camino de escritura de metadatos
  (renombra Pendiente_→Compra_ al saber la fecha, mueve de mes, actualiza description;
  devuelve `{nombreFinal, estado, movidaA, entrada}`). La cola `fotogastos-rev` se conserva
  como almacén del blob que «Leer con IA» reutiliza.
- **Token de Drive**: vive 60 min (límite de Google sin backend). Renovación: al cargar
  (silenciosa; iOS puede bloquearla sin gesto) y en el PRIMER `pointerdown` del usuario
  (throttle 30 s) — no quitar ese listener: es lo que evita el "No conectada" tras 1 h.
- **Panel de edición**: `abrirRevisar`/`rellenarPanel`; botones Leer con IA / Reintentar OCR
  (`leerConIAAhora('auto'|'ocr')`) / Ver imagen / Eliminar / Confirmar. Campos con corrección
  tipo Excel (`normalizarCampoEntrada`).
- **Generar**: por sección de mes en el acordeón → `generarDocumento(ctx)` → PDF + 606 →
  `subirOReemplazar` + hoja de compartir iOS.

## 6. Desarrollo y pruebas

- Tests: `npm test` (node --test; ~110). Solo lógica pura — TODO helper nuevo puro lleva test.
- Prueba en navegador local: `npx -y http-server -p PUERTO -c-1 .` — **usa un puerto NUEVO**
  si el SW sirve caché terca. En el Browser pane del agente la pestaña está `hidden`: los
  `requestAnimationFrame` de `conOverlay` no corren → shim de prueba
  `window.requestAnimationFrame = cb => setTimeout(cb, 16)` ANTES de ejercitar flujos.
- Facturas reales de prueba: `../Facturas de prueba/` (57). Plantilla PDF/PPTX de referencia:
  `../Junio 2025/`.
- OAuth: Client ID en `config.js` (público); orígenes autorizados incluyen
  `https://bimcana.github.io`. App publicada "In production" sin verificación (pantalla
  "no verificada" 1 vez por usuario; tope 100 usuarios; verificación CASA solo si escala).

## 7. Backlog conocido

- Publicar la Lite en GitHub (repo por crear) — ver su propio DOCUMENTO-TECNICO.md.
- Opcional: mover vendors pesados (ort/modelos/tesseract ~27 MB) a CDN con runtime-cache
  → sitio ~13 MB y builds de segundos. OneDrive (otra versión). Capacitor (app nativa).
- Limitación documentada: colisión de nombre si 2 dispositivos suben el mismo día en la
  misma ventana de segundos (Drive permite nombres duplicados; raro y visible).
