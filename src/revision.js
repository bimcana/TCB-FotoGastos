// Cola local (IndexedDB) de facturas subidas incompletas o leídas con OCR local, a la
// espera de que Gemini las revise cuando la app se abra con conexión. Guarda una copia
// de la imagen y su ubicación en Drive (mesId + nombre) para actualizar el índice.
const DB = 'fotogastos-rev', STORE = 'rev';

function abrir(){
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(db, modo, fn){
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, modo);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req.result);
    t.onerror = () => rej(t.error);
  });
}

export async function encolarRevision(item){ const db = await abrir(); await tx(db, 'readwrite', s => s.add({ ...item, creado: Date.now() })); }
export async function pendientesRevision(){ const db = await abrir(); return tx(db, 'readonly', s => s.getAll()); }
export async function eliminarRevision(id){ const db = await abrir(); await tx(db, 'readwrite', s => s.delete(id)); }
export async function cuentaRevision(){ return (await pendientesRevision()).length; }
