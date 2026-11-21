#!/usr/bin/env python3
"""Prepara el dataset de rocas para entrenamiento, sin fuga entre splits.

Problema que resuelve: el export de Roboflow trae 3 aumentos por imagen original
(espejo, recorte, brillo) y reparte esos aumentos entre train/valid/test. El
mismo original puede quedar en train y en test, lo que infla las metricas.

Que hace:
  1. Agrupa las imagenes por imagen original (cluster), no por archivo.
  2. Recalcula los splits: los clusters de test original se quedan como test;
     el resto se parte 85/15 estratificado por clase (train/valid).
  3. En valid/test deja UN representante por cluster (el medoid); en train deja
     todos los aumentos.
  4. Descarta del conjunto de evaluacion cualquier imagen casi identica a una de
     train (hash perceptual) y reporta los conflictos de etiqueta.
  5. Escribe manifest.csv, stats.json, near_duplicates.csv y conflictos.csv.

Uso:
  python3 tools/prepare_dataset.py \
      --src "$HOME/Academic/Deriverables/ML/rock-classifier/archive/Rock Data" \
      --out data/prepared

Mezclar otros datasets (opcional). Cada --extra es una carpeta con una
subcarpeta por clase; el nombre se resuelve contra la tabla de alias:
  python3 tools/prepare_dataset.py ... --extra ~/datasets/brac/Rock Data
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import re
import shutil
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

# --- Taxonomia canonica ------------------------------------------------------
# id, nombre visible, etiqueta tecnica, origen. El orden fija el orden de salida.
CLASSES: list[tuple[str, str, str, str]] = [
    ("basalt", "Basalto", "Basalt", "igneo"),
    ("olivine-basalt", "Basalto olivinico", "Olivine basalt", "igneo"),
    ("clay", "Arcilla", "Clay", "sedimentario"),
    ("conglomerate", "Conglomerado", "Conglomerate", "sedimentario"),
    ("shale", "Lutita", "Shale (mudstone)", "sedimentario"),
    ("diatomite", "Diatomita", "Diatomite", "sedimentario"),
    ("chert", "Silex (chert)", "Chert", "sedimentario"),
    ("siliceous-sinter", "Sinter siliceo", "Siliceous sinter", "sedimentario"),
    ("gypsum", "Yeso", "Gypsum", "sedimentario"),
]

ALIASES: dict[str, str] = {
    "basalt": "basalt",
    "basalto": "basalt",
    "olivine-basalt": "olivine-basalt",
    "olivinebasalt": "olivine-basalt",
    "olivine": "olivine-basalt",
    "clay": "clay",
    "arcilla": "clay",
    "conglomerate": "conglomerate",
    "conglomerado": "conglomerate",
    "shale": "shale",
    "shale-mudstone": "shale",
    "mudstone": "shale",
    "lutita": "shale",
    "diatomite": "diatomite",
    "diatomita": "diatomite",
    "chert": "chert",
    "flint": "chert",
    "silex": "chert",
    "siliceous-sinter": "siliceous-sinter",
    "siliceoussinter": "siliceous-sinter",
    "sinter": "siliceous-sinter",
    "geyserite": "siliceous-sinter",
    "gypsum": "gypsum",
    "yeso": "gypsum",
}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
IMG_SIZE = 512  # lado final; Custom Vision acepta 640, 512 va sobrado

# --- Utilidades -------------------------------------------------------------


def norm(name: str) -> str:
    """Normaliza un nombre de carpeta/clase para resolverlo contra ALIASES."""
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def resolve_class(folder: str) -> str | None:
    return ALIASES.get(norm(folder))


def source_key(path: Path) -> str:
    """Nombre de la imagen original detras de un archivo de Roboflow.

    `roca_2_jpg.rf.9f8e....jpg` -> `roca_2`
    """
    stem = re.sub(r"\.rf\.[0-9a-fA-F]+$", "", path.stem)
    stem = re.sub(r"_(jpg|jpeg|png|webp)$", "", stem, flags=re.IGNORECASE)
    return stem


def dhash(img: Image.Image) -> int:
    small = img.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    px = np.asarray(small, dtype=np.int16)
    bits = (px[:, 1:] > px[:, :-1]).reshape(-1)
    return int.from_bytes(np.packbits(bits, axis=0).tobytes(), "big")


def hamming(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Distancias de Hamming entre un vector de hashes (uint64) y otro."""
    return np.bitwise_count(np.bitwise_xor(a[:, None], b[None, :])).astype(np.int16)


