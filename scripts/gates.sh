#!/usr/bin/env bash
# Gate único de Litoteca. Lo corren por igual el nodo "Full gates" del grafo y
# cualquier agente antes de reportar pass, así que tiene que ser determinista,
# rápido y no tocar nada fuera del repo.
#
# Un sitio sin build no tiene compilador que atrape errores: el gate hace ese
# trabajo. Comprueba, en orden: sintaxis de todo el JS, coherencia de ids,
# integridad de las 9 fichas, recursos, el contrato de /api/predict contra la
# Function real con fetch falso, estructura y accesibilidad del HTML, las reglas
# visuales del blueprint, el presupuesto de JS y, al final, el comportamiento en
# un Chrome real.
set -euo pipefail
cd "$(dirname "$0")/.."

fallos=0
fallo() { echo "FALLO: $*"; fallos=$((fallos + 1)); }
ok() { echo "  ok  $*"; }

echo "== 1/8 sintaxis JavaScript"
while IFS= read -r archivo; do
  node --check "$archivo" || fallo "sintaxis en $archivo"
done < <(find assets functions tools scripts -name '*.js' -o -name '*.mjs' 2>/dev/null | sort)
ok "todo el JavaScript parsea"

echo "== 2/8 ids de app.js existen en index.html"
python3 - <<'PY' || fallos=$((fallos + 1))
import re, sys
html = open("index.html", encoding="utf-8").read()
js = open("assets/app.js", encoding="utf-8").read()
ids = set(re.findall(r'id="([^"]+)"', html))
pedidos = set(re.findall(r'\$\("#([^"]+)"\)', js))
# Los que app.js crea en tiempo de ejecución no están en el HTML inicial.
dinamicos = {"btn-guardar", "btn-compartir", "btn-otra", "btn-reintentar",
             "btn-subir-error", "btn-inicio-error"}
faltan = sorted(pedidos - ids - dinamicos)
if faltan:
    print("ids que app.js pide y no existen en index.html:", faltan)
    sys.exit(1)
print(f"  ok  {len(pedidos - dinamicos)} ids verificados")
PY

echo "== 2b/8 tarjeta compartible en PNG"
grep -q "function componerTarjeta" assets/app.js || fallo "falta componerTarjeta en assets/app.js"
grep -A80 "function compartirFicha" assets/app.js | grep -q "componerTarjeta(" || fallo "compartirFicha no compone la tarjeta"
ok "componerTarjeta existe y compartirFicha la usa"

echo "== 3/8 las 9 fichas"
node - <<'JS' || fallos=$((fallos + 1))
global.window = {};
require("./assets/fichas.js");
const fichas = window.LITOTECA_FICHAS;
const esperadas = ["basalt", "chert", "clay", "conglomerate", "diatomite",
                   "gypsum", "olivine-basalt", "shale", "siliceous-sinter"];
const campos = ["nombre", "tecnico", "origen", "que", "formacion", "donde", "usos", "dato", "gemela", "criterio"];
let errores = [];
for (const id of esperadas) {
  const f = fichas[id];
  if (!f) { errores.push(`falta la ficha ${id}`); continue; }
  for (const campo of campos) if (!f[campo]) errores.push(`${id}: falta ${campo}`);
  if (!["igneo", "sedimentario", "metamorfico"].includes(f.origen)) errores.push(`${id}: origen inválido ${f.origen}`);
  if (f.gemela && !fichas[f.gemela]) errores.push(`${id}: gemela desconocida ${f.gemela}`);
  if (f.gemela === id) errores.push(`${id}: es su propia gemela`);
}
const sobrantes = Object.keys(fichas).filter((id) => !esperadas.includes(id));
if (sobrantes.length) errores.push("fichas de más: " + sobrantes.join(", "));

// Cada ficha declara su ilustración canónica y el archivo existe en el repo.
const fs = require("fs");
const path = require("path");
for (const id of esperadas) {
  const f = fichas[id];
  if (!f) continue;
  const esperado = `/assets/rocas/${id}.svg`;
  if (f.ilustracion !== esperado) { errores.push(`${id}: ilustracion debe ser ${esperado}`); continue; }
  if (!fs.existsSync(path.join(".", f.ilustracion))) errores.push(`${id}: falta el archivo .${f.ilustracion}`);
}

