# TCB FotoGastos — Documento Técnico (versión Full)

> **¿Retomando el proyecto? Empieza por [CONTINUIDAD.md](CONTINUIDAD.md)** — resume el
> estado, las decisiones y los errores ya cometidos. Este documento es el detalle técnico.
>
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
| `gemini.js` | extracción con Gemini: `extraerDatos`, **`verificarDatos`** (2ª pasada), **`MODELOS`/`listarModelos`** (catálogo real), **`dimensionesLectura`** (tamaño de la imagen de lectura), `diagnosticoGemini`, `probarApiKey` | parseo, `dimensionesLectura` y `filtrarModelosUtiles` sí |
| `ocrlocal.js` | Tesseract + `parsearTextoFactura(texto, {rncPropio})` | parser sí |
| `validacion.js` | NCF/fechas/montos: `normalizarFecha`, `normalizarMontoTexto`, `facturaCompleta`, `estadoFactura`, `buscarDuplicado`, `rncValido` (dígito verificador DGII), `deducirMontos`, `afinarDatosFactura`; **Fase 23**: `ncfValido` con largo exacto, `ncfDiagnostico`, `ncfTipoConocido`, `corregirNcf`, `mismoRnc`, `coherenciaMontos`, `conciliarLecturas` | sí |
| `naming.js` | `Compra_DDN`, provisionales, `necesitaReArchivo`, `mesesDeCarpetas` | sí |
| `indice.js` | `_gastos.json` + **`descDeEntrada`/`entradaDeDesc`/`conciliarIndice`** | sí |
| `drive.js` | API Drive v3: token persistente, picker de carpetas, papelera, description | no |
| `queue.js`/`revision.js` | colas IndexedDB (subida offline / revisión IA) | no |
| `pdfgastos.js` | `paginar` (puro) + `generarPDF` (pdf-lib); exporta `RATIO_LARGA` | paginar sí |
| `f606.js` | `filas606`/`tipoId`/`montoFacturado`/`nombreArchivo606` (puros) + `generarXLSX606` que RELLENA la plantilla oficial DGII | puros sí |
| `empresa.js` | perfil membrete + `_empresa.json` | `empresaCompleta` sí |
| `carga.js` | loader perezoso de UMD vendorizados | no |
| `config.js` | `CLIENT_ID_APP` (público por diseño) | — |

