const PREFIJO = 'tcb:';

export function get(clave, porDefecto = null){
  try {
    const v = localStorage.getItem(PREFIJO + clave);
    return v === null ? porDefecto : JSON.parse(v);
  } catch(e){ return porDefecto; }
}

export function set(clave, valor){
  try { localStorage.setItem(PREFIJO + clave, JSON.stringify(valor)); } catch(e){}
}
