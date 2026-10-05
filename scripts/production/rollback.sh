#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 || $3 != --schema-compatible ]]; then
  echo "Usage: $0 /path/to/.env.production previous-commit --schema-compatible" >&2
  exit 2
fi

deployment_env=$(realpath "$1")
previous_tag=$2
if [[ ! $previous_tag =~ ^[0-9a-f]{40}$ ]]; then
  echo "Previous release must be identified by its full git commit hash." >&2
  exit 2
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

docker image inspect "voreli-server:$previous_tag" >/dev/null
docker image inspect "voreli-web:$previous_tag" >/dev/null

export RELEASE_TAG=$previous_tag
compose=(docker compose --env-file "$deployment_env" -f compose.production.yml)
"${compose[@]}" config --quiet
"${compose[@]}" up -d --no-build server web

echo "Previous application images started. Verify smoke checks; database migrations were not reversed."
