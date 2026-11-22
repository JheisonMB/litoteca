#!/usr/bin/env bash
set -euo pipefail
PORT="${PORT:-8099}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
echo "Litoteca dev server: http://localhost:${PORT}/"
echo "Mock fichas:        http://localhost:${PORT}/?mock=1"
echo "Galeria (9 fichas): http://localhost:${PORT}/?galeria=1"
echo ""
echo "Ctrl+C para detener."
exec python3 -m http.server "$PORT"
