/* Prueba del contrato de /api/predict sin red y sin Azure.
 *
 * Importa la Function real (copiada a .mjs porque el repo no tiene
 * package.json: Node trataría el .js como CommonJS y fallaría en el export),
 * le inyecta un `fetch` falso y comprueba la normalización y los umbrales.
 *
 * Uso: node scripts/prueba_contrato.mjs
 */
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporal = await mkdtemp(path.join(tmpdir(), "litoteca-contrato-"));
const copia = path.join(temporal, "predict.mjs");
await copyFile(path.join(raiz, "functions/api/predict.js"), copia);

let fallos = 0;
const ok = (condicion, mensaje) => {
  if (condicion) console.log("  ok  " + mensaje);
  else { console.log("FALLO: " + mensaje); fallos += 1; }
};

const entorno = {
  CUSTOM_VISION_ENDPOINT: "https://recurso.cognitiveservices.azure.com",
  CUSTOM_VISION_KEY: "clave-de-prueba",
  CUSTOM_VISION_PROJECT: "proyecto",
  CUSTOM_VISION_ITERATION: "rock-v2",
  CUSTOM_VISION_TRAINED: "2026-11-18"
};

function peticion(tamano = 2048, tipo = "image/jpeg") {
  const forma = new FormData();
  forma.append("imagen", new File([Buffer.alloc(tamano, 7)], "muestra.jpg", { type: tipo }));
  return new Request("http://local/api/predict", { method: "POST", body: forma });
}

function respuestas(lista) {
  return async () => new Response(JSON.stringify({ predictions: lista }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

const { onRequestPost, onRequestGet } = await import("file://" + copia);

try {
  // 1. Método distinto a POST.
  const get = await onRequestGet();
  ok(get.status === 405, "GET responde 405");

  // 2. Sin credenciales: 503 explícito, no un 500 opaco.
  const sinEntorno = await onRequestPost({ request: peticion(), env: {} });
  const cuerpoSinEntorno = await sinEntorno.json();
  ok(sinEntorno.status === 503 && cuerpoSinEntorno.error === "modelo_no_disponible",
    "sin variables responde 503 modelo_no_disponible");

  // 3. Contenido que no es multipart: 400.
  const malTipo = await onRequestPost({
    request: new Request("http://local/api/predict", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}"
    }),
    env: entorno
  });
  ok(malTipo.status === 400, "content-type inválido responde 400");

  // 4. Imagen demasiado grande: 413 antes de llamar al modelo.
  const grande = await onRequestPost({ request: peticion(5 * 1024 * 1024), env: entorno });
  ok(grande.status === 413, "imagen de 5 MB responde 413");

  // 5. Normalización y umbrales con una respuesta típica.
  globalThis.fetch = respuestas([
    { tagName: "Basalt", probability: 0.85 },
    { tagName: "olivine-basalt", probability: 0.1 },
    { tagName: "chert", probability: 0.05 },
    { tagName: "Etiqueta rara", probability: 0.9 }
  ]);
  const buena = await onRequestPost({ request: peticion(), env: entorno });
  const datos = await buena.json();
  ok(buena.status === 200, "respuesta del modelo responde 200");
  ok(datos.top === "basalt" && datos.predicciones[0].id === "basalt", "top-1 mapeado a basalt");
  ok(datos.predicciones.length === 3, "solo se devuelven 3 predicciones");
  ok(!datos.predicciones.some((p) => p.nombre === undefined), "etiquetas desconocidas se descartan");
  ok(Math.abs(datos.confianza - 0.85) < 1e-6, "confianza normalizada a 0,85");
  ok(Math.abs(datos.margen - 0.75) < 1e-6, "margen = p1 - p2");
  ok(datos.bajaConfianza === false && datos.ambiguo === false, "0,85 con margen 0,75 es seguro");
  ok(datos.modelo.iteracion === "rock-v2" && datos.modelo.entrenado === "2026-11-18",
    "metadatos de la iteración propagados");
  ok(typeof datos.latenciaMs === "number", "latenciaMs presente");
  ok(datos.predicciones[0].origen === "igneo" && datos.predicciones[2].origen === "sedimentario",
    "origen viene del catálogo, no del modelo");

  // 6. Margen por debajo de 0,15 con confianza suficiente: ambiguo.
  globalThis.fetch = respuestas([
    { tagName: "Shale-(Mudstone)", probability: 0.72 },
    { tagName: "clay", probability: 0.65 }
  ]);
  const ambiguo = await (await onRequestPost({ request: peticion(), env: entorno })).json();
  ok(ambiguo.top === "shale", "Shale-(Mudstone) se normaliza a shale");
  ok(ambiguo.ambiguo === true && ambiguo.bajaConfianza === false, "0,72 contra 0,65 se marca ambiguo");

  // 7. Confianza por debajo de 0,70: banda ámbar.
  globalThis.fetch = respuestas([{ tagName: "gypsum", probability: 0.55 }]);
  const flojo = await (await onRequestPost({ request: peticion(), env: entorno })).json();
  ok(flojo.bajaConfianza === true && flojo.ambiguo === false, "0,55 se marca baja confianza");
  ok(flojo.predicciones.length === 1 && flojo.margen === 0.55, "sin segunda clase el margen es p1");

  // 8. Azure caído: 503, nunca un 200 vacío.
  globalThis.fetch = async () => new Response("boom", { status: 500 });
  const caido = await onRequestPost({ request: peticion(), env: entorno });
  ok(caido.status === 503, "error de Azure se traduce a 503");

  // 9. Límite de uso.
  globalThis.fetch = async () => new Response("{}", { status: 429 });
  const limitado = await onRequestPost({ request: peticion(), env: entorno });
  ok(limitado.status === 429, "429 de Azure se propaga como 429");
} finally {
  await rm(temporal, { recursive: true, force: true });
}

if (fallos > 0) {
  console.log(`CONTRATO FALLIDO (${fallos})`);
  process.exit(1);
}
console.log("  contrato OK");
