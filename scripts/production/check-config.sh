#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/.env.production" >&2
  exit 2
fi

deployment_env=$(realpath "$1")
if [[ ! -f "$deployment_env" ]]; then
  echo "Production env file not found." >&2
  exit 2
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"
export RELEASE_TAG=configuration-check
docker compose --env-file "$deployment_env" -f compose.production.yml config --quiet

if grep -Eq 'replace-with-|example\.com' "$deployment_env"; then
  echo "Production env still contains example values." >&2
  exit 2
fi

echo "Compose configuration is valid and example values are absent."
