#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 /path/to/.env.production /path/to/verified-backup-receipt" >&2
  exit 2
fi

deployment_env=$(realpath "$1")
backup_receipt=$(realpath "$2")
if [[ ! -f "$deployment_env" || ! -s "$backup_receipt" ]]; then
  echo "A production env file and non-empty verified backup receipt are required." >&2
  exit 2
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

if [[ -n $(git status --porcelain --untracked-files=no) ]]; then
  echo "Build from a clean tracked checkout so the release tag identifies its contents." >&2
  exit 2
fi

export RELEASE_TAG
RELEASE_TAG=$(git rev-parse HEAD)
compose=(docker compose --env-file "$deployment_env" -f compose.production.yml)

scripts/production/check-config.sh "$deployment_env"
"${compose[@]}" build server web
"${compose[@]}" up -d postgres redis minio
"${compose[@]}" --profile tools run --rm migrate
"${compose[@]}" up -d server web

echo "Release $RELEASE_TAG started. Verify HTTPS, upload, Socket.IO and external WebRTC RTP."
