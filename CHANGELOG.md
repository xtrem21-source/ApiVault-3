# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-15

First public release.

### Added

- **Portable API key manager** built with Tauri v2 (Rust) and plain
  HTML/CSS/JavaScript (no frontend framework, no npm dependency).
- **Providers** with a unique name, a list of **URL variants** (short label +
  full address) and a list of **API keys** (short label + value, with add date).
- **Alphabetical sorting**, search box, add / edit / delete, and duplicate name
  detection with an automatic rename suggestion.
- **Encryption**: AES-256-GCM with a random 12-byte IV per key. The keys are
  encrypted with a random 32-byte **vault master key**, which is itself
  encrypted (wrapped) by the key derived from the master password.
- **Key derivation**: PBKDF2-SHA256, 100,000 iterations, random 16-byte salt.
  The master password is never stored; only a derivation proof (`verify_hash`)
  is.
- **24-word recovery phrase** (2048-word French word list without accents,
  derived from the official BIP39 French list). The phrase wraps the vault
  master key, so it can reopen the vault if the master password is lost. The
  phrase itself is never stored.
- **Two unlock modes**: Mode A - Strict (master password asked on every launch)
  and Mode B - Comfort (the derived key is remembered in `vault.json`).
- **"Enable phrase recovery"** action for existing vaults, including automatic
  migration of vaults created by earlier versions (format 1 to format 2).
- **Bilingual interface (French / English)**, automatic detection from the
  system language, language selector in the settings, saved in
  `vault.json` (`parametres.langue`).
- **Exports**: encrypted `.vaultbackup` (master password required), plain text
  HTML page with a red warning banner, plain text JSON. A confirmation dialog
  is shown before any plain text export.
- **Imports**: `.vaultbackup`, plain JSON export, or a raw `vault.json`. Import
  by file (from the `exports/` subfolder) or by pasting the content.
- **Clipboard hygiene**: automatic clipboard clearing 30 seconds after a copy
  (optional, on by default), using the native Windows clipboard API so it also
  works when the window has lost focus. The clipboard is only cleared if it
  still holds the copied value.
- **Revealed values re-mask themselves** after 30 seconds.
- **Strictly local**: no network access at runtime, nothing written outside the
  application folder (the WebView2 profile is redirected into
  `donnees-webview2/`).
- **Atomic writes** of `vault.json` (temporary file then rename), so an
  interrupted write can never truncate the vault.
- **Documentation**: `README.md`, `README.fr.md`, `docs/ARCHITECTURE.md`,
  `docs/SECURITY.md`, `docs/BUILD.md`, `docs/USAGE.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`.
- **GitHub Actions workflow** (`.github/workflows/build.yml`) that builds the
  Windows executable on every `v*` tag and attaches it to the release.

### Known limitations

- The Windows executable is not code-signed: Windows SmartScreen may show a
  warning on first launch.
- Only Windows is supported for now (the clipboard helper uses the Win32
  clipboard API). The frontend and the crypto layer are platform independent.
- No single-instance guard: two copies running at the same time both write
  `vault.json` (last writer wins).
- All API keys are kept in memory, decrypted, while the vault is unlocked.

[1.0.0]: https://github.com/OWNER/ApiVault-3/releases/tag/v1.0.0
