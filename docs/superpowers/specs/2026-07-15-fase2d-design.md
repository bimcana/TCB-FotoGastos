# Fase 2D — Guardado en background, edición total en Gastos, toggle IA/OCR y esquinas nivel Adobe Scan

**Fecha:** 2026-07-15 · **Estado:** aprobado por Ari ("Ejecutar tal cual")

## Problema

1. La lectura con Gemini tarda y bloquea el botón «Confirmar y subir»: el usuario debe esperar
   para guardar cada factura.
2. En Gastos solo se pueden abrir las facturas incompletas/pendientes; las completas no se
   pueden ver ni corregir.
3. La detección de esquinas falla al importar fotos de la galería con fondos difíciles
   (p. ej. mesa metálica brillante): Otsu no separa el papel y la app queda en «Sin detección»
   pasiva, además el OCR ni corre («sin imagen»).
4. El ajuste manual de esquinas ocurre sobre la tarjeta pequeña de Revisión: puntos chicos,
   dedo que tapa la esquina, ajuste fino imposible (comparado con Adobe Scan).
5. No hay forma de elegir OCR local cuando Gemini se demora.

## Decisiones tomadas con Ari (2026-07-15)

- **Archivo sin fecha conocida:** se sube de inmediato con nombre provisional y la app lo
  renombra/mueve automáticamente cuando la IA (o el usuario) fija la fecha de emisión.
- **Gastos:** todas las facturas son abiertas y editables, incluso las completas. Editar la
  fecha de emisión re-archiva (renombra/mueve) igual que el revisor.
- **Toggle IA/OCR:** manual; elegir OCR cancela la petición de Gemini en curso (AbortController)
  y llena con Tesseract local. En background SIEMPRE revisa la IA.
- **Esquinas:** editor a pantalla completa con lupa flotante, accesible desde Revisión y desde
  el visor; reemplaza al editor en-sitio actual.
- **Enfoque de arquitectura:** extender el pipeline actual (cola de revisión de Fase 2C como
  motor del background). Descartados: Background Sync (iOS no lo soporta) y rediseño
  offline-first (demasiado costo para el mismo resultado).

## Sección 1 — Guardar sin esperar a la IA

- «Confirmar y subir» queda **siempre habilitado** durante la lectura. Los campos siguen
  deshabilitados mientras el motor lee (para que la respuesta no pise ediciones), el botón no.
- Al guardar con lectura en vuelo: se aborta Gemini, y `subirFactura` decide:
  - **Con fecha de emisión válida** → flujo actual (`Compra_DDN.jpg` en `AAAA-MM_Mes`).
  - **Sin fecha válida** → nombre provisional `Pendiente_AAAAMMDD-HHMMSS.jpg` en la carpeta del
    mes actual, entrada de índice con `estado: 'pendiente'` y `provisional: true`, y SIEMPRE
    se encola en la cola de revisión (blob local + mesId + archivo).
- **Re-archivado (`sincronizarUbicacion`)**: cuando el revisor en background o una edición del
  usuario fijan/cambian la fecha de emisión, y la ubicación actual no coincide
  (nombre provisional, o día/mes distinto al del nombre actual):
  1. calcula carpeta destino `nombreCarpetaMes(fecha)` (asegurándola) y nombre
     `siguienteNombre(fecha, listarNombres(destino))`;
  2. renombra/mueve el archivo en Drive con **una** llamada
     `PATCH files/{id}?addParents={destino}&removeParents={origen}` + body `{name}`
     (nueva función `moverYRenombrar` en `drive.js`);
  3. quita la entrada del índice `_gastos.json` del mes origen y la agrega al del mes destino
     (o actualiza en sitio si es el mismo mes), con `fechaEmision` normalizada y
     `provisional` eliminado — **todo dentro del mutex `conLockIndice` existente**.
  - Si la fecha coincide con la ubicación actual y el nombre no es provisional: no se toca el
    archivo, solo los metadatos.
- El revisor `revisarPendientes` (Fase 2C) incorpora este paso tras la lectura de Gemini.
  Orden de escrituras seguro: primero mover el archivo, después los índices; si falla a mitad,
  la próxima corrida re-sincroniza (la operación es idempotente: se basa en el estado real).
- `refrescarGastos` deja de filtrar solo `Compra_*`: incluye también `Pendiente_*` para que las
  provisionales se vean en la lista con su etiqueta.

## Sección 2 — Gastos: todas las facturas editables

- Toda fila abre el panel de revisión (Fase 2C.2). Las completas también.
- El panel muestra una **miniatura** de la factura (descarga de Drive en diferido, con caché en
  memoria por sesión) además de los campos; tocarla abre el visor a pantalla completa.
- Al confirmar, si cambió la fecha de emisión se ejecuta `sincronizarUbicacion` (mismo camino
  que el revisor). El toast informa el nombre nuevo si hubo re-archivado.
- Etiquetas sin cambio: `Datos incompletos` (warn), `Pendiente de revisión` (info),
  completas sin etiqueta.

## Sección 3 — Toggle IA / OCR

