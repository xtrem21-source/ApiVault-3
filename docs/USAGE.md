# User guide

This guide walks through every screen of ApiVault-3. The interface automatically
starts in French or English depending on your system language; you can change it
at any time in the settings.

## 1. First launch

Run `ApiVault-3.exe`. If the folder does not contain a `vault.json` yet, the
welcome screen appears and offers two choices:

- **New vault** - start from scratch;
- **Import an existing vault** - load a `.vaultbackup`, a plain text JSON export
  or a raw `vault.json`.

The welcome screen also restates the ground rules: keys are encrypted, URLs are
not, there is no network access, and the folder can be copied to a USB stick.

## 2. Creating a vault

1. Click **New vault**.
2. Type a master password (12 characters minimum) and confirm it. A gauge shows
   its strength.
3. Click **Create the vault**. Derivation runs for a moment (100,000 PBKDF2
   iterations).
4. The **recovery phrase** screen appears with 24 words.

### The recovery phrase

Write the 24 words down on paper, in order. Store the paper away from the
computer. Tick **I have written down my recovery phrase** and click **Continue**.

What it is worth:

- it is generated locally with the operating system's random number generator;
- **only an encrypted copy of the vault master key is stored** in `vault.json` -
  neither the phrase nor anything derived from it is kept;
- it can reopen your vault if you forget the master password;
- if you lose **both** the master password and the phrase, the keys are lost
  forever. There is no other way in.

Do not photograph it, do not put it in a password manager you might also lose,
and never paste it into a chat window.

## 3. Unlocking the vault

The unlock screen has two tabs.

**Master password** (default)

- Mode A - Strict (default): asked on every launch.
- Mode B - Comfort: asked only the first time; afterwards the application opens
  directly.

**Recovery phrase**

- Paste or type the 24 words, separated by spaces, then click **Unlock with the
  phrase**.
- Case, accents and line breaks do not matter, and the field can contain a
  pasted multi-line phrase.
- Wrong word count and unknown words are reported before any decryption is
  attempted, so a typo gives a clear message instead of a generic failure.
- If the vault has no recovery phrase, the tab tells you so and suggests using
  the master password and then enabling recovery in the settings.

## 4. The main screen

```
+--------------------------------------------------------------+
| ApiVault-3   [Mode strict]          [Lock]  [Settings]        |
+--------------------------------------------------------------+
| [ Search a provider...        ]      [+ Add a provider]       |
+--------------------------------------------------------------+
| Mistral                                    1 key             |
|   [Copy the keys] [Edit] [Delete]                            |
|   URL VARIANTS (1)                                           |
|     With /v1     https://api.mistral.ai/v1        [Copy]      |
|   API KEYS (1)                                               |
|     Main key     ******   15/10/2026   [Reveal] [Copy]       |
+--------------------------------------------------------------+
| 2 providers - 3 keys - 4 URLs      File: ...\vault.json      |
+--------------------------------------------------------------+
```

- Providers are sorted **alphabetically** (accents and case ignored).
- The search box filters by provider name as you type.
- **Reveal** decrypts one key and displays it; the value masks itself again after
  30 seconds, and re-masks immediately if the list is redrawn.
- **Copy** puts a key or a URL in the clipboard. Unless you disabled the option
  in the settings, the clipboard is emptied **30 seconds later** (and only if it
  still holds what you copied).
- **Copy the keys** copies the whole provider as `label : value` lines, one per
  key.
- **Lock** clears the password and the keys from memory and returns to the
  unlock screen.
- The footer shows the provider / key / URL counts and the full path of
  `vault.json`.

### Adding and editing a provider

**Add a provider** opens a form with three parts:

1. **Provider name** - must be unique. If you type a name that already exists,
   the form refuses it and offers a free alternative ("OpenRouter 2") with a
   clickable button.
2. **URL variants** - as many rows as you like: a short label ("No version",
   "With /v1") and the full address. The label is optional, the address is not.
3. **API keys** - as many rows as you like: a short label ("Full Access") and
   the value. When editing an existing provider, leaving a value empty keeps the
   current one; use **Remove** on a row to delete that key.

Values are encrypted as soon as you save, before anything is written to disk.

## 5. Settings

### Unlock mode

