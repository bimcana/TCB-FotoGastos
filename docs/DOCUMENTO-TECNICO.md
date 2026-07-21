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
- Ramas: trabajo en `faseN` → merge --no-ff a `main`. **`git push origin main` = publicar.**
- **Pages publica desde `main` (root) en AMBAS apps** (unificado 2026-07-21; la Lite estaba
  en `gh-pages`). La rama `gh-pages` fue **borrada en los dos repos**: no hay paso de
  compilación (el contenido del repo *es* el sitio), así que una segunda rama solo añadía
  un ritual de sincronización y una fuente de errores — ya provocó uno (ver §4.2).
  **No volver a crear `gh-pages`.**

## 2. Mapa de módulos (src/)

| Módulo | Responsabilidad | Puro/Node-testeable |
|---|---|---|
| `main.js` | orquestación completa de UI y flujos (el único archivo grande) | no |
| `camera.js` | getUserMedia + captura de frame | no |
| `detect.js` | detección clásica en cascada (Otsu→adaptativa→Canny), `esquinasDeMascara`, helpers | helpers sí |
| `detectia.js` | U²-Net-p con ONNX Runtime WASM (carga perezosa) | no |
| `esquinas.js` | editor de esquinas a pantalla completa con lupa; handles laterales (`puntosMedios`/`desplazarLado` puros) | helpers sí |
| `process.js`/`enhance.js` | ortofoto (warp) + auto-color/filtros | parcial |
| `gemini.js` | extracción con Gemini (+`diagnosticoGemini`, `probarApiKey`) | parseo sí |
| `ocrlocal.js` | Tesseract + `parsearTextoFactura(texto, {rncPropio})` | parser sí |
| `validacion.js` | NCF/fechas/montos: `normalizarFecha`, `normalizarMontoTexto`, `facturaCompleta`, `estadoFactura`, `buscarDuplicado`, `rncValido` (dígito verificador DGII), `deducirMontos`, `afinarDatosFactura` | sí |
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
  **Fase 10:** «Confirmar y subir» con la tarjeta a la vista marca
  `datos.validadaPorUsuario` → `estadoFactura(datos, origen, {validadaPorUsuario})`
  devuelve `completa` aunque el motor haya sido el OCR local. Sin esto, con OCR por
  defecto (Fase 9) TODA captura caía como «Pendiente de revisión» pese a haberla
  revisado el humano. `pendiente` queda solo para lo que nadie validó: provisionales
  (sin fecha) y lo que rellena «Leer con IA». Confirmar NO tapa un esencial vacío.
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
   **Un push puede NO disparar la construcción** (pasó en fase8: `main` actualizada y cero
   ejecuciones). Antes de culpar a la caché, comprobar el estado real:
   `curl -s "https://api.github.com/repos/bimcana/TCB-FotoGastos/actions/runs?per_page=3"`
   — si no hay ninguna `queued`/`in_progress`, no hay nada en vuelo y re-disparar con
   `git commit --allow-empty` + push es seguro (la regla de arriba protege contra empujar
   SOBRE una cola activa, no contra re-disparar cuando no hay ninguna).
3. **`.nojekyll` existe y no se borra** (sin él, Jekyll procesa 40 MB y las builds mueren).
4. Scope de Drive es **`auth/drive` completo**, PERO la app solo opera dentro de
   `carpetaRaizId` (vinculada POR ID, no por nombre). No añadir consultas fuera de ella.
5. El repo público **no lleva datos de BIMCANA** (ejemplos: CLIENTE SRL, RNC 000-0000-00).
6. Identificadores ASCII; comentarios y commits en español (`git commit -F` por las tildes).
7. `RATIO_LARGA = 4` (exportado de pdfgastos.js, calibrado con 57 facturas reales — regla
   de altura de Ari: NADA se divide salvo tickets de supermercado; un solo RD$ la dividida).
8. Umbrales calibrados que no se cambian a ciegas: `UMBRAL_NITIDEZ=120`, `FRAMES_ESTABLES=4`,
   `TOL_ESTABLE=0.02` (Fase 9, pedido de Ari: 2% del ancho tolera el temblor natural de la
   mano; un frame tembloroso con documento detectado DEGRADA el conteo `estables` en vez de
   reiniciarlo — la nitidez dentro del papel sigue siendo la guarda anti-foto-movida),
   detección en vivo SIN rescate hull + `tocaBorde` (anti falsos positivos), import a 1200px,
   editor de esquinas por defecto a marco completo (inset 2%). Cámara pide enfoque continuo
   (`focusMode:'continuous'`) best-effort en camera.js.
9. Las facturas `completa` no se pueden eliminar desde la UI (registro fiscal); solo las de
   etiqueta de alerta (pendiente/incompleta/duplicada/sin procesar), y siempre a PAPELERA.
10. `parsearTextoFactura` recibe `{rncPropio}` (RNC del perfil Empresa) para NO tomar el RNC
    del cliente como emisor (trampa real de los vouchers Cardnet).

## 5. Flujos clave (dónde tocar qué)