def medoid(hashes: list[int]) -> int:
    """Indice del hash mas cercano a todos los demas (menor suma de distancias)."""
    if len(hashes) == 1:
        return 0
    arr = np.array(hashes, dtype=np.uint64)
    dist = hamming(arr, arr)
    return int(np.argmin(dist.sum(axis=1)))


# --- Recoleccion ------------------------------------------------------------


@dataclass
class Record:
    path: Path
    cls: str
    source: str  # nombre del dataset de origen
    orig_split: str  # train | valid | test segun el export original
    base: str  # imagen original
    width: int = 0
    height: int = 0
    digest: int = 0
    problem: str | None = None

    @property
    def cluster(self) -> str:
        return f"{self.cls}/{self.base}"


def collect(root: Path, source: str, split_hint: str | None = None) -> list[Record]:
    """Recorre root/<split>/<clase>/ o root/<clase>/ y devuelve registros."""
    recs: list[Record] = []
    if not root.is_dir():
        raise SystemExit(f"No existe la ruta: {root}")

    # Estructura con splits o plana: se detecta por nombres de subcarpeta.
    top = [p for p in root.iterdir() if p.is_dir()]
    splits = [p for p in top if p.name.lower() in {"train", "valid", "test"}]
    if splits:
        class_dirs = [(sp, cd) for sp in splits for cd in sp.iterdir() if cd.is_dir()]
    else:
        one = split_hint or "train"
        class_dirs = [(root, cd) for cd in top]

    for split_dir, class_dir in class_dirs:
        cls = resolve_class(class_dir.name)
        if cls is None:
            print(f"  ! clase desconocida, se omite: {class_dir.name}", file=sys.stderr)
            continue
        for p in sorted(class_dir.rglob("*")):
            if p.suffix.lower() not in IMAGE_EXTS or not p.is_file():
                continue
            recs.append(
                Record(
                    path=p,
                    cls=cls,
                    source=source,
                    orig_split=split_dir.name.lower()
                    if split_dir != root
                    else (split_hint or "train"),
                    base=source_key(p),
                )
            )
    return recs


def inspect(rec: Record) -> bool:
    """Lee la imagen, calcula hash y detecta archivos inservibles."""
    try:
        with Image.open(rec.path) as img:
            img.load()
            img = ImageOps.exif_transpose(img)
            rec.width, rec.height = img.size
            if min(rec.width, rec.height) < 256:
                rec.problem = "lado < 256 px"
            elif max(rec.width, rec.height) / min(rec.width, rec.height) > 2.5:
                rec.problem = "aspecto extremo"
            rec.digest = dhash(img)
    except Exception as exc:  # archivo corrupto o formato no soportado
        rec.problem = f"ilegible: {type(exc).__name__}"
        return False
    return rec.problem is None


# --- Splits -----------------------------------------------------------------


def assign_splits(
    clusters: dict[str, list[Record]], valid_frac: float, seed: int
) -> dict[str, str]:
    """Devuelve cluster -> split.

    Los clusters que tocan el test original quedan como test (son el conjunto
    externo del export). El resto se parte estratificado por clase.
    """
    split_of: dict[str, str] = {}
    pool: dict[str, list[str]] = defaultdict(list)

    for cid, members in clusters.items():
        splits = {m.orig_split for m in members}
        if "test" in splits:
            split_of[cid] = "test"
        else:
            pool[members[0].cls].append(cid)

    rng = random.Random(seed)
    for cls, cids in pool.items():
        cids = sorted(cids)
        rng.shuffle(cids)
        n_valid = max(1, round(len(cids) * valid_frac))
        for i, cid in enumerate(cids):
            split_of[cid] = "valid" if i < n_valid else "train"
    return split_of


