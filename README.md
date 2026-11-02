# HAMMA

**Make space. Keep everything.**

A free local workspace to compress, extract, convert, and download files.
Created by **Onazi Treasure Oj**.

## Run the new file workspace

```sh
npm ci
npm run start:local
```

Open http://127.0.0.1:5010. Requires Node.js 22+, Python 3.11+, and optional
FFmpeg/FFprobe for media conversion. Jobs run in local background processes.
Standard ZIP/TAR/GZIP/BZIP2/XZ operations, verified downloads, resumable uploads,
retry/cancel controls and 500-record guest history are implemented. The existing
browser-only workflow is inside **Workspace / SPK tools**.

See [supported formats, deployment and operational limits](docs/universal-processing.md).
This local implementation does not yet provide accounts, synchronized storage,
encryption at rest, distributed workers or validated multi-terabyte processing.

## Use the SPK browser workflow

1. Open HAMMA and choose **Select Files** or **Select Folder**. You can also drag files into the workspace.
2. Wait for the operation to finish.
3. Choose **Download** to save your result.

To restore an archive, select its `.spk` file the same way. An archive containing
several files is restored as a ZIP that you can open with your usual file manager.
Already compressed files may not become smaller.

## Find your way around

- **Workspace** queues standard archive and media operations.
- **SPK tools** inside Workspace compresses and restores SPK files in your browser.
- **Files & History** combines downloads, job history, retention and the current SPK result.
- **History** helps you find recent operations by file name.
- **Overview** shows how much space your recorded compressions saved.
- **Settings** lets you change appearance, automatic downloads, history, privacy, and app cache.
- **About** introduces the project and its creator.

On a computer, Settings is at the bottom left. On a phone, use the bottom navigation.

## Your files and privacy

The local workspace is free and needs no account. Your files are processed on
your device. Standard file jobs transfer data only to the local service and use
temporary local disk storage. A temporary cookie isolates your guest session.
No private contents are sent to an AI service or third party.

Optional local learning remembers size and timing measurements on this browser.
It starts off. You can enable it, turn it off, or clear it in Settings.
SPK history remembers file names and operation details; you can disable or clear
it separately. Standard job history and file retention are controlled in History.

**Download SPK results before closing the page or starting again.** Standard job
outputs stay on local disk until their expiry while the service runs. HAMMA is
not cloud storage. Clearing history or app cache never deletes downloaded copies.

## Want to run HAMMA yourself?

The [setup guide](docs/developer-guide.md) has installation instructions and
technical details for contributors. A hosted public download is not promised here.

## Creator and license

Made by **Onazi Treasure Oj**. Free and open source under the [MIT license](LICENSE).
