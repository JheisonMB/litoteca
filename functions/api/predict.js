/**
 * POST /api/predict — proxy del clasificador.
 *
 * Contrato (BLUEPRINT §10.2): multipart/form-data con el campo `imagen`
 * (JPEG/PNG/WebP, ≤ 4 MB). Devuelve el top-3 normalizado, `top`, `confianza`,
 * `margen`, `bajaConfianza` y `ambiguo`.
 *
 * Sin CUSTOM_VISION_ENDPOINT / CUSTOM_VISION_KEY / CUSTOM_VISION_PROJECT /
 * CUSTOM_VISION_ITERATION configurados responde 503 con un motivo explícito: la
 * interfaz lo trata como "modelo sin entrenar" y cae en modo demostración.
 */
const MAX_BYTES = 4 * 1024 * 1024;
const UMBRAL_CONFIANZA = 0.7;
const UMBRAL_MARGEN = 0.15;

const CLASES = {
  basalt: { id: "basalt", nombre: "Basalto", tecnico: "Basalt", origen: "igneo" },
  "olivine-basalt": { id: "olivine-basalt", nombre: "Basalto olivínico", tecnico: "Olivine basalt", origen: "igneo" },
  chert: { id: "chert", nombre: "Sílex", tecnico: "Chert", origen: "sedimentario" },
  clay: { id: "clay", nombre: "Arcilla", tecnico: "Clay", origen: "sedimentario" },
  conglomerate: { id: "conglomerate", nombre: "Conglomerado", tecnico: "Conglomerate", origen: "sedimentario" },
  diatomite: { id: "diatomite", nombre: "Diatomita", tecnico: "Diatomite", origen: "sedimentario" },
  gypsum: { id: "gypsum", nombre: "Yeso", tecnico: "Gypsum", origen: "sedimentario" },
  shale: { id: "shale", nombre: "Lutita", tecnico: "Shale (mudstone)", origen: "sedimentario" },
  "siliceous-sinter": { id: "siliceous-sinter", nombre: "Geiserita", tecnico: "Siliceous sinter", origen: "sedimentario" }
};

/* Etiquetas de Custom Vision → ids del contrato. Las etiquetas son los nombres
 * de carpeta de data/prepared, con la normalización del export original. */
const ETIQUETAS = {
  basalt: "basalt",
  "olivine-basalt": "olivine-basalt",
  "olivine basalt": "olivine-basalt",
  chert: "chert",
  clay: "clay",
  conglomerate: "conglomerate",
  diatomite: "diatomite",
  gypsum: "gypsum",
  shale: "shale",
  "shale-(mudstone)": "shale",
  "shale (mudstone)": "shale",
  mudstone: "shale",
  "siliceous-sinter": "siliceous-sinter",
  "siliceous sinter": "siliceous-sinter",
  geyserite: "siliceous-sinter"
};

function json(cuerpo, estado) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function claseDe(etiqueta) {
  const clave = String(etiqueta || "").trim().toLowerCase();
  const id = ETIQUETAS[clave];
  return id ? CLASES[id] : null;
}

export async function onRequestPost({ request, env }) {
  const inicio = Date.now();

  const tipo = request.headers.get("content-type") || "";
  if (!tipo.includes("multipart/form-data")) {
    return json({ error: "contenido_invalido", mensaje: "Se esperaba multipart/form-data con el campo imagen." }, 400);
  }

  let forma;
  try {
    forma = await request.formData();
  } catch (e) {
    return json({ error: "contenido_invalido", mensaje: "No pudimos leer el formulario." }, 400);
  }

  const imagen = forma.get("imagen");
  if (!imagen || typeof imagen === "string") {
    return json({ error: "imagen_ausente", mensaje: "Falta el campo imagen." }, 400);
  }
  if (!/^image\/(jpeg|png|webp)$/.test(imagen.type)) {
    return json({ error: "formato_no_soportado", mensaje: "Solo JPEG, PNG o WebP." }, 400);
  }
  if (imagen.size > MAX_BYTES) {
    return json({ error: "imagen_grande", mensaje: "La imagen supera los 4 MB." }, 413);
  }

  const endpoint = env.CUSTOM_VISION_ENDPOINT;
  const clave = env.CUSTOM_VISION_KEY;
  const proyecto = env.CUSTOM_VISION_PROJECT;
  const iteracion = env.CUSTOM_VISION_ITERATION || "Iteration1";

  if (!endpoint || !clave || !proyecto) {
    return json({
      error: "modelo_no_disponible",
      mensaje: "El modelo todavía no está entrenado ni publicado: faltan CUSTOM_VISION_ENDPOINT, CUSTOM_VISION_KEY y CUSTOM_VISION_PROJECT."
    }, 503);
  }

  const url =
    endpoint.replace(/\/+$/, "") +
    `/customvision/v3.0/Prediction/${encodeURIComponent(proyecto)}` +
    `/classify/iterations/${encodeURIComponent(iteracion)}/image`;

  let respuesta;
  try {
    respuesta = await fetch(url, {
      method: "POST",
      headers: {
        "Prediction-Key": clave,
        "Content-Type": "application/octet-stream"
      },
      body: await imagen.arrayBuffer()
    });
  } catch (e) {
    return json({ error: "modelo_inalcanzable", mensaje: "No alcanzamos Custom Vision." }, 503);
  }

  if (respuesta.status === 429) {
    return json({ error: "limite_uso", mensaje: "El modelo está al límite de uso. Reintenta en un minuto." }, 429);
  }
  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => "");
    return json({
      error: "modelo_error",
      mensaje: "Custom Vision respondió " + respuesta.status + ".",
      detalle: detalle.slice(0, 300)
    }, 503);
  }

  const cuerpo = await respuesta.json().catch(() => null);
  const crudas = cuerpo && Array.isArray(cuerpo.predictions) ? cuerpo.predictions : [];

  const predicciones = crudas
    .map((p) => {
      const clase = claseDe(p.tagName);
      return clase ? { ...clase, p: Number(p.probability) || 0 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.p - a.p);

  if (predicciones.length === 0) {
    return json({ error: "sin_clases", mensaje: "El modelo no devolvió ninguna etiqueta conocida." }, 503);
  }

  const top = predicciones[0];
  const segunda = predicciones[1] ? predicciones[1].p : 0;
  const confianza = top.p;
  const margen = confianza - segunda;

  return json({
    modelo: {
      iteracion: iteracion,
      entrenado: env.CUSTOM_VISION_TRAINED || null
    },
    predicciones: predicciones.slice(0, 3).map((p) => ({
      id: p.id, nombre: p.nombre, tecnico: p.tecnico, origen: p.origen, p: Number(p.p.toFixed(4))
    })),
    top: top.id,
    confianza: Number(confianza.toFixed(4)),
    margen: Number(margen.toFixed(4)),
    bajaConfianza: confianza < UMBRAL_CONFIANZA,
    ambiguo: confianza >= UMBRAL_CONFIANZA && margen < UMBRAL_MARGEN,
    latenciaMs: Date.now() - inicio
  }, 200);
}

export async function onRequestGet() {
  return json({ error: "metodo_no_permitido", mensaje: "Usa POST con multipart/form-data." }, 405);
}
