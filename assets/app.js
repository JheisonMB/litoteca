/* Litoteca — interfaz. Sin framework y sin build: un módulo plano que el
 * navegador puede ejecutar tal cual desde Pages.
 *
 * Flujo: inicio → (cámara | archivo) → recorte 512 px → POST /api/predict →
 * ficha. Todo escaneo nuevo se guarda en localStorage (máx. 10, miniatura
 * 96 px) para que "Mi litoteca" funcione sin conexión.
 *
 * Si /api/predict responde 503 el modelo todavía no está entrenado: la ficha se
 * genera en modo demostración y la interfaz lo dice en voz alta. */
(function () {
  "use strict";

  var FICHAS = window.LITOTECA_FICHAS || {};
  var CLAVE = "litoteca.historial.v1";
  var MAX_ENTRADAS = 10;
  var ORIGEN_TEXTO = { igneo: "Ígnea", sedimentario: "Sedimentaria" };

  var $ = function (sel, raiz) { return (raiz || document).querySelector(sel); };

  var dom = {
    vistas: {
      inicio: $("#vista-inicio"),
      camara: $("#vista-camara"),
      resultado: $("#vista-resultado"),
      historial: $("#vista-historial")
    },
    disparador: $("#btn-disparador"),
    btnCamara: $("#btn-camara"),
    btnSubir: $("#btn-subir"),
    archivo: $("#input-archivo"),
    selector: $("#selector"),
    elegirCamara: $("#elegir-camara"),
    elegirArchivo: $("#elegir-archivo"),
    video: $("#video"),
    obturador: $("#btn-capturar"),
    cerrarCamara: $("#cerrar-camara"),
    permiso: $("#aviso-permiso"),
    permisoTexto: $("#permiso-texto"),
    resultado: $("#resultado"),
    historialLista: $("#lista-historial"),
    historialVacio: $("#historial-vacio"),
    borrarTodo: $("#btn-borrar-todo"),
    anuncio: $("#anuncio"),
    sincronia: $("#sincronia"),
    metodologia: $("#metodologia")
  };

  var estado = {
    vista: "inicio",
    stream: null,
    foto: null,        // dataURL 512 px de la captura actual
    ultimoBlob: null,  // para reintentar
    respuesta: null
  };

  /* ---------------- utilidades ---------------- */

  function esc(texto) {
    return String(texto == null ? "" : texto)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function anunciar(mensaje) {
    dom.anuncio.textContent = mensaje;
  }

  function fechaLarga(iso) {
    try {
      return new Date(iso).toLocaleDateString("es-CO", {
        day: "2-digit", month: "short", year: "numeric"
      });
    } catch (e) { return ""; }
  }

  function porcentaje(p) {
    return Math.round((p || 0) * 100) + " %";
  }

  /* ---------------- navegación ---------------- */

  function mostrarVista(nombre) {
    Object.keys(dom.vistas).forEach(function (clave) {
      dom.vistas[clave].hidden = clave !== nombre;
    });
    estado.vista = nombre;
    if (nombre !== "camara") detenerCamara();
    window.scrollTo(0, 0);
  }

  function irAInicio() {
    mostrarVista("inicio");
    anunciar("Litoteca. Abre la cámara o sube una foto para empezar.");
  }

  /* ---------------- cámara ---------------- */

  function detenerCamara() {
    if (estado.stream) {
      estado.stream.getTracks().forEach(function (t) { t.stop(); });
      estado.stream = null;
    }
    if (dom.video) dom.video.srcObject = null;
  }

  function motivoPermiso(error) {
    var nombre = error && error.name ? error.name : "";
    if (!window.isSecureContext) {
      return "Esta página necesita HTTPS para usar la cámara. Abre la versión publicada del sitio, o sube una foto del dispositivo.";
    }
    if (nombre === "NotAllowedError" || nombre === "SecurityError") {
      return "El navegador tiene bloqueado el acceso a la cámara. Puedes habilitarlo en el candado de la barra de direcciones, o subir una foto del dispositivo.";
    }
    if (nombre === "NotFoundError" || nombre === "OverconstrainedError") {
      return "No encontramos una cámara disponible en este dispositivo. Sube una foto de la galería.";
    }
    if (nombre === "NotReadableError") {
      return "Otra aplicación está usando la cámara. Ciérrala y vuelve a intentar.";
    }
    return "No pudimos abrir la cámara. Sube una foto del dispositivo y seguimos igual.";
  }

  function mostrarPermisoBloqueado(error) {
    dom.permiso.hidden = false;
    dom.video.hidden = true;
    dom.obturador.disabled = true;
    dom.permisoTexto.textContent = motivoPermiso(error);
    anunciar("No hay acceso a la cámara. " + motivoPermiso(error));
  }

  function abrirCamara() {
    mostrarVista("camara");
    dom.permiso.hidden = true;
    dom.permisoTexto.textContent = "";
    dom.video.hidden = false;
    dom.obturador.disabled = false;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      mostrarPermisoBloqueado({ name: "NotFoundError" });
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }
      })
      .then(function (stream) {
        estado.stream = stream;
        dom.video.srcObject = stream;
        var reproduccion = dom.video.play();
        if (reproduccion && reproduccion.catch) reproduccion.catch(function () {});
        anunciar("Cámara lista. Encuadra la muestra y pulsa el obturador.");
      })
      .catch(function (error) { mostrarPermisoBloqueado(error); });
  }

  /* ---------------- captura ---------------- */

  function lienzoCuadrado(origen, ancho, alto, lado) {
    var ladoFuente = Math.min(ancho, alto);
    var lienzo = document.createElement("canvas");
    lienzo.width = lado;
    lienzo.height = lado;
    var ctx = lienzo.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      origen,
      (ancho - ladoFuente) / 2, (alto - ladoFuente) / 2, ladoFuente, ladoFuente,
      0, 0, lado, lado
    );
    return lienzo;
  }

  function aBlob(lienzo) {
    return new Promise(function (resolve) {
      lienzo.toBlob(function (blob) { resolve(blob); }, "image/jpeg", 0.82);
    });
  }

  function capturar() {
    if (!estado.stream || dom.video.readyState < 2) return;
    var lienzo = lienzoCuadrado(dom.video, dom.video.videoWidth, dom.video.videoHeight, 512);
    estado.foto = lienzo.toDataURL("image/jpeg", 0.82);
    if (navigator.vibrate) navigator.vibrate(18);
    lienzo.toBlob(function (blob) { procesar(blob); }, "image/jpeg", 0.82);
  }

  function fotoDesdeArchivo(archivo) {
    if (!archivo) return;
    var tipo = archivo.type || "";
    if (!/^image\/(jpeg|png|webp)$/.test(tipo)) {
      mostrarError("Ese archivo no es una imagen JPEG, PNG o WebP.");
      return;
    }
    var url = URL.createObjectURL(archivo);
    var img = new Image();
    img.onload = function () {
      var lienzo = lienzoCuadrado(img, img.naturalWidth, img.naturalHeight, 512);
      estado.foto = lienzo.toDataURL("image/jpeg", 0.82);
      URL.revokeObjectURL(url);
      lienzo.toBlob(function (blob) { procesar(blob); }, "image/jpeg", 0.82);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      mostrarError("No pudimos leer esa imagen. Prueba con otra foto.");
    };
    img.src = url;
  }

  /* ---------------- inferencia ---------------- */

  function procesar(blob) {
    estado.ultimoBlob = blob;
    mostrarVista("resultado");
    dom.resultado.innerHTML =
      '<div class="esqueleto" role="status">' +
      '<div class="linea ancha"></div><div class="linea media"></div>' +
      "<div class=\"linea\"></div><div class=\"linea\"></div>" +
      '<p style="margin:6px 0 0;color:var(--tinta-3);font-size:13px">Mirando la textura…</p>' +
      "</div>";
    anunciar("Analizando la muestra.");

    predecir(blob)
      .then(function (respuesta) { pintarResultado(respuesta, { guardar: true }); })
      .catch(function (error) { mostrarError(error.mensaje || "No pudimos analizar la muestra.", true); });
  }

  function predecir(blob) {
    var formulario = new FormData();
    formulario.append("imagen", blob, "muestra.jpg");

    return fetch("/api/predict", { method: "POST", body: formulario })
      .then(function (respuesta) {
        if (respuesta.status === 503) return demo(blob);        // modelo sin entrenar
        if (respuesta.status === 413) throw { mensaje: "La foto es demasiado grande. Intenta de nuevo." };
        if (respuesta.status === 400) throw { mensaje: "La imagen no se pudo procesar. Prueba con otra foto." };
        if (!respuesta.ok) throw { mensaje: "No alcanzamos el modelo (" + respuesta.status + ")." };
        return respuesta.json();
      })
      .catch(function (error) {
        if (error && error.mensaje) throw error;
        if (!navigator.onLine) throw { mensaje: "Sin conexión: la predicción vive en la nube. El historial y las fichas siguen disponibles." };
        throw { mensaje: "No alcanzamos el modelo. Revisa la conexión y reintenta." };
      });
  }

  /* Modo demostración: el modelo aún no está entrenado. Elegimos una clase de
   * forma determinista a partir de los bytes para poder revisar el diseño de
   * las fichas; la interfaz lo declara en una banda. Nunca se presenta como
   * una predicción real. */
  function demo(blob) {
    return new Promise(function (resolve) {
      var lector = new FileReader();
      lector.onload = function () {
        var bytes = new Uint8Array(lector.result);
        var hash = 0;
        for (var i = 0; i < bytes.length; i += 97) {
          hash = (hash * 31 + bytes[i]) % 1000003;
        }
        var ids = Object.keys(FICHAS);
        var indice = hash % ids.length;
        var top = FICHAS[ids[indice]];
        var p1 = 0.71 + ((hash >> 3) % 24) / 100;
        var p2 = Math.min(0.2, (1 - p1) * (0.45 + ((hash >> 5) % 25) / 100));

        resolve({
          demo: true,
          modelo: { iteracion: "demo", entrenado: null },
          top: top.id,
          confianza: p1,
          margen: p1 - p2,
          bajaConfianza: false,
          ambiguo: false,
          latenciaMs: 0,
          predicciones: [
            { id: top.id, nombre: top.nombre, tecnico: top.tecnico, origen: top.origen, p: p1 },
            {
              id: ids[(indice + 1) % ids.length],
              nombre: FICHAS[ids[(indice + 1) % ids.length]].nombre,
              tecnico: FICHAS[ids[(indice + 1) % ids.length]].tecnico,
              origen: FICHAS[ids[(indice + 1) % ids.length]].origen,
              p: p2
            },
            {
              id: ids[(indice + 2) % ids.length],
              nombre: FICHAS[ids[(indice + 2) % ids.length]].nombre,
              tecnico: FICHAS[ids[(indice + 2) % ids.length]].tecnico,
              origen: FICHAS[ids[(indice + 2) % ids.length]].origen,
              p: Math.max(0, 1 - p1 - p2)
            }
          ]
        });
      };
      lector.readAsArrayBuffer(blob);
    });
  }

  /* ---------------- ficha ---------------- */

  function fichaDe(id) {
    return FICHAS[id] || {
      id: id, nombre: id, tecnico: id, origen: "sedimentario",
      que: "Todavía no hay ficha curada para esta clase.",
      formacion: "", donde: "", usos: "", dato: "",
      gemela: null, criterio: "", wiki: null
    };
  }

  function seccion(titulo, texto) {
    if (!texto) return "";
    return '<section class="seccion"><h3>' + esc(titulo) + "</h3><p>" + esc(texto) + "</p></section>";
  }

  function pintarResultado(respuesta, opciones) {
    var ficha = fichaDe(respuesta.top);
    var origen = ficha.origen;
    var predicciones = respuesta.predicciones || [];
    var foto = estado.foto;
    estado.respuesta = respuesta;

    var avisos = "";
    if (respuesta.demo) {
      avisos +=
        '<p class="banda demo"><strong>Modo demostración.</strong> El modelo todavía no está ' +
        "entrenado con las 9 clases: esta ficha se elige al azar para revisar el diseño, no es una predicción.</p>";
    } else if (respuesta.bajaConfianza) {
      avisos +=
        '<p class="banda"><strong>Poco segura.</strong> La confianza no llega al 70 %. ' +
        "Prueba con más luz, fondo neutro y a 20–30 cm.</p>";
    }

    var top3 = predicciones.slice(0, 3).map(function (p) {
      return "<li><span>" + esc(p.nombre) + "</span><span>" + porcentaje(p.p) + "</span></li>";
    }).join("");

    var gemela = ficha.gemela ? fichaDe(ficha.gemela) : null;
    var bloqueGemela = gemela
      ? '<div class="gemela"><h3>No la confundas con</h3><p><strong>' + esc(gemela.nombre) + ".</strong> " +
        esc(ficha.criterio || "") + '</p><button type="button" data-ir-a="' + esc(gemela.id) + '">Ver la ficha de ' +
        esc(gemela.nombre).toLowerCase() + " →</button></div>"
      : "";

    var fuente = ficha.wiki
      ? '<p class="fuente">Fuente de la ficha: curada para Litoteca. Amplía en <a href="https://es.wikipedia.org/wiki/' +
        encodeURIComponent(ficha.wiki.replace(/ /g, "_")) + '" target="_blank" rel="noopener">Wikipedia (CC BY-SA 4.0)</a>.</p>'
      : "";

    var botonGuardar = opciones && opciones.guardar
      ? '<button type="button" class="boton principal" id="btn-guardar">Guardar en mi litoteca</button>'
      : "";

    dom.resultado.innerHTML =
      avisos +
      '<article class="ficha">' +
        '<header class="ficha-cabeza">' +
          (foto ? '<img class="ficha-foto" src="' + foto + '" alt="Muestra fotografiada">' : "") +
          '<div class="ficha-titulos">' +
            '<h2 class="ficha-nombre">' + esc(ficha.nombre) + "</h2>" +
            '<p class="ficha-tecnico">' + esc(ficha.tecnico) + "</p>" +
            '<span class="chip ' + esc(origen) + '">' + esc(ORIGEN_TEXTO[origen] || origen) + "</span>" +
          "</div>" +
        "</header>" +
        '<div class="confianza">' +
          '<div class="confianza-fila"><span>Confianza · top-1</span><span class="confianza-valor">' +
            porcentaje(respuesta.confianza) + "</span></div>" +
          '<div class="barra" role="img" aria-label="Confianza ' + porcentaje(respuesta.confianza) + '">' +
            '<i style="width:' + Math.max(2, Math.round(respuesta.confianza * 100)) + '%"></i></div>' +
          (top3 ? '<details class="top3"><summary>Tres primeras lecturas</summary><ol>' + top3 + "</ol></details>" : "") +
        "</div>" +
        '<div class="ficha-cuerpo">' +
          seccion("Qué es", ficha.que) +
          seccion("Cómo se formó", ficha.formacion) +
          seccion("Dónde se encuentra", ficha.donde) +
          seccion("Para qué se usa", ficha.usos) +
          seccion("Dato curioso", ficha.dato) +
          bloqueGemela +
          fuente +
        "</div>" +
        '<div class="ficha-acciones">' +
          '<button type="button" class="boton" id="btn-otra">Escanear otra</button>' +
          botonGuardar +
          '<button type="button" class="boton tenue" id="btn-compartir">Compartir</button>' +
        "</div>" +
      "</article>";

    var otra = $("#btn-otra");
    if (otra) otra.addEventListener("click", function () { abrirSelector(); });

    var guardar = $("#btn-guardar");
    if (guardar) {
      guardar.addEventListener("click", function () {
        guardarEnHistorial(ficha, respuesta).then(function (ok) {
          if (!ok) return;
          guardar.textContent = "Guardada ✓";
          guardar.disabled = true;
          anunciar("Muestra guardada en Mi litoteca.");
        });
      });
    }

    var compartir = $("#btn-compartir");
    if (compartir) compartir.addEventListener("click", function () { compartirFicha(ficha, respuesta); });

    var irA = dom.resultado.querySelector("[data-ir-a]");
    if (irA) {
      irA.addEventListener("click", function () {
        var destino = fichaDe(irA.getAttribute("data-ir-a"));
        estado.respuesta = {
          demo: respuesta.demo, top: destino.id, confianza: respuesta.confianza,
          bajaConfianza: true, ambiguo: false, predicciones: respuesta.predicciones,
          modelo: respuesta.modelo
        };
        pintarResultado(estado.respuesta, { guardar: false });
      });
    }

    anunciar(ficha.nombre + ". Confianza " + porcentaje(respuesta.confianza) + ".");
  }

  function mostrarError(mensaje, reintentar) {
    mostrarVista("resultado");
    dom.resultado.innerHTML =
      '<div class="aviso-permiso"><h2>No pudimos leer la muestra</h2><p>' + esc(mensaje) + "</p>" +
      '<div class="acciones-inicio">' +
        (reintentar ? '<button type="button" class="boton principal" id="btn-reintentar">Reintentar</button>' : "") +
        '<button type="button" class="boton" id="btn-subir-error">Subir una foto</button>' +
        '<button type="button" class="boton tenue" id="btn-inicio-error">Volver al inicio</button>' +
      "</div></div>";
    anunciar(mensaje);

    var reintentarBtn = $("#btn-reintentar");
    if (reintentarBtn) {
      reintentarBtn.addEventListener("click", function () {
        if (estado.ultimoBlob) procesar(estado.ultimoBlob);
      });
    }
    $("#btn-subir-error").addEventListener("click", function () { dom.archivo.click(); });
    $("#btn-inicio-error").addEventListener("click", irAInicio);
  }

  /* ---------------- compartir ---------------- */

  function compartirFicha(ficha, respuesta) {
    var texto = ficha.nombre + " (" + ficha.tecnico + ") · confianza " + porcentaje(respuesta.confianza) +
      ". Identificada con Litoteca.";
    if (navigator.share) {
      navigator.share({ title: "Litoteca · " + ficha.nombre, text: texto }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(function () {
        anunciar("Texto copiado al portapapeles.");
      }).catch(function () { window.prompt("Copia el texto:", texto); });
      return;
    }
    window.prompt("Copia el texto:", texto);
  }

  /* ---------------- historial ---------------- */

  function leerHistorial() {
    try {
      var crudo = window.localStorage.getItem(CLAVE);
      if (!crudo) return [];
      var lista = JSON.parse(crudo);
      return Array.isArray(lista) ? lista : [];
    } catch (e) { return []; }
  }

  function escribirHistorial(lista) {
    try {
      window.localStorage.setItem(CLAVE, JSON.stringify(lista));
      return true;
    } catch (e) { return false; }
  }

  function miniatura(origenUrl, lado) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var lienzo = lienzoCuadrado(img, img.naturalWidth, img.naturalHeight, lado);
        resolve(lienzo.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = function () { resolve(null); };
      img.src = origenUrl;
    });
  }

  function guardarEnHistorial(ficha, respuesta) {
    var lista = leerHistorial();
    var entrada = {
      id: String(Date.now()),
      clase: ficha.id,
      p: respuesta.confianza,
      fecha: new Date().toISOString(),
      miniatura: null
    };

    return miniatura(estado.foto, 96).then(function (mini) {
      entrada.miniatura = mini;
      lista.unshift(entrada);
      lista = lista.slice(0, MAX_ENTRADAS);
      if (escribirHistorial(lista)) { pintarHistorial(); return true; }

      // Cuota llena: miniaturas a 64 px y poda de las más viejas.
      return miniatura(estado.foto, 64).then(function (mini64) {
        entrada.miniatura = mini64;
        var recortada = lista.slice(0, 6);
        if (escribirHistorial(recortada)) { pintarHistorial(); return true; }
        var minimo = recortada.slice(0, 3);
        if (escribirHistorial(minimo)) { pintarHistorial(); return true; }
        mostrarError("El almacenamiento del navegador está lleno. Borra alguna entrada de Mi litoteca.");
        return false;
      });
    });
  }

  function pintarHistorial() {
    var lista = leerHistorial();
    dom.historialVacio.hidden = lista.length > 0;
    dom.borrarTodo.hidden = lista.length === 0;
    dom.historialLista.innerHTML = lista.map(function (entrada) {
      var ficha = fichaDe(entrada.clase);
      return (
        '<li><button type="button" class="entrada" data-abrir="' + esc(entrada.id) + '">' +
          (entrada.miniatura
            ? '<img src="' + entrada.miniatura + '" alt="Miniatura de ' + esc(ficha.nombre) + '">'
            : '<img src="" alt="">') +
          '<span class="entrada-texto">' +
            '<span class="entrada-nombre">' + esc(ficha.nombre) + "</span>" +
            '<span class="entrada-meta">' + esc(fechaLarga(entrada.fecha)) + " · " +
              esc(ORIGEN_TEXTO[ficha.origen] || ficha.origen) + "</span>" +
          "</span>" +
          '<span class="entrada-p">' + porcentaje(entrada.p) + "</span>" +
        "</button>" +
        '<button type="button" class="borrar" data-borrar="' + esc(entrada.id) + '" aria-label="Borrar ' +
          esc(ficha.nombre) + ' del historial">✕</button></li>'
      );
    }).join("");

    dom.historialLista.querySelectorAll("[data-abrir]").forEach(function (boton) {
      boton.addEventListener("click", function () {
        var entrada = leerHistorial().filter(function (e) {
          return e.id === boton.getAttribute("data-abrir");
        })[0];
        if (!entrada) return;
        estado.foto = entrada.miniatura;
        mostrarVista("resultado");
        pintarResultado({
          demo: false, modelo: { iteracion: "historial" }, top: entrada.clase,
          confianza: entrada.p, margen: 1, bajaConfianza: entrada.p < 0.7, ambiguo: false,
          predicciones: [{ id: entrada.clase, nombre: fichaDe(entrada.clase).nombre, p: entrada.p }]
        }, { guardar: false });
      });
    });

    dom.historialLista.querySelectorAll("[data-borrar]").forEach(function (boton) {
      boton.addEventListener("click", function (evento) {
        evento.stopPropagation();
        var objetivo = boton.getAttribute("data-borrar");
        escribirHistorial(leerHistorial().filter(function (e) { return e.id !== objetivo; }));
        pintarHistorial();
        anunciar("Entrada borrada.");
      });
    });
  }

  function abrirHistorial() {
    pintarHistorial();
    mostrarVista("historial");
    var n = leerHistorial().length;
    anunciar(n === 0 ? "Mi litoteca está vacía." : "Mi litoteca: " + n + " entradas.");
  }

  /* ---------------- selector ---------------- */

  function abrirSelector() {
    if (typeof dom.selector.showModal === "function") dom.selector.showModal();
    else dom.selector.setAttribute("open", "");
  }

  function cerrarSelector() {
    if (typeof dom.selector.close === "function") dom.selector.close();
    else dom.selector.removeAttribute("open");
  }

  /* ---------------- eventos ---------------- */

  dom.disparador.addEventListener("click", abrirSelector);
  dom.btnCamara.addEventListener("click", abrirSelector);
  dom.btnSubir.addEventListener("click", function () { dom.archivo.click(); });

  dom.elegirCamara.addEventListener("click", function () { cerrarSelector(); abrirCamara(); });
  dom.elegirArchivo.addEventListener("click", function () { cerrarSelector(); dom.archivo.click(); });

  dom.archivo.addEventListener("change", function (evento) {
    var archivo = evento.target.files && evento.target.files[0];
    fotoDesdeArchivo(archivo);
    evento.target.value = "";
  });

  dom.obturador.addEventListener("click", capturar);
  dom.cerrarCamara.addEventListener("click", irAInicio);

  $("#btn-historial").addEventListener("click", abrirHistorial);
  $("#btn-inicio").addEventListener("click", irAInicio);
  $("#btn-volver-inicio").addEventListener("click", irAInicio);
  $("#btn-subir-permiso").addEventListener("click", function () { dom.archivo.click(); });

  dom.borrarTodo.addEventListener("click", function () {
    if (!window.confirm("¿Borrar todas las muestras de Mi litoteca? Esta acción no se puede deshacer.")) return;
    escribirHistorial([]);
    pintarHistorial();
    anunciar("Historial borrado.");
  });

  document.addEventListener("keydown", function (evento) {
    if (evento.key === "Escape" && estado.vista === "camara" && !dom.selector.open) {
      irAInicio();
      return;
    }
    if (evento.key === " " && estado.vista === "camara" && evento.target === document.body) {
      evento.preventDefault();
      capturar();
    }
  });

  function actualizarConexion() {
    var enLinea = navigator.onLine;
    dom.sincronia.textContent = enLinea
      ? "En línea · la foto se analiza y se descarta"
      : "Sin conexión · el historial y las fichas ya visitadas siguen disponibles";
  }
  window.addEventListener("online", actualizarConexion);
  window.addEventListener("offline", actualizarConexion);

  /* ---------------- arranque ---------------- */

  actualizarConexion();
  pintarHistorial();
  dom.metodologia.textContent = "9 clases · modelo en preparación · v0";
  mostrarVista("inicio");
})();