# --- Escritura --------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True, type=Path, help="dataset base (export con train/valid/test)")
    ap.add_argument("--out", type=Path, default=Path("data/prepared"))
    ap.add_argument("--extra", action="append", default=[], type=Path, help="dataset adicional (repetible)")
    ap.add_argument("--valid-frac", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--size", type=int, default=IMG_SIZE, help="lado final en px; 0 = no redimensionar")
    ap.add_argument("--near-dup", type=int, default=6, help="umbral de Hamming para casi duplicados")
    ap.add_argument("--link", choices=["copy", "hard", "symlink"], default="copy")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print(f"Dataset base: {args.src}")
    records = collect(args.src, source="kaggle-stealthtechnologies")
    for extra in args.extra:
        print(f"Dataset extra: {extra}")
        records.extend(collect(extra, source=extra.parent.name))
    if not records:
        raise SystemExit("No se encontraron imagenes.")

    print(f"Imagenes encontradas: {len(records)}")

    kept: list[Record] = []
    dropped: list[Record] = []
    for i, rec in enumerate(records, 1):
        if inspect(rec):
            kept.append(rec)
        else:
            dropped.append(rec)
        if i % 500 == 0:
            print(f"  inspeccionadas {i}/{len(records)}")

    # Clusters = imagen original.
    clusters: dict[str, list[Record]] = defaultdict(list)
    for rec in kept:
        clusters[rec.cluster].append(rec)

    split_of = assign_splits(clusters, args.valid_frac, args.seed)

    # Vecindad entre clusters distintos: detecta el mismo original renombrado,
    # tanto dentro de una clase como con etiqueta contradictoria.
    near_rows: list[dict[str, object]] = []
    conflict_rows: list[dict[str, object]] = []
    hashes = np.array([m.digest for m in kept], dtype=np.uint64)
    chunk = 256
    for start in range(0, len(kept), chunk):
        dist = hamming(hashes[start : start + chunk], hashes)
        for row, col in zip(*np.where(dist <= args.near_dup)):
            i = start + int(row)
            j = int(col)
            if j <= i:
                continue
            ra, rb = kept[i], kept[j]
            if ra.base == rb.base:
                continue
            entry = {
                "archivo_a": ra.path.name,
                "cluster_a": ra.cluster,
                "archivo_b": rb.path.name,
                "cluster_b": rb.cluster,
                "hamming": int(dist[row, col]),
            }
            if ra.cls == rb.cls:
                near_rows.append({"clase": ra.cls, **entry})
            else:
                conflict_rows.append({"clase_a": ra.cls, "clase_b": rb.cls, **entry})

    # Seleccion: train con todos los aumentos; valid/test con un medoid por
    # cluster, y sin nada casi identico a una imagen de train.
    chosen: dict[str, list[Record]] = {"train": [], "valid": [], "test": []}
    reasons: Counter[str] = Counter()

    train_hashes = np.array(
        [m.digest for cid, members in clusters.items() if split_of[cid] == "train" for m in members],
        dtype=np.uint64,
    )

    for cid, members in clusters.items():
        split = split_of[cid]
        if split == "train":
            chosen["train"].extend(members)
            continue

        pick = members[medoid([m.digest for m in members])]
        if len(train_hashes):
            # Mismo original en train, aunque en el export tuviera otra etiqueta:
            # dejarlo en evaluacion seria medir memoria, no reconocimiento.
            dmin = int(hamming(np.array([pick.digest], dtype=np.uint64), train_hashes).min())
            if dmin <= args.near_dup:
                reasons["casi duplicado de train"] += 1
                dropped.append(pick)
                continue
        chosen[split].append(pick)

    for rec in dropped:
        if rec.problem is None:
            rec.problem = "descartada (duplicado)"

    # Contabilidad antes de escribir.
    total_out = sum(len(v) for v in chosen.values())
    print(f"\nClusters (imagenes originales): {len(clusters)}")
    print(f"Descartadas: {len(dropped)}  |  A escribir: {total_out}")
    for split in ("train", "valid", "test"):
        per_class = Counter(m.cls for m in chosen[split])
        print(f"  {split:5s} {len(chosen[split]):5d}  " + " ".join(f"{c}:{per_class.get(c, 0)}" for c, *_ in CLASSES))

    if args.dry_run:
        for rec in dropped[:20]:
            print(f"  - {rec.problem}: {rec.path}")
        return 0

    out: Path = args.out
    if out.exists():
        shutil.rmtree(out)
    for split in ("train", "valid", "test"):
        for cls, *_ in CLASSES:
            (out / split / cls).mkdir(parents=True, exist_ok=True)

    def place(rec: Record, split: str) -> str:
        # Nombre acotado: algunos originales traen nombres de 150+ caracteres y el
        # limite del sistema de archivos es 255 bytes por componente.
        slug = re.sub(r"[^A-Za-z0-9._-]+", "-", rec.base).strip("-.")[:80] or "img"
        tag = f"{rec.digest:016x}"[:12]
        dst = out / split / rec.cls / f"{rec.cls}__{slug}__{tag}.jpg"
        n = 1
        while dst.exists():
            n += 1
            dst = out / split / rec.cls / f"{rec.cls}__{slug}__{tag}-{n}.jpg"
        if args.link == "symlink":
            os.symlink(rec.path.resolve(), dst)
        elif args.link == "hard":
            os.link(rec.path, dst)
        else:
            img_dst = dst
            if args.size:
                with Image.open(rec.path) as img:
                    img = ImageOps.exif_transpose(img).convert("RGB")
                    if img.size != (args.size, args.size):
                        img = ImageOps.fit(img, (args.size, args.size), Image.Resampling.LANCZOS)
                    img.save(img_dst, "JPEG", quality=92, optimize=True)
            else:
                shutil.copy2(rec.path, dst)
        return str(dst.relative_to(out))

    rows = []
    for split in ("train", "valid", "test"):
        for rec in chosen[split]:
            rel = place(rec, split)
            rows.append(
                {
                    "split": split,
                    "clase": rec.cls,
                    "archivo": rel,
                    "cluster": rec.cluster,
                    "base": rec.base,
                    "fuente": rec.source,
                    "fuente_split": rec.orig_split,
                    "ancho": rec.width,
                    "alto": rec.height,
                    "dhash": f"{rec.digest:016x}",
                }
            )
    rows.sort(key=lambda r: (r["split"], r["clase"], r["archivo"]))

    with (out / "manifest.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    stats = {
        "generado": "prepare_dataset.py",
        "fuente": str(args.src),
        "extras": [str(e) for e in args.extra],
        "seed": args.seed,
        "valid_frac": args.valid_frac,
        "tamano_px": args.size or None,
        "imagenes_entrada": len(records),
        "clusters": len(clusters),
        "descartadas": len(dropped),
        "motivos_descarte": dict(Counter(r.problem for r in dropped)),
        "casi_duplicados_entre_clusters": len(near_rows),
        "etiquetas_contradictorias": len(conflict_rows),
        "clases": {
            cls: {
                "nombre": name,
                "tecnico": tech,
                "origen": origin,
                **{
                    split: sum(1 for r in rows if r["clase"] == cls and r["split"] == split)
                    for split in ("train", "valid", "test")
                },
                "clusters": sum(1 for cid in clusters if clusters[cid][0].cls == cls),
            }
            for cls, name, tech, origin in CLASSES
        },
        "totales": {
            split: sum(1 for r in rows if r["split"] == split)
            for split in ("train", "valid", "test")
        },
    }
    (out / "stats.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False), encoding="utf-8")

    fields = ["clase", "archivo_a", "cluster_a", "archivo_b", "cluster_b", "hamming"]
    with (out / "near_duplicates.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(near_rows)

    cfields = ["clase_a", "clase_b", "archivo_a", "cluster_a", "archivo_b", "cluster_b", "hamming"]
    with (out / "conflicts.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=cfields)
        writer.writeheader()
        writer.writerows(conflict_rows)

    with (out / "descartadas.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["motivo", "ruta"])
        for rec in dropped:
            writer.writerow([rec.problem, rec.path])

    print(f"\nListo: {out.resolve()}")
    print(f"  manifest.csv      {len(rows)} filas")
    print(f"  stats.json        resumen por clase y split")
    print(f"  near_duplicates.csv  {len(near_rows)} pares")
    print(f"  conflicts.csv     {len(conflict_rows)} pares con etiqueta distinta")
    print(f"  descartadas.csv   {len(dropped)} archivos")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
