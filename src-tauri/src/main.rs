// ApiVault-3 - point d'entree et commandes Tauri.
//
// Regle de portabilite : TOUT est ecrit dans le dossier qui contient le .exe.
// Aucun acces au registre, aucun fichier dans %APPDATA% / %LOCALAPPDATA%,
// aucun appel reseau. Le profil du navigateur embarque (WebView2) est lui aussi
// deplace dans le dossier de l'application (voir main()).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Nom du fichier de stockage, a cote du .exe.
const FICHIER_VAULT: &str = "vault.json";
/// Sous-dossier du profil WebView2 (cache du navigateur embarque).
const DOSSIER_PROFIL: &str = "donnees-webview2";
/// Sous-dossier des exports (sauvegardes chiffrees ou en clair).
const DOSSIER_EXPORTS: &str = "exports";

/// Retourne le dossier qui contient l'executable en cours.
/// C'est la seule racine que l'application utilise : tout y reste.
fn dossier_application() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    exe.parent()
        .map(|d| d.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Chemin complet du fichier vault.json.
fn chemin_vault() -> PathBuf {
    dossier_application().join(FICHIER_VAULT)
}

/// Chemin du dossier des exports.
fn dossier_exports() -> PathBuf {
    dossier_application().join(DOSSIER_EXPORTS)
}

/// Valide un nom de fichier d'export et refuse tout ce qui pourrait sortir
/// du dossier ApiVault-3 (chemins relatifs, separateurs, lecteur...).
fn chemin_export(nom: &str) -> Result<PathBuf, String> {
    let nom = nom.trim();
    if nom.is_empty() {
        return Err("Empty file name".to_string());
    }
    if nom.len() > 120 {
        return Err("File name too long (120 characters maximum)".to_string());
    }
    if nom.contains("..") || nom.contains('/') || nom.contains('\\') || nom.contains(':') {
        return Err("Forbidden file name (paths are not accepted)".to_string());
    }
    if let Some(c) = nom
        .chars()
        .find(|c| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')))
    {
        return Err(format!("Forbidden character in the file name: {}", c));
    }
    Ok(dossier_exports().join(nom))
}

// ---------------------------------------------------------------------------
// Presse-papiers Windows (API Win32 directe : aucune dependance supplementaire)
//
// Pourquoi ne pas utiliser navigator.clipboard depuis l'interface ?
//   - writeText echoue avec "Document is not focused" des que la fenetre de
//     l'application n'est plus au premier plan, ce qui est justement le cas
//     au bout des 30 secondes d'effacement automatique ;
//   - il n'existe aucun moyen fiable de vider le presse-papiers en JavaScript.
// On passe donc par OpenClipboard/GetClipboardData/SetClipboardData.
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod presse_papiers {
    use std::os::raw::c_void;

    type Hwnd = *mut c_void;
    type Handle = *mut c_void;
    type Bool = i32;

    /// Identifiant du format "texte Unicode" du presse-papiers Windows.
    const CF_UNICODETEXT: u32 = 13;
    /// Memoire deplacee (obligatoire pour SetClipboardData).
    const GMEM_MOVEABLE: u32 = 0x0002;

    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalAlloc(drapeaux: u32, taille: usize) -> Handle;
        fn GlobalLock(memoire: Handle) -> *mut c_void;
        fn GlobalUnlock(memoire: Handle) -> Bool;
        fn GlobalFree(memoire: Handle) -> Handle;
        fn Sleep(millisecondes: u32);
    }

    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(hwnd: Hwnd) -> Bool;
        fn CloseClipboard() -> Bool;
        fn EmptyClipboard() -> Bool;
        fn IsClipboardFormatAvailable(format: u32) -> Bool;
        fn GetClipboardData(format: u32) -> Handle;
        fn SetClipboardData(format: u32, memoire: Handle) -> Handle;
    }

    /// Ouvre le presse-papiers, en reessayant : un autre programme peut le
    /// verrouiller momentanement.
    fn ouvrir() -> bool {
        for _ in 0..10 {
            if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
                return true;
            }
            unsafe { Sleep(30) };
        }
        false
    }

    /// Lit le texte actuellement present dans le presse-papiers.
    pub fn lire() -> Option<String> {
        if !ouvrir() {
            return None;
        }
        let mut resultat = None;
        unsafe {
            if IsClipboardFormatAvailable(CF_UNICODETEXT) != 0 {
                let memoire = GetClipboardData(CF_UNICODETEXT);
                if !memoire.is_null() {
                    let pointeur = GlobalLock(memoire) as *const u16;
                    if !pointeur.is_null() {
                        let mut longueur = 0usize;
                        while *pointeur.add(longueur) != 0 {
                            longueur += 1;
                        }
                        resultat = Some(String::from_utf16_lossy(std::slice::from_raw_parts(
                            pointeur, longueur,
                        )));
                        GlobalUnlock(memoire);
                    }
                }
            }
            CloseClipboard();
        }
        resultat
    }

    /// Place un texte dans le presse-papiers. Renvoie true si l'ecriture a
    /// reussi (le focus de la fenetre n'a aucune importance ici).
    pub fn ecrire(texte: &str) -> bool {
        if !ouvrir() {
            return false;
        }
        unsafe {
            if EmptyClipboard() == 0 {
                CloseClipboard();
                return false;
            }
            let utf16: Vec<u16> = texte.encode_utf16().chain(std::iter::once(0)).collect();
            let memoire = GlobalAlloc(GMEM_MOVEABLE, utf16.len() * 2);
            if memoire.is_null() {
                CloseClipboard();
                return false;
            }
            let cible = GlobalLock(memoire) as *mut u16;
            if cible.is_null() {
                GlobalFree(memoire);
                CloseClipboard();
                return false;
            }
            std::ptr::copy_nonoverlapping(utf16.as_ptr(), cible, utf16.len());
            GlobalUnlock(memoire);
            if SetClipboardData(CF_UNICODETEXT, memoire).is_null() {
                GlobalFree(memoire);
                CloseClipboard();
                return false;
            }
            // Apres un SetClipboardData reussi, la memoire appartient au systeme :
            // il ne faut surtout pas la liberer.
            CloseClipboard();
        }
        true
    }

    /// Vide entierement le presse-papiers.
    pub fn vider() -> bool {
        if !ouvrir() {
            return false;
        }
        let ok = unsafe { EmptyClipboard() != 0 };
        unsafe { CloseClipboard() };
        ok
    }
}

