#!/usr/bin/env bash
set -euo pipefail

DEST="../conductor-benchmarker/evaluators"

if [ ! -d "$DEST" ]; then
  echo "Error: $DEST not found. Run from py-slang root."
  exit 1
fi

VARIANTS=(
  "svml-jit:--backend svml --jit"
  "svml-nojit:--backend svml --no-jit"
)

for entry in "${VARIANTS[@]}"; do
  name="${entry%%:*}"
  flags="${entry#*:}"
  echo "Building $name..."
  npx tsx scripts/build.ts $flags
  cp dist/python-evaluator.cjs "$DEST/python-$name.cjs"
  echo "  -> $DEST/python-$name.cjs"
done

echo ""
echo "Done. Evaluators in $DEST:"
ls -1 "$DEST"/python-*.cjs
