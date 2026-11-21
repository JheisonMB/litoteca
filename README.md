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
