# Building from source

## Prerequisites

| Component | Version used | Notes |
| --- | --- | --- |
| Windows | 10 or 11 | |
| Rust | stable (1.99 tested), MSVC target | install from <https://rustup.rs> |
| Visual Studio Build Tools | 2022 | workload **Desktop development with C++** (provides the MSVC linker) |
| Tauri CLI | 2.x (2.12 tested) | `cargo install tauri-cli --version "^2"` |
| Microsoft Edge WebView2 Runtime | any recent | needed to *run* the application, already present on Windows 11 |

Check your setup:

```bat
cargo --version
rustc --version
cargo tauri --version
```

If `cargo tauri` is unknown, the CLI is not installed yet:

```bat
cargo install tauri-cli --version "^2"
```

**Node.js and npm are not required.** The frontend is a set of static files that
Tauri embeds into the executable at compile time; there is no bundler and no
`node_modules` folder.

## Building with the script

From the project root, double-click **`build.bat`** or run:

```bat
build.bat
```

What it does:

1. checks that `cargo` is available;
2. runs `cargo tauri build` inside `src-tauri/`;
3. looks for the produced executable (`ApiVault-3.exe` or `apivault-3.exe`);
4. copies it to `ApiVault-3.exe` in the project root.

Expected output:

```
============================================================
 ApiVault-3 - construction du .exe portable
============================================================

Compilation en cours, cela peut prendre plusieurs minutes...

   Compiling apivault-3 v1.0.0 (...)
    Finished `release` profile [optimized] target(s) in 1m 34s
       Built application at: ...\src-tauri\target\release\apivault-3.exe

============================================================
 Termine : ApiVault-3.exe est pret a la racine du dossier.
============================================================
```

The first build takes around **five minutes**: it compiles the whole Tauri
dependency tree. Incremental builds take about **a minute and a half**.

## Building manually

```bat
cd src-tauri
cargo tauri build
copy /Y "target\release\apivault-3.exe" "..\ApiVault-3.exe"
```

`cargo build --release` inside `src-tauri/` works too and produces the same
executable; `cargo tauri build` simply adds the Tauri configuration checks.

## Why no installer is produced

`tauri.conf.json` contains:

```json
"bundle": {
  "active": false,
  "targets": [],
  "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.ico"]
}
```

With `bundle.active: false`, no MSI or NSIS installer is generated. This keeps
the deliverable a single portable executable **and** avoids the bundler having
to download a packaging tool on first use, so a build works fully offline.

## Release profile

The binary is deliberately small (about 2.7 MB). `src-tauri/Cargo.toml`
configures:

```toml
[profile.release]
opt-level = "z"      # optimise for size
lto = true           # link-time optimisation
codegen-units = 1    # better optimisation, slower build
panic = "abort"      # no unwinding tables
strip = true         # remove debug symbols
incremental = false
```

If you need faster iteration while working on the Rust side, `cargo tauri dev`
uses the debug profile and is much quicker.

## Continuous integration

`.github/workflows/build.yml` builds the executable on GitHub runners:

- triggered by a `v*` tag push, or manually through **workflow_dispatch**;
- runs on `windows-latest`;
- installs Rust, Node.js 20 and the Tauri CLI;
- caches `~/.cargo` and `src-tauri/target`;
- runs `cargo tauri build` with `working-directory: src-tauri`;
- uploads `src-tauri/target/release/*.exe` as the `ApiVault-windows` artifact;
- on a tag, creates a GitHub release and attaches the executable.

To publish a new version:

```bat
git tag v1.0.0
git push origin v1.0.0
```

Because `bundle.active` is `false`, the artifact is named `apivault-3.exe`
(the Cargo binary name). Rename it to `ApiVault-3.exe` when attaching it to a
release if you prefer that name.

## Troubleshooting

| Message | Cause and fix |
| --- | --- |
| `error: linker 'link.exe' not found` | Visual Studio Build Tools are missing. Install the **Desktop development with C++** workload. |
| `'cargo' is not recognized` | Rust is not installed, or the terminal was opened before the installation. Install from <https://rustup.rs> and reopen the terminal. |
| `error: no such command: tauri` | `cargo install tauri-cli --version "^2"` |
| The build stops with `failed to fetch` | The machine has no access to crates.io. The dependency tree has to be fetched once; `Cargo.lock` is committed so the resolution itself is reproducible. |
| `The system cannot find the file specified` while copying | The executable name changed. Look in `src-tauri\target\release\` and adjust `build.bat`. |
| The window opens on a white page | The WebView2 Runtime is missing. Install it once from <https://developer.microsoft.com/microsoft-edge/webview2/>. |
| The application refuses to start again right after a build | A previous instance is still running and holds the executable. Close it, then build. |

## Clean rebuild

`src-tauri\target\` is regenerated; deleting it always works and is the
recommended way to free a gigabyte or two:

```bat
rmdir /s /q src-tauri\target
build.bat
```

## Verifying a build

After building, the following should hold:

- `ApiVault-3.exe` is smaller than 10 MB;
- starting it in an empty folder shows the welcome screen without a
  `vault.json` file;
- it creates `donnees-webview2/` **inside** its own folder, and nothing appears
  in `%APPDATA%` or `%LOCALAPPDATA%`;
- creating a vault writes a `vault.json` whose `fournisseurs[].cles[]` entries
  contain `iv` and `valeur_chiffree`, never a readable key.