- Segmented control `IA · OCR` junto al indicador «Leyendo con…» en la tarjeta de datos.
  Visible solo si hay API key (sin key ya se usa OCR local siempre; el toggle no aplica).
- Por defecto IA. Tocar OCR: aborta Gemini en vuelo (señal `AbortSignal` nueva en
  `extraerDatos`) y corre Tesseract local; muestra nota «revisa los datos». Tocar IA relanza
  Gemini. El token `genOCR` existente sigue descartando lecturas obsoletas.
- Guardar con origen `local` u OCR incompleto → `estado 'pendiente'` + cola de revisión
  (comportamiento Fase 2C que se conserva): la IA en background corrige después.
- Abandonar Revisión o guardar también aborta cualquier lectura en vuelo.

## Sección 4 — Detección en cascada (importación con fondos difíciles)

- `detectarDocumento` se generaliza a una **cascada de estrategias de binarización** sobre la
  misma tubería de contornos (extraída a helper): 1) Otsu (actual), 2) umbral adaptativo
  gaussiano, 3) Canny + dilatación. Devuelve el primer cuadrilátero que pase
  `cuadrilateroValido`; si ninguna estrategia da, `null`.
- Cámara en vivo: misma cascada (Otsu corta primero en el caso común; el costo extra solo se
  paga cuando falla, que es exactamente cuando hoy no había detección).
- Importación de galería: la cascada corre con imagen normalizada a mayor resolución de
  trabajo (lado ~1200px en vez de escala fija 0.35) — no es tiempo real, prima el acierto.
- Si aun así no hay detección al importar: **se abre directamente el editor de esquinas a
  pantalla completa** con esquinas iniciales al 10% (comportamiento Adobe Scan), en vez del
  estado pasivo «Sin detección».
- Sin esquinas ya **no** se salta la lectura de datos: OCR/IA leen la imagen original completa
  (adiós al estado «sin imagen»).

## Sección 5 — Editor de esquinas a pantalla completa con lupa

- Módulo nuevo `src/esquinas.js` + overlay en `index.html` (patrón del visor): imagen sobre
  fondo oscuro ocupando la pantalla, 4 esquinas arrastrables con zona táctil ≥44px, líneas
  conectoras, y **lupa flotante** (canvas circular ~120px que amplía ×2.5 la zona bajo el
  dedo, desplazada hacia arriba/lado opuesto para no quedar tapada).
- API: `abrirEditorEsquinas(canvasOriginal, esquinasIniciales) → Promise<esquinas|null>`
  (null = cancelado). Botones «Aplicar» y «Cancelar».
- Puntos de entrada: botón «Ajustar esquinas manualmente» de Revisión, botón de recorte dentro
  del visor a pantalla completa, y apertura automática al importar sin detección.
- Se elimina el editor en-sitio actual (canvas `rev-esquinas` y su lógica de arrastre).

## Módulos afectados

| Módulo | Cambio |
|---|---|
| `naming.js` | `nombreProvisional(date)`, `esProvisional(nombre)`, `nombreCoincideConFecha(nombre, fechaISO)` (puros, con tests) |
| `drive.js` | `moverYRenombrar(fileId, nombre, addParents, removeParents)` + `buscarArchivo(carpetaId, nombre) → id` |
| `gemini.js` | `extraerDatos(..., señal)` con AbortSignal |
| `detect.js` | cascada de estrategias + helper de contornos + resolución de trabajo parametrizable (tests puros de la lógica de decisión) |
| `esquinas.js` | **nuevo** — editor a pantalla completa con lupa |
| `indice.js` | `quitarEntrada(indice, archivo)` (puro, con tests) |
| `main.js` | confirmar sin esperar, `sincronizarUbicacion`, toggle IA/OCR, Gastos editable + miniatura, integración editor |
| `index.html` | toggle, overlay del editor, botón recorte en visor, miniatura en panel revisar |
| `sw.js` | `VERSION = 'fase2d-v1'`, `esquinas.js` al precache |

## Errores y casos borde

- Fallo de Drive a mitad del re-archivado → la corrida siguiente del revisor lo reintenta
  (idempotente); la entrada nunca se borra de un índice sin haberse escrito en el destino
  (orden: mover archivo → escribir índice destino → quitar del índice origen).
- Dos provisionales en el mismo segundo: el timestamp incluye fecha+hora+segundos y, si el
  nombre ya existe en la carpeta, se sufija `_2`, `_3`…
- Guardar offline sin fecha → cola offline actual; al reconectar `subirFactura` aplica la
  misma regla provisional.
- Abort de Gemini no debe caer al OCR local automático (es cancelación, no error de red):
  se distingue `AbortError` del resto.

## Pruebas

- Node (`npm test`): naming provisional/coincidencia, `quitarEntrada`, decisión de cascada,
  helper puro de re-archivado (dado entry+fecha → acción esperada).
- Manual en iPhone (Ari): foto cámara + guardar inmediato, importar la foto del fondo
  metálico, toggle OCR con Gemini lento, editar fecha de una completa y verificar
  renombrado/movida en Drive.
