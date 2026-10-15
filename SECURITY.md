# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Use GitHub's private vulnerability reporting instead:

1. Open the **Security** tab of the repository.
2. Click **Report a vulnerability**.
3. Describe the issue, including:
   - what an attacker can achieve,
   - the steps to reproduce it,
   - the version of ApiVault-3 and of Windows you used,
   - whether a `vault.json` file was involved.

If private reporting is not available, open a minimal public issue asking the
maintainers to contact you privately, and **do not include any details or
secrets in it**.

## What to expect

- Acknowledgement within a few days.
- An assessment and, when the report is valid, a fix in a patch release with
  credit to the reporter (unless you prefer to stay anonymous).

## Please never include in a report

- a real API key, a master password, or a recovery phrase;
- a real `vault.json`, `.vaultbackup` or plain text export.

If a proof of concept is needed, reproduce it with a vault created for that
purpose, using dummy keys.

## Scope

In scope:

- the encryption design and its implementation
  (`src/crypto.js`, `src/app.js`, `src-tauri/src/main.rs`);
- the handling of secrets in memory, on disk and in the clipboard;
- anything that could make the application read or write files outside its own
  folder, or open a network connection;
- the format of `vault.json` and of the exports.

Out of scope:

- an attacker who already controls the machine and can read the process memory
  while the vault is unlocked;
- a weak master password chosen by the user;
- the absence of code signing (Windows SmartScreen warnings) - see the README.

For the technical details of the cryptography, see
[docs/SECURITY.md](docs/SECURITY.md).