// ---------------------------------------------------------------------------
// Commandes appelees depuis l'interface (JavaScript -> Rust)
// ---------------------------------------------------------------------------

/// Dossier de l'application (affiche dans les parametres).
#[tauri::command]
fn dossier_app() -> String {
    dossier_application().to_string_lossy().to_string()
}

/// Chemin complet du vault.json (affiche dans les parametres).
#[tauri::command]
fn chemin_du_vault() -> String {
    chemin_vault().to_string_lossy().to_string()
}

/// Lit vault.json. Renvoie None au premier lancement (fichier absent).
#[tauri::command]
fn lire_vault() -> Result<Option<String>, String> {
    let chemin = chemin_vault();
    if !chemin.exists() {
        return Ok(None);
    }
    fs::read_to_string(&chemin)
        .map(Some)
        .map_err(|e| format!("Cannot read vault.json: {}", e))
}

/// Ecrit vault.json de facon atomique (fichier temporaire puis remplacement),
/// pour ne jamais laisser un vault tronque en cas d'interruption.
#[tauri::command]
fn ecrire_vault(contenu: String) -> Result<(), String> {
    let chemin = chemin_vault();
    let temporaire = chemin.with_extension("json.tmp");
    fs::write(&temporaire, contenu.as_bytes())
        .map_err(|e| format!("Cannot write the temporary file: {}", e))?;
    fs::rename(&temporaire, &chemin).map_err(|e| {
        let _ = fs::remove_file(&temporaire);
        format!("Cannot replace vault.json: {}", e)
    })
}

/// Liste les fichiers presents dans le dossier "exports" (tries, sans dossiers).
#[tauri::command]
fn lister_exports() -> Result<Vec<String>, String> {
    let dossier = dossier_exports();
    if !dossier.exists() {
        return Ok(Vec::new());
    }
    let entrees = fs::read_dir(&dossier).map_err(|e| format!("Cannot read the exports folder: {}", e))?;
    let mut noms: Vec<String> = Vec::new();
    for entree in entrees.flatten() {
        let chemin = entree.path();
        if chemin.is_file() {
            if let Some(nom) = chemin.file_name() {
                noms.push(nom.to_string_lossy().to_string());
            }
        }
    }
    noms.sort_by_key(|n| n.to_lowercase());
    Ok(noms)
}

