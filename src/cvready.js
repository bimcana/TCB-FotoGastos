export function cvReady(){
  return new Promise(res => {
    if (window.cv && cv.Mat) return res();
    const check = () => (window.cv && cv.Mat) ? res() : setTimeout(check, 100);
    check();
  });
}
