#!/usr/bin/env bash
# Gate único de Litoteca. Lo corren por igual el nodo "Full gates" del grafo y
# cualquier agente antes de reportar pass, así que tiene que ser determinista,
# rápido y no tocar nada fuera del repo.
#
# Comprueba: sintaxis de todo el JavaScript, coherencia entre los ids que
# pide app.js y los que existen en index.html, integridad de las 9 fichas,
# y que los recursos referenciados desde el HTML existan.
set -euo pipefail
cd "$(dirname "$0")/.."

fallos=0
fallo() { echo "FALLO: $*"; fallos=$((fallos + 1)); }
ok() { echo "  ok  $*"; }

echo "== sintaxis JavaScript"
while IFS= read -r archivo; do
  node --check "$archivo" || fallo "sintaxis en $archivo"
done < <(find assets functions tools scripts -name '*.js' -o -name '*.mjs' 2>/dev/null)
ok "todo el JavaScript parsea"

echo "== ids de app.js existen en index.html"
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

echo "== las 9 fichas"
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
if (errores.length) { console.error(errores.join("\n")); process.exit(1); }
console.log(`  ok  ${esperadas.length} fichas completas`);
JS

echo "== recursos referenciados"
for recurso in $(grep -o 'href="/[^"]*"\|src="/[^"]*"' index.html | sed 's/.*="\///; s/"$//' | sort -u); do
  [ -f "$recurso" ] && ok "$recurso" || fallo "index.html referencia $recurso y no existe"
done

echo "== contrato de /api/predict"
grep -q "UMBRAL_CONFIANZA = 0.7" functions/api/predict.js || fallo "umbral de confianza del contrato alterado"
grep -q "UMBRAL_MARGEN = 0.15" functions/api/predict.js || fallo "umbral de margen del contrato alterado"
ok "umbrales 0,70 / 0,15 intactos"

if [ "$fallos" -gt 0 ]; then
  echo "GATES FAILED ($fallos)"
  exit 1
fi
echo "GATES PASSED"
