# ApiVault-3

**A personal, portable and fully offline API key manager for Windows.**
Built with [Tauri v2](https://v2.tauri.app/) (Rust) and plain HTML/CSS/JavaScript.

ApiVault-3 keeps your API keys (OpenRouter, OpenAI, Mistral, and so on) together
with the different URL variants of each provider, in a single `vault.json` file
sitting next to the executable. The keys are encrypted with AES-256-GCM using a
master password you choose; the URLs stay in plain text because they are not
secrets. The whole thing is a folder you can copy to a USB stick: no installer,
no registry entry, nothing written outside that folder, and no network access
at all.

---

## Table of contents

- [Screenshots](#screenshots)
- [Features](#features)
- [Security at a glance](#security-at-a-glance)
- [Requirements](#requirements)
- [Download](#download)
- [Build from source](#build-from-source)
- [Usage](#usage)
- [The `vault.json` format](#the-vaultjson-format)
- [Project layout](#project-layout)
- [Known limitations](#known-limitations)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Security](#security)
- [Licence](#licence)

---

## Screenshots

| Welcome screen | Master password |
| --- | --- |
| ![Welcome screen](screenshots/01-welcome.png) | ![Master password creation](screenshots/02-master-password.png) |

| Recovery phrase | Main screen (empty vault) |
| --- | --- |
| ![Recovery phrase](screenshots/03-recovery-phrase.png) | ![Empty main screen](screenshots/04-main-screen-empty.png) |

| Main screen with a provider | Settings |
| --- | --- |
| ![Main screen with a provider](screenshots/05-main-screen-with-provider.png) | ![Settings](screenshots/06-settings.png) |

| Plain text export warning | Portable folder |
| --- | --- |
| ![Plain text export warning](screenshots/07-export-clear.png) | ![Portable folder](screenshots/08-portable-folder.png) |

The screenshots are not part of the repository by default; see
[`screenshots/README.md`](screenshots/README.md) for the list of pictures to
add and how to name them.

---

## Features

**Keys and URLs**

- Providers sorted alphabetically, with a search box.
- Each provider holds several **URL variants**: a short label ("No version",
  "With /v1", "Embeddings endpoint") and the full address, each with a **Copy**
  button that copies the URL as is.
- Each provider holds several **API keys**: a short label ("Full Access",
  "Limited Models"), the encrypted value, a **Reveal** button and a **Copy**
  button.
- Provider names are **unique**: creating a duplicate is refused and a free name
  is suggested automatically ("OpenRouter 2").
- Adding, editing and deleting providers and keys, with their creation date
  (`DD/MM/YYYY`).

**Security**

- AES-256-GCM, **one random 12-byte IV per key**.
- PBKDF2-SHA256, **100,000 iterations**, random 16-byte salt.
- The master password is **never stored** - only a derivation proof.
- A random 32-byte **vault master key** encrypts the API keys, so changing the
  master password does not require re-encrypting every key.
- **24-word recovery phrase** that can reopen the vault if the master password
  is lost. The phrase itself is never stored.
- Automatic clipboard clearing after 30 seconds (optional), using the native
  Windows clipboard API so it works even when the window is in the background.
- Revealed values re-mask themselves after 30 seconds.
- No network access, no telemetry, nothing written outside the application
  folder.

**Portability**

- One `.exe` (about 2.7 MB) plus a `vault.json` file.
- Copy the folder to a USB stick, run `ApiVault-3.exe` anywhere.
- The WebView2 browser profile is redirected into `donnees-webview2/` inside the
  folder, so no data lands in `%APPDATA%` or `%LOCALAPPDATA%`.

**Unlock modes**

- **Mode A - Strict (default)**: the master password is asked on every launch.
- **Mode B - Comfort**: the derived key is remembered in `vault.json` so the
  application opens directly. Convenient, but anyone who gets the file can read
  the keys.

**Bilingual interface**

- French and English, detected from the system language and switchable in the
  settings; the choice is saved in `vault.json`.

**Import / export**

- Encrypted `.vaultbackup` (restorable with the master password).
- Plain text HTML page (readable tables) and plain text JSON, both behind a red
  warning and an explicit confirmation dialog.
- Import from a `.vaultbackup`, a plain JSON export, or a raw `vault.json`,
  either from the `exports/` subfolder or by pasting the content.

---

## Security at a glance

| Item | Where it lives |
| --- | --- |
| API keys | `vault.json`, **encrypted** (AES-256-GCM, one IV per key) |
| URL variants | `vault.json`, **plain text** (not secrets) |
| Master password | **never written to disk** |
| Derivation proof | `kdf.verify_hash` (PBKDF2-SHA256, 100,000 iterations) |
| Vault master key | `kdf.cle_maitre_chiffree` (wrapped by the password key) and `recuperation.cle_maitre_chiffree` (wrapped by the phrase key) |
| Recovery phrase | **never written to disk** |
| Network | **none** |

Full technical details: [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Requirements

**To run** (from a release, or from your own build):

| Component | Notes |
| --- | --- |
| Windows 10 or 11 | |
| Microsoft Edge WebView2 Runtime | Already present on Windows 11 and on most Windows 10 installations. If it is missing, install it once from <https://developer.microsoft.com/microsoft-edge/webview2/>. |

**To build from source**, additionally:

| Component | Notes |
| --- | --- |
| Rust (cargo, rustc) | <https://rustup.rs> - stable toolchain, MSVC target |
| Tauri CLI v2 | `cargo install tauri-cli --version "^2"` |
| Visual Studio Build Tools | "Desktop development with C++" workload (MSVC linker) |

No Node.js and no npm are required: the frontend is plain static files that
Tauri embeds in the executable.

---

## Download

Grab `apivault-3.exe` from the [latest release](../../releases/latest), put it in
an empty folder, and rename it to whatever you like (for example
`ApiVault-3.exe`). On first launch it creates `vault.json` next to itself.

> The executable is not code-signed, so Windows SmartScreen may warn you the
> first time. You can build it yourself from source with `build.bat` if you
> prefer.

---

## Build from source

Clone the repository and double-click **`build.bat`**, or from a terminal:

```bat
build.bat
```

The script compiles the application and copies the resulting executable to
`ApiVault-3.exe` in the project root. Expected output:

```
Termine : ApiVault-3.exe est pret a la racine du dossier.
```

Manual equivalent:

```bat
cd src-tauri
cargo tauri build
copy /Y "target\release\apivault-3.exe" "..\ApiVault-3.exe"
```

The first build takes about five minutes (it compiles the whole Tauri stack);
later builds take about a minute and a half.

More detail (including the GitHub Actions workflow):
[`docs/BUILD.md`](docs/BUILD.md).

---

## Usage

1. Double-click `ApiVault-3.exe`.
2. On first launch, choose **New vault**, pick a master password (12 characters
   minimum), then write down the **24-word recovery phrase** and tick the box.
3. Click **+ Add a provider**, then fill in:
   - the provider name (must be unique),
   - its **URL variants** (short label + full address),
   - its **API keys** (short label + value).
4. Use **Reveal** to display a key and **Copy** to put it (or a URL) in the
   clipboard.
5. **Lock** the vault when you are done, or just close the window.

Step-by-step guide with every screen: [`docs/USAGE.md`](docs/USAGE.md).

---

## The `vault.json` format

```json
{
  "version": 2,
  "mode": "strict",
  "kdf": {
    "salt": "<base64, 16 bytes>",
    "iterations": 100000,
    "verify_hash": "<base64>",
    "iv_cle_maitre": "<base64, 12 bytes>",
    "cle_maitre_chiffree": "<base64>"
  },
  "parametres": {
    "effacement_presse_papiers": true,
    "langue": "en"
  },
  "fournisseurs": [
    {
      "id": "uuid",
      "nom": "OpenRouter 1",
      "urls": [
        { "libelle": "No version", "adresse": "https://openrouter.ai/api" },
        { "libelle": "With /v1", "adresse": "https://openrouter.ai/api/v1" }
      ],
      "cles": [
        {
          "libelle": "Full Access",
          "iv": "<base64, 12 bytes>",
          "valeur_chiffree": "<base64>",
          "date_ajout": "15/10/2026"
        }
      ]
    }
  ],
  "recuperation": {
    "sel_phrase": "<base64, 16 bytes>",
    "iterations": 100000,
    "iv": "<base64, 12 bytes>",
    "cle_maitre_chiffree": "<base64>"
  }
}
```

- Keys are encrypted, URLs are not.
- `recuperation` is absent when phrase recovery is not enabled.
- `mode` is `strict` or `confort`; in `confort`, `kdf.cle_memorisee` holds the
  derived unlock key.
- Field names are in French: the format was defined that way in the original
  specification and is kept for backward compatibility.

Vaults written by earlier versions (`version: 1`, keys encrypted directly with
the password-derived key, no `kdf.iv_cle_maitre` and no `recuperation`) are
still supported. **Settings -> Phrase recovery -> Enable phrase recovery**
upgrades such a vault to version 2.

---

## Project layout

```
.
├── build.bat              Build script (cargo tauri build + copy)
├── README.md              This file
├── README.fr.md           French version
├── LICENSE                MIT
├── src/                   Frontend (plain HTML/CSS/JS)
│   ├── index.html
│   ├── style.css
│   ├── app.js             Interface logic, vault model, exports/imports
│   ├── crypto.js          PBKDF2, AES-256-GCM, vault master key, recovery
│   ├── bip39.js           Recovery phrase generation and validation
│   ├── i18n.js            Translation engine
│   └── i18n/{fr,en}.json  Translation dictionaries
├── src-tauri/             Rust side (Tauri)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   ├── icons/
│   └── src/main.rs        Entry point, file and clipboard commands
├── docs/                  Architecture, security, build, usage
├── screenshots/           Screenshots used by this README
└── .github/workflows/     GitHub Actions build workflow
```

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Known limitations

- **Not code-signed**: Windows SmartScreen may warn on first launch.
- **Windows only** for now: the clipboard helper calls the Win32 clipboard API.
  The frontend and the crypto layer are platform independent, so other platforms
  are mostly a matter of replacing that helper.
- **No single-instance guard**: two copies running at once both write
  `vault.json`; the last writer wins.
- **Keys are in memory while the vault is open**: malware running on the same
  machine at that moment can read them.
- **The plain text exports are dangerous by nature**: they contain the keys
  without encryption. They are written to `exports/` and must be deleted after
  use.
- **In Mode B, `vault.json` is enough to read everything** - that is the trade-off
  of not typing the password.

---

## Documentation

| Document | Content |
| --- | --- |
| [docs/USAGE.md](docs/USAGE.md) | Detailed user guide |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit together |
| [docs/SECURITY.md](docs/SECURITY.md) | Cryptographic details and threat model |
| [docs/BUILD.md](docs/BUILD.md) | Building from source, CI, troubleshooting |
| [CHANGELOG.md](CHANGELOG.md) | Release history |

---

## Contributing

Pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first:
it is short and covers the branch naming, the "no hardcoded UI string" rule and
the "no new dependency" spirit of the project. All participants are expected to
follow the [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Security

Please report vulnerabilities privately - see [SECURITY.md](SECURITY.md). Never
open a public issue containing a real key, password or `vault.json`.

---

## Licence

[MIT](LICENSE) - Copyright (c) 2026 ApiVault contributors.
