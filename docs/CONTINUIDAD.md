# TCB FotoGastos — Punto de partida para la próxima sesión

> **Léeme entero antes de tocar nada.** Este documento es el estado real de la app a
> **11 de agosto de 2026** y, sobre todo, el porqué de las decisiones. El detalle técnico
> vive en [DOCUMENTO-TECNICO.md](DOCUMENTO-TECNICO.md); aquí está lo que hace falta para
> retomar sin romper cosas.

---

## 1. Qué es y dónde está

PWA estática (sin build, módulos ES) para fotografiar facturas con NCF dominicanas,
archivarlas en Google Drive y generar el cierre mensual.

| | |
|---|---|
| **App Full** | https://bimcana.github.io/TCB-FotoGastos/ · repo `bimcana/TCB-FotoGastos` |
| **App Lite** (alimentadora) | https://bimcana.github.io/TCB-Gastos-Lite/ · repo `bimcana/TCB-Gastos-Lite` |
| **Versión actual** | Full `fase21-v1` · Lite `lite-v10` |
| **Pruebas** | `npm test` — 205 en la Full, 60 en la Lite. Todo helper puro lleva test. |
| **Publicar** | `git push origin main` **es** publicar (Pages sirve desde `main` en ambos repos). |

**Usuario:** Ari (BIMCANA SRL, Punta Cana). Arquitecto, no programador. Prefiere el
español, decisiones explicadas y honestidad sobre lo que no se ha probado.

---

## 2. El cierre de mes produce TRES archivos

Es el corazón del producto. Cada uno tiene un papel distinto y no son intercambiables:

| Archivo | Para qué | Nombre |
|---|---|---|
| PDF | ver las facturas del mes | `Gastos_{Mes_Año}.pdf` |
| Excel | **revisar** antes de enviar | `Revision_606_{Mes_Año}.xlsx` |
| **TXT** | **lo que se sube a la DGII** | `DGII_F_606_{RNC}_{AAAAMM}.TXT` |

### Los tres van en el MISMO orden: fecha de emisión ascendente
`ordenarParaDocumento` (naming.js, pura) se aplica **una sola vez** sobre la lista completa
en `generarDocumento`, así el PDF, el Excel y el TXT se pueden cotejar línea a línea.
Criterio: fecha ascendente → correlativo del nombre `Compra_DDN` (**numérico**, no
alfabético: `Compra_112` antes que `Compra_1110`) → las provisionales sin fecha al final.
**Ojo:** el índice `_gastos.json` guarda las facturas en el orden en que se SUBIERON —
una factura vieja puede fotografiarse días después. Nunca lo uses sin ordenar.

### El TXT es el entregable real
La herramienta Excel de la DGII **solo existe para producir ese TXT** con su botón
«Generar Archivo». Ari no puede ni abrir los .xls de su contable (Vista Protegida, macros
bloqueadas por Microsoft, control `cmdValidar` roto), así que la app genera el TXT directo.

**Su formato salió del VBA de la herramienta oficial**, extraído y descomprimido del
`vbaProject.bin`, y está **verificado idéntico byte a byte** contra un TXT real de la
contabilidad (20 facturas de junio 2026). Si algún día la DGII lo rechaza, la comparación
se hace contra ese VBA — no contra suposiciones. Detalles del formato en
DOCUMENTO-TECNICO §5d.

> **PENDIENTE DE ARI:** pasar el TXT por el
> [prevalidador de la DGII](https://dgii.gov.do/herramientas/formularios/Paginas/herramientasPreValidacion.aspx).
> Es la única validación que no se ha hecho.

---

## 3. El PDF: cómo se decide el tamaño (lo que más costó)

Dos decisiones **independientes**. Mezclarlas ya rompió el PDF una vez:

**a) Qué tamaño tiene cada factura** → `factorEscala`
Se estima el tamaño *físico* del papel y toda la página se escala con el mismo factor
(puntos por pulgada), así el PDF respeta las proporciones reales.
- `RATIO_CARTA = 1.45` separa hoja (8.5") de rollo de caja (3").
- El alto sale de `ancho × ratio`: un voucher corto queda bajo, un ticket largo alto.
- Las pequeñas **crecen hasta un 50%** si sobra sitio (`REALCE_MAX`), pero **nunca pasan
  del 80% de la altura de la mayor** (`REALCE_TOPE_ALTURA`), para no borrar la jerarquía.
  El crecimiento es proporcional: no deforma.