// Cada ficha integra su lámina del proceso geológico: ruta canónica,
// archivo presente en el repo y alt descriptivo en español.
for (const id of esperadas) {
  const f = fichas[id];
  if (!f) continue;
  const lamina = `/assets/rocas/procesos/${id}.webp`;
  if (f.proceso !== lamina) { errores.push(`${id}: proceso debe ser ${lamina}`); continue; }
  if (!fs.existsSync(path.join(".", f.proceso))) errores.push(`${id}: falta el archivo .${f.proceso}`);
  if (!f.procesoAlt || !String(f.procesoAlt).trim()) errores.push(`${id}: falta procesoAlt`);
}

// El mock de desarrollo debe cubrir exactamente las mismas 9 categorías.
global.window.location = { search: "" };
require("./assets/mock.js");
const mock = global.window.LITOTECA_MOCK;
const suyas = mock ? mock.categorias() : [];
if (suyas.join(",") !== esperadas.slice().sort().join(",") && suyas.length !== 9)
  errores.push("el mock no cubre las 9 categorías: " + suyas.join(", "));
for (const id of esperadas) {
  const r = mock && mock.respuesta(id);
  if (!r) { errores.push(`el mock no responde para ${id}`); continue; }
  if (r.top !== id) errores.push(`el mock devuelve ${r.top} para ${id}`);
  if (r.predicciones.length !== 3) errores.push(`el mock no devuelve top-3 para ${id}`);
  if (r.mock !== true) errores.push(`el mock no se marca como mock para ${id}`);
}

if (errores.length) { console.error(errores.join("\n")); process.exit(1); }
console.log(`  ok  ${esperadas.length} fichas completas y mock alineado`);
JS

echo "== 4/8 recursos y contrato"
for recurso in $(grep -o 'href="/[^"]*"\|src="/[^"]*"' index.html | sed 's/.*="\///; s/"$//' | sort -u); do
  [ -f "$recurso" ] && ok "$recurso" || fallo "index.html referencia $recurso y no existe"
done
grep -q "UMBRAL_CONFIANZA = 0.7" functions/api/predict.js || fallo "umbral de confianza del contrato alterado"
grep -q "UMBRAL_MARGEN = 0.15" functions/api/predict.js || fallo "umbral de margen del contrato alterado"
ok "umbrales 0,70 / 0,15 intactos"
node scripts/prueba_contrato.mjs || fallo "el contrato de /api/predict no se comporta como está documentado"

echo "== 5/8 estructura y accesibilidad del HTML"
python3 - <<'PY' || fallos=$((fallos + 1))
import sys
from html.parser import HTMLParser

class Revisor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids, self.duplicados = set(), set()
        self.h1 = 0
        self.problemas = []
        self.pila = []
        self.etiquetas_void = {"area","base","br","col","embed","hr","img","input","link","meta","source","track","wbr"}
        self.titulo = ""
        self.en_titulo = False
        self.lang = None
        self.viewport = False
        self.botones_sin_etiqueta = 0
        self.botones_abiertos = 0
        self.imgs_sin_alt = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            if a["id"] in self.ids: self.duplicados.add(a["id"])
            self.ids.add(a["id"])
        if tag == "html": self.lang = a.get("lang")
        if tag == "title": self.en_titulo = True
        if tag == "h1": self.h1 += 1
        if tag == "meta" and a.get("name") == "viewport": self.viewport = True
        if tag == "img" and "alt" not in a: self.imgs_sin_alt += 1
        if tag == "button":
            self.botones_abiertos += 1
            if not (a.get("aria-label") or a.get("aria-labelledby")):
                self.botones_sin_etiqueta += 1
        if tag not in self.etiquetas_void:
            self.pila.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.etiquetas_void and self.pila and self.pila[-1] == tag:
            self.pila.pop()

    def handle_data(self, data):
        if self.en_titulo: self.titulo += data
        if data.strip() and self.botones_abiertos > 0:
            self.botones_sin_etiqueta = max(0, self.botones_sin_etiqueta - 1)

    def handle_endtag(self, tag):
        if tag == "title": self.en_titulo = False
        if tag == "button": self.botones_abiertos = max(0, self.botones_abiertos - 1)
        if tag in self.etiquetas_void: return
        if not self.pila:
            self.problemas.append(f"</{tag}> sin apertura")
            return
        if self.pila[-1] != tag:
            self.problemas.append(f"</{tag}> cierra <{self.pila[-1]}>")
            if tag in self.pila:
                while self.pila and self.pila.pop() != tag: pass
            return
        self.pila.pop()