Vendor (~40 MB, NO precacheados los grandes): `opencv.js`, `ort/` + `modelos/u2netp.onnx`
(IA recorte), `tesseract/` (OCR), `pdf-lib/`, `sheetjs/`, **`dgii/formato606-base.xlsx`**
(63 KB, plantilla oficial del 606 — ver §7).

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
- **SINCRONÍA CON DRIVE (Fase 22)**: `conciliarIndice` va en LAS DOS DIRECCIONES —
  restaura del `description` lo que el índice hubiera perdido **y QUITA las entradas cuya
  imagen ya no está en Drive** (`huerfanas`). Antes solo añadía: si se borraba una factura
  a mano desde Drive, la entrada quedaba clavada en `_gastos.json`, Gastos la mostraba sin
  miniatura, no dejaba borrarla y **el cierre del mes fallaba** al no encontrar la imagen.
  `renderSeccion` persiste ambas cosas bajo el mutex y avisa con un toast.
  **DOS SALVAGUARDAS, no tocar:** (1) con lista de archivos VACÍA no se quita nada (un
  fallo de red no puede vaciar un registro fiscal); (2) `listarArchivos` **pagina de
  verdad** (`nextPageToken`) — antes cortaba en 1000 en silencio, y una lista truncada
  habría borrado entradas válidas como si fueran huérfanas.
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
   import a 1200px, editor de esquinas por defecto a marco completo (inset 2%). Cámara pide
   enfoque continuo (`focusMode:'continuous'`) best-effort en camera.js.
   **Fase 11 — VIVO recalibrado con las 61 fotos reales (detectaba 2/61):** rescate hull
   HABILITADO también en vivo (su solidez ≥0.8 filtra texturas) + `candidatosDeContorno`
   (approx → minAreaRect con llenado ≥0.82 → hull, validados POR candidato) + el veto ya no
   es `tocaBorde` (mataba tickets largos, que tocan arriba y abajo por definición) sino
   `esCasiElEncuadre` (>90% del frame = detecté el fondo). Resultado medido: vivo 2→35/61,
   importación auto 31→44/61, 17 ms/frame, CERO regresiones archivo-por-archivo. NO revertir
   a "vivo estricto sin hull" sin re-medir contra `../Facturas de prueba/`.
   Límite asumido y documentado en detect.js: sobre una funda plástica clara la detección
   puede dar la funda (derecha, recibo legible dentro, ✂ ajusta); se intentó una guarda de
   tinta y se DESCARTÓ con datos (6/35 quads legítimos daban tinta <0.006 — los mataría).
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
- **Lote/galería (`recortarImportada` en main.js)**: cascada
  `detectarDocumento` → **`papelLlenaLaFoto`→`marcoCompleto` (Fase 11: patrón A medido —
  el papel llena la foto al ~99% y la guarda de área lo rechazaba; 12/61 se resuelven
  así)** → `rectanguloDePapel` (minAreaRect + llenado ≥0.82) → IA → `bandaDePapel` → editor. Se acepta el PRIMERO que pase **dos** filtros:
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
- **NCF CANÓNICO (Fase 22)**: el OCR y la IA devuelven el mismo comprobante de formas
  distintas (`B01 0000 7133`, `b0100007133`, `B01-0000-7133`) y comparándolos crudos **la
  misma factura no se detectaba como duplicada**. `ncfCanonico` (validacion.js, pura)
  deja solo alfanuméricos en mayúsculas; lo usan `buscarDuplicado`, `afinarDatosFactura`
  (al leer, para que se GUARDE ya canónico) y el campo de la tarjeta al salir de él.
- **Borrado en DOS pasos (Fase 22)**: `eliminarFactura` toca el archivo y limpia el índice
  por separado. Si el archivo ya no está en Drive (borrado a mano) o falla el permiso, **el
  registro se limpia igual** — antes la excepción abortaba todo y la entrada se quedaba
  clavada. No volver a unirlos en un solo `try`.
- **Duplicado al leer el NCF (Fase 12)**: `actualizarEntradaConReArchivo` llama a
  `marcarSiDuplicada` (usa `repiteNCF`, puro en indice.js) en sus TRES ramas. Antes solo
  se chequeaba al mover de carpeta de mes → una factura de Lite (llega sin NCF y solo se
  conoce al «Leer con IA», normalmente en el mismo mes) nunca se marcaba. `repiteNCF`
  excluye la propia factura y las YA-duplicadas: así el original nunca se marca (no se
  cae del 606), solo la copia nueva. NO cambiar a marcar ambas.