**b) Cuántas caben en la página** → `cabeEnPagina`
**Siempre 3 facturas**, con dos excepciones: un ticket de supermercado (ocupa 2 de las 3
columnas) y **dos hojas carta juntas** (llenan la página; no entra una tercera).

### Errores ya cometidos aquí — no repetirlos
1. **Casilla de ancho fijo (198 pt):** dejaba la hoja carta a ~256 pt de alto, diminuta.
2. **Igualar la altura de todas:** el problema opuesto — un voucher de gasolina se
   estiraba hasta parecer una hoja carta.
3. **Umbral `FACTOR_MIN`:** ataba *cuántas caben* al *tamaño resultante* y dejaba facturas
   **solas en su página** (17 páginas para 36 facturas, 6 de ellas huérfanas).
4. **`RATIO_CARTA` en 1.9:** metía los vouchers de gasolina en el saco de las hojas; les
   daba 8.5" de ancho y aplastaban el resto de la página.

### La lección de método que más sirvió
El error 4 se calibró con un histograma de 93 proporciones y "parecía" que 1.9 era la
frontera natural. **Bastó abrir dos imágenes** para verlo:

| Archivo | Proporción | Qué es de verdad |
|---|---|---|
| `240.jpg` | 1.31 | hoja carta (BM Cargo) |
| `051.jpg` | **1.62** | **gasolina** (rollo térmico) |

**Al calibrar un umbral por proporciones, abre las imágenes de los casos frontera.**
Las facturas reales están en `../Junio 2025/` (36, escaneos recortados — es el conjunto
representativo) y `../Facturas de prueba/` (57, muchas son fotos sin recortar con ratio
1.33, **no sirven para juzgar el paginado**).

---

## 4. Reglas que no se pueden romper

1. **Subir `VERSION` en `sw.js` en cada despliegue.** Si no, los dispositivos quedan con
   la versión cacheada. En PowerShell usa **ruta absoluta** con las APIs de .NET
   (`[IO.File]::WriteAllText($rutaAbsoluta, $t, (New-Object Text.UTF8Encoding $false))`)
   — con ruta relativa falla en silencio, y `Set-Content -Encoding utf8` mete BOM.
2. **Un push por publicación.** Espera a que termine la construcción. Si un push no
   dispara nada, comprueba antes de re-empujar:
   `curl -s "https://api.github.com/repos/bimcana/TCB-FotoGastos/actions/runs?per_page=3"`.
   Sin `queued`/`in_progress`, re-disparar con `git commit --allow-empty` es seguro.
3. **Verifica el CONTENIDO publicado**, no solo el `sw.js`:
   `curl -s .../src/f606.js | grep -c generarTXT606`.
4. **La IA (Gemini) solo corre a petición del usuario** — al capturar el motor por defecto
   es el OCR local. Nunca re-agregar disparadores automáticos: agota la cuota gratis.
5. **Almacenamiento en ISO** (`AAAA-MM-DD`) y números; el formato dominicano
   (`DD-MM-AAAA`, `2,500.00`) es solo de presentación.
6. **Las facturas `completa` no se borran** desde la UI (registro fiscal); las demás van a
   la papelera de Drive.
7. **El repo es público:** nada de datos de BIMCANA en los ejemplos, ni credenciales.
8. Identificadores ASCII; comentarios y commits en español (`git commit -F` por las tildes).

---

## 5. Cómo verificar sin poder probar en el iPhone

- **Lógica pura:** `npm test` (Node). Todo lo que se pueda extraer a función pura, se
  extrae y se testea — así se validaron el TXT, el paginado y los estados.
