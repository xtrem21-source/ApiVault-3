# Contributing to ApiVault-3

Thanks for taking the time to contribute. This document is intentionally short.

## Getting started

1. **Fork** the repository and clone your fork.
2. Create a branch with a descriptive name:
   - `feat/short-description` for a new feature
   - `fix/short-description` for a bug fix
   - `docs/short-description` for documentation only
3. Build the project with `build.bat` (or see [docs/BUILD.md](docs/BUILD.md)).
4. Make your change, then test it in the running application: this project has
   no automated test suite, so a change is only considered ready when it has
   been exercised in the real executable (create a vault, add a provider and a
   key, lock and unlock, and so on).
5. Open a **pull request** against the default branch, describing:
   - what the change does and why;
   - how you tested it;
   - anything that still needs attention.

## Conventions

- **Language**: code comments, commit messages and PR titles are written in
  **English**. (The historical code comments in the frontend were written in
  French without accents; new comments should be English.)
- **Interface text**: never hardcode a user-visible string. Every text must go
  through `src/i18n/fr.json` and `src/i18n/en.json`, and both files must always
  define exactly the same keys. Use `t("key")` in JavaScript and
  `data-i18n="key"` in HTML.
- **Frontend**: plain HTML/CSS/JavaScript, no framework, no bundler and no npm
  dependency. Keep it that way.
- **Rust**: keep dependencies minimal. The project uses `tauri` and
  `tauri-build` only. If you need a new crate, explain why in the PR.
- **No network access at runtime**: the application must never open a
  connection, and must never write outside its own folder.
- **Secrets**: never commit `vault.json`, an export, or any file containing a
  real API key. Use throwaway values for screenshots.
- **Commits**: use [Conventional Commits](https://www.conventionalcommits.org/)
  style prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`).

## Security

Please do not open a public issue for a vulnerability: see
[SECURITY.md](SECURITY.md) for the reporting process.

## Licence

By contributing, you agree that your contributions are licensed under the MIT
Licence (see [LICENSE](LICENSE)).
