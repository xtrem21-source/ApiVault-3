# Screenshots

This folder holds the pictures used by the project README. The image files are
**not** committed by default: they show the application, and a picture taken on
the wrong vault can leak real keys. Generate them yourself with the procedure
below, check them carefully, then commit them.

`README.md` (English) and `README.fr.md` (French) reference these files:

| File name | Referenced as |
| --- | --- |
| `01-welcome.png` | Welcome screen |
| `02-master-password.png` | Master password creation |
| `03-recovery-phrase.png` | Recovery phrase |
| `04-main-screen-empty.png` | Main screen, empty vault |
| `05-main-screen-with-provider.png` | Main screen with a demo provider |
| `06-settings.png` | Settings |
| `07-export-clear.png` | Plain text export warning |
| `08-portable-folder.png` | Portable folder in Windows Explorer |

---

## General rules

- **Format**: PNG.
- **Minimum width**: 1200 px. Capture the application window only, not the whole
  desktop (except for `08-portable-folder.png`).
- **Name the files exactly as listed above.** The README links are relative and
  case sensitive on GitHub.
- **No real secrets.** Never publish a picture showing a real API key, a real
  recovery phrase, a real master password or a real `vault.json` path
  containing personal information.
- **Use a throwaway vault.** The cleanest approach is to do the whole series in
  one session with a vault created for that purpose, containing only dummy
  values (for example `sk-demo-0000`), and to delete the folder afterwards.
