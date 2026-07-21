let tokenClient = null, accessToken = null, expiraEn = 0;

// El token de acceso vive ~1 h: se persiste para que reabrir la app dentro de esa
// ventana NO requiera reconectar (la causa principal del "Drive se desconecta").
// En 401 (vencido/revocado) se limpia y la UI ofrece reconectar.
// Version de scope: al subir de drive.file a drive (Fase 4), los tokens viejos siguen
// "validos" pero NO ven archivos ajenos — se invalidan para forzar el consentimiento nuevo.
try {
  if (localStorage.getItem('tcb:scopeV') !== '2'){
    localStorage.removeItem('tcb:driveToken');
    localStorage.setItem('tcb:scopeV', '2');
  }
  const t = JSON.parse(localStorage.getItem('tcb:driveToken') || 'null');
  if (t && t.accessToken && Date.now() < t.expiraEn){ accessToken = t.accessToken; expiraEn = t.expiraEn; }
} catch(e){}

function guardarToken(){
  try { localStorage.setItem('tcb:driveToken', JSON.stringify({ accessToken, expiraEn })); } catch(e){}
}
function limpiarToken(){
  accessToken = null; expiraEn = 0;
  try { localStorage.removeItem('tcb:driveToken'); } catch(e){}
}

export function initAuth(clientId){
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    // Fase 4: acceso amplio (necesario para VER archivos que otros suban a la carpeta
    // matriz — drive.file solo muestra lo creado por la app). La app queda RESTRINGIDA
    // en codigo a la carpeta matriz: toda operacion parte de carpetaRaizId.
    scope: 'https://www.googleapis.com/auth/drive',
    callback: () => {}
  });
}

export function conectado(){ return !!accessToken && Date.now() < expiraEn; }

let onDesconexion = null;
export function alDesconectar(cb){ onDesconexion = cb; }

// opciones.silencioso: intento sin interaccion (prompt:'') con timeout corto — se usa
// al abrir la app para renovar el acceso si el usuario ya dio consentimiento antes.
export function conectar(opciones = {}){
  return new Promise((res, rej) => {
    if (!tokenClient) return rej(new Error('Falta el Client ID en Ajustes'));
    const silencioso = opciones.silencioso || conectado();
    const timer = setTimeout(() => rej(new Error('Tiempo de espera agotado al conectar con Google')),
      opciones.silencioso ? 8000 : 60000);
    tokenClient.callback = t => {
      clearTimeout(timer);
      if (t.error) return rej(new Error(t.error));
      accessToken = t.access_token;
      expiraEn = Date.now() + (t.expires_in - 60) * 1000;
      guardarToken();
      res();
    };
    tokenClient.requestAccessToken({ prompt: silencioso ? '' : 'consent' });
  });
}

async function api(path, opts = {}){
  const r = await fetch('https://www.googleapis.com/drive/v3/' + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + accessToken, ...(opts.headers || {}) }
  });
  if (r.status === 401){ // token vencido a mitad de sesion: avisar para reconectar
    limpiarToken();
    if (onDesconexion) onDesconexion();
  }
  if (!r.ok) throw new Error('Drive ' + r.status + ': ' + await r.text());
  return r.json();
}

export async function crearCarpeta(nombre, padreId = null){
  const creada = await api('files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nombre, mimeType: 'application/vnd.google-apps.folder',
                           ...(padreId ? { parents: [padreId] } : {}) })
  });
  return creada.id;
}

export async function asegurarCarpeta(nombre, padreId = null){
  const filtroPadre = padreId ? ` and '${padreId}' in parents` : '';
  const q = encodeURIComponent(
    `name='${nombre.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${filtroPadre}`);
  const res = await api(`files?q=${q}&fields=files(id,name)&pageSize=10`);
  if (res.files.length) return res.files[0].id;
  return crearCarpeta(nombre, padreId);
}

// Carpetas compartidas conmigo (nivel raiz de "Compartidos") — para vincular la carpeta
// matriz de una empresa cuyo Drive es de otra persona.
export async function carpetasCompartidas(){
  const q = encodeURIComponent(`sharedWithMe = true and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await api(`files?q=${q}&fields=files(id,name)&pageSize=1000`);
  return res.files;
}

export async function buscarCarpeta(nombre, padreId = null){
  const filtroPadre = padreId ? ` and '${padreId}' in parents` : '';
  const q = encodeURIComponent(`name='${nombre.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${filtroPadre}`);
  const res = await api(`files?q=${q}&fields=files(id)&pageSize=1`);
  return res.files.length ? res.files[0].id : null;
}

export async function listarCarpetas(padreId){
  const q = encodeURIComponent(`'${padreId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await api(`files?q=${q}&fields=files(id,name)&pageSize=1000`);
  return res.files;
}

// Listado con lo necesario para conciliar: nombre, tipo y description (metadatos propios).
export async function listarArchivos(carpetaId){
  const q = encodeURIComponent(`'${carpetaId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed=false`);
  const res = await api(`files?q=${q}&fields=files(id,name,mimeType,description)&pageSize=1000`);
  return res.files;
}

export async function descargarPorId(fileId){
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!r.ok) return null;
  return r.blob();
}

// Mueve un archivo o CARPETA a otro padre sin renombrarlo (usado por «Archivar»).
export async function moverACarpeta(fileId, nuevoPadreId, viejoPadreId){
  return api(`files/${fileId}?addParents=${nuevoPadreId}&removeParents=${viejoPadreId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
  });
}

// A la papelera (recuperable 30 dias) — para el original de una factura ajena procesada.
export async function moverAPapelera(fileId){
  return api(`files/${fileId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true })
  });
}

