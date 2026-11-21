#!/bin/bash
set -Eeuxo pipefail

cat <<EOF >.env
DATABASE_URL=postgres://flapjack:flapjack@localhost:5477/flapjack_dev
EOF