- **Navegador:** `preview_start` con un **puerto nuevo** (el service worker sirve caché
  terca en puertos ya usados). En el panel del agente la pestaña está `hidden`: los
  `requestAnimationFrame` no corren, así que hace falta el shim
  `window.requestAnimationFrame = cb => setTimeout(cb, 16)`.
- **Excel real:** se puede abrir y comprobar con COM (`New-Object -ComObject Excel.Application`).
  Así se descubrió que Office bloquea los archivos con macros bajados de internet.
- **Lo que NO se puede probar aquí:** Drive en vivo (un token falso recibe 401 y la app lo
  limpia, que es lo correcto), la cámara, y el envío real a la DGII. Decirlo claramente en
  vez de dar por bueno lo no probado.

---

## 6. Limitación conocida: Drive se desconecta cada hora

**No tiene arreglo sin backend, y está investigado a fondo.** Google no emite refresh
tokens a aplicaciones de navegador: su documento de descubrimiento OIDC solo admite
`client_secret_post` y `client_secret_basic`, nunca el método `none`, así que PKCE sin
secreto tampoco sirve. La hora de vida la fija Google y no es configurable. En la PWA de
iOS agravan dos cosas documentadas: WebKit aísla el almacén de la app instalada (no
comparte la sesión de Google con Safari) y `window.opener` viene vacío en WKWebView desde
iOS 17.5.

**Mitigado:** se recuerda la cuenta (`login_hint`, salta el selector), el token se renueva
proactivamente en el primer gesto cuando le quedan <5 min, y `error_callback` detecta al
instante el popup bloqueado. Botón «Reconectar a Drive» en Gastos, visible solo
desconectado.

### La decisión que quedó pendiente: Google Apps Script
Un script desplegado como Web App (`executeAs: USER_DEPLOYING`) que escriba en Drive
**eliminaría el OAuth de la PWA y la reconexión por completo**, sin servicios de terceros.
Comparativa que se le dio a Ari:

- **A favor:** mata la reconexión, la Lite no necesitaría cuenta de Google, arregla de raíz
  el 403 al borrar facturas ajenas, sin techo de usuarios.
- **En contra:** la URL del script es una llave y **el repo es público**; hay que reescribir
  las 21 funciones de Drive (51 llamadas en la Full, 8 en la Lite); punto único de fallo;
  más lento; se pierde el rastro de quién subió qué; el código vive fuera del repo.
- **Matiz decisivo:** un script *solo-escritura* es riesgo bajo; uno que *lee* expone las
  facturas → filtración fiscal.
- **Recomendación dada:** hacerlo completo **con un PIN** que el usuario escribe una vez en
  Ajustes (ese sí es un secreto real, no publicado), si la Full la usa solo Ari.

**Ari lo pospuso a otra sesión. Preguntarle antes de empezar.**

---

## 7. Pendientes

1. **Prevalidar el TXT en la DGII** (Ari) — lo único sin verificar del 606.
2. **Google Apps Script** — decisión de arquitectura pendiente (§6).
3. **Portar a la Lite** lo que aplique del PDF/606 si alguna vez lo necesita (hoy la Lite
   solo captura y sube; no lee datos ni genera documentos).
4. Backlog viejo: OneDrive, envoltorio nativo (Capacitor) para que el permiso de cámara se
   pida una sola vez, mover vendors pesados a CDN.

---

## 8. Cómo trabajar con Ari

- Explica **qué se rompió y por qué**, sin adornos. Valora la franqueza más que el brillo.
- **Sus reglas suelen ser más simples que la solución "inteligente"** — «siempre 3 por
  página» resolvió lo que un umbral calculado había estropeado. Escúchalas literalmente.
- Manda archivos de muestra (PDF, TXT, Excel) para que juzgue con sus propios ojos.
- Marca siempre la diferencia entre *verificado* y *pendiente de prueba de campo*.
- Recuérdale cerrar y reabrir la app dos veces en el iPhone tras cada publicación.
