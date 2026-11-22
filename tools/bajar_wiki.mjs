#!/usr/bin/env node
/* Baja una vez los extractos de Wikipedia y los congela en assets/wiki.js.
 * Uso: node tools/bajar_wiki.mjs
 * Requiere red (una sola vez). Si algún título no trae `extract`,
 * imprime los fallos, sale con código 1 y no toca assets/wiki.js. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, "..");
const UA = "Litoteca/0.1 (jhmartinez07@unisalle.edu.co)";

const caja = { window: {} };
vm.createContext(caja);
const fuenteFichas = fs.readFileSync(path.join(raiz, "assets", "fichas.js"), "utf-8");
vm.runInContext(fuenteFichas, caja, { filename: "fichas.js" });
const fichas = caja.window.LITOTECA_FICHAS || {};

const ids = Object.keys(fichas).sort();
const memoria = new Map(); // titulo wiki -> entrada

async function bajar(titulo) {
  if (memoria.has(titulo)) return memoria.get(titulo);
  const slug = titulo.replace(/ /g, "_");
  const url = "https://es.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(slug);
  const respuesta = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!respuesta.ok) throw new Error("HTTP " + respuesta.status);
  const datos = await respuesta.json();
  if (!datos.extract) throw new Error("sin extract");
  const entrada = {
    titulo: datos.title || titulo,
    extracto: datos.extract,
    url: (datos.content_urls && datos.content_urls.desktop && datos.content_urls.desktop.page)
      || ("https://es.wikipedia.org/wiki/" + encodeURIComponent(slug)),
    idioma: "es",
    licencia: "CC BY-SA 4.0",
  };
  memoria.set(titulo, entrada);
  return entrada;
}

const fallos = [];
const porId = {};
for (const id of ids) {
  const titulo = fichas[id] && fichas[id].wiki;
  if (!titulo) { fallos.push(`${id} — (sin título wiki)`); continue; }
  try {
    porId[id] = await bajar(titulo);
  } catch (error) {
    fallos.push(`${id} — ${titulo}`);
  }
}

if (fallos.length) {
  for (const f of fallos) console.error(f);
  process.exit(1);
}

const salida = {
  generado: new Date().toISOString().slice(0, 10),
  fuente: "https://es.wikipedia.org",
};
for (const id of ids) salida[id] = porId[id];

const texto = "/* Generado por node tools/bajar_wiki.mjs — no editar a mano. */\n"
  + "window.LITOTECA_WIKI = " + JSON.stringify(salida, null, 2) + ";\n";
fs.writeFileSync(path.join(raiz, "assets", "wiki.js"), texto, "utf-8");
console.log(`wiki.js escrito con ${ids.length} entradas.`);
