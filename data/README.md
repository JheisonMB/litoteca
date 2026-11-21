# `data/` — la única copia del dataset

Todo el material de imágenes vive aquí y **no se versiona** (`.gitignore` ignora
`data/`, salvo este README). Antes vivía duplicado entre
`~/Academic/Deriverables/ML/rock-classifier/archive/` y esta carpeta; desde el
21 nov 2026 la fuente única es este directorio.

```text
data/
├── raw/
│   ├── rock-data.zip            ← descarga original de Kaggle (223 MB)
│   └── rock-data/               ← el export descomprimido, tal cual
│       ├── train/<clase>/       3.687 archivos (con los 3 aumentos por original)
│       ├── valid/<clase>/         351 archivos
│       └── test/<clase>/          174 archivos
└── prepared/                    ← salida de tools/prepare_dataset.py
    ├── train/<clase>/           3.428 imágenes (todos los aumentos)
    ├── valid/<clase>/             209 imágenes (1 por original)
    ├── test/<clase>/              146 imágenes (1 por original)
    ├── manifest.csv             procedencia y dhash por archivo
    ├── conflicts.csv            22 pares con etiqueta contradictoria
    ├── near_duplicates.csv      duplicados perceptuales
    ├── descartadas.csv          descartes con motivo
    └── stats.json               cifras del proceso
```

* `raw/` es el original inmutable: sirve para auditar y para volver a preparar.
* `prepared/` es lo que se sube a Custom Vision y lo que se evalúa.
* El detalle de cada decisión está en [`../DATASETS.md`](../DATASETS.md).

Para reconstruir `prepared/` desde cero:

```bash
python3 tools/prepare_dataset.py --src data/raw/rock-data --out data/prepared
```
