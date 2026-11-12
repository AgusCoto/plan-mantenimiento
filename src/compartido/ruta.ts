// Navegación por hash, como el prototipo: #tablero, #eq-INY-PRO-INY-001, #ot-<id>…
export const ruta = () => decodeURIComponent((location.hash || "").replace(/^#\/?/, ""));
export const ir = (h: string) => {
  if (ruta() === h) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = h;
};
