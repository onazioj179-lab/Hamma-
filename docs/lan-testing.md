# Test on phones over Wi-Fi

This computer runs the processing service. Phones send files to this computer;
FFmpeg and archive jobs run here, not on the phone GPU. Every browser receives
its own session, jobs and downloads. Two jobs execute concurrently; additional
jobs wait. This is private-network testing, not Internet hosting or Kubernetes.

From the repository, build once with `npm run build`, then run
`powershell -File scripts/start-lan.ps1`. The default port is 5014. Open the
printed address on each phone connected to the same Wi-Fi. Keep the computer
awake and the server terminal running. Guest Wi-Fi/AP client isolation can
prevent connections; use a network where devices can communicate.

If Windows blocks inbound access, run `scripts/allow-lan-firewall.ps1` once in an
Administrator PowerShell. It allows only the selected Wi-Fi interface, local
address, port and local-subnet clients. It does not change network category or
disable the firewall. To remove the rule, follow the command printed by it.

LAN mode is explicit (`--lan --host 0.0.0.0 --allow-host <private-ip>`). Unknown
Host headers, foreign Origins and cross-site browser requests remain rejected.
Default startup stays loopback-only. No router port forwarding is needed.
The IP may change when the router renews its lease; restart with the new address.

This test link uses HTTP on the local network, not end-to-end encrypted transport.
Use non-sensitive test files. Browser-generated IDs and retry keys work without
secure-context-only `randomUUID`/WebCrypto APIs, which are unavailable on ordinary
HTTP phone addresses. The existing SPK fallback may have additional browser
capability limits. Codec compatibility and job size limits remain as documented
in [the processing guide](universal-processing.md).

Docker is optional. Kubernetes is unnecessary for a single-computer test server.
`compose.lan.yml` provides the equivalent container setup. Set `HAMMA_LAN_IP` to
the private Wi-Fi address, stop the native server first, and run
`docker compose -f compose.lan.yml up --build -d`. The container port is published
only on that host address. Docker was unavailable on this machine, so that
configuration is supplied but not claimed tested.
