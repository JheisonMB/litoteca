# Dataset de litoteca — qué se hizo y por qué

Documento de trazabilidad de la preparación de datos. Sirve como borrador directo
para la sección de metodología y para la de limitaciones del informe: aquí están
los números, las decisiones y lo que se descartó, con la razón de cada cosa.

Estado a 20 nov 2026: dataset preparado y verificado. Modelo **no** entrenado
todavía (Custom Vision sigue pendiente).

---

## 1. Fuente

| Dato | Valor |
|---|---|
| Dataset | `stealthtechnologies/rock-classification` (Kaggle) |
| Origen real | export de Roboflow `universe.roboflow.com/william-cwsr-8jizi/rock-clasfication`, v1, 4 feb 2024 |
| Archivo local | `data/raw/rock-data.zip` (223 MB) |
| Copia local | `data/raw/rock-data/{train,valid,test}/<clase>/` |
| Licencia declarada | MIT (en `README.dataset.txt`, atribuida a “a Roboflow user”) |
| Clases | 9 (ígneas y sedimentarias; **ninguna metamórfica**) |
| Imágenes | 4.212 |
| Preprocesado del export | auto-orientación con EXIF eliminado, resize a 640×640 *stretch* |
| Aumento del export | 3 versiones por original: espejo horizontal 50 %, recorte 0–20 %, shear ±10°, brillo ±15 %, exposición ±10 %, sal y pimienta 0,1 % |

Consecuencia de la última fila: las 4.212 imágenes **no** son 4.212 muestras
independientes. Al agruparlas por original quedan **1.754 imágenes distintas**
(2,4 aumentos por original, no 4). Cualquier métrica calculada sin deduplicar
está midiendo, en parte, memoria del set de entrenamiento.

---

## 2. Lo que estaba mal en los splits originales

Antes de tocar nada se midió el solapamiento por nombre de imagen original
(`..._jpg.rf.<hash>.jpg` → `...`):

| Comprobación | Resultado |
|---|---|
| Imágenes en `train` | 3.687 → 1.193 originales distintos |
| Imágenes en `valid` | 351 → 330 originales |
| Imágenes en `test` | 174 → 168 originales |
| Mismo original en `train` **y** `valid` | 89 |
| Mismo original en `train` **y** `test` | 43 |
| Mismo original en `valid` **y** `test` | 15 |

Es decir: el `test` del export no era un conjunto externo. Contenía originales
que el modelo ya había visto (con otro aumento). Un 25 % de las imágenes de test
estaba contaminado, y el `valid` usado para elegir iteración, más aún.

Segundo hallazgo, con hash perceptual: **22 pares de imágenes casi idénticas
tienen etiquetas distintas** (Hamming ≤ 6 en 64 bits), repartidos así:

| Par de etiquetas | Pares |
|---|---|
| `chert` ↔ `diatomite` | 11 |
| `chert` ↔ `siliceous-sinter` | 5 |
| `clay` ↔ `shale` | 3 |
| `conglomerate` ↔ `shale` | 2 |
| `clay` ↔ `diatomite` | 1 |

Esto no es un error del código: es ruido de etiquetado del dataset. La misma foto
está en dos carpetas. Es evidencia dura de lo que el blueprint anticipaba como
“pares casi gemelos”, y explica de antemano por qué el modelo va a confundir
`chert`, `diatomite` y `siliceous-sinter`. Va en el informe como limitación
medida, no como excusa.

---

## 3. Qué hace `tools/prepare_dataset.py`

```bash
python3 tools/prepare_dataset.py \
    --src data/raw/rock-data \
    --out data/prepared
```

Produce un dataset listo para subir a Custom Vision y para evaluar sin fuga:

```
data/prepared/
├── train/<clase>/   3.428 imágenes (todos los aumentos)
├── valid/<clase>/     209 imágenes (1 por original)
├── test/<clase>/      146 imágenes (1 por original)
├── manifest.csv       3.783 filas: split, clase, archivo, cluster, fuente, tamaño, dhash
├── stats.json         conteos por clase y split, motivos de descarte
├── near_duplicates.csv  duplicados entre clusters distintos, misma clase
├── conflicts.csv      22 pares con etiqueta contradictoria
└── descartadas.csv    55 archivos y su motivo
```

Salida: 245 MB, 512×512 JPEG calidad 92, ~40 s de ejecución.

---

## 4. Decisiones y su justificación

| Decisión | Por qué |
|---|---|
| **Cluster = imagen original**, no archivo | El aumento es del export, no del fenómeno. Agrupar por original es la única forma de que train y test midan cosas distintas |
| Nombre del cluster = nombre sin `_jpg.rf.<hash>` | Roboflow conserva el nombre del original; es la señal de agrupación más fiable que trae el export |
| `dHash` de 64 bits (9×8 en gris) | Barato, robusto a reescalado y brillo; detecta el mismo original renombrado y las etiquetas contradictorias. No se usa para agrupar automáticamente entre nombres distintos, solo para **reportar** y para excluir de evaluación |
| Umbral de Hamming ≤ 6 | Conservador a propósito: con menos se escapan recortes; con más se empiezan a mezclar rocas distintas del mismo tipo. Los 284 pares intra-clase quedan en CSV para revisión |
| En `train` van todos los aumentos | Aumentar es legítimo al entrenar; el error era tener aumentos en test |
| En `valid`/`test` va **un medoid** por original | El medoid (menor distancia media al resto del cluster) es el miembro menos deformado. Evita que la métrica dependa de un recorte agresivo |
| `test` = originales que tocaban el `test` del export | Se conserva el conjunto externo tal como lo definió el autor, pero limpio de contaminación |
| Resto de originales (`train` + `valid` originales) → 85/15 estratificado por clase | El `valid` original estaba contaminado; se rehace. El 15 % da 209 imágenes de validación con las que fijar umbrales |
| Se descarta de evaluación cualquier imagen a Hamming ≤ 6 de una de `train` | Incluso con otra etiqueta. Dejarla sería evaluar memoria. 55 descartes, todos por esta razón |
| Redimensión 512×512 con `ImageOps.fit` (recorte centrado) | Custom Vision Compact acepta 640, pero 512 baja peso y latencia sin pérdida medible en este dominio. Se deja `--size 0` para conservar el original |
| Solo se usan clases del catálogo canónico | Cualquier carpeta que no resuelva a un `id` de las 9 se omite con aviso; así un dataset extra no puede introducir etiquetas silenciosas |

