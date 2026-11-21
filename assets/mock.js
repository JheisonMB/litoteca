/* Litoteca — mock de desarrollo.
 *
 * Sirve para diseñar las nueve fichas sin modelo entrenado. Solo se activa con
 * `?mock=1` (tira de categorías sobre el resultado) o `?galeria=1` (las nueve
 * fichas seguidas). En producción la URL publicada no lleva esos parámetros y
 * este archivo no hace nada: no hay ninguna ruta que lo active sola.
 *
 * Las probabilidades son inventadas y deterministas por categoría, para que una
 * misma tarjeta no cambie de aspecto entre recargas. */
(function () {
  "use strict";

  var ORDEN = [
    "basalt", "olivine-basalt", "chert", "clay", "conglomerate",
    "diatomite", "gypsum", "shale", "siliceous-sinter"
  ];

  var CONFIANZAS = {
    basalt: 0.93, "olivine-basalt": 0.78, chert: 0.86, clay: 0.71,
    conglomerate: 0.89, diatomite: 0.66, gypsum: 0.81, shale: 0.74,
    "siliceous-sinter": 0.63
  };

  function parametros() {
    try { return new URLSearchParams(window.location.search); }
    catch (e) { return new URLSearchParams(""); }
  }

  function activo() { return parametros().get("mock") === "1"; }
  function galeria() { return parametros().get("galeria") === "1"; }
  function categorias() { return ORDEN.slice(); }

  /* Respuesta con la misma forma que el contrato de /api/predict. */
  function respuesta(id, confianza) {
    var fichas = window.LITOTECA_FICHAS || {};
    var ficha = fichas[id] || fichas[ORDEN[0]];
    var p1 = typeof confianza === "number" ? confianza : (CONFIANZAS[ficha.id] || 0.8);
    var p2 = Math.max(0.01, Math.min(0.32, (1 - p1) * 0.62));
    var p3 = Math.max(0, Number((1 - p1 - p2).toFixed(4)));

    var otros = ORDEN.filter(function (otro) { return otro !== ficha.id; });
    function de(otroId, p) {
      var otra = fichas[otroId];
      return { id: otra.id, nombre: otra.nombre, tecnico: otra.tecnico, origen: otra.origen, p: Number(p.toFixed(4)) };
    }

    return {
      mock: true,
      modelo: { iteracion: "mock", entrenado: null },
      top: ficha.id,
      confianza: Number(p1.toFixed(4)),
      margen: Number((p1 - p2).toFixed(4)),
      bajaConfianza: p1 < 0.7,
      ambiguo: p1 >= 0.7 && (p1 - p2) < 0.15,
      latenciaMs: 0,
      predicciones: [
        { id: ficha.id, nombre: ficha.nombre, tecnico: ficha.tecnico, origen: ficha.origen, p: Number(p1.toFixed(4)) },
        de(otros[0], p2),
        de(otros[1], p3)
      ]
    };
  }

  window.LITOTECA_MOCK = {
    activo: activo,
    galeria: galeria,
    categorias: categorias,
    respuesta: respuesta
  };
})();
