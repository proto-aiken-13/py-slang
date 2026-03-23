#!/usr/bin/env bash
# Run GitHub Actions CI locally via act
# Requires: act (brew install act), Docker
# Note: Coveralls step will fail locally (no GITHUB_TOKEN + MITM proxy TLS)

set -euo pipefail

CERT_PATH="${NODE_EXTRA_CA_CERTS:-/Users/loremipsum/corp-ca-bundle.pem}"

act -W .github/workflows/node.js.yml \
  --container-architecture linux/amd64 \
  -j build \
  --env NODE_EXTRA_CA_CERTS=/certs/corp-ca-bundle.pem \
  --env NODE_TLS_REJECT_UNAUTHORIZED=0 \
  --env "PATH=/opt/hostedtoolcache/node/22.22.1/x64/bin:/opt/acttoolcache/node/24.14.0/x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  --container-options "-v ${CERT_PATH}:/certs/corp-ca-bundle.pem:ro" \
  "$@"
