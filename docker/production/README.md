# Single-host release preparation

`compose.production.yml` is separate from the local development Compose. It assumes a
Linux host with Docker Compose, two DNS names resolving to that host, and inbound TCP
80/443 plus the configured UDP RTC range. Postgres, Redis, MinIO and the Node HTTP port
bind only to loopback. The Node process and Caddy use host networking so mediasoup sends
and receives RTP without Docker bridge address translation.

The browser uses the app origin for HTTP and Socket.IO. Direct attachment requests use
`https://$S3_DOMAIN`; the server accesses MinIO at `127.0.0.1:9000`. The storage adapter
signs browser URLs with the public origin but performs its own reads/writes on loopback.
MinIO allows the app origin for browser uploads.

## Prepare a host

1. Point the app and storage DNS names at the host. Install Docker Engine and Compose.
2. Copy `.env.production.example` to an untracked `.env.production`, replace every example
   value, and restrict file permissions to the deploying account.
3. Keep `DATABASE_URL` on `127.0.0.1:5432`; URL-encode special characters in its password.
   Keep `MEDIASOUP_ANNOUNCED_IP` equal to the address clients can reach.
4. Run `scripts/production/check-config.sh .env.production`.
5. Allow inbound TCP 80/443 and UDP 40000–40100 (or the chosen matching range) in both
   provider and host firewalls. Restrict SSH to trusted addresses. Do not publish 3000,
   5432, 6379, 9000 or MinIO's console.

## Release contract

`scripts/production/release.sh .env.production /path/to/backup-receipt` builds immutable
images tagged with the full git commit, starts the data services, runs Prisma migrations,
then starts the app and web proxy. It refuses a dirty tracked checkout and requires a
non-empty receipt for a verified off-host backup before migration. The receipt is an
operator record; the script cannot verify an external backup provider it does not know.
For an empty first install, record that the volumes are new and no user data exists.

The first release remains gated on choosing external backup storage and demonstrating a
restore of Postgres **and** MinIO objects. A failed application release can return to the
previous git commit and image only if its migrations are compatible with the old code.
`scripts/production/rollback.sh .env.production <full-previous-commit> --schema-compatible`
starts the retained images without rebuilding or reversing Prisma migrations. Check schema
compatibility before invoking it. Keep the previous images until smoke passes.

After each release, check HTTPS on both names, login and secure refresh cookie, chat,
upload/download, Socket.IO reconnect and a voice call from another network. HTTP health
alone does not prove that the UDP path works. Record the tested commit, date and result.

## First external call diagnostic

Run this once before inviting other users, then repeat after changes to the firewall,
networking, mediasoup configuration or reverse proxy.

1. Use two devices on different networks: desktop on home Internet and phone on cellular
   data. Join the same voice room, speak in both directions for at least one minute, then
   start a screen share and confirm the remote viewer receives changing video frames.
   Repeat with the phone as caller/receiver of a direct call. Record the git commit,
   device/OS/browser, network type and UTC start/end time.
2. Follow server logs with `docker compose --env-file .env.production -f compose.production.yml
logs -f server`. Match the test interval to `Voice transport ICE state changed`,
   `Voice transport DTLS state changed` and ICE restart events. A transition to connected
   proves negotiation, while continued incoming RTP still needs a client check.
3. On desktop Chromium, inspect `chrome://webrtc-internals` during the call. For the selected
   candidate pair record whether UDP or TCP was selected, current RTT, and whether
   `bytesReceived` grows. For inbound audio/video record `packetsLost`, `packetsReceived`,
   jitter and concealed audio samples at the start and end of a 60-second interval. In
   DevTools Console, `Voice network degraded` includes the sender's reported loss percent
   and RTT when quality falls. Do not attach the full internals dump to a public issue:
   it can contain private network addresses and session negotiation data.
4. Repeat while changing the phone from Wi-Fi to cellular data, then back. Note the length
   of any audible gap and whether an ICE restart returned to connected. Test a second
   mobile provider when available; one carrier cannot establish general reachability.
5. Mark the smoke failed if either side cannot hear the other, bytes stop increasing for
   a live stream, the screen freezes, ICE repeatedly fails, or reconnect exceeds the call
   grace period. Record the symptom with the transport state timeline and stats, then
   separate HTTPS/WebSocket failures from ICE/UDP failures before changing configuration.

These checks establish the initial baseline. They cannot guarantee that every mobile
provider and network path will work; production metrics and alerts belong to spec 015.

## Still needs the rented host

- Real DNS and automatic TLS certificate issuance.
- Off-host encrypted backups and an isolated restore drill.
- Provider/host firewall verification and outside-network WebRTC/Android tests.
- Production rollback drill against a compatible migration.
