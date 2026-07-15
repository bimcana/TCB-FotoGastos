const DB = 'fotogastos', STORE = 'cola';

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

export async function encolar(item){ const db = await abrir(); await tx(db, 'readwrite', s => s.add({ ...item, creado: Date.now() })); }
export async function pendientes(){ const db = await abrir(); return tx(db, 'readonly', s => s.getAll()); }
export async function eliminar(id){ const db = await abrir(); await tx(db, 'readwrite', s => s.delete(id)); }
export async function cuenta(){ return (await pendientes()).length; }
