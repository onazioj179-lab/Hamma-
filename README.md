# HAMMA

**Make space. Keep everything.**

HAMMA is a free workspace for compressing files and restoring SPK archives on
your own device. Created by **Onazi Treasure Oj**.

No account, subscription, or Python service is needed for the browser workspace.
Choose files or a folder to create an archive. Choose an `.spk` file to restore
it. Multi-file archives restore as a ZIP so you can use your usual file manager.
Compression savings depend on the input; already compressed files can grow.

## What you can use

- **Workspace:** file and folder selection, drag and drop, measured progress,
  cancellation, compression, restoration, and result downloads.
- **My files:** the current result available in this session. Large jobs saved
  directly to disk are identified as saved. This is not cloud storage.
- **History:** the last 20 completed local records, with search, filtering, and
  deletion. History stores file names and size metadata, not file contents.
- **Overview:** counts and savings calculated from recorded operations. Optional
  local learning shows observed throughput; no sample data is invented.
- **Settings:** light/dark/system appearance, automatic downloads, history and
  privacy preferences, app cache cleanup, local learning reset, and About.

The interface uses solid surfaces without blurred popups. Settings and creator
information are at the bottom of the desktop sidebar. All main views work on
narrow screens as well.

## Privacy and learning

File processing stays on the device in the free workspace. It does not upload
files, send analytics, or set tracking cookies. Essential local storage remembers
your settings and privacy choice. History can be turned off or cleared.

Local performance learning is **off until you opt in**. When enabled, it keeps
rolling totals of input bytes, output bytes, and elapsed time. It keeps no file
names or contents and sends nothing to a server. Opting out clears those totals.
The current implementation learns local performance measurements; it does not
train a shared model across users or change compression strategies from those
measurements.

Cache cleanup deletes only HAMMA/SPK Cache Storage entries. It cannot clear the
browser's HTTP cache, other sites, or downloaded files. Download results before
closing or resetting the page: output bytes are not retained in history.

## Run the browser workspace

Use a current Node.js LTS release that supports the checked-in dependencies.
From this repository directory:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. To create a production build:

```sh
npm run typecheck
npm run test:web
npm run build
```

Build output is in `web/dist/`. The browser selects an available engine and can
fall back to JavaScript; a WebAssembly-capable browser does not by itself prove
that native WASM ran. If building the WASM bindings, install Rust and wasm-pack:

```sh
npm run build:wasm
```

## Optional Rust backend

The native core and optional HTTP API are Rust. Python is retained as a separate
research service under `hamma/`; it is not in the free workspace's runtime path.
That research code has not been represented as a completed Rust port.

```sh
cargo run -p spk-backend --bin spk-server
```

The API binds to `127.0.0.1:3000` by default. `PORT` and `SPK_BIND_HOST` override
that address. `SPK_WEB_DIR` selects built static web assets. See the backend code
and [maintenance documentation](docs/maintenance.md) before deploying it publicly.

API admission is enforced in Rust: by default, 120 API requests per peer IP per
minute, with a stricter 10/minute allowance for account creation, login, and
recovery. Rejected calls receive HTTP 429 and `Retry-After`. Configure positive
limits using `SPK_API_RPM` and `SPK_AUTH_RPM`. Health checks remain available.
The limiter is bounded and process-local: multiple instances need a shared edge
limiter. Behind a reverse proxy, peers share that proxy's quota; forwarding
headers are not trusted. Browser compression does not call this API or consume
its request allowance. Local processing admits one active job at a time.

## Project layout

| Directory | Purpose |
| --- | --- |
| `web/` | Active React/TypeScript browser workspace |
| `core/` | Rust compression and archive implementation |
| `wasm/` | WebAssembly bindings |
| `backend/` | Optional Rust HTTP API |
| `hamma/` | Separate Python optimizer research service |
| `mobile/`, `mobile-web/` | Separate mobile clients |
| `docs/` | Specifications, maintenance notes, and historical designs |
| `scripts/`, `validation/` | Development and verification tooling |

See [workspace behavior and verification](docs/ui-workspace.md),
[archive format](docs/SPK_Format_v1.md), and [native roadmap](docs/native-roadmap.md).
Historical design targets in older documents are not current performance
guarantees. Server storage, account hardening, billing, sharing, and all native
worker paths are not certified by this UI rebuild.

## License and creator

[MIT](LICENSE). Created by **Onazi Treasure Oj**. The interface includes a small
creator watermark and an About panel linking to this repository.