- **Eliminar una factura subida por OTRA cuenta (Fase 12)**: el archivo de Lite lo posee
  el empleado, así que `trashed:true` da 403 `insufficientFilePermissions`. `eliminarFactura`
  detecta el 403 con `esErrorDePermiso` (drive.js, puro) y cae a `quitarDeCarpeta`
  (removeParents del mes): la copia sigue en el Drive de origen pero desaparece de Gastos.
  El `_gastos.json` y la cola de revisión se limpian igual. No convertir esto en borrado
  permanente (no somos dueños del archivo).
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
  **Fase 14 — POR QUÉ NO SE PUEDE ELIMINAR LA RECONEXIÓN (investigado 2026-08-11):** Google
  NO emite refresh tokens a clientes públicos de navegador. Su documento de descubrimiento
  OIDC declara `token_endpoint_auth_methods_supported: ["client_secret_post",
  "client_secret_basic"]` — el método `none` (cliente público) no existe, así que PKCE sin
  `client_secret` tampoco sirve. La duración (~3600 s) la fija Google y no es configurable.
  En la PWA de iOS agravan dos cosas documentadas: WebKit aísla el almacén de la app de
  pantalla de inicio (la sesión de Google de Safari no se comparte) y `window.opener` es
  `null` en popups de WKWebView desde iOS 17.5, así que el callback de GIS puede no llegar.
  Mitigaciones aplicadas (sin backend): `login_hint` con la cuenta recordada
  (`cuentaRecordada`/`recordarCuenta`, correo vía `correoDeLaCuenta`) para saltar el
  selector, y `error_callback` de GIS para fallar al instante cuando el popup se bloquea o
  se cierra, en vez de esperar al timeout. **La única solución de raíz sin servidor de
  terceros sería un Google Apps Script desplegado como Web App (`executeAs: USER_DEPLOYING`)
  que escriba en Drive; eliminaría el OAuth de la PWA por completo. Es un cambio de
  arquitectura pendiente de decisión de Ari.**
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
- **ORDEN DE LOS DOCUMENTOS (Fase 21)**: `_gastos.json` guarda las facturas en el orden en
  que se SUBIERON (una vieja puede fotografiarse días después), así que `generarDocumento`
  aplica `ordenarParaDocumento` (naming.js, pura) **una sola vez** sobre la lista completa:
  fecha de emisión ascendente → correlativo del nombre `Compra_DDN` (`correlativoDe`,
  **numérico**: `Compra_112` antes que `Compra_1110`) → provisionales sin fecha al final.
  Los tres entregables comparten esa lista para poder cotejarlos línea a línea. **No usar
  `idx.facturas` sin ordenar en nada que se presente al usuario.**
- **Paginado del PDF — POR TAMAÑO FÍSICO DEL PAPEL (Fase 14, 2ª pasada)**. Historia, para
  no repetir el error: la casilla fija de 198 pt dejaba una hoja carta a ~256 pt de alto,
  diminuta junto a un ticket. El 1er intento igualó la ALTURA de todas dándoles el ancho
  necesario — y salió el problema opuesto: **un voucher de gasolina se estiraba hasta
  parecer tan grande como una hoja carta**. Ninguna de las dos respeta la realidad.
  **Criterio definitivo**: se estima el tamaño FÍSICO del papel y todas las facturas de una
  página se escalan con el MISMO factor (pt por pulgada), así el PDF conserva las
  proporciones reales. `anchoFisico(ratio)`: por debajo de **`RATIO_CARTA=1.45`** es hoja
  (`ANCHO_CARTA=8.5"`), por encima rollo de caja (`ANCHO_ROLLO=3"`). El alto sale de
  `ancho × ratio`, así que un voucher corto queda bajo y un ticket largo alto, sin
  necesidad de identificar el comercio.
  **UMBRAL CALIBRADO MIRANDO LAS FACTURAS, no solo los números (Fase 19):** `240.jpg`
  ratio 1.31 es una hoja carta real (BM Cargo) y `051.jpg` ratio **1.62 es una GASOLINA**
  (rollo térmico de United Petroleum). Con el umbral anterior (1.9) los vouchers de
  gasolina entraban como hojas, recibían 8.5" de ancho y **aplastaban al resto de la
  página** — el bug que reportó Ari («se hizo una factura diminuta y en realidad es más
  grande que la de gasolina»). Los formatos de hoja reales son carta (1.294) y A4 (1.414);
  1.45 los cubre y deja fuera los vouchers. Oficio (1.647) queda como rollo a propósito:
  es raro, y confundirlo con un voucher hace más daño que mostrarlo algo más estrecho.
  **Lección: al calibrar un umbral por proporción, ABRIR las imágenes de los casos
  frontera** — ver dos facturas reveló en un minuto lo que el histograma de 93 ocultaba.
  `factorEscala(cols)` (pura) da el mayor factor que cabe a lo ancho y no rebasa la altura
  de banda. **Realce de las pequeñas (Fase 20, pedido de Ari «pueden escalarse de un 20 a
  50% si el espacio lo permite, para tener una página de espaciado más uniforme»):** una
  factura que queda corta CRECE proporcionalmente (ancho y alto, sin deformar) mientras
  haya ancho libre — `realceComun` (pura, búsqueda binaria del mayor factor común que
  cabe). Topes: `REALCE_MAX=1.5` y `REALCE_TOPE_ALTURA=0.8` — **nunca alcanza a la más alta
  de su página**, para no borrar la jerarquía que Ari pidió antes. Sustituyó al estirado
  del 10%, que solo tocaba el ancho y deformaba. Medido: la gasolina pasa del 44% al 68%
  de la altura del frame mientras carta y ticket largo siguen al 100%. La separación es
  uniforme con el grupo centrado. Medido: carta 396 pt vs gasolina 238 pt en la misma página.
  `generarPDF` dibuja con `it.cajas[]` (`{x,w,h}`, altura propia por caja), ya no con `xs`.
