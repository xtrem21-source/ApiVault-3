# Architecture

## Overview

ApiVault-3 is a [Tauri v2](https://v2.tauri.app/) desktop application:

- a **Rust** binary (`src-tauri/`) that owns the window, the filesystem access
  and the clipboard;
- a **plain HTML/CSS/JavaScript** frontend (`src/`) rendered by the WebView2
  engine, which owns the user interface and *all* cryptography.

There is no server, no background service, no database and no network code
anywhere in the project.

```
            +------------------------------------------------------+
            |  ApiVault-3.exe  (one process)                        |
            |                                                       |
            |  +-------------------+      +----------------------+  |
            |  |  Rust / Tauri     |      |  WebView2 (Chromium) |  |
            |  |                   |      |                      |  |
            |  |  window + config  |      |  index.html          |  |
            |  |  10 IPC commands  |<---->|  style.css           |  |
            |  |  clipboard (Win32)|      |  app.js   logic      |  |
            |  |                   |      |  crypto.js  AES/GCM  |  |
            |  +---------+---------+      |  bip39.js  phrase    |  |
            |            |                |  i18n.js   texts     |  |
            +------------|----------------+----------+-----------+  |
                         |                           |
                         v                           v
              +---------------------+     +------------------------+
              |  vault.json         |     |  Web Crypto API        |
              |  exports/           |     |  (PBKDF2 + AES-GCM,    |
              |  donnees-webview2/  |     |   inside WebView2)     |
              +---------------------+     +------------------------+
                 all inside the application folder
```

## Why this split

- **Cryptography in the frontend**: the Web Crypto API is a well-audited,
  constant-time implementation provided by the browser engine; using it avoids
  pulling a Rust crypto crate into the build.
- **Files and clipboard in Rust**: the frontend has no filesystem permission at
  all. It cannot read or write anything on its own; every file access goes
  through a command that is restricted to the application folder.
- **No Tauri plugin**: the project depends on `tauri` only. The filesystem and
  clipboard features are implemented as ten small commands.

## Rust side (`src-tauri/`)

| File | Role |
| --- | --- |
| `src/main.rs` | Everything: window creation, the ten commands, the Win32 clipboard helpers |
| `tauri.conf.json` | Product name, identifier, static frontend, CSP, `bundle.active: false` |
| `build.rs` | `tauri_build::build()` |
| `capabilities/default.json` | Minimal permissions (`core:default`) for the `main` window |
| `Cargo.toml` | `tauri` and `tauri-build`, pinned versions, size-optimised release profile |
| `icons/` | Multi-size `icon.ico` (7 sizes) and the PNGs referenced by the config |

### IPC commands

All ten commands are declared in `src/main.rs`. Error strings are in English
(the frontend translates them for display).

| Command | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `dossier_app` | - | `String` | Folder containing the executable |
| `chemin_du_vault` | - | `String` | Full path of `vault.json` |
| `lire_vault` | - | `Option<String>` | `None` on first launch |
| `ecrire_vault` | `contenu` | `()` | Atomic: temporary file, then rename |
| `lister_exports` | - | `Vec<String>` | Sorted file names in `exports/` |
| `lire_export` | `nom` | `String` | File name validated by `chemin_export` |
| `ecrire_export` | `nom`, `contenu` | `String` | Creates `exports/` if needed, returns the path |
| `supprimer_export` | `nom` | `()` | |
| `copier_presse_papiers` | `texte` | `bool` | Win32 clipboard write |
| `vider_presse_papiers` | `attendu` | `String` | `"vide"`, `"conserve"` or `"echec"` |

`chemin_export(nom)` rejects anything that could escape the folder: empty names,
names longer than 120 characters, `..`, `/`, `\`, `:`, and any character outside
`[A-Za-z0-9._-]`.

### Portability

`tauri.conf.json` declares no window, so the single window is built in `main()`
where its data directory can be forced:

```rust
WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
    .data_directory(profil.clone())   // <exe dir>/donnees-webview2
```

Without this, Tauri would put the WebView2 profile in
`%LOCALAPPDATA%\<identifier>`. The `WEBVIEW2_USER_DATA_FOLDER` environment
variable is set as a second line of defence. `bundle.active` is `false`, so
`cargo tauri build` produces a plain executable instead of an installer, and no
packaging tool (and therefore no download) is needed.

The Content Security Policy is restrictive:

```
default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline';
script-src 'self'; connect-src 'self' ipc: http://ipc.localhost
```

No remote origin is allowed, so even a hypothetical injected string could not
fetch anything.

## Frontend (`src/`)

| File | Role |
| --- | --- |
| `index.html` | All screens as `<section class="ecran">` blocks, plus the generic modal. Every visible string carries a `data-i18n*` attribute. |
| `style.css` | Single stylesheet, dark theme, no external font or asset. |
| `app.js` | State machine, vault model, rendering, providers, settings, exports, imports, clipboard policy, event wiring. |
| `crypto.js` | Conversions, PBKDF2 derivation, AES-256-GCM, vault master key wrapping, recovery phrase key derivation. |
| `bip39.js` | The 2048-word list, phrase generation, phrase normalisation and validation. |
| `i18n.js` | Dictionary loading, language detection, `t()` / `tPluriel()`, DOM translation, technical error translation. |
| `i18n/fr.json`, `i18n/en.json` | 288 keys each, exactly the same key set. |

### Screens

`ecran-bienvenue`, `ecran-creation-mdp`, `ecran-phrase`,
`ecran-import-bienvenue`, `ecran-connexion` (with two tabs), `ecran-principal`,
`ecran-parametres`. `afficherEcran(id)` toggles the `.actif` class; the generic
modal (`fond-modale`) is reused by every dialog.

### State

A single module-level object:

| Field | Meaning |
| --- | --- |
| `vault` | The in-memory image of `vault.json`; keys are **always** ciphertext |
| `cle` | The `CryptoKey` used to encrypt/decrypt API keys (non-extractable) |
| `cleMaitre` | Raw bytes of the effective key, kept only to enable Mode B |
| `materielMotDePasse` | PBKDF2 output of the password, when it has been typed |
| `phraseTemporaire` | The recovery phrase while it is displayed, cleared afterwards |
| `derniereCopie` | Last copied value, so the clipboard is only cleared if unchanged |
| `minuteurPresse`, `minuteursMasquage` | Timers for clipboard clearing and re-masking |

`verrouiller()` and the `beforeunload` handler zero the byte arrays and drop the
references.

## Crypto design

See [SECURITY.md](SECURITY.md) for the full detail. The essential shape:

```
master password --PBKDF2-SHA256(100000, salt)--> password key
                                                      |
                                                      v  AES-256-GCM
                                          kdf.cle_maitre_chiffree  -> vault master key (32 random bytes)
                                                                        |
                                                                        v  AES-256-GCM, one IV per key
                                                                   API keys

recovery phrase --PBKDF2-SHA256(100000, sel_phrase)--> phrase key
                                                      |
                                                      v  AES-256-GCM
                                          recuperation.cle_maitre_chiffree -> same vault master key
```

Two wrapping paths, one working key. This is what makes the recovery phrase
survive a master password change.

## Format versions

| Version | Layout | Unlock |
| --- | --- | --- |
| 1 | API keys encrypted directly with the password-derived key; `kdf` has `salt`, `iterations`, `verify_hash` only | password only |
| 2 | API keys encrypted with a random vault master key; `kdf` also has `iv_cle_maitre` and `cle_maitre_chiffree`; optional `recuperation` block | password and/or recovery phrase |

`normaliserVault()` upgrades the in-memory representation transparently, and
`aUneCleMaitre(vault)` decides which path applies. A version 1 vault is only
converted to version 2 when the user enables phrase recovery (the API keys are
then re-encrypted with a fresh master key).

## Bilingual interface

- Detection order: value saved by the application (localStorage, stored in the
  WebView2 profile inside the application folder), then `navigator.languages`,
  then French.
- When a vault is opened, `parametres.langue` from `vault.json` takes precedence.
- Both dictionaries are loaded at start-up: the English one doubles as the
  reference table used to translate the English error strings coming from Rust.
- A translation is applied to the whole document by `appliquerTraductions()`;
  dynamic parts are re-rendered by `rafraichirTextesDynamiques()`.

## Data flow examples

**Unlocking**

1. `lire_vault` returns the raw JSON.
2. `normaliserVault()` builds the model.
3. `ouvrirAvecMotDePasse()` derives the key, compares `verify_hash`, unwraps
   `cle_maitre_chiffree`, and returns both the master key and the effective key.
4. `entrerDansApplication()` renders the providers.

**Adding a key**

1. The modal collects the label and the value.
2. `chiffrerValeur()` encrypts the value with a fresh IV.
3. `sauvegarderVault()` serialises the model (ciphertext only) to `vault.json`.

**Plain text export**

1. A red confirmation dialog is shown first.
2. Every key is decrypted one by one and written into a generated document.
3. The document is written to `exports/` by `ecrire_export`.
