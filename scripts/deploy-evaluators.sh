#!/usr/bin/env bash
set -euo pipefail

DEST="../conductor-benchmarker/evaluators"

if [ ! -d "$DEST" ]; then
  echo "Error: $DEST not found. Run from py-slang root."
  exit 1
fi

VARIANTS=(
  "svml-jit:BACKEND=svml JIT=on"
  "svml-nojit:BACKEND=svml JIT=off"
)

for entry in "${VARIANTS[@]}"; do
  name="${entry%%:*}"
  envs="${entry#*:}"
  echo "Building $name..."
  env $envs npx rollup -c --bundleConfigAsCjs --silent
  cp dist/python-evaluator.cjs "$DEST/python-$name.cjs"
  echo "  -> $DEST/python-$name.cjs"
done

echo ""
echo "Done. Evaluators in $DEST:"
ls -1 "$DEST"/python-*.cjs