- **Captura**: `buclDeteccion` (vivo, estricto) → shutter → `procesarYRevisar` →
  `leerDatosDeFactura` → confirmar (SIEMPRE habilitado; sin fecha → subida provisional)
  → `subirFactura`. **Motor por defecto = OCR LOCAL (Fase 9, decisión de Ari):** el
  usuario repite la foto varias veces mirando cómo quedó; Gemini en cada intento agota
  la cuota gratis. La IA corre SOLO a pedido: toggle IA en la tarjeta o «Leer con IA»
  en Gastos. NO volver a poner 'ia' como `motorPreferido` por defecto.
- **Lote/galería (Fase 10, `recortarImportada` en main.js)**: cascada
  `detectarDocumento` → `rectanguloDePapel` (minAreaRect + guarda de llenado ≥0.82: una
  factura ES un rectángulo, robusto a bordes ondulados donde approxPolyDP daba quads
  torcidos) → IA → `bandaDePapel` → editor. Se acepta el PRIMERO que pase **dos** filtros:
  1. **Forma** — `recorteConfiable`: cuadrilátero válido + área ≥15% + ángulos 65–115° +
     `ladosOpuestosParecidos` (≤30%).
  2. **Contenido** — `fraccionClara(canvas, esquinas) ≥ 0.75`. **Esta es la que importa.**
     El fallo de campo de Ari era un *paralelogramo rotado* que pasaba TODA guarda
     geométrica (ángulos ~90°, lados iguales) pero se había comido una franja de granito;
     solo la fracción de píxeles claros lo distingue (medido: 0.61 vs 0.98 del correcto).
     **No relajar este umbral sin volver a medir con fotos reales.**
  `bandaDePapel` = pedido literal de Ari: laterales del papel prolongados a los bordes
  superior e inferior de la FOTO (`extenderLateralesAlMarco`, puro), con la inclinación
  del propio papel. **Se probó medir el ángulo por proyección del texto y devolvía 10°
  donde el ticket estaba a 5°** — se descartó: en una factura el texto es paralelo al
  borde del papel, así que la geometría del papel da el mismo resultado y es fiable.
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
  Fase 8: el mismo listener renueva PROACTIVAMENTE si el token expira en <5 min
  (`porExpirar` en drive.js) — refresca solo el token, sin `postConexion`. Botón
  `#btn-reconectar` («Reconectar a Drive») en el encabezado de Gastos, mismo flujo de un
  toque que el subtítulo tocable (`reconectarConGesto`).
  **Fase 10 — el botón se deriva del estado REAL, no del momento de la llamada:**
  `debeMostrarReconectar(conectado, huboConexionPrevia)` (puro, en drive.js, con tests) +
  `sincronizarEstadoDrive()` en main.js, invocado al abrir Gastos, en `visibilitychange`
  y tras cada intento de conexión. Además `postConexion` oculta el aviso en su PRIMERA
  línea: antes lo hacía al final, así que si fallaba a mitad (carpeta inaccesible,
  `_empresa.json` ilegible) el botón quedaba visible con Drive conectado — el bug de
  campo. `mostrarAvisoReconectar` también se auto-anula si `conectado()`.
- **Lectura Fase 8 (calidad de OCR/IA)**: la lectura NO usa el filtro visual activo —
  `canvasParaLectura(motor)` en main.js da a cada motor su mejor estado de imagen desde
  `canvasPlano` con intensidad 65: Gemini → 'color' (auto-color), Tesseract → 'grises';
  cacheado por captura en `__resultado.lectura`. TODO resultado de motor pasa por
  `afinarDatosFactura` (validacion.js): descarta el RNC del comprador (perfil Empresa) y
  deduce el monto faltante (total = subtotal + itbis) sin pisar valores leídos. El chip
  «RNC verificado» usa `rncValido` (dígito verificador mod-11/Luhn — la consulta EN LÍNEA
  a DGII no es viable desde una PWA estática: WebForms sin CORS, web service móvil
  retirado; verificado 2026-07-21). El prompt de Gemini recibe `rncCliente` y reglas de
  nombreComercio (texto grande/logo, razón social preferida, nunca la dirección).
- **Carpetas en Gastos (Fase 7)**: deslizar el encabezado a la izquierda revela acciones
  según `accionesCarpeta({nombre, vacia, hoyISOStr})` (naming.js, puro): vacía →
  `['archivar','eliminar']`; mes ACTUAL con facturas → `[]`; resto → `['archivar']`.
  Archivar mueve la carpeta a `CARPETA_ARCHIVO` ('Archivo') dentro de la matriz con
  `moverACarpeta`; esa carpeta se EXCLUYE del árbol de Gastos (solo se ve en Drive).
  Eliminar (solo vacías) va a papelera. `armarDeslizamiento` distingue toque de
  deslizamiento con `fila.dataset.deslizando`.
- **Formato de presentación (Fase 7)**: se GUARDA ISO (`AAAA-MM-DD`) y número; se MUESTRA
  `DD-MM-AAAA` y `2,500.00` vía `formatearFechaDO`/`formatearMonto` (validacion.js).
  Al leer, `normalizarFecha`/`normalizarMontoTexto` revierten. NO cambiar el
  almacenamiento a DD-MM: lo consumen nombres de carpeta, orden y el 606.
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
