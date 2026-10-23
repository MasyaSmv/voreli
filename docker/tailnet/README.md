# Temporary private deployment

Run Voreli on a Linux host for a small private group. The application and object storage
use Tailscale HTTPS; mediasoup receives UDP on the host's Tailscale IPv4 address.

## Once per host

1. Install Docker Engine, Compose and Tailscale **in the same Linux network namespace**.
   Start Docker. Run `sudo tailscale up`, sign in, and enable MagicDNS and HTTPS certificates
   for the tailnet when prompted. Run `sudo tailscale set --operator="$(whoami)"` so the
   deployment command can manage Serve without sudo. Add the other users' devices to the
   same tailnet.
   On the current Ubuntu/WSL2 host, Tailscale's [official installer](https://tailscale.com/docs/install/windows/wsl2)
   is `curl -fsSL https://tailscale.com/install.sh | sh`; it asks for the user's sudo
   password. Do not put that password in the repository or `.env.tailnet`.
2. From this repository, run `pnpm deploy:tailnet`. The first run builds images, creates
   `.env.tailnet` with random secrets, creates separate Docker volumes, runs migrations,
   creates the `owner` account with a starter server, and configures Tailscale Serve.
   The account password is `INITIAL_OWNER_PASSWORD` in `.env.tailnet`; keep this file private.
   Later runs repeat the release without replacing secrets, the account, or data.
3. Open the printed `https://<host>.<tailnet>.ts.net:8443/` URL on a joined device. The browser
   uses the same origin for API and Socket.IO; direct attachment requests use port 10000.
   Sign in as `owner`, then create invitations for the other test accounts in the app.

Only the Tailscale clients can access the web app. Tailscale Serve terminates TLS and
forwards raw HTTP to the local proxy, preserving the Host header used by signed S3 URLs.
For the app it sends PROXY protocol v2, so Caddy can pass each client's tailnet IP to the
server for per-client rate limiting. The storage forwarder does not use client IPs.
It does not forward RTP. The mediasoup transport advertises the host's Tailscale IPv4; each
client must reach UDP port 40000 over its tailnet connection. This stand runs one mediasoup
worker, so it needs one RTC port. Test voice and screen
share on two devices from different networks. `tailscale ping <peer>` identifies direct
and relayed paths; a DERP relay can reduce media quality.

The host must stay on for the app to be available. Data lives in `voreli-tailnet` Compose
volumes. Back it up before relying on it; `docker compose down` keeps volumes, while
`down -v` deletes them. The generated `.env.tailnet` and its service-specific environment
files contain credentials and are ignored by git. Do not expose ports 15432, 16379,
19000, 13000, 18080 or 19080 publicly.

On Windows/WSL2, installing Tailscale only on Windows does not put its address in the WSL2
network namespace. This command requires Tailscale inside the Linux environment that runs
Docker with host networking. [Tailscale's WSL2 guide](https://tailscale.com/docs/install/windows/wsl2)
warns that simultaneous Windows and WSL2 Tailscale clients can break nested encrypted
packets. Use a separate Linux host when available, or verify the WSL2 path with only its
Tailscale client active. Windows-to-WSL localhost forwarding alone does not prove UDP
reachability from a second tailnet device.

This deployment is a temporary test environment. It does not satisfy production spec 032:
there is no off-host backup or public IPv4/UDP validation.