- **CUÁNTAS caben (regla de Ari, Fase 18) — `cabeEnPagina`, pura y testeada:**
  **SIEMPRE 3 facturas por página**, con dos únicas excepciones: un ticket de supermercado
  (se lleva 2 de las 3 columnas) y **dos hojas carta juntas** (llenan la página entre las
  dos; no entra una tercera). **ERROR YA COMETIDO, no repetirlo:** hubo un umbral
  `FACTOR_MIN=30` que cerraba la página cuando al repartir todo quedaba pequeño, y dejaba
  facturas SOLAS — medido con las 36 de Junio 2025: 17 páginas, 6 de ellas con una única
  factura. El tamaño lo resuelve `factorEscala`; **cuántas caben es maquetación, no
  escala**: son decisiones separadas y mezclarlas rompió el PDF. Tras el arreglo, las
  mismas 36 facturas dan 12 páginas, todas de 3.

## 5c. Los TRES entregables del cierre de mes (Fase 17)

| Archivo | Para qué | Nombre |
|---|---|---|
| PDF | ver las facturas del mes | `Gastos_{Mes_Año}.pdf` |
| Excel | **revisar** antes de enviar | `Revision_606_{Mes_Año}.xlsx` |
| **TXT** | **lo que se sube a la DGII** | `DGII_F_606_{RNC}_{AAAAMM}.TXT` |

El Excel **ya NO imita la plantilla de la DGII** — ese papel lo cumple el TXT, que sale
idéntico al oficial. Ahora es una hoja de revisión (`generarXLSXRevision`): datos en
formato dominicano, **el comercio y el archivo de la foto** (que el 606 no lleva),
totales para cuadrar y, abajo, **las facturas que NO entran al envío con su motivo**
(`repartoRevision` / `motivoExclusion`, puros y testeados). Lleva nombre propio para que
nadie lo confunda con el TXT oficial.

Se retiró `vendor/dgii/formato606-base.xlsx` y el generador que la rellenaba: sin uso.

## 5d. Archivo .TXT de envío a la DGII (Fase 16) — EL ENTREGABLE REAL

**Lo que la DGII recibe NO es el Excel: es un `.TXT`.** La herramienta Excel solo existe
para producirlo con su botón «Generar Archivo». Ari no podía ni abrir los .xls de su
contable (Vista Protegida, «File error: data may have been lost», macros bloqueadas por
Microsoft, control `cmdValidar` roto), así que la app lo genera directo: sin Excel, sin
macros y sin nada que Office pueda bloquear.

**FUENTE DE VERDAD: el propio VBA de la herramienta oficial.** Se extrajo el
`vbaProject.bin` de la plantilla y se descomprimió (MS-OVBA) para leer el módulo
`modServicios` → `cmdGenerarArchivo`. De ahí, literalmente:

- Cabecera: `"606|" & RNC & "|" & Periodo & "|" & Registros` (para periodos ≥ 201501; el
  formato viejo añadía el monto total — no aplica).
- Detalle: **23 campos** separados por `|`, en el orden de las columnas B..Z.
- Fechas: `ConcatFecha_one(AAAAMM, dia)` = `AAAAMM & Format$(dia,"00")` → **AAAAMMDD**.
- **`Mid(...,1,2)`** en tipo de bienes, tipo de retención y forma de pago: al TXT va SOLO
  el código de dos dígitos (`02`, `01`), nunca la etiqueta larga.
