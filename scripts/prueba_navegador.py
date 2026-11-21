#!/usr/bin/env python3
"""Smoke test de navegador para el gate de Litoteca.

Sirve el repo con un /api/predict falso que responde 503 (modelo sin entrenar),
carga index.html en Chrome headless, sube una imagen generada en la propia
página —sin depender de data/, que no se versiona— y comprueba que se pinta la
ficha, que aparece la banda de demostración, que "Guardar" escribe en
localStorage y que la entrada llega al historial.

Uso: python3 scripts/prueba_navegador.py [--chrome RUTA]
Sale con 0 si todo pasa, 1 si algo falla.
"""
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RAIZ = pathlib.Path(__file__).resolve().parent.parent

PRUEBA = """
<script>
(async function () {
  const resultados = [];
  const anotar = (nombre, ok, detalle) => resultados.push({ nombre, ok, detalle: detalle || "" });

  // Imagen generada en la página: el gate no depende de data/.
  const lienzo = document.createElement('canvas');
  lienzo.width = 512; lienzo.height = 512;
  const ctx = lienzo.getContext('2d');
  ctx.fillStyle = '#6b6b6b'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = 'rgba(' + (i % 255) + ',' + ((i * 7) % 255) + ',' + ((i * 13) % 255) + ',0.5)';
    ctx.fillRect((i * 37) % 512, (i * 53) % 512, 6, 6);
  }
  const blob = await new Promise((r) => lienzo.toBlob(r, 'image/jpeg', 0.85));
  const archivo = new File([blob], 'muestra.jpg', { type: 'image/jpeg' });

  const transferencia = new DataTransfer();
  transferencia.items.add(archivo);
  const entrada = document.getElementById('input-archivo');
  entrada.files = transferencia.files;
  entrada.dispatchEvent(new Event('change', { bubbles: true }));

  await new Promise((r) => setTimeout(r, 2500));

  const ficha = document.querySelector('.ficha');
  anotar('ficha renderizada', !!ficha);
  anotar('nombre comun', !!(document.querySelector('.ficha-nombre') || {}).textContent);
  anotar('nombre tecnico', !!(document.querySelector('.ficha-tecnico') || {}).textContent);
  anotar('chip de origen', /Ignea|Sedimentaria/.test((document.querySelector('.chip') || {}).textContent || ''));
  anotar('barra de confianza', /%/.test(((document.querySelector('.barra i') || {}).style || {}).width || ''));
  anotar('banda de demostracion', !!document.querySelector('.banda.demo'));
  anotar('ilustracion de roca', !!document.querySelector('.ficha-ilustracion img'));
  anotar('bloque de gemela', !!document.querySelector('[data-ir-a]'));
  anotar('secciones de ficha', document.querySelectorAll('.seccion h3').length >= 5);
  anotar('botones de accion', !!document.getElementById('btn-compartir') && !!document.getElementById('btn-otra'));

  const guardar = document.getElementById('btn-guardar');
  anotar('boton guardar', !!guardar);
  if (guardar) guardar.click();
  await new Promise((r) => setTimeout(r, 600));

  const crudo = localStorage.getItem('litoteca.historial.v1');
  const lista = crudo ? JSON.parse(crudo) : [];
  anotar('entrada en localStorage', lista.length === 1, 'entradas=' + lista.length);
  anotar('miniatura guardada', !!(lista[0] && /^data:image\\/jpeg/.test(lista[0].miniatura || '')));
  anotar('estado del boton guardar', /Guardada/.test((guardar || {}).textContent || ''));

  document.getElementById('btn-historial').click();
  await new Promise((r) => setTimeout(r, 200));
  anotar('fila en el historial', document.querySelectorAll('#lista-historial li').length === 1);
  anotar('boton borrar todo visible', !document.getElementById('btn-borrar-todo').hidden);

  // Navegación de ida y vuelta sin dejar la cámara colgada.
  document.getElementById('btn-volver-inicio').click();
  anotar('volver al inicio', !document.getElementById('vista-inicio').hidden);

  const caja = document.createElement('div');
  caja.id = 'informe-prueba';
  caja.textContent = JSON.stringify(resultados);
  document.body.appendChild(caja);
})();
</script>
"""


class Manejador(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RAIZ), **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.startswith("/__prueba"):
            html = (RAIZ / "index.html").read_text().replace("</body>", PRUEBA + "</body>")
            cuerpo = html.encode()
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)
            return
        super().do_GET()

    def do_POST(self):
        largo = int(self.headers.get("content-length", 0))
        self.rfile.read(largo)
        cuerpo = json.dumps({"error": "modelo_no_disponible"}).encode()
        self.send_response(503)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)


def buscar_chrome():
    for candidato in ("google-chrome", "chromium", "chromium-browser", "chrome"):
        ruta = shutil.which(candidato)
        if ruta:
            return ruta
    return None


def main():
    chrome = None
    if "--chrome" in sys.argv:
        chrome = sys.argv[sys.argv.index("--chrome") + 1]
    chrome = chrome or buscar_chrome()
    if not chrome:
        print("FALLO: no hay Chrome/Chromium instalado; el smoke test no puede correr")
        return 1

    servidor = ThreadingHTTPServer(("127.0.0.1", 0), Manejador)
    puerto = servidor.server_address[1]
    hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
    hilo.start()

    perfil = tempfile.mkdtemp(prefix="litoteca-chrome-")
    try:
        proceso = subprocess.run(
            [
                chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                "--user-data-dir=" + perfil, "--virtual-time-budget=15000",
                "--dump-dom", f"http://127.0.0.1:{puerto}/__prueba.html",
            ],
            capture_output=True, text=True, timeout=180,
        )
        dom = proceso.stdout
    except subprocess.TimeoutExpired:
        servidor.shutdown()
        shutil.rmtree(perfil, ignore_errors=True)
        print("FALLO: Chrome no terminó en 180 s")
        return 1

    servidor.shutdown()
    shutil.rmtree(perfil, ignore_errors=True)

    if "informe-prueba" not in dom:
        print("FALLO: la página no llegó a ejecutar la prueba (¿error de JS?)")
        print(dom[:600])
        return 1

    import re

    crudo = re.search(r'<div id="informe-prueba">(.*?)</div>', dom, re.S).group(1)
    resultados = json.loads(
        crudo.replace("&quot;", '"').replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    )
    fallos = [r for r in resultados if not r["ok"]]
    for r in resultados:
        print(("  ok  " if r["ok"] else "FALLO: ") + r["nombre"] + ((" (" + r["detalle"] + ")") if r["detalle"] else ""))
    if fallos:
        print(f"NAVEGADOR FALLIDO ({len(fallos)})")
        return 1
    print("  navegador OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
