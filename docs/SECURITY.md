# Cryptographic details and threat model

This document describes exactly what ApiVault-3 protects, how, and what it does
not protect. Everything below is implemented with the Web Crypto API of the
embedded WebView2 engine (`src/crypto.js`); no third-party cryptography library
is used.

## 1. Threat model

**Protected against**

- Someone who obtains a copy of `vault.json` (stolen USB stick, shared folder,
  backup) but does not know the master password and does not have the recovery
  phrase.
- Offline brute-force of a reasonably strong master password.
- Tampering with `vault.json`: every encrypted value is authenticated, so a
  modified ciphertext fails to decrypt instead of producing wrong data.
- Silent leaking of secrets over the network: the application contains no
  network code, and the window CSP forbids remote origins.
- Secrets staying in the clipboard forever: it is cleared after 30 seconds.

**Not protected against**

- Malware running on the machine while the vault is open (keys are decrypted in
  memory at that moment).
- A keylogger or screen capture.
- A weak master password (see section 8).
- Mode B: when the derived key is stored in `vault.json`, the file alone is
  enough to read everything.
- The plain text exports (`.html` and `.json`), which contain the keys in clear
  by design.

## 2. Parameters

| Constant | Value | Where |
| --- | --- | --- |
| Key derivation | PBKDF2-HMAC-SHA256 | `deriverMatiere()` |
| Iterations | 100,000 | `ITERATIONS_PBKDF2` |
| Salt length | 16 bytes, `crypto.getRandomValues` | `TAILLE_SALT` |
| Derived material | 32 bytes | `TAILLE_CLE` |
| Symmetric cipher | AES-256-GCM | `matiereVersCle()`, `chiffrerValeur()` |
| IV length | 12 bytes, random per operation | `TAILLE_IV` |
| Authentication tag | 16 bytes (appended by the Web Crypto API) | - |
| Vault master key | 32 random bytes | `genererCleMaitre()` |
| Recovery phrase | 24 words from a 2048-word list | `genererPhraseRecuperation()` |
| Format version | 2 | `VERSION_FORMAT` |

## 3. Deriving the password key

```
material       = PBKDF2-SHA256(password, salt, 100000, 32 bytes)
password key   = AES-256-GCM key imported from `material`, non-extractable
verify_hash    = base64( SHA-256( material || "ApiVault-3|preuve-de-derivation|v1" ) )
```

- The password itself is never stored, in any form.
- `verify_hash` is a separate hash, not the key: it lets the application tell a
  wrong password from a corrupted vault without keeping anything that could be
  replayed as a key. The fixed label guarantees the proof is not equal to
  anything that might be used as a key.
- The password key is imported with `extractable = false`, so JavaScript cannot
  read its bytes back out of the `CryptoKey` object.

## 4. The vault master key

Since format version 2, API keys are not encrypted with the password key
directly. A random 32-byte **vault master key** (VMK) is generated when the
vault is created, and it is the key that actually encrypts the API keys.

The VMK is stored only in encrypted form, twice:

| Path | Field | Wrapped with |
| --- | --- | --- |
| Password | `kdf.cle_maitre_chiffree` (+ `kdf.iv_cle_maitre`) | the password key |
| Recovery phrase | `recuperation.cle_maitre_chiffree` (+ `recuperation.iv`) | the phrase key |

Why this indirection: the recovery phrase must keep working after a master
password change. If the phrase wrapped the password-derived key instead, a
password change would invalidate it, because the phrase is not available at that
moment. With a stable VMK:

- **changing the master password** re-wraps the VMK with the new password key
  (new salt, new proof) and leaves the API keys untouched;
- **regenerating the recovery phrase** replaces the phrase wrapping and leaves
  both the VMK and the API keys untouched.

Wrapping is done by `emballerCleMaitre()`, which encrypts the base64 text of the
VMK with the wrapping key. The wrapping IV is stored alongside the ciphertext.

## 5. Encrypting each API key

```
{valeur_chiffree, iv} = AES-256-GCM(vault master key, plaintext = the API key)
```

