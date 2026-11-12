// Filtros y pestañas que se recuerdan al ir y volver entre pantallas (como el objeto `ui` del prototipo).
import { useState } from "react";

const memoria = new Map<string, unknown>();
export function useUi<T>(clave: string, inicial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(memoria.has(clave) ? (memoria.get(clave) as T) : inicial);
  return [v, (x: T) => { memoria.set(clave, x); setV(x); }];
}