r = Revisor()
r.feed(open("index.html", encoding="utf-8").read())
errores = []
if r.duplicados: errores.append("ids duplicados: " + ", ".join(sorted(r.duplicados)))
if r.pila: errores.append("etiquetas sin cerrar: " + ", ".join(r.pila))
errores += r.problemas
if r.lang != "es": errores.append(f"<html lang> es {r.lang!r}, se espera 'es'")
if not r.titulo.strip(): errores.append("<title> vacío")
if r.h1 != 1: errores.append(f"{r.h1} <h1>; se espera exactamente 1")
if not r.viewport: errores.append("falta <meta name=viewport>")
if r.imgs_sin_alt: errores.append(f"{r.imgs_sin_alt} <img> sin alt")
if r.botones_sin_etiqueta: errores.append(f"{r.botones_sin_etiqueta} <button> sin texto ni aria-label")
if 'aria-live' not in open("index.html", encoding="utf-8").read(): errores.append("sin región aria-live")
if errores:
    print("\n".join(errores)); sys.exit(1)
print(f"  ok  HTML bien formado, {len(r.ids)} ids únicos, un h1, botones etiquetados")
PY

echo "== 6/8 sistema visual (BLUEPRINT §12)"
python3 - <<'PY' || fallos=$((fallos + 1))
import sys
css = open("assets/app.css", encoding="utf-8").read()
errores = []
if css.count("{") != css.count("}"): errores.append("llaves desbalanceadas en app.css")
for prohibido in ("backdrop-filter", "linear-gradient", "radial-gradient(", "box-shadow"):
    # radial-gradient solo se admite en la textura de papel del body.
    if prohibido == "radial-gradient(":
        if css.count("radial-gradient(") > 2: errores.append("más de dos radial-gradient (textura de papel)")
        continue
    if prohibido in css: errores.append(f"'{prohibido}' prohibido por el blueprint")
for token in ("--papel", "--tinta", "--igneo", "--sedimentario"):
    if token + ":" not in css: errores.append(f"falta el token {token}")
if "prefers-reduced-motion" not in css: errores.append("falta el bloque prefers-reduced-motion")
if css.count("--igneo") < 2 or css.count("--sedimentario") < 2: errores.append("los acentos de origen no se usan")
if errores:
    print("\n".join(errores)); sys.exit(1)
print("  ok  sin sombras, sin degradados de UI, tokens y motion respetados")
PY

echo "== 6b/8 presupuesto de CSS"
limite_css=$((24 * 1024))
css_bytes=$(wc -c < assets/app.css)
if [ "$css_bytes" -gt "$limite_css" ]; then
  fallo "app.css suma $css_bytes bytes; el presupuesto es $limite_css"
else
  ok "$((css_bytes / 1024)) KB de CSS (presupuesto 24 KB)"
fi

echo "== 7/8 presupuesto de JavaScript"
limite=$((150 * 1024))
total=$(du -cb assets/*.js functions/api/*.js | tail -1 | cut -f1)
if [ "$total" -gt "$limite" ]; then
  fallo "el JavaScript suma $total bytes; el presupuesto es $limite"
else
  ok "$((total / 1024)) KB de JS (presupuesto 150 KB)"
fi

echo "== 8/8 comportamiento en Chrome"
python3 scripts/prueba_navegador.py || fallo "el smoke test de navegador falló"

if [ "$fallos" -gt 0 ]; then
  echo "GATES FAILED ($fallos)"
  exit 1
fi
echo "GATES PASSED"
