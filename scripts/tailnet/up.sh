#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

for command_name in docker tailscale python3 openssl curl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing $command_name. See docker/tailnet/README.md." >&2
    exit 1
  fi
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker Engine is unavailable to this user. Start Docker and check socket access." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose is required." >&2
  exit 1
fi

tailnet_identity=$(tailscale status --json | python3 -c '
import ipaddress
import json
import sys

status = json.load(sys.stdin)
device = status.get("Self") or {}
addresses = device.get("TailscaleIPs") or []
name = str(device.get("DNSName") or "").rstrip(".")
ipv4 = next((ip for ip in addresses if ipaddress.ip_address(ip).version == 4), "")
if status.get("BackendState") != "Running" or not name.endswith(".ts.net") or not ipv4:
    sys.exit("Tailscale is not connected or MagicDNS is unavailable. Run tailscale up first.")
if not any(str(domain).rstrip(".") == name for domain in (status.get("CertDomains") or [])):
    sys.exit("Tailscale HTTPS is disabled. Enable HTTPS certificates for this tailnet, then rerun.")
print(name, ipv4)
')
read -r app_domain announced_ip <<< "$tailnet_identity"

env_file="$repo_root/.env.tailnet"
umask 077
read_secret() {
  local key=$1
  local current
  current=$(sed -n "s/^${key}=//p" "$env_file")
  if [[ ! $current =~ ^[0-9a-f]{24,}$ ]]; then
    echo "Invalid $key in $env_file. Keep the generated secrets or restore them from backup." >&2
    exit 1
  fi
  printf '%s' "$current"
}

if [[ -f $env_file ]]; then
  postgres_password=$(read_secret POSTGRES_PASSWORD)
  jwt_secret=$(read_secret JWT_SECRET)
  s3_access_key=$(read_secret S3_ACCESS_KEY)
  s3_secret_key=$(read_secret S3_SECRET_KEY)
  if grep -q '^INITIAL_OWNER_PASSWORD=' "$env_file"; then
    initial_owner_password=$(read_secret INITIAL_OWNER_PASSWORD)
  else
    initial_owner_password=$(openssl rand -hex 24)
  fi
else
  postgres_password=$(openssl rand -hex 32)
  jwt_secret=$(openssl rand -hex 32)
  s3_access_key=$(openssl rand -hex 16)
  s3_secret_key=$(openssl rand -hex 32)
  initial_owner_password=$(openssl rand -hex 24)
fi

temp_env=$(mktemp "$env_file.XXXXXX")
postgres_env_file="$repo_root/.env.tailnet.postgres"
bootstrap_env_file="$repo_root/.env.tailnet.bootstrap"
temp_postgres_env=$(mktemp "$postgres_env_file.XXXXXX")
temp_bootstrap_env=$(mktemp "$bootstrap_env_file.XXXXXX")
trap 'rm -f "$temp_env" "$temp_postgres_env" "$temp_bootstrap_env"' EXIT
cat > "$temp_env" <<EOF
APP_DOMAIN=$app_domain
MEDIASOUP_ANNOUNCED_IP=$announced_ip
POSTGRES_PASSWORD=$postgres_password
TAILNET_DATABASE_URL=postgresql://voreli:$postgres_password@127.0.0.1:15432/voreli?schema=public
JWT_SECRET=$jwt_secret
S3_ACCESS_KEY=$s3_access_key
S3_SECRET_KEY=$s3_secret_key
INITIAL_OWNER_PASSWORD=$initial_owner_password
EOF
printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password" > "$temp_postgres_env"
printf 'INITIAL_OWNER_PASSWORD=%s\n' "$initial_owner_password" > "$temp_bootstrap_env"
mv "$temp_env" "$env_file"
mv "$temp_postgres_env" "$postgres_env_file"
mv "$temp_bootstrap_env" "$bootstrap_env_file"
trap - EXIT

# Compose gives exported variables precedence over --env-file; use the generated values together.
compose=(env -u APP_DOMAIN -u MEDIASOUP_ANNOUNCED_IP -u POSTGRES_PASSWORD \
  -u TAILNET_DATABASE_URL -u JWT_SECRET -u S3_ACCESS_KEY -u S3_SECRET_KEY \
  -u INITIAL_OWNER_PASSWORD docker compose --env-file "$env_file" -f compose.tailnet.yml)
"${compose[@]}" config --quiet
"${compose[@]}" build server web minio
if ! docker run --rm --network host --env TAILNET_IPV4="$announced_ip" --entrypoint node voreli-server:tailnet -e '
const interfaces = Object.values(require("node:os").networkInterfaces()).flat();
if (!interfaces.some((address) => address?.address === process.env.TAILNET_IPV4)) {
  process.exit(1);
}
'; then
  echo "Docker host networking cannot see this Tailscale address. Use Docker Engine in the same Linux network namespace as Tailscale." >&2
  exit 1
fi
"${compose[@]}" up -d postgres redis minio
"${compose[@]}" --profile tools run --rm migrate
"${compose[@]}" --profile tools run --rm bootstrap
"${compose[@]}" up -d server web

for attempt in {1..30}; do
  if curl --fail --silent --output /dev/null http://127.0.0.1:13000/health; then
    break
  fi
  if [[ $attempt -eq 30 ]]; then
    echo "Voreli did not become healthy. Inspect: docker compose --env-file .env.tailnet -f compose.tailnet.yml logs server web" >&2
    exit 1
  fi
  sleep 2
done

tailscale serve --bg --proxy-protocol=2 --tls-terminated-tcp=8443 tcp://127.0.0.1:18080
tailscale serve --bg --tls-terminated-tcp=10000 tcp://127.0.0.1:19080

for attempt in {1..30}; do
  if curl --fail --silent --output /dev/null --max-time 5 --noproxy '*' \
    --resolve "$app_domain:8443:$announced_ip" "https://$app_domain:8443/health"; then
    break
  fi
  if [[ $attempt -eq 30 ]]; then
    echo "Tailnet HTTPS ingress did not become healthy. Inspect Tailscale Serve and the web container logs." >&2
    exit 1
  fi
  sleep 2
done

echo "Voreli: https://$app_domain:8443/"
echo "Storage: https://$app_domain:10000/"
echo "Media address: $announced_ip (UDP 40000 over the tailnet)"
echo "Initial account: owner; password is INITIAL_OWNER_PASSWORD in .env.tailnet"
echo "Invite participants to the tailnet, then test a call from another network."
