// Catálogo compartido por W-Main y la app de operarios: empresas, áreas y tipos de equipo
// de fábrica, más los cambios guardados en Configuración (config/codigos).
(function(){
"use strict";
const EMP0={IP:"Inyectora de plásticos",LH:"Limpieza hogar",PH:"Pinturas",AL:"Alimentos",GR:"Grupo (pañol / sin asignar)"};
const AREAS0=[["INY","Inyección"],["SOP","Soplado"],["MOL","Molienda / recuperado"],["ELA","Elaboración / mezcla"],["ENV","Envasado / llenado"],["EMP","Etiquetado y empaque"],["DEP","Depósito / logística"],["SER","Servicios generales (aire, agua, vapor, energía)"],["LAB","Calidad / laboratorio"],["EFL","Efluentes"],["EDI","Edilicio"],["TAL","Taller / pañol de mantenimiento"]];
const TIPOS0=[["INY","Inyectora",0],["SOP","Sopladora",0],["MOL","Molino",0],["MDE","Molde / matriz",1],["CHI","Chiller / enfriador",0],["COM","Compresor",1],["SEC","Secador / deshumidificador",0],["MEZ","Mezclador / agitador",0],["DIS","Dispersor",0],["MAR","Marmita / reactor",0],["BOM","Bomba",1],["LLE","Llenadora / envasadora",0],["TAP","Tapadora",0],["ETQ","Etiquetadora",0],["CIN","Cinta transportadora",0],["TAN","Tanque / recipiente",0],["CAL","Caldera",0],["INT","Intercambiador / pasteurizador",0],["TAB","Tablero eléctrico",0],["MOT","Motor eléctrico / motorreductor",1],["API","Apiladora",1],["AUT","Autoelevador / zorra",1],["HER","Herramienta eléctrica",1],["SOL","Soldadora",1],["GEN","Grupo electrógeno",1],["BAL","Balanza",0],["EXT","Extracción / ventilación",0],["ROB","Robot / manipulador",0],["OTR","Otro",0]];
const nombres=(cfg,k)=>((cfg&&cfg.nombres)||{})[k]||{};
function areas(cfg){if(cfg&&Array.isArray(cfg.areasLista))return cfg.areasLista.map(x=>[x.c,x.d]);const m=new Map(AREAS0);((cfg&&cfg.areas)||[]).forEach(a=>{if(a&&a.c&&!m.has(a.c))m.set(a.c,a.d)});const ren=nombres(cfg,"areas");for(const k of m.keys())if(ren[k])m.set(k,ren[k]);return [...m]}
function tipos(cfg){if(cfg&&Array.isArray(cfg.tiposLista))return cfg.tiposLista.map(x=>[x.c,{d:x.d,movil:!!x.movil}]);const m=new Map(TIPOS0.map(t=>[t[0],{d:t[1],movil:!!t[2]}]));((cfg&&cfg.tipos)||[]).forEach(t=>{if(t&&t.c&&!m.has(t.c))m.set(t.c,{d:t.d,movil:!!t.movil})});const ren=nombres(cfg,"tipos");for(const [k,i] of m)if(ren[k])m.set(k,{d:ren[k],movil:i.movil});return [...m]}
function empresas(cfg){
  const E={};
  if(cfg&&Array.isArray(cfg.empresasLista))cfg.empresasLista.forEach(x=>{if(x&&x.c)E[x.c]=x.d});
  else{Object.assign(E,EMP0);((cfg&&cfg.empresas)||[]).forEach(x=>{if(x&&x.c&&!(x.c in E))E[x.c]=x.d});
    const ren=nombres(cfg,"emp");for(const k of Object.keys(E))if(ren[k])E[k]=ren[k]}
  return E;
}
window.PM_CAT={EMP0,AREAS0,TIPOS0,empresas,areas,tipos};
})();
