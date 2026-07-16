# Fase 2E — Autorecorte con IA local, revisor visible, reconexión automática y panel de cola

**Fecha:** 2026-07-15 · **Estado:** aprobado por Ari ("Ok. Perfecto")

## Problema (feedback de campo con capturas, 2026-07-15 noche)

1. Importar desde la Fototeca con fondo difícil (mesa metálica) abre el editor con esquinas
   genéricas: falta el **autorecorte automático nivel Adobe Scan** ("estrictamente necesario").
2. El icono de cola (flecha con badge) no hace nada al tocarlo; el usuario debe poder revisar
   lo encolado hasta que pase a Gastos.
3. El llenado silencioso con Gemini no se percibe: el usuario guardó provisional, abrió el
   panel y estaba vacío. Concepto confirmado: "Pendiente de revisión" NO es para llenar a
   mano — Gemini llena en silencio y el usuario **valida** después. Pide además botón de
   reintento manual.
4. (Detectado en sus capturas) Falso positivo del rescate por casco convexo de 2D: una manta
   texturada marcada como "Documento detectado" en la cámara en vivo.

## Decisiones tomadas con Ari (2026-07-15)

- **Motor de autorecorte: IA local** (modelo ONNX ~5 MB, una descarga, offline). Gemini-esquinas
  y el híbrido quedaron descartados.
- **Revisor: las 3 mejoras** — arranque automático tras cada subida, indicador visible
  "Leyendo con IA…" con relleno del panel abierto, y botón manual "Leer con IA".
- **Reconexión automática de Drive al abrir** (consentimiento previo recordado); si Google
  exige interacción, aviso tocable "Reconectar Drive" en Gastos.
- **Panel de cola: ver + reintentar + eliminar** (solo cola de SUBIDA; lo ya subido que espera
  IA se ve en Gastos con su chip, que es su estado real).

## Sección 1 — Motor IA de detección (`src/detectia.js`)

- **U²-Net-p ONNX** (~4.7 MB, Apache-2.0, el candidato del backlog) + **onnxruntime-web**
  (WASM), ambos vendorizados: `vendor/modelos/u2netp.onnx`, `vendor/ort/` (ort.min.js + wasm).
  Carga perezosa (primera importación de imagen); el SW los cachea en runtime como Tesseract.
  Requiere WASM SIMD (iOS 16.4+); si no carga → se sigue sin IA (clásico + editor manual).
- `detectarConIA(canvas) → Promise<esquinas|null>`: reescala a 320×320, normaliza
  (mean/std ImageNet, patrón rembg), inferencia (sesión singleton, `numThreads:1` — GitHub
  Pages no tiene COOP/COEP), máscara 320×320 → min-max → umbral 0.5 → canvas gris →
  `esquinasDeMascara` (OpenCV: mayor contorno + `aCuatroEsquinas` existente) → esquinas
  mapeadas a coords originales (escala x/y independiente) → `cuadrilateroValido`.
- **Flujo de importación (estilo Adobe):** clásico (rápido) → si null, IA local → el editor
  de esquinas se abre **SIEMPRE con las esquinas detectadas precargadas**; "Aplicar" acepta el
  autorecorte y pasa al reconocimiento de datos. Sin detección alguna → esquinas genéricas.
- Captura de cámara (disparo manual) sin detección clásica → también intenta IA antes de
  mostrar "Sin detección" (no abre el editor solo; el flujo de cámara no cambia más).

## Sección 2 — Revisor IA visible y con reintento

- `revisarPendientes()` se dispara ADEMÁS: tras cada subida que encoló revisión (confirm y
  cola offline) y tras la reconexión automática. Triggers existentes se conservan.
- **Estado observable:** main.js mantiene `archivosEnLectura` (Set de nombres en proceso) y el
  revisor emite refresco: la fila de Gastos cuyo archivo está en el Set muestra chip animado
  `Leyendo con IA…` (clase `.chip.leyendo` con pulso CSS). Al terminar cada ítem:
  `refrescarGastos()` y, si el panel abierto corresponde a ese archivo (aunque haya sido
  renombrado), se rellenan los campos y toast "Datos leídos — revisa y confirma". La etiqueta
  "Pendiente de revisión" permanece hasta que el usuario confirma (sin cambio).
- **Botón "Leer con IA"** en el panel de revisión, visible si estado ≠ completa: lee ESA
  factura al momento — blob de la cola de revisión si existe, si no descarga la imagen de
  Drive (reutiliza thumbCache) — con Gemini (key+conexión) o **OCR local como respaldo**;
  aplica vía `actualizarEntradaConReArchivo` (mismo camino que el revisor, con re-archivado)
  y rellena el panel. Deshabilitado mientras lee ("Leyendo…").

## Sección 3 — Reconexión automática de Drive

- Tras conectar con éxito: `set('driveConectadoAntes', true)`.
- Al cargar la app, si `driveConectadoAntes` y hay `clientId`: `initAuth` + intento
  **silencioso** (`conectar({silencioso:true})` → `requestAccessToken({prompt:''})`). Éxito →
  asegura carpeta raíz, `procesarCola()` + `revisarPendientes()` + refresco de UI de estado.
