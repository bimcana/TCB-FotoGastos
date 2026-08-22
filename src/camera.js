// Fase 23: se pide 2560x1440 en vez de 1920x1080. Cada pixel de mas es un pixel mas por
// digito del NCF, que es donde se cometian los errores de 0/6/8. `ideal` es una peticion
// blanda: el navegador da lo mas cercano que tenga, asi que un movil que no llegue sigue
// funcionando igual.
//
// NO se pide 4K a proposito. La foto pasa entera por OpenCV.js (warp + realce), que corre
// sobre un heap WASM limitado: a 4K cada Mat son ~33 MB y autoColor usa una decena. Eso no
// se puede probar desde aqui (la camara es justo lo que no se puede probar sin el iPhone),
// y quedarse sin memoria en pleno cierre de mes seria peor que un digito borroso. El tope
// de `dimensionesDestino` es la segunda red de seguridad.
export async function iniciarCamara(video){
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 2560 }, height: { ideal: 1440 } },
    audio: false
  });
  // Enfoque continuo si el dispositivo lo expone (Fase 9): mejor nitidez apuntando
  // hacia abajo a facturas pequeñas. Best-effort — si el navegador no lo soporta
  // (iOS viejo), se ignora en silencio y la camara arranca igual.
  try {
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')){
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    }
  } catch(e){ console.warn('Enfoque continuo no disponible:', e.message); }
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function capturarFrame(video){
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  return c;
}