- A **fresh random 12-byte IV** is generated for every value
  (`crypto.getRandomValues`) - never reused, never derived from a counter.
- The 16-byte GCM tag is appended to the ciphertext by the Web Crypto API, so
  the stored value is `ciphertext || tag`. Decryption fails loudly on any
  modification.
- Only the base64 of the IV and of that blob is stored; `vault.json` is pure
  ASCII.
- One IV per key means two identical keys produce two different ciphertexts.

## 6. The recovery phrase

- 24 words drawn uniformly (`indiceAleatoire()`, rejection sampling to avoid
  modulo bias) from a **2048-word list**. Entropy:
  `24 x log2(2048) = 264 bits`.
- The list is the official BIP39 French word list with the accents removed
  (2048 words, no duplicates, `[a-z]` only), so a phrase can be typed on any
  keyboard and stored in any encoding.
- The phrase is **never written to disk**. Only `recuperation`, which contains
  no information about the phrase other than the wrapped VMK, is stored.
- Input is normalised before derivation: NFD decomposition, combining marks
  removed, lower-cased, everything that is not a letter turned into a separator,
  repeated spaces collapsed (`normaliserPhraseSaisie()`). Case, accents and
  line breaks therefore do not matter.
- `verifierPhrase()` checks the word count (exactly 24) and reports unknown
  words before any derivation is attempted.
- The phrase key is derived with **its own randomly generated salt**
  (`recuperation.sel_phrase`, 16 bytes) and 100,000 iterations, recorded as
  `recuperation.iterations` so the block stays self-describing if the constant
  is ever raised.

## 7. Storage, memory and clipboard

- `vault.json` is written atomically (temporary file, then rename), so an
  interrupted write cannot truncate it.
- Only ciphertext, base64 IVs, salts, the derivation proof, provider names and
  URLs are ever written. Naming and URLs are not secrets by design.
- `etat.cle` holds a non-extractable `CryptoKey`; the raw bytes
  (`etat.cleMaitre`) are kept only so Mode B can store them, and are zeroed by
  `verrouiller()` and by the window's `beforeunload` handler.
- The clipboard is written and cleared through the **native Win32 API**
  (`OpenClipboard`, `SetClipboardData`, `EmptyClipboard`) rather than
  `navigator.clipboard`, because the browser API refuses to work once the window
  has lost focus - which is precisely the situation 30 seconds later. The
  clipboard is only emptied if it still contains the value the application put
  there; a value copied in another program in the meantime is never destroyed.
- Revealed values are re-masked after 30 seconds.

## 8. Strength of the master password

The only thing standing between `vault.json` and the API keys is the master
password. PBKDF2 at 100,000 iterations makes a serious dictionary attack
expensive, but it cannot rescue a short or common password.

Reasonable guidance: a passphrase of at least four unrelated words, or 16+
characters mixing cases, digits and symbols. The application enforces a 12
character minimum and shows a strength gauge, but a minimum is not a
recommendation.

## 9. Threat model of the two unlock modes

| | Mode A - Strict | Mode B - Comfort |
| --- | --- | --- |
| Password asked | every launch | never (after the first) |
| Stored in `vault.json` | salt, iterations, proof, wrapped VMK | plus `kdf.cle_memorisee` (the effective key) |
| Attacker with the file | needs the password | reads everything immediately |

Mode B is an explicit, documented trade-off. Switching to it shows a warning and
requires confirmation; switching back deletes `kdf.cle_memorisee` immediately.

## 10. Versioning and audits

- The format version is stored in `vault.json` (`version`). Version 1 vaults
  remain readable; the upgrade to version 2 is explicit (enabling phrase
  recovery) and re-encrypts the API keys.
- The derivation label carries its own suffix (`...-v1`) so that a future change
  of the proof construction can be detected instead of silently breaking every
  vault.
- If you review this project, the places to read first are `src/crypto.js` in
  full (about 250 lines), `normaliserVault()` and the two `ouvrir*()` functions
  in `src/app.js`, and the command table in `src-tauri/src/main.rs`.

## 11. Reporting

See [SECURITY.md](../SECURITY.md) at the root of the repository.