---

## 5. Resultado

| Clase (`id`) | Nombre | Origen | Originales | train | valid | test |
|---|---|---|---|---|---|---|
| `basalt` | Basalto | ígnea | 198 | 398 | 27 | 15 |
| `olivine-basalt` | Basalto olivínico | ígnea | 192 | 359 | 18 | 19 |
| `clay` | Arcilla | sedimentaria | 198 | 410 | 26 | 12 |
| `conglomerate` | Conglomerado | sedimentaria | 200 | 414 | 23 | 13 |
| `shale` | Lutita | sedimentaria | 195 | 367 | 26 | 20 |
| `diatomite` | Diatomita | sedimentaria | 198 | 383 | 22 | 19 |
| `chert` | Sílex | sedimentaria | 195 | 379 | 21 | 14 |
| `siliceous-sinter` | Sinter silíceo | sedimentaria | 181 | 354 | 21 | 11 |
| `gypsum` | Yeso | sedimentaria | 197 | 364 | 25 | 23 |
| **Total** | | | **1.754** | **3.428** | **209** | **146** |

- 3.783 archivos escritos de 4.212 de entrada (89,8 %).
- 55 descartes, **todos** por casi duplicado con `train`; ninguno por archivo
  ilegible, lado menor a 256 px o relación de aspecto extrema (se comprobó: el
  export ya venía limpio en ese sentido).
- Verificación posterior: manifiesto y disco coinciden en las 3.783 filas, los
  3.783 archivos son 512×512 y **ningún cluster aparece en más de un split** (0
  de 1.701).
- Nuevo tamaño del conjunto de evaluación: **355 originales** (209 validación +
  146 test), frente a los 174 archivos contaminados del export. Menos imágenes
  que las ~550 estimadas en el blueprint, pero sin aumentos y sin fuga: es un
  número más pequeño y muchísimo más defendible.

---

## 6. Cómo se usa después

1. **Entrenamiento**: subir `train/` a Custom Vision con sus 9 tags.
2. **Umbrales**: fijarlos con `valid/` (curva precisión–recall por clase). No
   tocarlos mirando `test/`.
3. **Reporte**: `test/` se evalúa una sola vez, al final, para la tabla de
   métricas. Sirve como conjunto externo porque sus originales nunca entraron a
   entrenamiento.
4. **Dominio cruzado** (camino A del blueprint, pendiente): pasar imágenes de
   Brac/PLOS por el modelo ya entrenado. Esas no se mezclan con `train`.

Reproducibilidad: `python3.12` con `Pillow ≥ 12` y `numpy ≥ 2.4`
(`tools/requirements.txt`), semilla 42, `--valid-frac 0.15`, `--near-dup 6`.

---

## 7. Lo que queda pendiente

| Pendiente | Nota |
|---|---|
| Mezclar Brac / PLOS | El script ya acepta `--extra <ruta>` con mapeo por alias de carpeta. Falta descargar y **leer la licencia** de cada uno antes de meterlo |
| Licencias de extras en este documento | Regla del blueprint: nada NC ni “solo investigación” en repo público |
| Revisión visual de marcas de agua o capturas | No se automatizó; una pasada rápida sobre `train` basta y se documenta como revisión manual |
| Revisar los 284 pares de `near_duplicates.csv` | Son casi duplicados dentro de la misma clase y distinto nombre. No afectan la fuga, pero algunos podrían ser el mismo espécimen fotografiado dos veces |
| Fijar el umbral de Hamming con evidencia | 6 se eligió por criterio; si se quiere rigor, comparar 4/6/8 contra una muestra etiquetada a mano |
| `data/` no se versiona | 245 MB. Está en `.gitignore`; se regenera con el script |

---

## 8. Qué citar en el informe

- Dataset: *Rock Classification*, `stealthtechnologies`, Kaggle, licencia MIT;
  export de Roboflow `william-cwsr-8jizi/rock-clasfication` v1 (4 feb 2024),
  descargado el 20 nov 2026.
- Preprocesado y aumento del export: citar literalmente las dos listas del
  `README.roboflow.txt` (resize 640×640 stretch; 3 versiones por original).
- Deduplicación: 4.212 archivos → 1.754 originales; splits 3.428 / 209 / 146
  agrupados por original, sin intersección entre splits.
- Limitación medida: 22 pares con etiqueta contradictoria, 11 de ellos
  `chert`/`diatomite`. Es la causa esperada de la confusión entre las clases
  síliceas y debe aparecer junto a la matriz de confusión, no después.