- Montos: `Trim(.Cells(...))` = el VALOR, así que van sin separador de miles, con punto
  decimal y sin ceros de relleno (`3050`, no `3,050.00`). Réplica: `montoTXT`.
- La última línea se imprime con `Print #1, x;` (punto y coma) → **el archivo no termina
  en salto de línea**; las demás llevan CRLF.
- Nombre: `DGII_F_606_{RNC}_{AAAAMM}.TXT` en mayúsculas.

Implementado en f606.js con funciones puras y testeadas: `montoTXT`, `fechaTXT`,
`lineaTXT606`, `generarTXT606`, `nombreTXT606`. **Si alguna vez la DGII rechaza el
archivo, la comparación se hace contra ese VBA, no contra suposiciones.**

**VALIDACIÓN DEFINITIVA (Fase 17):** Ari aportó el TXT real que su contabilidad generó
con el botón «Generar Archivo» (`DGII_F_606_133231824_202606.txt`, 20 facturas de junio).
Se reconstruyeron esas facturas y se regeneró el archivo con este código: **idéntico byte
a byte** (script `comparar-txt.mjs`), incluyendo propinas (494, 73.43, 81), cédulas con
cero inicial, montos con y sin decimales e ITBIS en cero. El archivo real confirma además:
CRLF, sin salto final, 100% ASCII. Ya no es una suposición razonada — está comprobado
contra el output de la herramienta oficial.

## 5b. Formato 606 sobre la plantilla oficial (Fase 14)

El Excel del 606 ya NO es un libro inventado: se RELLENA la plantilla oficial de la DGII
`vendor/dgii/formato606-base.xlsx` (derivada de «Formato de Envío 606 NG-07-2018 y
05-2019»; 63 KB tras quitarle las ~10.000 filas de datos vacías). Mapeo **verificado
celda a celda contra el ejemplar real de la contabilidad** (`DGII_F_606_133231824_202606.xls`):

| Celda | Contenido |
|---|---|
| `C4` / `C5` / `C6` | RNC de la empresa (**texto**) / periodo AAAAMM / nº de registros |
| Fila 11 | encabezados oficiales (no tocar). Datos desde la **fila 12** |
| `A` `B` `C` `D` | línea · RNC-cédula del proveedor (**texto**) · Tipo Id (1 RNC / 2 cédula) · `TIPO_BIENES` |
| `E` `G` `H` | NCF · fecha AAAAMM · día |
| `K` `M` `N` `R` | monto en servicios · total facturado (=K) · ITBIS · ITBIS por adelantar (=N) |
| `Y` `Z` | propina legal (solo si > 0) · `FORMA_PAGO` |

Reglas que NO se pueden romper:
1. **`B` y `C4` son de tipo texto**: las cédulas empiezan por 0 (`01200156113`) y como
   número se perdería. Igual `G` lleva formato `@`.
2. **`M` es el monto SIN ITBIS**, no el total pagado (comprobado: fila con K=4940.01,
   N=889.20, Y=494 tiene M=4940.01).
3. Todo el monto va a **servicios (K)**; bienes (L) queda vacío — así lo hace el ejemplar
   en sus 20 filas. Si contabilidad lo cambia, se ajusta en `filas606`.
4. `Y` solo se escribe cuando hay propina, como el ejemplar (en los datos internos
   `propinaLegal` es 0, nunca null).
5. El archivo se genera como **.xlsx sin macros a propósito**: Office bloquea los archivos
   con macros descargados de internet — el propio ejemplar de la DGII no abre desde una
   carpeta temporal por eso. Si contabilidad necesita los botones de la herramienta
   oficial, copia las filas a su plantilla con macros.
6. Nombre: `nombreArchivo606` → `DGII_F_606_{RNC}_{AAAAMM}.xlsx`, el patrón de la DGII.

