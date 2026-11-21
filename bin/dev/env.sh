#!/bin/bash
set -Eeuxo pipefail

# Uses the same ${FLAPJACK_PORT:-5477} as docker-compose.yml so the two stay in sync.
PORT="${FLAPJACK_PORT:-5477}"

cat <<EOF >.env
DATABASE_URL=postgres://flapjack:flapjack@localhost:${PORT}/flapjack_dev
EOF