export async function ponerDescripcion(fileId, texto){
  return api(`files/${fileId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: texto })
  });
}

export async function buscarArchivo(carpetaId, nombre){
  const q = encodeURIComponent(`name='${nombre.replace(/'/g, "\\'")}' and '${carpetaId}' in parents and trashed=false`);
  const res = await api(`files?q=${q}&fields=files(id)&pageSize=1`);
  return res.files.length ? res.files[0].id : null;
}

export async function nombreDe(fileId){
  const r = await api(`files/${fileId}?fields=name`);
  return r.name;
}

// Renombra y (si cambia el padre) mueve el archivo en UNA sola llamada PATCH;
// opcionalmente actualiza tambien su description (metadatos que viajan con el archivo).
export async function moverYRenombrar(fileId, nuevoNombre, nuevoPadreId, viejoPadreId, description = undefined){
  const params = (nuevoPadreId && viejoPadreId && nuevoPadreId !== viejoPadreId)
    ? `?addParents=${nuevoPadreId}&removeParents=${viejoPadreId}` : '';
  return api(`files/${fileId}${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nuevoNombre, ...(description ? { description } : {}) })
  });
}

export async function descargarImagen(carpetaId, nombre){
  const q = encodeURIComponent(`name='${nombre.replace(/'/g, "\\'")}' and '${carpetaId}' in parents and trashed=false`);
  const res = await api(`files?q=${q}&fields=files(id)&pageSize=1`);
  if (!res.files.length) return null;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${res.files[0].id}?alt=media`,
    { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!r.ok) return null;
  return r.blob();
}

export async function listarNombres(carpetaId){
  const q = encodeURIComponent(`'${carpetaId}' in parents and trashed=false`);
  const res = await api(`files?q=${q}&fields=files(name)&pageSize=1000`);
  return res.files.map(f => f.name);
}

export async function subirJPEG(blob, nombre, carpetaId, description = undefined){
  const fd = new FormData();
  fd.append('metadata', new Blob(
    [JSON.stringify({ name: nombre, parents: [carpetaId], ...(description ? { description } : {}) })], { type: 'application/json' }));
  fd.append('file', blob);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST', headers: { Authorization: 'Bearer ' + accessToken }, body: fd
  });
  if (!r.ok) throw new Error('Subida falló: ' + r.status + ' ' + await r.text());
  return r.json();
}

// Sube un archivo con nombre fijo; si ya existe en la carpeta, lo REEMPLAZA (una sola
// version de Gastos_{Mes}.pdf y 606_{Mes}.xlsx por mes).
export async function subirOReemplazar(blob, nombre, carpetaId){
  const id = await buscarArchivo(carpetaId, nombre);
  if (id){
    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,
      { method: 'PATCH', headers: { Authorization: 'Bearer ' + accessToken }, body: blob });
    if (!r.ok) throw new Error('Reemplazo falló: ' + r.status + ' ' + await r.text());
    return r.json();
  }
  return subirJPEG(blob, nombre, carpetaId); // multipart generico: sirve para cualquier blob
}

export async function leerJSON(carpetaId, nombre){
  const q = encodeURIComponent(`name='${nombre}' and '${carpetaId}' in parents and trashed=false`);
  const res = await api(`files?q=${q}&fields=files(id,name)&pageSize=1`);
  if (!res.files.length) return null;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${res.files[0].id}?alt=media`,
    { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!r.ok) throw new Error('Drive leerJSON ' + r.status);
  return r.json();
}

export async function guardarJSON(carpetaId, nombre, obj){
  const q = encodeURIComponent(`name='${nombre}' and '${carpetaId}' in parents and trashed=false`);
  const res = await api(`files?q=${q}&fields=files(id)&pageSize=1`);
  const cuerpo = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  if (res.files.length){
    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${res.files[0].id}?uploadType=media`,
      { method: 'PATCH', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: cuerpo });
    if (!r.ok) throw new Error('Drive guardarJSON PATCH ' + r.status);
  } else {
    const fd = new FormData();
    fd.append('metadata', new Blob([JSON.stringify({ name: nombre, parents: [carpetaId] })], { type: 'application/json' }));
    fd.append('file', cuerpo);
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken }, body: fd });
    if (!r.ok) throw new Error('Drive guardarJSON POST ' + r.status);
  }
}
