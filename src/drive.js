let tokenClient = null, accessToken = null, expiraEn = 0;

// El token de acceso vive ~1 h: se persiste para que reabrir la app dentro de esa
// ventana NO requiera reconectar (la causa principal del "Drive se desconecta").
// En 401 (vencido/revocado) se limpia y la UI ofrece reconectar.
try {
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
    scope: 'https://www.googleapis.com/auth/drive.file',
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

export async function asegurarCarpeta(nombre, padreId = null){
  const filtroPadre = padreId ? ` and '${padreId}' in parents` : '';
  const q = encodeURIComponent(
    `name='${nombre.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${filtroPadre}`);
  const res = await api(`files?q=${q}&fields=files(id,name)&pageSize=10`);
  if (res.files.length) return res.files[0].id;
  const creada = await api('files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nombre, mimeType: 'application/vnd.google-apps.folder',
                           ...(padreId ? { parents: [padreId] } : {}) })
  });
  return creada.id;
}

export async function buscarCarpeta(nombre, padreId = null){
  const filtroPadre = padreId ? ` and '${padreId}' in parents` : '';
  const q = encodeURIComponent(`name='${nombre.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${filtroPadre}`);
  const res = await api(`files?q=${q}&fields=files(id)&pageSize=1`);
  return res.files.length ? res.files[0].id : null;
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

// Renombra y (si cambia el padre) mueve el archivo en UNA sola llamada PATCH.
export async function moverYRenombrar(fileId, nuevoNombre, nuevoPadreId, viejoPadreId){
  const params = (nuevoPadreId && viejoPadreId && nuevoPadreId !== viejoPadreId)
    ? `?addParents=${nuevoPadreId}&removeParents=${viejoPadreId}` : '';
  return api(`files/${fileId}${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nuevoNombre })
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

export async function subirJPEG(blob, nombre, carpetaId){
  const fd = new FormData();
  fd.append('metadata', new Blob(
    [JSON.stringify({ name: nombre, parents: [carpetaId] })], { type: 'application/json' }));
  fd.append('file', blob);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST', headers: { Authorization: 'Bearer ' + accessToken }, body: fd
  });
  if (!r.ok) throw new Error('Subida falló: ' + r.status + ' ' + await r.text());
  return r.json();
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