- Blur or black out anything sensitive with an image editor (GIMP, Paint.NET,
  Pinta, or the Windows Snipping Tool's pen).

How to capture the window on Windows: focus it, press **Alt + PrtScn**, then
paste into Paint and save as PNG. In the Windows 11 Snipping Tool, use
**Window** capture mode.

---

## 1. `01-welcome.png` - Welcome screen

**What must be visible**: the "ApiVault-3" title, the one-line subtitle, the
description card with its four bullet points, the "First launch" heading and the
two buttons **New vault** / **Import an existing vault**.

**How**:

1. Put `ApiVault-3.exe` alone in an empty folder (no `vault.json`).
2. Start it. The welcome screen is shown because no vault exists yet.
3. Capture the window.

---

## 2. `02-master-password.png` - Master password creation

**What must be visible**: the "New vault" heading, "Step 1 of 2: master
password", the explanation paragraph, the two password fields (empty), the
strength gauge, and the **Create the vault** button.

**How**:

1. From the welcome screen, click **New vault**.
2. Capture **before** typing anything, so no password appears on the picture.
3. Do not continue: go back and start from a fresh folder, or use the values you
   are about to create for the rest of the series.

---

## 3. `03-recovery-phrase.png` - Recovery phrase

**What must be visible**: the "Recovery phrase" heading, "Step 2 of 2: write
these 24 words down on paper", the red warning box, the grid of 24 numbered
words, the **I have written down my recovery phrase** checkbox and the
**Continue** button (disabled).

**How**:

1. Create the vault (step 2) with a throwaway password, for example
   `Demo-Password-2026!`.
2. The phrase screen appears. Capture the window.
3. **Before publishing, blur or mask the 24 words.** They are real secrets of
   *that* vault, and publishing them teaches readers nothing while creating a
   genuine risk. Replace each word with a grey rectangle, or write
   `word1 ... word24` over them.
4. Keep the paper copy of the phrase for the next steps, or simply acknowledge
   the checkbox and continue with the demo vault.

> If you cannot mask the words cleanly, take the picture of this screen with a
> vault you are about to delete, and delete the whole folder right after.

---

## 4. `04-main-screen-empty.png` - Main screen, empty vault

**What must be visible**: the header with the "ApiVault-3" title and the mode
badge, the **Lock** and **Settings** buttons, the search box, the
**+ Add a provider** button, and the "No provider yet." message. The footer
should show `0 providers - 0 keys - 0 URLs`.

**How**:

1. Right after confirming the recovery phrase of the fresh vault.
2. Capture the window.

---

## 5. `05-main-screen-with-provider.png` - Main screen with a demo provider

**What must be visible**: one provider named **OpenRouter 1**, with:
- two URL variants: **No version** (`https://openrouter.ai/api`) and
  **With /v1** (`https://openrouter.ai/api/v1`);
- two API keys, **Full Access** and **Limited Models**, both masked (`******`)
  with their date;
- the **Copy**, **Reveal**, **Edit** and **Delete** buttons.

**How**:

1. Click **+ Add a provider**.
2. Name it `OpenRouter 1`.
3. Add the two URL variants above.
4. Add two keys with **dummy values**, for example
   `sk-demo-0000000000000000` and `sk-demo-1111111111111111`.
   Never use a real key.
5. Save, make sure nothing is revealed (all values show `******`), and capture.

---

## 6. `06-settings.png` - Settings

**What must be visible**, in one capture or in two stacked ones of the same
width:

- the **Interface language** selector (FR / EN);
- the **Unlock mode** toggle (Strict / Comfort) with the two explanations;
- the **Phrase recovery** card with its status line and its button
  (**Enable phrase recovery** or **Generate a new recovery phrase**);
- the **Clipboard** option and its checkbox;
- the **Export the vault** buttons (**Encrypted export (.vaultbackup)**,
  **Plain HTML export**, **Plain JSON export**) and the red warning;
- the **Import the vault** card;
- the **Locations** card (blur the folder path if it reveals your user name).

**How**: click **Settings** and capture. Scroll if needed and take two pictures,
or resize the window so everything fits.

---

## 7. `07-export-clear.png` - Plain text export warning

**What must be visible**: the confirmation dialog titled "Plain text export", the
sentence stating that the file will contain all the API keys without encryption,
the red warning telling you never to share it, and the
**Confirm the plain text export** button next to **Cancel**.

**How**:

1. In the settings, click **Plain JSON export** (or **Plain HTML export**).
2. The dialog appears **before** anything is written. Capture it.
3. Click **Cancel** so no plain text file is created.

---

## 8. `08-portable-folder.png` - The portable folder

**What must be visible**: the contents of the `ApiVault-3` folder in Windows
Explorer: `ApiVault-3.exe`, `src/`, `src-tauri/`, `README.md`, `README.fr.md`,
`build.bat` (and optionally `vault.json`). The point is to show that the
application is a plain folder.

**How**:

1. Open the folder in File Explorer, switch to the **Details** view so the file
   sizes are visible.
2. Optionally select `ApiVault-3.exe` so the status bar shows its size
   (about 2.7 MB).
3. Capture **the Explorer window**, not the whole desktop: press **Alt + PrtScn**.
4. Hide anything personal (user name in the path, other files).

---

## Checklist before committing

- [ ] The eight files exist, named exactly as above.
- [ ] Each is a PNG at least 1200 px wide.
- [ ] The 24 words of `03-recovery-phrase.png` are masked.
- [ ] `05-main-screen-with-provider.png` shows only dummy keys, all masked.
- [ ] No real key, password or phrase is readable anywhere.
- [ ] No personal folder path is readable.
- [ ] `README.md` and `README.fr.md` display the images correctly.

---

## Version française (résumé)

Ce dossier contient les captures utilisées par le README. Elles ne sont pas
versionnées par défaut : une capture faite sur le mauvais vault peut révéler de
vraies clés.

Huit fichiers PNG, largeur minimale 1200 px, noms exacts :
`01-welcome.png`, `02-master-password.png`, `03-recovery-phrase.png`,
`04-main-screen-empty.png`, `05-main-screen-with-provider.png`,
`06-settings.png`, `07-export-clear.png`, `08-portable-folder.png`.

Points d'attention :

- travaillez sur un vault jetable, avec des valeurs fictives (`sk-demo-0000`) ;
- **masquez les 24 mots** de `03-recovery-phrase.png` avant publication ;
- aucune clé, aucun mot de passe et aucune phrase réelle ne doit être lisible ;
- pas de chemin de dossier personnel visible ;
- capturez la fenêtre de l'application avec **Alt + Impr. écran**, puis collez
  dans un éditeur d'image et enregistrez en PNG.
