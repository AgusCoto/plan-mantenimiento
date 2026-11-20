// Íconos de la interfaz (trazo con el color del texto: currentColor). Incluye uno por tipo de falla.
const P: Record<string, string> = {
  inicio: "M3 11 12 3l9 8M5 9.5V21h5v-6h4v6h5V9.5",
  calendario: "M4 5h16v16H4zM4 10h16M8 3v4M16 3v4M8.5 15.5l2 2 4-4",
  libro: "M5 4h11a3 3 0 0 1 3 3v14H8a3 3 0 0 1-3-3zM5 18a3 3 0 0 1 3-3h11",
  grafico: "M4 20h16M7 16v-5M11 16V7M15 16v-8M19 16v-3",
  tablero: "M3 4h18v12H3zM8 20h8M12 16v4M7 12l3-3 2 2 4-4",
  reloj: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  menu: "M4 7h16M4 12h16M4 17h16",
  persona: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1",
  lapiz: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  equipos: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  ordenes: "M9 3h6v3H9zM7 4.5H5v17h14v-17h-2M8.5 11h7M8.5 15h7",
  reportes: "M12 3 2.5 20h19zM12 10v4.5M12 17.2v.1",
  movimientos: "M4 8h13l-3.5-3.5M20 16H7l3.5 3.5",
  compras: "M3 4h2.5l2.2 11h10.6l2.2-8H7M9.5 20a1 1 0 1 0 0-.1M17 20a1 1 0 1 0 0-.1",
  apariencia: "M12 3a9 9 0 1 0 0 18c1.2 0 1.6-.8 1.6-1.6 0-.9-.6-1.3-.6-2.2 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 12a1 1 0 1 0 0-.1M9.5 7.5a1 1 0 1 0 0-.1M14.5 7.5a1 1 0 1 0 0-.1",
  usuarios: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1.5A5.5 5.5 0 0 1 7.5 14h3a5.5 5.5 0 0 1 5.5 5.5V21M16 3.5a4 4 0 0 1 0 7.5M19 14.3a5.5 5.5 0 0 1 3 4.9V21",
  registro: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5",
  configuracion: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z",
  escanear: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16",
  nfc: "M6 8.5a6 6 0 0 1 0 7M9.5 6a10 10 0 0 1 0 12M13 3.5a14 14 0 0 1 0 17",
  camara: "M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  video: "M3 6h12v12H3zM15 10l6-3.5v11L15 14",
  aviso: "M12 3a6 6 0 0 0-6 6v3.5L4.5 16h15L18 12.5V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0",
  salir: "M10 4H5v16h5M14 8l4 4-4 4M18 12H9",
  mas: "M12 5v14M5 12h14",
  buscar: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM16 16l5 5",
  descargar: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14",
  // Tipos de falla
  ruido: "M4 9.5h3l5-4v13l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12",
  gota: "M12 3c3.5 4.5 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6.5 6-11z",
  aire: "M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7",
  agua: "M3 15c2 0 2-1.5 4.5-1.5S9.5 15 12 15s2-1.5 4.5-1.5S18.5 15 21 15M3 19c2 0 2-1.5 4.5-1.5S9.5 19 12 19s2-1.5 4.5-1.5S18.5 19 21 19M12 3c2 2.6 3.4 4.6 3.4 6.4a3.4 3.4 0 0 1-6.8 0C8.6 7.6 10 5.6 12 3z",
  termometro: "M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0zM12 9v7.5",
  power: "M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0",
  rayo: "M13 2 4.5 13.5H11L10 22l8.5-11.5H12z",
  enchufe: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
  producto: "M4 7.5 12 3l8 4.5v9L12 21l-8-4.5zM4 7.5l8 4.5 8-4.5M12 12v9",
  pregunta: "M9.2 9a3 3 0 1 1 4.2 2.8c-.9.4-1.4 1-1.4 2v.7M12 17.5v.1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  engranaje: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.4 7.4 0 0 1-2.2 1.3L14.5 21h-4l-.4-2.3a7.4 7.4 0 0 1-2.2-1.3l-1.9.7-2-3.4 1.6-1.2a7.6 7.6 0 0 1 0-3L4 9.3l2-3.4 1.9.7a7.4 7.4 0 0 1 2.2-1.3L10.5 3h4l.4 2.3a7.4 7.4 0 0 1 2.2 1.3l1.9-.7 2 3.4-1.6 1.2a7.6 7.6 0 0 1 0 3z",
};
export type Icono = keyof typeof P | string;
export const ICONOS = Object.keys(P);
export function Ico({ n, className, titulo }: { n: Icono; className?: string; titulo?: string }) {
  return (
    <svg className={className || "ico"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      role={titulo ? "img" : undefined} aria-label={titulo} aria-hidden={titulo ? undefined : true}>
      <path d={P[n] || P.pregunta} />
    </svg>
  );
}