- Fallo silencioso (interaction_required / popup bloqueado / sin red) → **aviso tocable**:
  `gastos-sub` se convierte en "Reconectar Google Drive ▸" (un toque = conectar normal).
  Igual al expirar el token a mitad de sesión (los `api()` de drive.js con 401 marcan
  desconectado y muestran el aviso). El botón de Ajustes queda como siempre.
- El timeout de 60 s del `conectar` actual no aplica al intento silencioso (se baja a 8 s
  para no dejar promesas colgadas al abrir).

## Sección 4 — Panel de cola de subida

- Tocar `#btn-cola` abre `#cola-panel` (mismo patrón visual que `#revisar-panel`): una fila
  por ítem de la cola de subida (queue.js `pendientes()`): miniatura (objectURL del blob),
  datos parciales (comercio · fecha · total, los que haya), motivo "Esperando conexión con
  Drive", y acciones **"Subir ahora"** (dispara `procesarCola()`; si no hay conexión, toast
  honesto) y **eliminar** (confirmación nativa `confirm()`; borra el ítem y su foto de la
  cola). El badge existente se actualiza. Cola vacía → nota "Nada en cola".
- Los objectURL de miniaturas se revocan al cerrar el panel.

## Sección 5 — Fix del falso positivo en cámara en vivo

- `detectarDocumento(srcCanvas, maxLado, opciones)` gana `{rescate:boolean}` (default
  `true`): el rescate por casco convexo (`aCuatroEsquinas` fase hull) solo corre con
  `rescate:true`. El **bucle de cámara en vivo llama con `rescate:false`** (criterio
  estricto de 2C). Importación y stills mantienen el rescate.
- Guarda adicional solo para el vivo: se rechaza el cuadrilátero si alguna esquina queda a
  menos del 1% del borde del frame (los falsos de la manta tocaban los bordes).

## Módulos afectados

| Módulo | Cambio |
|---|---|
| `vendor/ort/`, `vendor/modelos/u2netp.onnx` | **nuevos** (vendorizados, `.gitattributes` binary) |
| `src/detectia.js` | **nuevo** — carga perezosa ORT + inferencia + máscara→esquinas |
| `src/detect.js` | exporta `esquinasDeMascara` y `aCuatroEsquinas`; `detectarDocumento(..., {rescate})`; helper puro `mapearEsquinas(pts, sx, sy)`; guarda de borde para vivo |
| `src/drive.js` | `api()` marca desconectado en 401 y avisa (callback `onDesconexion`); `conectar({silencioso})` |
| `src/main.js` | flujo import con editor precargado; IA tras disparo sin detección; Set `archivosEnLectura` + chip animado + relleno del panel; botón "Leer con IA"; reconexión automática + aviso tocable; panel de cola |
| `index.html` | panel de cola, botón "Leer con IA" en revisar-panel |
| `styles.css` | `.chip.leyendo` animado, filas del panel de cola |
| `src/queue.js` | sin cambios (ya tiene pendientes/eliminar) |
| `sw.js` | `VERSION='fase2e-v1'`; runtime-cache para `vendor/ort/` y `vendor/modelos/` (patrón tesseract); `detectia.js` al precache |

## Errores y casos borde

- ORT/modelo no disponibles (primera vez sin conexión, iOS viejo sin SIMD): `detectarConIA`
  devuelve null sin romper; el flujo cae a editor manual. Nunca bloquea la importación.
- "Leer con IA" sin key y sin conexión → OCR local; si tampoco (Tesseract sin cachear y sin
  red) → toast honesto "Sin conexión y sin OCR disponible".
- Reconexión silenciosa lanzada al abrir NO debe encolar dos corridas del revisor si el
  usuario toca Gastos a la vez (el flag `revisando` existente ya lo cubre).
- Eliminar de la cola de subida es DESTRUCTIVO para esa foto (no está en Drive aún) → siempre
  con confirmación y texto claro.
- El panel de revisión abierto puede corresponder a un archivo que el revisor RENOMBRÓ
  (Pendiente_→Compra_): el evento de fin de lectura entrega `{archivoAnterior, archivoNuevo}`
  y el panel se re-vincula al nuevo nombre antes de rellenar.

## Pruebas

- Node: `mapearEsquinas`, decisión de flujo de importación (función pura
  `esquinasParaImportar(clasicas, ia)` si aplica), regla de guarda de borde (pura).
- Navegador: `detectarConIA` contra las imágenes reales de `Testing/` (metal) y sintéticos;
  panel de cola con ítems simulados en IndexedDB; chip animado; reconexión simulada.
- Campo (Ari): importar la foto de la mesa metálica → autorecorte correcto de una; guardar
  rápido → ver chip "Leyendo con IA…" y el panel llenarse; matar y reabrir la app → reconexión
  sola; tocar el icono de cola con ítems pendientes.