- **Mode A - Strict (default)**: nothing but the derivation proof is stored.
- **Mode B - Comfort**: the effective key is stored in `vault.json`, so the
  application opens without asking. Switching to Mode B shows an explicit
  warning and requires confirmation; **anyone who gets the file can read the
  keys**. Switching back to strict deletes the stored key immediately.

### Interface language

French or English. The choice is saved in `vault.json` and applied on the next
launch. Before a vault exists, the choice is remembered in the application's
local profile folder.

### Changing the master password

Type the current password, then the new one twice. What happens depends on the
format of the vault:

- **Version 2 vaults** (created or upgraded by this version): a new salt and a
  new derivation proof are generated, and the vault master key is re-wrapped.
  The API keys themselves are not touched, and **the recovery phrase keeps
  working**.
- **Version 1 vaults** (created by an earlier version): every API key is
  decrypted and re-encrypted with the new password key.

### Phrase recovery

- **Enable phrase recovery**: asks for the master password, converts the vault
  to format 2 if needed (the API keys are then re-encrypted with a new master
  key), generates a 24-word phrase and displays it once.
- **Generate a new recovery phrase**: replaces an existing phrase. The old
  phrase becomes permanently unusable.
- The vault is saved *before* the phrase is displayed, so a phrase you never
  wrote down is never the only way in.

### Clipboard

**Automatically clear the clipboard after 30 seconds** - on by default. The
clearing is done through the Windows clipboard API, so it also works when the
window is in the background. If you copied something else in the meantime, your
value is left alone.

### Export the vault

Everything is written to the `exports/` subfolder, next to the executable.

| Format | Content | Protection |
| --- | --- | --- |
| `.vaultbackup` | Full vault, re-encrypted with the master password | Master password required to restore |
| Plain HTML | Readable tables of every provider, URL and key | **Keys in clear** - red warning and confirmation first |
| Plain JSON | Complete structure with the keys in clear | **Keys in clear** - red warning and confirmation first |

Both plain text formats go through a confirmation dialog with a red warning
before anything is written.

### Import the vault

Drop the file into `exports/`, click **Refresh list**, then **Import**; or paste
the content into the text area and use the import button.

- `.vaultbackup` asks for the master password that was used when it was created.
- A plain JSON export (or a raw `vault.json`) is re-encrypted with your current
  master password; on first launch, you are asked to choose one.
- Importing **replaces** the current content of the vault. A wrong password is
  reported and nothing is changed.

### Locations

Shows the application folder and the exact path of `vault.json`.

## 6. Portability: USB stick and other machines

1. Lock the vault (or close the window) - the keys are cleared from memory.
2. Copy the whole folder: `ApiVault-3.exe`, `vault.json`, and optionally your
   `exports/`.
3. On any Windows 10/11 machine, run `ApiVault-3.exe`.

`donnees-webview2/` is only a browser cache; it is recreated automatically and
need not be copied.

`vault.json` must stay **next to the executable**: that is where the application
looks for it.

## 7. Backups

- **Encrypted backup**: Settings -> Export the vault -> `.vaultbackup`. Store it
  somewhere else (another disk, a safe). It needs the master password to be
  restored.
- **The recovery phrase** covers the case where you forget the password, not the
  case where the file is lost. You need *both* a copy of `vault.json` (or of a
  `.vaultbackup`) *and* a way to unlock it.
- Deleting a provider or a key is immediate and final - there is no recycle bin.

## 8. Frequently asked

**I forgot my master password.** Use the recovery phrase tab, if recovery was
enabled for that vault.

**The recovery tab says no phrase is configured.** That vault predates the
feature or was created without it. Unlock with the master password, then
Settings -> Phrase recovery -> Enable phrase recovery.

**I lost the phrase.** Regenerate one from the settings, as long as you still
know the master password. The old phrase stops working.

**"vault.json is corrupted".** The file is not valid JSON - most likely an
interrupted copy. Restore a `.vaultbackup`, or start a new vault. The old file
is not modified until you save.

**Nothing opens / blank window.** Install the Microsoft Edge WebView2 Runtime
(see the README).

**My antivirus complains.** The executable is not code-signed. Add an exception,
or build it yourself with `build.bat`.

**Windows SmartScreen blocks it.** Click "More info", then "Run anyway" - or
build it yourself.

**Can I keep it on a NAS / network share?** Nothing forbids it, but the
application writes files next to itself, and a network share weakens the
"nothing leaves this folder" property.
