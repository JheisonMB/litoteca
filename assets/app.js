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
    var titulo = dom.permiso.querySelector("h2");
    if (titulo) {
      titulo.setAttribute("tabindex", "-1");
      titulo.focus({ preventScroll: true });
    }
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
      '<article class="ficha" aria-busy="true"><div class="ficha-cuerpo">' +
      '<div class="esqueleto" role="status">' +
      '<div class="linea ancha"></div><div class="linea media"></div>' +
      "<div class=\"linea\"></div><div class=\"linea\"></div>" +
      '<p style="margin:6px 0 0;color:var(--tinta-3);font-size:13px">Mirando la textura…</p>' +
      "</div></div></article>";
    anunciar("Analizando la muestra.");

    predecir(blob)
      .then(function (respuesta) { pintarResultado(respuesta, { conAcciones: true }); })
      .catch(function (error) { mostrarError(error.mensaje || "No pudimos analizar la muestra.", true); });
  }

  function predecir(blob) {
    var formulario = new FormData();
    formulario.append("imagen", blob, "muestra.jpg");

    return fetch("/api/predict", { method: "POST", body: formulario })
      .then(function (respuesta) {
        if (respuesta.status === 503) return demo(blob);        // modelo sin entrenar
        if (respuesta.status === 413) throw { mensaje: "La foto supera 4 MB. Usa una imagen más liviana." };
        if (!respuesta.ok) {
          return respuesta.json().catch(function () { return {}; }).then(function (cuerpo) {
            if (cuerpo && cuerpo.mensaje) throw { mensaje: cuerpo.mensaje, error: cuerpo.error };
            if (respuesta.status === 400) throw { mensaje: "No pudimos leer esa imagen. Prueba con otra foto en JPEG, PNG o WebP." };
            throw { mensaje: "No alcanzamos el modelo. Revisa la conexión e intenta de nuevo." };
          });
        }
        return respuesta.json();
      })
      .catch(function (error) {
        if (error && error.mensaje) throw error;
        if (!navigator.onLine) throw { mensaje: "Sin conexión: la predicción vive en la nube. El historial y las fichas siguen disponibles." };
        throw { mensaje: "No alcanzamos el modelo. Revisa la conexión e intenta de nuevo." };
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
      gemela: null, criterio: "", wiki: null, ilustracion: null,
      proceso: null, procesoAlt: ""
    };
  }

  function seccion(titulo, texto) {
    if (!texto) return "";
    return '<section class="seccion"><h3>' + esc(titulo) + "</h3><p>" + esc(texto) + "</p></section>";
  }

  function formacionBloque(ficha) {
    if (!ficha.formacion) return "";
    var lamina = ficha.proceso
      ? '<figure class="proceso"><img src="' + esc(ficha.proceso) + '" alt="' +
        esc(ficha.procesoAlt || ("Ilustración del proceso de formación de " + ficha.nombre)) +
        '" loading="lazy" decoding="async"></figure>'
      : "";
    return '<section class="seccion seccion-formacion"><h3>Cómo se formó</h3>' +
      lamina + '<div class="seccion-formacion-texto"><p>' + esc(ficha.formacion) +
      "</p></div></section>";
  }

  function htmlFicha(ficha, respuesta, foto, conAcciones) {
    var origen = ficha.origen;
    var predicciones = respuesta.predicciones || [];

    var top3 = predicciones.slice(0, 3).map(function (p) {
      return "<li><span>" + esc(p.nombre) + "</span><span>" + porcentaje(p.p) + "</span></li>";
    }).join("");

    var gemela = ficha.gemela ? fichaDe(ficha.gemela) : null;
    var bloqueGemela = gemela
      ? '<div class="gemela"><h3>No la confundas con</h3><p><strong>' + esc(gemela.nombre) + ".</strong> " +
        esc(ficha.criterio || "") + '</p><button type="button" data-ir-a="' + esc(gemela.id) + '">Ver la ficha de ' +
        esc(gemela.nombre).toLowerCase() + " →</button></div>"
      : "";

    var portadaImg = ficha.ilustracion
      ? '<img src="' + esc(ficha.ilustracion) + '" alt="Ilustración de ' + esc(ficha.nombre) + '" loading="lazy" decoding="async">'
      : (foto ? '<img src="' + foto + '" alt="Muestra fotografiada">' : "");
    var miniaturaPortada = (ficha.ilustracion && foto)
      ? '<img class="ficha-miniatura" src="' + foto + '" alt="Muestra fotografiada">'
      : "";

    var wiki = (window.LITOTECA_WIKI || {})[ficha.id];
    var fuente;
    if (wiki && wiki.extracto) {
      fuente = '<p class="fuente">Fuente de la ficha: curada para Litoteca.</p>' +
        '<p class="fuente">' + esc(wiki.extracto) + "</p>" +
        '<p class="fuente">Fuente: <a href="' + esc(wiki.url) +
        '" target="_blank" rel="noopener">Wikipedia (CC BY-SA 4.0)</a></p>';
    } else {
      fuente = '<p class="fuente">Fuente de la ficha: curada para Litoteca.</p>';
    }

    var acciones = conAcciones
      ? '<div class="ficha-acciones">' +
          '<button type="button" class="boton principal" id="btn-guardar">Guardar en mi litoteca</button>' +
          '<button type="button" class="boton" id="btn-otra">Escanear otra</button>' +
          '<button type="button" class="boton tenue" id="btn-compartir">Compartir</button>' +
        "</div>"
      : "";

    return (
      '<article class="ficha">' +
        '<div class="ficha-lamina">' +
          '<figure class="ficha-portada">' +
            portadaImg +
            '<figcaption class="ficha-portada-pie">' +
              '<span class="chip ' + esc(origen) + '">' + esc(ORIGEN_TEXTO[origen] || origen) + "</span>" +
              miniaturaPortada +
            "</figcaption>" +
          "</figure>" +
          '<div class="ficha-veredicto">' +
            '<h2 class="ficha-nombre">' + esc(ficha.nombre) + "</h2>" +
            '<p class="ficha-tecnico">' + esc(ficha.tecnico) + "</p>" +
            '<div class="confianza">' +
              '<div class="confianza-fila"><span>Confianza · top-1</span><span class="confianza-valor">' +
                (typeof respuesta.confianza === "number" ? porcentaje(respuesta.confianza) : "Desconocida") + "</span></div>" +
              '<div class="barra" role="img" aria-label="Confianza ' +
                (typeof respuesta.confianza === "number" ? porcentaje(respuesta.confianza) : "desconocida") + '">' +
                '<i style="width:' + Math.max(2, Math.round((respuesta.confianza || 0) * 100)) + '%"></i></div>' +
              (top3 ? '<details class="top3"><summary>Tres primeras lecturas</summary><ol>' + top3 + "</ol></details>" : "") +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="ficha-cuerpo">' +
          seccion("Qué es", ficha.que) +
          formacionBloque(ficha) +
          seccion("Dónde se encuentra", ficha.donde) +
          seccion("Para qué se usa", ficha.usos) +
          seccion("Dato curioso", ficha.dato) +
          bloqueGemela +
          fuente +
        "</div>" +
        acciones +
      "</article>"
    );
  }

  function pintarResultado(respuesta, opciones) {
    var ficha = fichaDe(respuesta.top);
    estado.respuesta = respuesta;

    var avisos = "";
    if (respuesta.mock) {
      avisos +=
        '<p class="banda demo"><strong>Mock de desarrollo.</strong> Categoría forzada desde `?mock=1`: ' +
        "ni la imagen ni el modelo intervienen. Sirve para revisar el diseño de la ficha.</p>";
    } else if (respuesta.demo) {
      avisos +=
        '<p class="banda demo"><strong>Modo demostración.</strong> El modelo todavía no está ' +
        "entrenado con las 9 clases: esta ficha se elige al azar para revisar el diseño, no es una predicción.</p>";
    } else if (respuesta.bajaConfianza) {
      avisos +=
        '<p class="banda"><strong>Poco segura.</strong> La confianza no llega al 70 %. ' +
        "Prueba con más luz, fondo neutro y a 20–30 cm.</p>";
    }

    dom.resultado.innerHTML = avisos + htmlFicha(ficha, respuesta, estado.foto, !!(opciones && opciones.conAcciones !== false));

    dom.resultado.querySelectorAll(".proceso img").forEach(function (img) {
      img.addEventListener("error", function () { img.closest(".proceso").hidden = true; });
      if (img.complete && img.naturalWidth === 0) img.closest(".proceso").hidden = true;
    });

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
    if (compartir) compartir.addEventListener("click", function () { compartirFicha(ficha, respuesta, compartir); });

    var irA = dom.resultado.querySelector("[data-ir-a]");
    if (irA) {
      irA.addEventListener("click", function () {
        var destino = fichaDe(irA.getAttribute("data-ir-a"));
        var siguiente = {
          mock: respuesta.mock, demo: respuesta.demo, top: destino.id,
          confianza: respuesta.confianza, bajaConfianza: true, ambiguo: false,
          predicciones: respuesta.predicciones, modelo: respuesta.modelo
        };
        estado.respuesta = siguiente;
        pintarResultado(siguiente, { conAcciones: false });
        montarTiraMock();
      });
    }

    montarTiraMock();
    anunciar(ficha.nombre + (typeof respuesta.confianza === "number" ? ". Confianza " + porcentaje(respuesta.confianza) : ""));
    var nombre = dom.resultado.querySelector(".ficha-nombre");
    if (nombre) {
      nombre.setAttribute("tabindex", "-1");
      nombre.focus({ preventScroll: true });
    }
  }

  /* Tira de desarrollo: solo con ?mock=1, para revisar cada ficha con una foto. */
  function montarTiraMock() {
    var mock = window.LITOTECA_MOCK;
    if (!mock || !mock.activo() || !estado.respuesta) return;

    var tira = document.createElement("div");
    tira.className = "tira-mock";
    tira.setAttribute("role", "group");
    tira.setAttribute("aria-label", "Mock de desarrollo: elegir categoría");

    var rotulo = document.createElement("span");
    rotulo.className = "tira-mock-rotulo";
    rotulo.textContent = "Mock";
    tira.appendChild(rotulo);

    mock.categorias().forEach(function (id) {
      var boton = document.createElement("button");
      boton.type = "button";
      boton.className = "tira-mock-boton";
      boton.textContent = fichaDe(id).nombre;
      boton.setAttribute("aria-pressed", String(id === estado.respuesta.top));
      boton.addEventListener("click", function () {
        pintarResultado(mock.respuesta(id), { conAcciones: true });
        anunciar("Mock: " + fichaDe(id).nombre + ".");
      });
      tira.appendChild(boton);
    });

    dom.resultado.appendChild(tira);
  }

  /* Galería de desarrollo: las nueve fichas seguidas, con ?galeria=1. */
  function abrirGaleria() {
    var mock = window.LITOTECA_MOCK;
    if (!mock) return;
    mostrarVista("resultado");
    var piezas = mock.categorias().map(function (id) {
      return '<div class="galeria-item">' + htmlFicha(fichaDe(id), mock.respuesta(id), estado.foto, false) + "</div>";
    });
    dom.resultado.innerHTML =
      '<p class="banda demo"><strong>Galería de desarrollo.</strong> Las nueve fichas con confianza simulada, ' +
      "para revisar el diseño de las tarjetas antes de entrenar el modelo.</p>" + piezas.join("");
    anunciar("Galería de desarrollo con las nueve fichas.");
  }

  function mostrarError(mensaje, reintentar) {
    mostrarVista("resultado");
    dom.resultado.innerHTML =
      '<article class="ficha"><div class="ficha-cuerpo">' +
      '<div class="aviso-permiso"><h2 tabindex="-1">No pudimos leer la muestra</h2><p>' + esc(mensaje) + "</p>" +
      '<div class="acciones-inicio">' +
        (reintentar ? '<button type="button" class="boton principal" id="btn-reintentar">Reintentar</button>' : "") +
        '<button type="button" class="boton" id="btn-subir-error">Subir una foto</button>' +
        '<button type="button" class="boton tenue" id="btn-inicio-error">Volver al inicio</button>' +
      "</div></div></div></article>";
    anunciar(mensaje);
    var tituloError = dom.resultado.querySelector(".aviso-permiso h2");
    if (tituloError) tituloError.focus({ preventScroll: true });

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

  function cargarImagen(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("foto no legible")); };
      img.src = url;
    });
  }

  function redondear(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function envolver(ctx, texto, maxAncho) {
    var palabras = String(texto == null ? "" : texto).split(/\s+/).filter(Boolean);
    var lineas = [];
    var actual = "";
    palabras.forEach(function (palabra) {
      var prueba = actual ? actual + " " + palabra : palabra;
      if (actual && ctx.measureText(prueba).width > maxAncho) {
        lineas.push(actual);
        actual = palabra;
      } else {
        actual = prueba;
      }
    });
    if (actual) lineas.push(actual);
    if (!lineas.length) lineas.push("");
    return lineas;
  }

  var TARJETA = {
    ancho: 1080, alto: 1350, x: 100, w: 880,
    papel: "#f7f4ee", tinta: "#1b1a17", tinta2: "#57534b", tinta3: "#6b665d",
    filete: "#e2dbcd", pista: "#efeae0",
    acentos: { igneo: "#c2410c", sedimentario: "#a16207" },
    pie: "Litoteca · jhmartinez07@unisalle.edu.co"
  };

  function componerTarjeta(ficha, respuesta) {
    var T = TARJETA;
    var lienzo = document.createElement("canvas");
    lienzo.width = T.ancho;
    lienzo.height = T.alto;
    var ctx = lienzo.getContext("2d");
    ctx.fillStyle = T.papel;
    ctx.fillRect(0, 0, T.ancho, T.alto);

    var fotoLista = (typeof estado.foto === "string" && estado.foto)
      ? cargarImagen(estado.foto).catch(function () { return null; })
      : Promise.resolve(null);

    return fotoLista.then(function (img) {
      var yNombre = img ? 1030 : 190;
      if (img) {
        var lado = Math.min(img.naturalWidth, img.naturalHeight) || 1;
        ctx.save();
        redondear(ctx, T.x, 70, T.w, T.w, 24);
        ctx.clip();
        ctx.drawImage(img,
          (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado,
          T.x, 70, T.w, T.w);
        ctx.restore();
        ctx.strokeStyle = T.filete;
        ctx.lineWidth = 2;
        redondear(ctx, T.x, 70, T.w, T.w, 24);
        ctx.stroke();
      }

      var acento = T.acentos[ficha.origen] || T.tinta;

      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = T.tinta;
      ctx.font = "88px Georgia, serif";
      var lineas = envolver(ctx, ficha.nombre, T.w);
      lineas.forEach(function (linea, i) {
        ctx.fillText(linea, 640, yNombre + i * 100);
      });

      var yTec = yNombre + (lineas.length - 1) * 100 + 60;
      ctx.fillStyle = T.tinta2;
      ctx.font = "34px monospace";
      ctx.fillText(ficha.tecnico || "", 640, yTec);

      var yChip = yTec + 80;
      var etiqueta = ORIGEN_TEXTO[ficha.origen] || ficha.origen || "";
      ctx.font = "34px monospace";
      var anchoTexto = ctx.measureText(etiqueta).width;
      var xGrupo = 640 - (28 + 16 + anchoTexto) / 2;
      ctx.fillStyle = acento;
      ctx.beginPath();
      ctx.arc(xGrupo + 14, yChip - 12, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = "left";
      ctx.fillText(etiqueta, xGrupo + 28 + 16, yChip);
      ctx.textAlign = "center";

      var hayConfianza = !!(respuesta && typeof respuesta.confianza === "number");
      ctx.fillStyle = T.tinta3;
      ctx.font = "28px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("Confianza", T.x, 1280);
      ctx.font = "30px monospace";
      ctx.textAlign = "right";
      ctx.fillText(hayConfianza ? Math.round(respuesta.confianza * 100) + " %" : "Desconocida", T.x + T.w, 1280);
      ctx.textAlign = "center";

      if (hayConfianza) {
        ctx.fillStyle = T.pista;
        redondear(ctx, T.x, 1300, T.w, 16, 8);
        ctx.fill();
        var relleno = Math.max(16, Math.round(respuesta.confianza * T.w));
        ctx.fillStyle = T.tinta;
        redondear(ctx, T.x, 1300, relleno, 16, 8);
        ctx.fill();
      }

      ctx.fillStyle = T.tinta3;
      ctx.font = "24px monospace";
      ctx.fillText(T.pie, 640, 1340);

      return new Promise(function (resolve, reject) {
        lienzo.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error("lienzo vacio"));
        }, "image/png");
      });
    });
  }

  // Expuesta para verificarla desde la consola; la pagina no usa modulos.
  window.componerTarjeta = componerTarjeta;

  async function compartirFicha(ficha, respuesta, boton) {
    var btn = boton || $("#btn-compartir");
    var original = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Preparando…"; }
    try {
      var blob = await componerTarjeta(ficha, respuesta);
      var archivo = new File([blob], "litoteca-" + ficha.id + ".png", { type: "image/png" });
      var texto = ficha.nombre + " (" + ficha.tecnico + ") · confianza " +
        ((respuesta && typeof respuesta.confianza === "number") ? porcentaje(respuesta.confianza) : "Desconocida") +
        ". Identificada con Litoteca.";
      var compartible = false;
      try {
        compartible = !!(navigator.canShare && navigator.canShare({ files: [archivo] }));
      } catch (e) { compartible = false; }
      if (compartible) {
        await navigator.share({ files: [archivo], title: "Litoteca · " + ficha.nombre, text: texto });
        return;
      }
      var url = URL.createObjectURL(blob);
      var enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = "litoteca-" + ficha.id + ".png";
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      anunciar("Tarjeta descargada.");
    } catch (error) {
      anunciar("No pudimos preparar la tarjeta.");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = original || "Compartir"; }
    }
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
      var thumb = entrada.miniatura
        ? '<img src="' + entrada.miniatura + '" alt="Miniatura de ' + esc(ficha.nombre) + '">'
        : (ficha.ilustracion
          ? '<img class="entrada-ilustracion" src="' + esc(ficha.ilustracion) + '" alt="" loading="lazy" decoding="async">'
          : '<span class="entrada-hueco" aria-hidden="true"></span>');
      return (
        '<li><button type="button" class="entrada" data-abrir="' + esc(entrada.id) + '">' +
          thumb +
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
        }, { conAcciones: false });
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
  dom.btnCamara.addEventListener("click", function () { abrirCamara(); });
  dom.btnSubir.addEventListener("click", function () { dom.archivo.click(); });

  dom.elegirCamara.addEventListener("click", function () { cerrarSelector(); abrirCamara(); });
  dom.elegirArchivo.addEventListener("click", function () { cerrarSelector(); dom.archivo.click(); });
  $("#btn-cerrar-selector").addEventListener("click", cerrarSelector);

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

  var mock = window.LITOTECA_MOCK;
  var enMock = !!(mock && mock.activo());
  dom.metodologia.textContent = enMock
    ? "9 clases · mock de desarrollo · v0"
    : "9 clases · modelo en preparación · v0";

  if (mock && mock.galeria()) {
    abrirGaleria();
  } else {
    mostrarVista("inicio");
  }

  // Registro del service worker (solo contexto seguro y si el navegador lo soporta).
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  }
})();
