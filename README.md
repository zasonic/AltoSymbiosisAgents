# altosybioagents

Build AI teams that work together on your desktop. Chat with Claude and
local models, create specialist agents, index your files, and keep
everything on your machine.

## Install

Download the latest installer from
[Releases](https://github.com/zasonic/altosybioagents/releases) and double-click.
No system Python or Node is required — on first launch the app downloads
Miniconda and creates its own Python environment under `%APPDATA%`.

**First launch requires internet** to download ~600 MB (Miniconda + Python
dependencies). The download takes about 5 minutes on a typical connection.
Subsequent launches work offline.

**Windows x64 only** in this release. macOS and Linux installers are
tracked for a future release. macOS / Linux developers can still run from
source — see [Run](#run) below.

You will need:
- An [Anthropic API key](https://console.anthropic.com/settings/keys).
- [Ollama](https://ollama.com/download) or [LM Studio](https://lmstudio.ai/)
  for local models (optional but recommended — keeps simple messages free).
  Local engines bundled with the installer return in the next release.

## Trust

The installer is **not code-signed**. Windows shows "Windows protected
your PC" on first run — click **More info → Run anyway**. See
[docs/img/smartscreen.png](docs/img/smartscreen.png) for the exact
dialog. Subsequent launches go straight to the app.

If you're a cautious user:

- Source is here on GitHub. License: [MIT](LICENSE).
- Security boundaries, threat model, and reporting: [SECURITY.md](SECURITY.md).
- Build the installer from this commit and check the SHA256 matches the
  one in the release notes: [docs/DEVELOPMENT.md → Reproducible builds](docs/DEVELOPMENT.md).

## Run

Open the app, paste your API key in Settings, and start chatting. Messages
route automatically: simple turns go to a local model when one is available,
complex turns go to Claude.

For developers: install [Node 20+](https://nodejs.org/) and clone the repo.
On Windows, double-click `dev\dev.bat`; on macOS / Linux, run
`npm install && npm run dev`. Python is **not** required to run `npm run dev`
— the bootstrap install (Miniconda + sidecar venv) happens inside the
running Electron app the first time you launch it. To run the backend pytest
suite directly, set up a Python 3.12 venv at `backend/.venv` and
`pip install -r backend/requirements.txt`.

```
dev\dev.bat                  # install + dev (Windows)
npm install && npm run dev   # install + dev (macOS / Linux, dev only)
dev\build-installer.bat      # produce NSIS installer (Windows)
```

## Where things live

- App data: `%APPDATA%/altosybioagents/` on Windows,
  `~/Library/Application Support/altosybioagents/` on macOS,
  `~/.config/altosybioagents/` on Linux. Settings, SQLite database, logs,
  and the bundled Python environment (`bin/miniconda/`, `bin/sidecar-venv/`)
  all live there. The API key is in the OS keyring, not on disk.
- Source layout: `desktop-ui/` (React renderer), `desktop-shell/` (Electron
  main + preload, including `bootstrap/` for the first-launch installer),
  `backend/` (Python FastAPI sidecar — pip-installable package), `branding/`
  (icon), `dev/` (developer scripts), `legacy/` (kept-for-one-release
  PyInstaller artifacts, deleted in v1.0.1).

Deeper docs:
- [docs/USER-GUIDE.md](docs/USER-GUIDE.md) — features and how to use them.
- [docs/architecture.md](docs/architecture.md) — services, schemas, IPC.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — dev setup and build flow.
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — common errors.
- [docs/FAQ.md](docs/FAQ.md) — common questions.
- [docs/legacy.md](docs/legacy.md) — pre-v6 code lives on the legacy/v5 branch.
- [CHANGELOG.md](CHANGELOG.md) — user-facing changes per release.

MIT — see [LICENSE](LICENSE).
