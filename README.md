# Litoteca

Clasificador de muestras de roca con la cámara del teléfono, más la ficha que
explica **por qué** la piedra que tienes en la mano es lo que es.

Sitio estático (HTML, CSS y JavaScript sin build) con una Pages Function en
`functions/` como proxy del modelo. El diseño y el alcance completos están en
[`BLUEPRINT.md`](BLUEPRINT.md); el dataset y su preparación, en
[`DATASETS.md`](DATASETS.md).

## Estado

| Pieza | Estado |
|---|---|
| Dataset preparado (9 clases, sin fuga entre splits) | hecho — ver `DATASETS.md` |
| Página: inicio, cámara, subida, ficha, historial local | hecho |
| Proxy `/api/predict` | escrito, responde `503` hasta que exista el modelo |
| Modelo en Custom Vision | **pendiente de entrenar** |

Mientras no haya modelo, la página funciona en **modo demostración**: elige una
ficha de forma determinista para poder revisar el diseño, y lo declara en una
banda visible. No finge una predicción.

## Desarrollo sin modelo (mock)

Dos interruptores por URL, solo para diseño; la URL publicada no los lleva:

| URL | Qué hace |
|---|---|
| `/?galeria=1` | Las 9 fichas seguidas con confianza simulada, para revisar las tarjetas |
| `/?mock=1` | Tras subir una foto, una tira fuerza cualquiera de las 9 categorías |

El mock vive en `assets/mock.js` y devuelve objetos con la forma exacta del
contrato de `/api/predict`, así que lo que se diseña con él es lo que verá la
página cuando el modelo exista. La banda de la ficha lo declara siempre.

## Correr en local

```bash
python3 -m http.server 8099      # abre http://localhost:8099
```

Sin la Function, `/api/predict` da 404; para ver el estado real del proxy usa
`npx wrangler pages dev . --compatibility-date=2026-11-21`.

La cámara exige contexto seguro: `localhost` sirve, una IP de la red local no.

## Estructura

```text
index.html                 inicio, cámara, resultado e historial (una sola página)
assets/app.css             sistema visual (papel, tinta, un acento por pantalla)
assets/app.js              cámara, subida, recorte 512 px, API, fichas, localStorage
assets/fichas.js           las 9 fichas curadas: qué es, cómo se formó, gemelas
functions/api/predict.js   proxy de Custom Vision + contrato y umbrales
scripts/gates.sh           gate determinista (sintaxis, ids, fichas, contrato)
tools/prepare_dataset.py   dataset → 3.428 / 209 / 146
data/                      dataset (ignorado por git, ver data/README.md)
```

## Variables de la Function

| Variable | Uso |
|---|---|
| `CUSTOM_VISION_ENDPOINT` | `https://<recurso>.cognitiveservices.azure.com` |
| `CUSTOM_VISION_KEY` | clave de predicción de la iteración publicada |
| `CUSTOM_VISION_PROJECT` | id del proyecto de Custom Vision |
| `CUSTOM_VISION_ITERATION` | nombre de la iteración (por defecto `Iteration1`) |
| `CUSTOM_VISION_TRAINED` | fecha de entrenamiento, se muestra en la ficha |

La región útil de la suscripción es **northcentralus**: `sys.regionrestriction`
bloquea East US y solo allí hay SKU de `CustomVision.Training/Prediction`.

## Gate

```bash
bash scripts/gates.sh    # GATES PASSED
```

Ocho bloques, sin saltos: sintaxis de todo el JS · ids de `app.js` contra el
HTML · integridad de las 9 fichas y cobertura del mock · recursos y umbrales
del contrato · **`scripts/prueba_contrato.mjs`** (la Function real con `fetch`
falso: normalización de etiquetas, ambigüedad, baja confianza, 400/413/429/503)
· estructura y accesibilidad del HTML (ids únicos, un `h1`, `lang`, `viewport`,
`alt`, botones etiquetados, `aria-live`) · reglas visuales del blueprint (sin
sombras, sin degradados de UI, tokens, `prefers-reduced-motion`) · presupuesto
de JS · **`scripts/prueba_navegador.py`** (Chrome headless: subida, ficha, banda
demo, guardado en `localStorage`, historial).
