# HAMMA

**Make space. Keep everything.**

A web app to compress, extract, convert, and download files locally.
Created by **Onazi Treasure OJ**. SHANTE is HAMMA's internal processing engine.

Optional Google/Apple sign-in setup and verification limits: [account providers](docs/account-providers.md).

Build and verification instructions: [SHANTE CORE](native/README.md).

## Start HAMMA with one click on Windows

Double-click **Start HAMMA.cmd** in this folder (or the HAMMA desktop shortcut).
It builds changed app files, starts the local processor in the background, and
opens the browser. Reopening it reuses the running server. Node.js 22.12+ and
Python 3.11+ must already be installed; the first launch installs npm dependencies.

The default address is **http://127.0.0.1:5014**. Phones and other computers on
the same network use this computer's private address on port 5014. The launcher
writes current links to `.hamma-data/connection-links.txt`. Keep this computer
awake. Localhost on a phone refers to the phone itself. Remote internet access
is not provided by these LAN links. Windows Firewall must allow this port from
the local subnet; the existing setup script is `scripts/allow-lan-firewall.ps1`.

Standard formats and SPK share **Add Files / Add Folder**. Choose ZIP or another
format under **Options / Archive**, or choose SPK for browser compression.
Use **Extract** to restore SPK and standard archives. Empty folders require a
standard archive format. One history list sorts and searches both engines,
with colored operation tags and unique IDs. The current SPK download stays on
its history row; older SPK records contain metadata only. Overview includes
retained processor jobs and browser SPK records, with measured compression savings.
Each visitor has a separate session and history.

Logs: `.hamma-data/server.err.log`. Startup state: `.hamma-data/launcher.json`.
The launcher uses `.hamma-data/lan-test` to preserve the existing LAN job store.

## Run the web app

```sh
npm ci
npm run start:local
```

Open http://127.0.0.1:5010. Requires Node.js 22.12+, Python 3.11+, and optional
FFmpeg/FFprobe for media conversion. Jobs run in local background processes.
Standard ZIP/TAR/GZIP/BZIP2/XZ operations, verified downloads, resumable uploads,
retry/cancel controls and 500-record guest history are implemented. The browser SPK engine is available through the same Workspace file picker.
Build [SHANTE CORE](native/README.md) to enable verified native Zstandard.

See [supported formats, deployment and operational limits](docs/universal-processing.md).
See [mixed-file workflows](docs/mixed-workflows.md) for grouped actions and upload recovery.
The [HAMMA web engineering audit](docs/engineering/hammer-directive-audit.md)
tracks release acceptance and remaining implementation work.
The Account page supports durable local Free accounts, sign-in, sign-out and
password changes. Guest and account files remain separate; signing out returns
to the same guest session. Passwords are hashed with scrypt, and sessions use
HttpOnly cookies. These accounts belong to this processor installation.
Billing is disabled. Synchronized storage, encryption at rest, distributed
workers and validated multi-terabyte processing remain unfinished.

Network account access requires HTTPS. Supply your certificate and private key
explicitly (both files are required):

```sh
python -m processor.server --tls-cert /path/to/certificate.pem --tls-key /path/to/private-key.pem
```

The browser must trust that certificate. Existing explicit `--lan` and
`--allow-host` restrictions still apply to private-network listeners; forwarded
headers do not enable credential access over plaintext HTTP. Local loopback HTTP
continues to work for development. The Windows launcher continues to use its
existing HTTP mode, so use the explicit HTTPS command for network accounts.

`GET /api/process/files` provides an owner-scoped retained-upload index with
`q`, `offset`, `limit` (maximum 100), and `duplicates=1` filters. Duplicate results
use matching stored checksums and sizes; incomplete or unhashed uploads are
excluded. The index does not scan drives or expose local disk paths.

## Use the SPK browser workflow

For phones on the same Wi-Fi, build the app and run
`powershell -File scripts/start-lan.ps1`. This computer processes the files;
each phone has a separate browser session. See [Wi-Fi setup and testing](docs/lan-testing.md).
Docker is optional; Kubernetes is not needed for this single-computer setup.

1. Open HAMMA and choose **Select Files** or **Select Folder**. You can also drag files into the workspace.
2. Wait for the operation to finish.
3. Choose **Download** to save your result.

To restore an archive, select its `.spk` file the same way. An archive containing
several files is restored as a ZIP that you can open with your usual file manager.
Already compressed files may not become smaller.

## Find your way around

- **Workspace** queues standard archive and media operations.
- **Files & History** combines downloads, job history, retention and the current SPK result.
- **Overview** combines processor and browser activity, status, and measured compression savings.
- **Settings** lets you change appearance, automatic downloads, history, privacy, and app cache.
- **About** introduces the project and its creator.

On a computer, Settings is at the bottom left. On a phone, use the bottom navigation.

## Your files and privacy

The local workspace is free and needs no account. Your files are processed on
your device. Standard file jobs transfer data only to the local service and use
temporary local disk storage. A temporary cookie isolates your guest session.
No private contents are sent to an AI service or third party.

The active workspace uses essential storage and does not expose a learning or
analytics opt-in. Historical optimizer components are separate from this path.
SPK history remembers file names and operation details; you can disable or clear
it separately. Standard job history and file retention are controlled in History.

**Download SPK results before closing the page.** Each result remains available
through subsequent operations until you delete it or close the page. Standard job
outputs stay on local disk until their expiry while the service runs. HAMMA is
not cloud storage. Clearing history or app cache never deletes downloaded copies.

## Want to run HAMMA yourself?

The [setup guide](docs/developer-guide.md) has installation instructions and
technical details for contributors. A hosted public download is not promised here.

## Creator and license

Made by **Onazi Treasure Oj**. Free and open source under the [MIT license](LICENSE).
