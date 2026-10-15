@echo off
rem ===========================================================================
rem  ApiVault-3 - construction du .exe portable
rem  Prerequis : Rust (cargo) + Tauri CLI (cargo install tauri-cli ou binaire
rem  deja present). Voir README.md, section "Construire le projet".
rem ===========================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================================
echo  ApiVault-3 - construction du .exe portable
echo ============================================================
echo.

where cargo >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] cargo est introuvable dans le PATH.
  echo Installez Rust depuis https://rustup.rs puis relancez ce script.
  goto :fin
)

echo Compilation en cours, cela peut prendre plusieurs minutes...
echo.
cd src-tauri
cargo tauri build
if errorlevel 1 (
  echo.
  echo [ERREUR] La construction a echoue. Le message d'erreur de cargo est ci-dessus.
  cd ..
  goto :fin
)
cd ..

set "BINAIRE="
if exist "src-tauri\target\release\ApiVault-3.exe" set "BINAIRE=src-tauri\target\release\ApiVault-3.exe"
if not defined BINAIRE if exist "src-tauri\target\release\apivault-3.exe" set "BINAIRE=src-tauri\target\release\apivault-3.exe"

if not defined BINAIRE (
  echo [ERREUR] Le binaire n'a pas ete trouve dans src-tauri\target\release.
  goto :fin
)

echo Copie de "!BINAIRE!" vers la racine du dossier...
copy /Y "!BINAIRE!" "ApiVault-3.exe" >nul
if errorlevel 1 (
  echo [ERREUR] La copie de l'executable a echoue.
  goto :fin
)

echo.
echo ============================================================
echo  Termine : ApiVault-3.exe est pret a la racine du dossier.
echo ============================================================

:fin
echo.
pause