/// Lit un fichier du dossier "exports".
#[tauri::command]
fn lire_export(nom: String) -> Result<String, String> {
    let chemin = chemin_export(&nom)?;
    if !chemin.exists() {
        return Err(format!("File not found: {}", nom));
    }
    fs::read_to_string(&chemin).map_err(|e| format!("Cannot read the file: {} ({})", nom, e))
}

/// Ecrit un fichier dans le dossier "exports" (cree au besoin).
/// Renvoie le chemin complet ecrit, affiche a l'utilisateur.
#[tauri::command]
fn ecrire_export(nom: String, contenu: String) -> Result<String, String> {
    let chemin = chemin_export(&nom)?;
    fs::create_dir_all(dossier_exports())
        .map_err(|e| format!("Cannot create the exports folder: {}", e))?;
    fs::write(&chemin, contenu.as_bytes())
        .map_err(|e| format!("Cannot write the file: {} ({})", nom, e))?;
    Ok(chemin.to_string_lossy().to_string())
}

/// Supprime un fichier du dossier "exports".
#[tauri::command]
fn supprimer_export(nom: String) -> Result<(), String> {
    let chemin = chemin_export(&nom)?;
    if !chemin.exists() {
        return Err(format!("File not found: {}", nom));
    }
    fs::remove_file(&chemin).map_err(|e| format!("Cannot delete the file: {} ({})", nom, e))
}

// ---------------------------------------------------------------------------
// Presse-papiers : commandes exposees a l'interface
// ---------------------------------------------------------------------------

/// Place un texte dans le presse-papiers Windows.
#[tauri::command]
fn copier_presse_papiers(texte: String) -> Result<bool, String> {
    #[cfg(windows)]
    {
        Ok(presse_papiers::ecrire(&texte))
    }
    #[cfg(not(windows))]
    {
        let _ = texte;
        Err("The clipboard is not available on this system".to_string())
    }
}

/// Vide le presse-papiers apres l'effacement automatique.
///
/// `attendu` est le texte que l'application venait d'y placer : si le
/// presse-papiers contient autre chose (l'utilisateur a copie quelque chose
/// entre-temps), on ne l'efface pas. Renvoie "vide", "conserve" ou "echec".
#[tauri::command]
fn vider_presse_papiers(attendu: Option<String>) -> Result<String, String> {
    #[cfg(windows)]
    {
        if let Some(reference) = attendu {
            if let Some(contenu) = presse_papiers::lire() {
                if contenu != reference {
                    return Ok("conserve".to_string());
                }
            }
        }
        if presse_papiers::vider() {
            Ok("vide".to_string())
        } else {
            Ok("echec".to_string())
        }
    }
    #[cfg(not(windows))]
    {
        let _ = attendu;
        Err("The clipboard is not available on this system".to_string())
    }
}

// ---------------------------------------------------------------------------
// Point d'entree
// ---------------------------------------------------------------------------

fn main() {
    let dossier = dossier_application();

    // Profil WebView2 : par defaut Tauri l'ecrit dans %LOCALAPPDATA%\<identifier>.
    // On le deplace dans le dossier de l'application pour rester portable.
    // La variable d'environnement est un filet de securite en plus de
    // data_directory() passe au constructeur de fenetre.
    let profil = dossier.join(DOSSIER_PROFIL);
    let _ = fs::create_dir_all(&profil);
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &profil);

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            dossier_app,
            chemin_du_vault,
            lire_vault,
            ecrire_vault,
            lister_exports,
            lire_export,
            ecrire_export,
            supprimer_export,
            copier_presse_papiers,
            vider_presse_papiers
        ])
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("ApiVault-3")
                .inner_size(1060.0, 760.0)
                .min_inner_size(860.0, 620.0)
                .resizable(true)
                .center()
                .data_directory(profil.clone())
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Erreur au lancement d'ApiVault-3");
}