Verificado abriendo el resultado con Excel real (COM): abre sin avisos, cabecera y
encabezados intactos, cédula con su cero inicial y propina en su fila.

## 5e. Precisión de la lectura (Fase 23)

Cinco piezas independientes. Se pueden tocar por separado, pero conviene saber para qué
está cada una antes de moverla.

### a) La imagen que sale hacia el modelo — `dimensionesLectura(w, h)`
Dimensiona por el **lado CORTO** (el ancho del papel), tope `MAX_PIXELES = 5e6`, y **no
amplía nunca**. Antes se reducía por el lado largo a 1280 px y un rollo de 884×3500 se
enviaba a 323×1280 (~10 px por dígito del NCF). Calidad `CALIDAD_LECTURA = 0.92`.
`generationConfig.mediaResolution = 'MEDIA_RESOLUTION_HIGH'` explícito, y el **texto va
antes de la imagen** en `parts` (recomendación oficial para una sola imagen con texto).

> Si alguna vez hay que aligerar la subida, baja `MAX_PIXELES` — **no** `ANCHO_LECTURA`.
> El ancho del papel es lo que decide si el NCF se puede leer.

### b) Catálogo de modelos — `MODELOS` / `listarModelos(apiKey)`
`MODELOS` es el orden de preferencia y el respaldo sin conexión; `listarModelos` pregunta
a `models.list` qué tiene la key del usuario y `filtrarModelosUtiles` descarta lo que no
sirve para leer una factura (embeddings, TTS, audio, imagen, vídeo y los alias `-latest` /
`-001`, que solo duplican la lista). Los botones de Ajustes se pintan desde ahí:
**no volver a escribir ids de modelo en el HTML.** `extrasDeModelo` manda `thinkingLevel`
solo a la serie 3, y `pedir()` reintenta sin `mediaResolution`/`thinkingLevel` si un modelo
los rechaza con 400 — así un modelo nuevo nunca deja al usuario sin lectura.

### c) NCF/e-NCF
`B + 2 + 8 = 11` · `E + 2 + 10 = 13`. `ncfValido` canoniza y mide; `ncfDiagnostico`
explica qué falta o sobra; `ncfTipoConocido` avisa (no bloquea) si el tipo no está en la
lista de la DGII. **`corregirNcf` nunca cambia el número de dígitos** — solo traduce
letras que están en posiciones obligatoriamente numéricas y el 8/3 que el OCR pone donde
va la serie. Si le sobra un dígito, se muestra tal cual: esconderlo dejaría al usuario sin
saber qué corregir.

### d) Doble comprobación — `conciliarLecturas(a, b)`
Pura, sin DOM ni red. Devuelve `{ datos, conflictos, confirmados }`. Al discrepar gana el
valor que **pasa la validación estructural** (NCF con su largo, RNC con dígito
verificador); si empatan, manda `a` y el campo queda en `conflictos`. La UI enseña las dos
versiones.

> **Lo que hace válida la segunda pasada es que sea DISTINTA**: otra imagen (grises de
> alto contraste, `canvasParaLectura('local')`) y otro prompt (`PROMPT_VERIFICACION`,
> transcribir carácter a carácter). Si se le manda la misma imagen con el mismo prompt,
> coincidir deja de significar nada y el chip «verificado x2» se vuelve una mentira.

Cuesta el doble de cuota. Se apaga en Ajustes (`tcb:dobleComprobacion`). **No rompe la
regla 4**: sigue corriendo solo cuando el usuario pide la lectura con IA.

### e) Coordenadas de captura — `escalaDeteccion`
El bucle en vivo trabaja SIEMPRE a `LADO_DETECCION = 1920`, aunque la cámara dé más, para
que `UMBRAL_NITIDEZ` y `TOL_ESTABLE` (calibrados en campo) sigan midiendo lo mismo. Por
eso **las esquinas del bucle NO están en el espacio de la foto**: usa
`ultimasEsquinasEnFoto()` antes de recortar. `MAX_PIXELES_ORTO = 8e6` en
`dimensionesDestino` protege el heap WASM de OpenCV.js.


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
