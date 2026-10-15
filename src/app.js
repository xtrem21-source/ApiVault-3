// ApiVault-3 - logique de l'interface.
//
// Tous les textes affiches passent par les dictionnaires src/i18n/<langue>.json
// (fonctions t() et tPluriel()). Les seuls echanges avec Rust sont la lecture et
// l'ecriture de fichiers dans le dossier de l'application, et le presse-papiers.
"use strict";

// ---------------------------------------------------------------------------
// Etat de l'application
// ---------------------------------------------------------------------------

const etat = {
  vault: null, // contenu de vault.json (cles toujours chiffrees)
  cle: null, // cle AES-256-GCM effective en memoire (jamais ecrite)
  cleMaitre: null, // matiere brute de la cle effective (pour le mode Confort)
  materielMotDePasse: null, // matiere derivee du mot de passe, si saisie
  filtre: "",
  phraseTemporaire: null, // phrase de recuperation affichee une seule fois
  phraseContexte: "creation", // "creation" ou "activation"
  recuperationEnAttente: null, // bloc recuperation a enregistrer
  echecsConnexion: 0,
  minuteurPresse: null, // minuterie d'effacement du presse-papiers
  derniereCopie: null, // dernier texte copie (pour l'effacement automatique)
  minuteursMasquage: [] // minuteries de masquage des valeurs revelees
};

const DUREE_EFFACEMENT_PRESSE_PAPIERS = 30000; // 30 secondes (impose)
const DUREE_MASQUAGE_VALEUR = 30000; // remasquage automatique d'une cle revelee
const LONGUEUR_MINI_MDP = 12;

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/** Acces aux commandes Rust exposees par Tauri (withGlobalTauri). */
function appel(nom, args) {
  return window.__TAURI__.core.invoke(nom, args);
}

function elt(id) {
  return document.getElementById(id);
}

/** Echappe le texte avant insertion dans du HTML. */
function echapper(texte) {
  return String(texte === null || texte === undefined ? "" : texte)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Identifiant unique pour chaque fournisseur. */
function nouvelIdentifiant() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const octets = octetsAleatoires(16);
  octets[6] = (octets[6] & 0x0f) | 0x40;
  octets[8] = (octets[8] & 0x3f) | 0x80;
  const hex = Array.from(octets)
    .map((o) => o.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}

/** Date du jour au format francais DD/MM/YYYY. */
function dateDuJour() {
  const d = new Date();
  const jour = String(d.getDate()).padStart(2, "0");
  const mois = String(d.getMonth() + 1).padStart(2, "0");
  return jour + "/" + mois + "/" + d.getFullYear();
}

/** Horodatage pour les noms de fichiers : AAAA-MM-JJ-HHMMSS. */
function horodatage() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  );
}

/** Heure locale lisible (pour les exports). */
function heureLocale() {
  return new Date().toLocaleTimeString(i18n.langue === "fr" ? "fr-FR" : "en-US");
}

/** Nom normalise pour la comparaison des noms de fournisseurs. */
function normaliserNom(nom) {
  return String(nom || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function trierFournisseurs(liste) {
  return liste.slice().sort((a, b) => String(a.nom).localeCompare(String(b.nom), i18n.langue, { sensitivity: "base" }));
}

function trouverFournisseur(id) {
  return etat.vault.fournisseurs.find((f) => f.id === id) || null;
}

/** Traduit un message d'erreur venu de Rust avant de l'afficher. */
function erreurRust(erreur) {
  return traduireErreurTechnique(erreur && erreur.message ? erreur.message : String(erreur));
}

// ---------------------------------------------------------------------------
// Notifications et modale
// ---------------------------------------------------------------------------

function notifier(message, type) {
  const zone = elt("notifications");
  const boite = document.createElement("div");
  boite.className = "notification " + (type || "info");
  boite.textContent = message;
  zone.appendChild(boite);
  setTimeout(() => {
    boite.remove();
  }, 5000);
}

function fermerModale() {
  elt("fond-modale").classList.add("cache");
  elt("modale-titre").textContent = "";
  elt("modale-corps").innerHTML = "";
  elt("modale-actions").innerHTML = "";
}

/**
 * Ouvre la modale generique.
 * boutons : [{ texte, classe, action(corps) -> Promise|void, fermerApres }]
 * Les textes passent par t() : on peut fournir une cle au lieu du texte.
 */
function ouvrirModale(options) {
  elt("modale-titre").textContent = options.titreCle ? t(options.titreCle) : options.titre || "";
  elt("modale-corps").innerHTML = options.corpsHtml || "";
  const actions = elt("modale-actions");
  actions.innerHTML = "";
  (options.boutons || []).forEach((definition) => {
    const bouton = document.createElement("button");
    bouton.className = "btn " + (definition.classe || "secondaire");
    bouton.textContent = definition.texteCle ? t(definition.texteCle) : definition.texte || "";
    bouton.addEventListener("click", async () => {
      bouton.disabled = true;
      try {
        const resultat = await definition.action(elt("modale-corps"));
        if (definition.fermerApres !== false && resultat !== false) {
          fermerModale();
        }
      } catch (erreur) {
        notifier(erreurRust(erreur), "erreur");
      } finally {
        bouton.disabled = false;
      }
    });
    actions.appendChild(bouton);
  });
  elt("fond-modale").classList.remove("cache");
  if (typeof options.surAfficher === "function") {
    options.surAfficher(elt("modale-corps"));
  }
}

/** Modale de confirmation (renvoie true si l'utilisateur confirme). */
function demanderConfirmation(titreCle, corpsHtml, texteValiderCle, classeValider) {
  return new Promise((resoudre) => {
    ouvrirModale({
      titreCle: titreCle,
      corpsHtml: '<div class="carte">' + corpsHtml + "</div>",
      boutons: [
        { texteCle: "commun.annuler", classe: "secondaire", action: () => resoudre(false) },
        { texteCle: texteValiderCle, classe: classeValider || "danger", action: () => resoudre(true) }
      ]
    });
  });
}

/** Modale de saisie d'un mot de passe (renvoie la valeur ou null). */
function demanderMotDePasse(titreCle, corpsTexte, etiquetteCle) {
  return new Promise((resoudre) => {
    ouvrirModale({
      titreCle: titreCle,
      corpsHtml:
        '<div class="carte"><p>' +
        echapper(corpsTexte) +
        '</p><label class="champ"><span>' +
        echapper(t(etiquetteCle)) +
        '</span><input type="password" id="modale-mdp" /></label>' +
        '<p id="modale-erreur" class="erreur cache"></p></div>',
      surAfficher: (corps) => {
        const champ = corps.querySelector("#modale-mdp");
        if (champ) {
          champ.focus();
          champ.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
              const valider = elt("modale-actions").querySelector(".principal");
              if (valider) {
                valider.click();
              }
            }
          });
        }
      },
      boutons: [
        { texteCle: "commun.annuler", classe: "secondaire", action: () => resoudre(null) },
        {
          texteCle: "commun.valider",
          classe: "principal",
          action: (corps) => {
            const valeur = corps.querySelector("#modale-mdp").value;
            if (!valeur) {
              const zone = corps.querySelector("#modale-erreur");
              zone.textContent = t("erreur.mdp_vide");
              zone.classList.remove("cache");
              return false;
            }
            resoudre(valeur);
          }
        }
      ]
    });
  });
}

// ---------------------------------------------------------------------------
// Presse-papiers
// ---------------------------------------------------------------------------

function effacementPressePapiersActif() {
  if (!etat.vault || !etat.vault.parametres) {
    return true;
  }
  return etat.vault.parametres.effacement_presse_papiers !== false;
}

/**
 * Ecrit dans le presse-papiers.
 * 1) commande Rust (API Win32) : fonctionne meme si la fenetre n'a pas le focus,
 *    ce qui est indispensable pour l'effacement automatique ;
 * 2) API navigateur (si la fenetre est au premier plan) ;
 * 3) repli document.execCommand.
 */
async function ecrirePressePapiers(texte) {
  try {
    const ok = await appel("copier_presse_papiers", { texte: texte });
    if (ok) {
      return true;
    }
  } catch (erreur) {
    // On tente les chemins du navigateur ci-dessous.
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(texte);
      return true;
    }
  } catch (erreur) {
    // On tente le repli ci-dessous.
  }
  try {
    const zone = document.createElement("textarea");
    zone.value = texte;
    zone.setAttribute("readonly", "");
    zone.style.position = "fixed";
    zone.style.top = "-1000px";
    zone.style.opacity = "0";
    document.body.appendChild(zone);
    zone.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(zone);
    return ok;
  } catch (erreur) {
    return false;
  }
}

/** Vide le presse-papiers, mais seulement s'il contient encore `reference`. */
async function viderPressePapiers(reference) {
  try {
    return await appel("vider_presse_papiers", { attendu: reference || null });
  } catch (erreur) {
    return "echec";
  }
}

/**
 * Copie un texte puis programme l'effacement automatique du presse-papiers
 * apres 30 secondes si l'option est activee.
 */
async function copierAvecEffacement(texte, description) {
  const ok = await ecrirePressePapiers(texte);
  if (!ok) {
    notifier(t("notif.copie_impossible"), "erreur");
    return;
  }
  etat.derniereCopie = texte;
  if (effacementPressePapiersActif()) {
    if (etat.minuteurPresse) {
      clearTimeout(etat.minuteurPresse);
    }
    etat.minuteurPresse = setTimeout(async () => {
      etat.minuteurPresse = null;
      const reference = etat.derniereCopie;
      etat.derniereCopie = null;
      const resultat = await viderPressePapiers(reference);
      if (resultat === "vide") {
        notifier(t("notif.presse_efface"), "info");
      } else if (resultat === "conserve") {
        notifier(t("notif.presse_conserve"), "info");
      } else {
        notifier(t("notif.presse_echec"), "avertir");
      }
    }, DUREE_EFFACEMENT_PRESSE_PAPIERS);
    notifier(t("notif.copie_effacement", { objet: description }), "succes");
  } else {
    etat.derniereCopie = null;
    notifier(t("notif.copie", { objet: description }), "succes");
  }
}

// ---------------------------------------------------------------------------
// Navigation entre ecrans
// ---------------------------------------------------------------------------

function ecranActif() {
  const section = document.querySelector(".ecran.actif");
  return section ? section.id : null;
}

function afficherEcran(id) {
  document.querySelectorAll(".ecran").forEach((section) => {
    section.classList.remove("actif");
  });
  const cible = elt(id);
  if (cible) {
    cible.classList.add("actif");
  }
  window.scrollTo(0, 0);
}

/** Reaffiche les parties dynamiques apres un changement de langue. */
function rafraichirTextesDynamiques() {
  const ecran = ecranActif();
  if (ecran === "ecran-principal") {
    rendreFournisseurs();
  } else if (ecran === "ecran-parametres") {
    majEcranParametres();
  } else if (ecran === "ecran-connexion") {
    preparerEcranConnexion();
  } else if (ecran === "ecran-phrase" && etat.phraseTemporaire) {
    afficherPhrase(etat.phraseContexte);
  }
}

/** Change la langue, met a jour l'interface et enregistre le choix. */
async function definirLangue(langue) {
  let change = false;
  try {
    change = await changerLangue(langue);
  } catch (erreur) {
    notifier(erreurRust(erreur), "erreur");
    return;
  }
  if (!change) {
    return;
  }
  appliquerTraductions();
  rafraichirTextesDynamiques();
  if (etat.vault) {
    etat.vault.parametres.langue = i18n.langue;
    if (etat.cle) {
      try {
        await sauvegarderVault();
      } catch (erreur) {
        notifier(t("notif.enregistrement_impossible", { detail: erreurRust(erreur) }), "erreur");
      }
    }
  }
  notifier(t("notif.langue_changee", { langue: t("parametres.langue_" + i18n.langue) }), "info");
}

// ---------------------------------------------------------------------------
// Modele du vault
// ---------------------------------------------------------------------------

function kdfVide() {
  return { salt: "", iterations: ITERATIONS_PBKDF2, verify_hash: "" };
}

function vaultVide() {
  return {
    version: VERSION_FORMAT,
    mode: "strict",
    kdf: kdfVide(),
    parametres: { effacement_presse_papiers: true, langue: i18n.langue },
    fournisseurs: []
  };
}

/** Complete un vault charge depuis le disque pour eviter les champs absents. */
function normaliserVault(brut) {
  const vault = brut && typeof brut === "object" ? brut : {};
  const resultat = {
    version: aUneCleMaitre(vault) ? 2 : 1,
    mode: vault.mode === "confort" ? "confort" : "strict",
    kdf: {
      salt: (vault.kdf && vault.kdf.salt) || "",
      iterations: (vault.kdf && Number(vault.kdf.iterations)) || ITERATIONS_PBKDF2,
      verify_hash: (vault.kdf && vault.kdf.verify_hash) || ""
    },
    parametres: {
      effacement_presse_papiers: !vault.parametres || vault.parametres.effacement_presse_papiers !== false,
      langue:
        vault.parametres && LANGUES_DISPONIBLES.indexOf(vault.parametres.langue) >= 0 ? vault.parametres.langue : i18n.langue
    },
    fournisseurs: []
  };
  if (vault.kdf && typeof vault.kdf.cle_memorisee === "string") {
    resultat.kdf.cle_memorisee = vault.kdf.cle_memorisee;
  }
  if (vault.kdf && typeof vault.kdf.iv_cle_maitre === "string") {
    resultat.kdf.iv_cle_maitre = vault.kdf.iv_cle_maitre;
  }
  if (vault.kdf && typeof vault.kdf.cle_maitre_chiffree === "string") {
    resultat.kdf.cle_maitre_chiffree = vault.kdf.cle_maitre_chiffree;
  }
  if (aUneRecuperation(vault)) {
    resultat.recuperation = {
      sel_phrase: String(vault.recuperation.sel_phrase),
      iterations: Number(vault.recuperation.iterations) || ITERATIONS_PBKDF2,
      iv: String(vault.recuperation.iv),
      cle_maitre_chiffree: String(vault.recuperation.cle_maitre_chiffree)
    };
  }
  const fournisseurs = Array.isArray(vault.fournisseurs) ? vault.fournisseurs : [];
  resultat.fournisseurs = fournisseurs
    .filter((f) => f && typeof f === "object")
    .map((f) => ({
      id: f.id || nouvelIdentifiant(),
      nom: String(f.nom || "?"),
      urls: (Array.isArray(f.urls) ? f.urls : [])
        .filter((u) => u && typeof u === "object")
        .map((u) => ({ libelle: String(u.libelle || "URL"), adresse: String(u.adresse || "") })),
      cles: (Array.isArray(f.cles) ? f.cles : [])
        .filter((c) => c && typeof c === "object")
        .map((c) => ({
          libelle: String(c.libelle || "?"),
          iv: String(c.iv || ""),
          valeur_chiffree: String(c.valeur_chiffree || ""),
          date_ajout: String(c.date_ajout || dateDuJour())
        }))
    }));
  return resultat;
}

/** Enregistre vault.json sur le disque (cles deja chiffrees uniquement). */
async function sauvegarderVault() {
  const contenu = JSON.stringify(etat.vault, null, 2);
  await appel("ecrire_vault", { contenu: contenu });
}

// ---------------------------------------------------------------------------
// Demarrage
// ---------------------------------------------------------------------------

async function demarrer() {
  // 1) Les traductions d'abord : toute l'interface en depend.
  try {
    await initialiserI18n();
  } catch (erreur) {
    afficherErreurSansTraductions(erreur.message);
    return;
  }
  appliquerTraductions();

  // 2) Verifications de l'environnement.
  if (!window.__TAURI__ || !window.__TAURI__.core || !window.__TAURI__.core.invoke) {
    afficherErreurFatale(t("erreur.api_tauri"));
    return;
  }
  if (!window.crypto || !window.crypto.subtle) {
    afficherErreurFatale(t("erreur.webcrypto"));
    return;
  }

  brancherEvenements();

  let cheminVault = "";
  try {
    cheminVault = await appel("chemin_du_vault");
    elt("chemin-vault-connexion").textContent = cheminVault;
    elt("chemin-vault-pied").textContent = cheminVault;
    elt("info-vault").textContent = cheminVault;
    elt("info-dossier").textContent = await appel("dossier_app");
  } catch (erreur) {
    notifier(t("notif.lecture_chemins_impossible", { detail: erreurRust(erreur) }), "erreur");
  }

  let brut = null;
  let erreurLecture = null;
  try {
    brut = await appel("lire_vault");
  } catch (erreur) {
    erreurLecture = erreur;
  }

  if (erreurLecture) {
    notifier(t("notif.vault_illisible", { detail: erreurRust(erreurLecture) }), "erreur");
    afficherEcran("ecran-bienvenue");
    return;
  }

  if (brut === null || brut === undefined || String(brut).trim() === "") {
    afficherEcran("ecran-bienvenue");
    return;
  }

  let objet = null;
  try {
    objet = JSON.parse(brut);
  } catch (erreur) {
    notifier(t("notif.vault_corrompu"), "erreur");
    afficherEcran("ecran-bienvenue");
    return;
  }

  etat.vault = normaliserVault(objet);

  // La langue enregistree dans le vault est prioritaire.
  if (etat.vault.parametres.langue !== i18n.langue) {
    try {
      await changerLangue(etat.vault.parametres.langue);
      appliquerTraductions();
    } catch (erreur) {
      // On garde la langue courante.
    }
  }

  // Mode B : la cle est memorisee dans vault.json, on ouvre directement.
  if (etat.vault.mode === "confort" && etat.vault.kdf.cle_memorisee) {
    try {
      const matiere = base64VersOctets(etat.vault.kdf.cle_memorisee);
      etat.cle = await matiereVersCle(matiere);
      etat.cleMaitre = matiere;
      entrerDansApplication();
      notifier(t("notif.vault_ouvert_auto"), "info");
      return;
    } catch (erreur) {
      notifier(t("notif.ouverture_auto_impossible"), "avertir");
    }
  }

  preparerEcranConnexion();
  afficherEcran("ecran-connexion");
}

/** Message d'erreur affiche quand meme les dictionnaires sont illisibles. */
function afficherErreurSansTraductions(detail) {
  const zone = elt("notifications");
  const boite = document.createElement("div");
  boite.className = "notification erreur";
  boite.textContent =
    "Translation files could not be loaded / Les fichiers de langue n'ont pas pu etre charges : " + detail;
  zone.appendChild(boite);
  const section = elt("ecran-bienvenue");
  if (section) {
    section.classList.add("actif");
  }
}

function afficherErreurFatale(message) {
  ouvrirModale({
    titreCle: "modale.erreur_titre",
    corpsHtml: '<div class="carte"><p class="erreur">' + echapper(message) + "</p></div>",
    boutons: [{ texteCle: "commun.fermer", classe: "secondaire", action: () => {} }]
  });
}

// ---------------------------------------------------------------------------
// Connexion : mot de passe maitre ou phrase de recuperation
// ---------------------------------------------------------------------------

function preparerEcranConnexion() {
  elt("texte-mode-connexion").textContent =
    etat.vault && etat.vault.mode === "confort" ? t("connexion.soustitre_confort") : t("connexion.soustitre");
  elt("mdp-connexion").value = "";
  elt("phrase-connexion").value = "";
  elt("erreur-connexion").classList.add("cache");
  elt("erreur-phrase").classList.add("cache");
  basculerOngletConnexion("mdp");
}

function basculerOngletConnexion(onglet) {
  const estPhrase = onglet === "phrase";
  elt("onglet-mdp").classList.toggle("actif", !estPhrase);
  elt("onglet-phrase").classList.toggle("actif", estPhrase);
  elt("panneau-mdp").classList.toggle("cache", estPhrase);
  elt("panneau-phrase").classList.toggle("cache", !estPhrase);
  const disponible = aUneRecuperation(etat.vault);
  elt("phrase-absente").classList.toggle("cache", disponible);
  elt("btn-ouvrir-phrase").disabled = !disponible;
  elt("phrase-connexion").disabled = !disponible;
  if (estPhrase && disponible) {
    elt("phrase-connexion").focus();
  } else if (!estPhrase) {
    elt("mdp-connexion").focus();
  }
}

/** Applique le resultat d'une ouverture (mot de passe ou phrase). */
function appliquerOuverture(ouverture) {
  etat.cle = ouverture.cleEffective;
  etat.cleMaitre = ouverture.cleMaitre || ouverture.materiel || null;
  etat.materielMotDePasse = ouverture.materiel || null;
}

async function ouvrirVault() {
  const champ = elt("mdp-connexion");
  const erreur = elt("erreur-connexion");
  erreur.classList.add("cache");
  const motDePasse = champ.value;
  if (!motDePasse) {
    erreur.textContent = t("erreur.mdp_actuel_requis");
    erreur.classList.remove("cache");
    return;
  }

  const bouton = elt("btn-ouvrir-vault");
  bouton.disabled = true;
  bouton.textContent = t("connexion.derivation_en_cours");

  try {
    const ouverture = await ouvrirAvecMotDePasse(motDePasse, etat.vault);
    if (!ouverture) {
      etat.echecsConnexion += 1;
      // Petite pause qui ralentit les essais repetes.
      const attente = Math.min(etat.echecsConnexion * 300, 3000);
      erreur.textContent =
        t("erreur.mdp_incorrect") + (attente > 900 ? " " + t("erreur.nouvelle_tentative", { s: Math.round(attente / 1000) }) : "");
      erreur.classList.remove("cache");
      await new Promise((r) => setTimeout(r, attente));
      champ.value = "";
      champ.focus();
      return;
    }
    etat.echecsConnexion = 0;
    appliquerOuverture(ouverture);
    champ.value = "";
    entrerDansApplication();
  } catch (erreur$) {
    erreur.textContent = t("erreur.derivation", { detail: erreurRust(erreur$) });
    erreur.classList.remove("cache");
  } finally {
    bouton.disabled = false;
    bouton.textContent = t("connexion.bouton");
  }
}

async function ouvrirVaultParPhrase() {
  const erreur = elt("erreur-phrase");
  erreur.classList.add("cache");

  if (!aUneRecuperation(etat.vault)) {
    erreur.textContent = t("notif.phrase_absente");
    erreur.classList.remove("cache");
    return;
  }

  const controle = verifierPhrase(elt("phrase-connexion").value);
  const attendus = nombreDeMotsAttendus();
  if (controle.nombre !== attendus) {
    erreur.textContent = t("notif.phrase_nombre", { attendu: attendus, saisis: controle.nombre });
    erreur.classList.remove("cache");
    return;
  }
  if (controle.inconnus.length) {
    erreur.textContent = t("notif.phrase_inconnus", { mots: controle.inconnus.join(", ") });
    erreur.classList.remove("cache");
    return;
  }

  const bouton = elt("btn-ouvrir-phrase");
  bouton.disabled = true;
  bouton.textContent = t("connexion.phrase_bouton_en_cours");
  try {
    const ouverture = await ouvrirAvecPhrase(controle.mots.join(" "), etat.vault);
    if (!ouverture) {
      erreur.textContent = t("notif.phrase_incorrecte");
      erreur.classList.remove("cache");
      return;
    }
    appliquerOuverture(ouverture);
    elt("phrase-connexion").value = "";
    entrerDansApplication();
    notifier(t("notif.vault_ouvert_phrase"), "succes");
  } catch (erreur$) {
    erreur.textContent = t("erreur.derivation", { detail: erreurRust(erreur$) });
    erreur.classList.remove("cache");
  } finally {
    bouton.disabled = false;
    bouton.textContent = t("connexion.phrase_bouton");
  }
}

/** Affiche l'ecran principal une fois la cle en memoire. */
function entrerDansApplication() {
  elt("etiquette-mode").textContent = etat.vault.mode === "confort" ? t("principal.mode_confort") : t("principal.mode_strict");
  elt("etiquette-mode").className = "etiquette " + (etat.vault.mode === "confort" ? "confort" : "strict");
  elt("recherche").value = "";
  etat.filtre = "";
  rendreFournisseurs();
  afficherEcran("ecran-principal");
}

/** Efface le mot de passe et la cle de la memoire vive. */
function verrouiller() {
  if (etat.cleMaitre) {
    etat.cleMaitre.fill(0);
  }
  if (etat.materielMotDePasse) {
    etat.materielMotDePasse.fill(0);
  }
  etat.cleMaitre = null;
  etat.materielMotDePasse = null;
  etat.cle = null;
  etat.phraseTemporaire = null;
  etat.recuperationEnAttente = null;
  etat.minuteursMasquage.forEach((m) => clearTimeout(m));
  etat.minuteursMasquage = [];
  preparerEcranConnexion();
  afficherEcran("ecran-connexion");
  elt("mdp-connexion").focus();
}

// ---------------------------------------------------------------------------
// Creation d'un nouveau vault
// ---------------------------------------------------------------------------

function evaluerForce(motDePasse) {
  let score = 0;
  if (motDePasse.length >= LONGUEUR_MINI_MDP) score += 1;
  if (motDePasse.length >= 16) score += 1;
  if (/[a-z]/.test(motDePasse) && /[A-Z]/.test(motDePasse)) score += 1;
  if (/[0-9]/.test(motDePasse)) score += 1;
  if (/[^A-Za-z0-9]/.test(motDePasse)) score += 1;
  return Math.min(score, 5);
}

function majJaugeForce() {
  const valeur = elt("nouveau-mdp").value;
  const score = evaluerForce(valeur);
  const jauge = elt("force-mdp");
  if (!jauge.firstElementChild) {
    const barre = document.createElement("div");
    jauge.appendChild(barre);
  }
  const barre = jauge.firstElementChild;
  const pourcentages = [0, 20, 40, 60, 80, 100];
  const couleurs = ["#f85149", "#f85149", "#d29922", "#d29922", "#3fb950", "#3fb950"];
  barre.style.width = pourcentages[score] + "%";
  barre.style.background = couleurs[score];
}

async function creerVault() {
  const erreur = elt("erreur-creation");
  erreur.classList.add("cache");
  const motDePasse = elt("nouveau-mdp").value;
  const confirmation = elt("nouveau-mdp2").value;

  if (motDePasse.length < LONGUEUR_MINI_MDP) {
    erreur.textContent = t("erreur.mdp_court", { n: LONGUEUR_MINI_MDP });
    erreur.classList.remove("cache");
    return;
  }
  if (motDePasse !== confirmation) {
    erreur.textContent = t("erreur.mdp_differents");
    erreur.classList.remove("cache");
    return;
  }

  const bouton = elt("btn-creer-vault");
  bouton.disabled = true;
  bouton.textContent = t("creation.bouton_en_cours");

  try {
    const parametres = await preparerMotDePasse(motDePasse, null);
    // Cle maitre aleatoire du vault, emballee avec la cle du mot de passe.
    const cleMaitre = genererCleMaitre();
    const emballe = await emballerCleMaitre(parametres.cle, cleMaitre);

    const nouveau = vaultVide();
    nouveau.kdf = {
      salt: parametres.salt,
      iterations: parametres.iterations,
      verify_hash: parametres.verify_hash,
      iv_cle_maitre: emballe.iv,
      cle_maitre_chiffree: emballe.valeur_chiffree
    };
    nouveau.parametres.langue = i18n.langue;
    etat.vault = nouveau;
    etat.cle = await matiereVersCle(cleMaitre);
    etat.cleMaitre = cleMaitre;
    etat.materielMotDePasse = parametres.materiel;

    // Phrase de recuperation : elle emballe la meme cle maitre.
    etat.phraseTemporaire = genererPhraseRecuperation();
    etat.recuperationEnAttente = await preparerRecuperation(cleMaitre, etat.phraseTemporaire.join(" "));
    etat.phraseContexte = "creation";

    elt("nouveau-mdp").value = "";
    elt("nouveau-mdp2").value = "";
    majJaugeForce();
    afficherPhrase("creation");
  } catch (erreur$) {
    erreur.textContent = t("erreur.derivation", { detail: erreurRust(erreur$) });
    erreur.classList.remove("cache");
  } finally {
    bouton.disabled = false;
    bouton.textContent = t("creation.bouton");
  }
}

/** Affiche l'ecran de phrase de recuperation (creation ou activation). */
function afficherPhrase(contexte) {
  etat.phraseContexte = contexte;
  elt("soustitre-phrase").textContent =
    contexte === "activation" ? t("phrase.sous_titre_activation") : t("phrase.sous_titre");
  elt("phrase-corps-1").textContent = contexte === "activation" ? t("phrase.corps_activation_1") : t("phrase.corps_1");
  elt("phrase-corps-2").textContent = contexte === "activation" ? t("phrase.corps_activation_2") : t("phrase.corps_2");

  const liste = elt("liste-phrase");
  liste.innerHTML = "";
  (etat.phraseTemporaire || []).forEach((mot) => {
    const element = document.createElement("li");
    element.textContent = mot;
    liste.appendChild(element);
  });
  elt("case-phrase-notee").checked = false;
  elt("btn-phrase-continuer").disabled = true;
  afficherEcran("ecran-phrase");
}

/** Appele quand l'utilisateur confirme avoir note la phrase. */
async function finaliserPhrase() {
  const contexte = etat.phraseContexte;
  try {
    if (contexte === "creation") {
      etat.vault.recuperation = etat.recuperationEnAttente;
      await sauvegarderVault();
      notifier(t("notif.vault_cree", { chemin: await appel("chemin_du_vault") }), "succes");
      etat.phraseTemporaire = null;
      etat.recuperationEnAttente = null;
      elt("liste-phrase").innerHTML = "";
      entrerDansApplication();
      return;
    }
    // Activation : le vault a deja ete enregistre avant l'affichage.
    etat.phraseTemporaire = null;
    etat.recuperationEnAttente = null;
    elt("liste-phrase").innerHTML = "";
    majEcranParametres();
    afficherEcran("ecran-parametres");
    notifier(t("notif.recuperation_activee"), "succes");
  } catch (erreur) {
    notifier(t("notif.ecriture_vault_impossible", { detail: erreurRust(erreur) }), "erreur");
  }
}

// ---------------------------------------------------------------------------
// Ecran principal
// ---------------------------------------------------------------------------

function rendreFournisseurs() {
  const zone = elt("liste-fournisseurs");
  const filtre = etat.filtre.trim().toLowerCase();
  const liste = trierFournisseurs(etat.vault.fournisseurs).filter(
    (f) => !filtre || String(f.nom).toLowerCase().includes(filtre)
  );

  zone.innerHTML = "";
  const vide = elt("aucun-fournisseur");
  vide.classList.toggle("cache", liste.length > 0);
  if (etat.vault.fournisseurs.length === 0) {
    vide.textContent = t("principal.aucun");
  } else if (liste.length === 0) {
    vide.textContent = t("principal.aucun_filtre");
  }

  liste.forEach((fournisseur) => {
    const carte = document.createElement("div");
    carte.className = "fournisseur";
    carte.dataset.id = fournisseur.id;

    const urls = fournisseur.urls
      .map(
        (url, index) =>
          '<div class="ligne-element">' +
          '<span class="libelle">' + echapper(url.libelle) + "</span>" +
          "<code>" + echapper(url.adresse) + "</code>" +
          '<button class="btn secondaire mini" data-action="copier-url" data-id="' + echapper(fournisseur.id) + '" data-index="' + index + '">' + t("commun.copier") + "</button>" +
          "</div>"
      )
      .join("");

    const cles = fournisseur.cles
      .map(
        (cle, index) =>
          '<div class="ligne-element">' +
          '<span class="libelle">' + echapper(cle.libelle) + "</span>" +
          '<code class="valeur" data-id="' + echapper(fournisseur.id) + '" data-index="' + index + '">******</code>' +
          '<span class="date">' + echapper(cle.date_ajout) + "</span>" +
          '<button class="btn secondaire mini" data-action="reveler" data-id="' + echapper(fournisseur.id) + '" data-index="' + index + '">' + t("commun.reveler") + "</button>" +
          '<button class="btn secondaire mini" data-action="copier-cle" data-id="' + echapper(fournisseur.id) + '" data-index="' + index + '">' + t("commun.copier") + "</button>" +
          "</div>"
      )
      .join("");

    carte.innerHTML =
      '<div class="fournisseur-entete">' +
      "<h3>" + echapper(fournisseur.nom) + "</h3>" +
      '<span class="compteur">' + tPluriel("principal.cles", fournisseur.cles.length) + "</span>" +
      '<button class="btn principal mini" data-action="copier-toutes-cles" data-id="' + echapper(fournisseur.id) + '">' + t("principal.copier_cles") + "</button>" +
      '<button class="btn secondaire mini" data-action="modifier" data-id="' + echapper(fournisseur.id) + '">' + t("commun.modifier") + "</button>" +
      '<button class="btn danger mini" data-action="supprimer" data-id="' + echapper(fournisseur.id) + '">' + t("commun.supprimer") + "</button>" +
      "</div>" +
      '<div class="bloc-interne"><h4>' + t("principal.urls_titre", { n: fournisseur.urls.length }) + "</h4>" +
      (fournisseur.urls.length ? urls : '<p class="aide">' + t("principal.aucune_url") + "</p>") +
      "</div>" +
      '<div class="bloc-interne"><h4>' + t("principal.cles_titre", { n: fournisseur.cles.length }) + "</h4>" +
      (fournisseur.cles.length ? cles : '<p class="aide">' + t("principal.aucune_cle") + "</p>") +
      "</div>";

    zone.appendChild(carte);
  });

  const total = etat.vault.fournisseurs.reduce((somme, f) => somme + f.cles.length, 0);
  const totalUrls = etat.vault.fournisseurs.reduce((somme, f) => somme + f.urls.length, 0);
  elt("compteur-global").textContent = [
    tPluriel("principal.fournisseurs", etat.vault.fournisseurs.length),
    tPluriel("principal.cles", total),
    tPluriel("principal.urls", totalUrls)
  ].join(" - ");

  elt("etiquette-mode").textContent = etat.vault.mode === "confort" ? t("principal.mode_confort") : t("principal.mode_strict");
}

async function copierUrl(idFournisseur, index) {
  const fournisseur = trouverFournisseur(idFournisseur);
  if (!fournisseur || !fournisseur.urls[index]) {
    notifier(t("notif.url_introuvable"), "erreur");
    return;
  }
  await copierAvecEffacement(fournisseur.urls[index].adresse, t("notif.url_description", { libelle: fournisseur.urls[index].libelle }));
}

async function dechiffrerCle(idFournisseur, index) {
  const fournisseur = trouverFournisseur(idFournisseur);
  if (!fournisseur || !fournisseur.cles[index]) {
    throw new Error("cle introuvable");
  }
  const cle = fournisseur.cles[index];
  return dechiffrerValeur(etat.cle, cle.iv, cle.valeur_chiffree);
}

async function copierCle(idFournisseur, index) {
  try {
    const valeur = await dechiffrerCle(idFournisseur, index);
    await copierAvecEffacement(valeur, t("notif.description_cle"));
  } catch (erreur) {
    notifier(t("notif.dechiffrement_impossible", { detail: erreurRust(erreur) }), "erreur");
  }
}

async function copierToutesLesCles(idFournisseur) {
  const fournisseur = trouverFournisseur(idFournisseur);
  if (!fournisseur) {
    return;
  }
  if (fournisseur.cles.length === 0) {
    notifier(t("notif.aucune_cle"), "avertir");
    return;
  }
  const lignes = [];
  for (let i = 0; i < fournisseur.cles.length; i++) {
    try {
      lignes.push(fournisseur.cles[i].libelle + " : " + (await dechiffrerCle(idFournisseur, i)));
    } catch (erreur) {
      lignes.push(fournisseur.cles[i].libelle + " : " + t("notif.dechiffrement_impossible", { detail: "" }).trim());
    }
  }
  await copierAvecEffacement(lignes.join("\n"), t("notif.cles_description", { n: fournisseur.cles.length }));
}

async function basculerRevelation(bouton, idFournisseur, index) {
  const code = document.querySelector('code.valeur[data-id="' + idFournisseur + '"][data-index="' + index + '"]');
  if (!code) {
    return;
  }
  if (bouton.dataset.revele === "1") {
    code.textContent = "******";
    bouton.dataset.revele = "0";
    bouton.textContent = t("commun.reveler");
    return;
  }
  try {
    const valeur = await dechiffrerCle(idFournisseur, index);
    code.textContent = valeur;
    bouton.dataset.revele = "1";
    bouton.textContent = t("commun.masquer");
    const minuterie = setTimeout(() => {
      if (code.isConnected) {
        code.textContent = "******";
        bouton.dataset.revele = "0";
        bouton.textContent = t("commun.reveler");
      }
    }, DUREE_MASQUAGE_VALEUR);
    etat.minuteursMasquage.push(minuterie);
  } catch (erreur) {
    notifier(t("notif.dechiffrement_impossible", { detail: erreurRust(erreur) }), "erreur");
  }
}

// ---------------------------------------------------------------------------
// Ajout / modification / suppression d'un fournisseur
// ---------------------------------------------------------------------------

async function supprimerFournisseur(idFournisseur) {
  const fournisseur = trouverFournisseur(idFournisseur);
  if (!fournisseur) {
    return;
  }
  const confirme = await demanderConfirmation(
    "modale.suppr_fournisseur_titre",
    "<p>" + echapper(t("modale.suppr_fournisseur_corps", { nom: fournisseur.nom, n: fournisseur.cles.length })) + "</p>" +
      '<p class="avertissement">' + echapper(t("modale.suppr_fournisseur_avertissement")) + "</p>",
    "commun.supprimer"
  );
  if (!confirme) {
    return;
  }
  etat.vault.fournisseurs = etat.vault.fournisseurs.filter((f) => f.id !== idFournisseur);
  try {
    await sauvegarderVault();
    rendreFournisseurs();
    notifier(t("notif.fournisseur_supprime"), "succes");
  } catch (erreur) {
    notifier(t("notif.ecriture_vault_impossible", { detail: erreurRust(erreur) }), "erreur");
  }
}

/** Propose un nom libre du type "OpenRouter 2". */
function proposerNomLibre(nom) {
  const base = String(nom).trim();
  let compteur = 2;
  const pris = new Set(etat.vault.fournisseurs.map((f) => normaliserNom(f.nom)));
  while (compteur < 1000) {
    const candidat = base + " " + compteur;
    if (!pris.has(normaliserNom(candidat))) {
      return candidat;
    }
    compteur += 1;
  }
  return base + " " + Date.now();
}

function ligneUrlHtml(url) {
  return (
    '<div class="ligne-form">' +
    '<input class="libelle-champ" type="text" data-role="url-libelle" placeholder="' + echapper(t("fournisseur.url_libelle")) + '" value="' + echapper(url ? url.libelle : "") + '" />' +
    '<input type="text" data-role="url-adresse" placeholder="' + echapper(t("fournisseur.url_adresse")) + '" value="' + echapper(url ? url.adresse : "") + '" />' +
    '<button class="btn danger mini" data-action="retirer-ligne" type="button">' + t("fournisseur.retirer") + "</button>" +
    "</div>"
  );
}

function ligneCleHtml(cle, index) {
  const etiquette = cle ? t("fournisseur.cle_valeur_conservee") : t("fournisseur.cle_valeur");
  const libelle = cle ? cle.libelle : "";
  const classeNouvelle = cle ? ' data-index="' + index + '"' : ' data-nouvelle="1"';
  const valeur = cle ? "" : "";
  return (
    '<div class="ligne-form"' + classeNouvelle + ">" +
    '<input class="libelle-champ" type="text" data-role="cle-libelle" placeholder="' + echapper(t("fournisseur.cle_libelle")) + '" value="' + echapper(libelle) + '" />' +
    '<input type="password" data-role="cle-valeur" placeholder="' + echapper(etiquette) + '" value="' + echapper(valeur) + '" />' +
    '<button class="btn danger mini" data-action="retirer-ligne" type="button">' + t("fournisseur.retirer") + "</button>" +
    "</div>"
  );
}

function ouvrirModaleFournisseur(idExistant) {
  const fournisseur = idExistant ? trouverFournisseur(idExistant) : null;
  const urlsHtml = (fournisseur && fournisseur.urls.length ? fournisseur.urls : [null]).map(ligneUrlHtml).join("");
  const clesHtml = (fournisseur && fournisseur.cles.length ? fournisseur.cles : [null])
    .map((c, i) => ligneCleHtml(c, i))
    .join("");

  ouvrirModale({
    titreCle: fournisseur ? "fournisseur.modifier_titre" : "fournisseur.ajouter_titre",
    corpsHtml:
      '<label class="champ"><span>' + t("fournisseur.nom") + '</span><input type="text" id="fournisseur-nom" placeholder="' +
      echapper(t("fournisseur.nom_placeholder")) + '" value="' + echapper(fournisseur ? fournisseur.nom : "") + '" /></label>' +
      '<div class="sous-bloc"><h3>' + t("fournisseur.urls_titre") + '</h3><div id="lignes-urls">' + urlsHtml + "</div>" +
      '<button class="btn secondaire petit" data-action="ajouter-url" type="button">' + t("fournisseur.url_ajouter") + "</button></div>" +
      '<div class="sous-bloc"><h3>' + t("fournisseur.cles_titre") + '</h3><div id="lignes-cles">' + clesHtml + "</div>" +
      '<button class="btn secondaire petit" data-action="ajouter-cle" type="button">' + t("fournisseur.cle_ajouter") + "</button></div>" +
      '<p id="erreur-fournisseur" class="erreur cache"></p>',
    surAfficher: (corps) => {
      const nom = corps.querySelector("#fournisseur-nom");
      if (nom) {
        nom.focus();
      }
    },
    boutons: [
      { texteCle: "commun.annuler", classe: "secondaire", action: () => {} },
      {
        texteCle: fournisseur ? "commun.enregistrer" : "commun.ajouter",
        classe: "principal",
        action: (corps) => enregistrerFournisseur(corps, idExistant)
      }
    ]
  });
}

/** Enregistre le formulaire fournisseur. Renvoie false pour garder la modale ouverte. */
async function enregistrerFournisseur(corps, idExistant) {
  const erreur = corps.querySelector("#erreur-fournisseur");
  const signaler = (contenuHtml) => {
    erreur.innerHTML = contenuHtml;
    erreur.classList.remove("cache");
    return false;
  };
  erreur.classList.add("cache");

  const nom = corps.querySelector("#fournisseur-nom").value.trim();
  if (!nom) {
    return signaler(echapper(t("erreur.nom_obligatoire")));
  }

  // Unicite des noms : refus + proposition de renommage.
  const homonyme = etat.vault.fournisseurs.find((f) => f.id !== idExistant && normaliserNom(f.nom) === normaliserNom(nom));
  if (homonyme) {
    const suggestion = proposerNomLibre(nom);
    return signaler(
      echapper(t("erreur.nom_double", { nom: nom })) +
        '<br /><button class="btn secondaire petit" data-action="utiliser-suggestion" data-suggestion="' +
        echapper(suggestion) + '" type="button">' + echapper(t("erreur.renommer_bouton", { nom: suggestion })) + "</button>"
    );
  }

  // URLs variantes.
  const urls = [];
  let urlIncomplete = false;
  corps.querySelectorAll("#lignes-urls .ligne-form").forEach((ligne) => {
    const libelle = ligne.querySelector('[data-role="url-libelle"]').value.trim();
    const adresse = ligne.querySelector('[data-role="url-adresse"]').value.trim();
    if (!libelle && !adresse) {
      return;
    }
    if (!adresse) {
      urlIncomplete = true;
      return;
    }
    urls.push({ libelle: libelle || "URL", adresse: adresse });
  });
  if (urlIncomplete) {
    return signaler(echapper(t("erreur.url_adresse")));
  }

  // Cles API : les nouvelles valeurs sont chiffrees immediatement, avant toute
  // ecriture sur le disque (aucune cle en clair dans vault.json).
  const anciennes = idExistant ? trouverFournisseur(idExistant).cles : [];
  const cles = [];
  const nouvelles = [];
  let cleIncomplete = false;

  corps.querySelectorAll("#lignes-cles .ligne-form").forEach((ligne) => {
    const libelle = ligne.querySelector('[data-role="cle-libelle"]').value.trim();
    const valeur = ligne.querySelector('[data-role="cle-valeur"]').value;
    if (ligne.dataset.nouvelle === "1") {
      if (!libelle && !valeur) {
        return;
      }
      if (!libelle || !valeur) {
        cleIncomplete = true;
        return;
      }
      nouvelles.push({ libelle: libelle, valeur: valeur });
      return;
    }
    const index = Number(ligne.dataset.index);
    const existante = anciennes[index];
    if (!existante) {
      return;
    }
    cles.push({
      libelle: libelle || existante.libelle,
      iv: existante.iv,
      valeur_chiffree: existante.valeur_chiffree,
      date_ajout: existante.date_ajout,
      remplacer: valeur ? valeur : null
    });
  });

  if (cleIncomplete) {
    return signaler(echapper(t("erreur.cle_complete")));
  }

  try {
    for (const entree of cles) {
      if (entree.remplacer !== null) {
        const chiffre = await chiffrerValeur(etat.cle, entree.remplacer);
        entree.iv = chiffre.iv;
        entree.valeur_chiffree = chiffre.valeur_chiffree;
      }
      delete entree.remplacer;
    }
    for (const nouvelle of nouvelles) {
      const chiffre = await chiffrerValeur(etat.cle, nouvelle.valeur);
      cles.push({
        libelle: nouvelle.libelle,
        iv: chiffre.iv,
        valeur_chiffree: chiffre.valeur_chiffree,
        date_ajout: dateDuJour()
      });
    }

    if (idExistant) {
      const fournisseur = trouverFournisseur(idExistant);
      fournisseur.nom = nom;
      fournisseur.urls = urls;
      fournisseur.cles = cles;
    } else {
      etat.vault.fournisseurs.push({ id: nouvelIdentifiant(), nom: nom, urls: urls, cles: cles });
    }

    await sauvegarderVault();
    rendreFournisseurs();
    notifier(t(idExistant ? "notif.fournisseur_modifie" : "notif.fournisseur_ajoute"), "succes");
    return true;
  } catch (erreur$) {
    return signaler(echapper(t("erreur.chiffrement_ecriture", { detail: erreurRust(erreur$) })));
  }
}

// ---------------------------------------------------------------------------
// Parametres
// ---------------------------------------------------------------------------

function majEcranParametres() {
  elt("mode-strict").checked = etat.vault.mode !== "confort";
  elt("mode-confort").checked = etat.vault.mode === "confort";
  elt("case-presse-papiers").checked = effacementPressePapiersActif();
  elt("selecteur-langue").value = i18n.langue;

  const active = aUneRecuperation(etat.vault);
  elt("etat-recuperation").textContent = active ? t("parametres.recuperation_active") : t("parametres.recuperation_inactive");
  elt("etat-recuperation").className = "aide " + (active ? "etat-ok" : "");
  elt("btn-recuperation").textContent = active ? t("parametres.recuperation_regenerer") : t("parametres.recuperation_activer");
}

async function changerMode(nouveauMode) {
  if (!etat.vault || etat.vault.mode === nouveauMode) {
    return;
  }
  if (nouveauMode === "confort") {
    const confirme = await demanderConfirmation(
      "modale.confort_titre",
      "<p>" + echapper(t("modale.confort_corps")) + "</p>" +
        '<p class="avertissement">' + echapper(t("parametres.mode_avertissement")) + "</p>",
      "modale.confort_bouton",
      "principal"
    );
    if (!confirme) {
      majEcranParametres();
      return;
    }
    try {
      if (!etat.cleMaitre) {
        notifier(t("erreur.cle_maitre_absente"), "erreur");
        majEcranParametres();
        return;
      }
      etat.vault.mode = "confort";
      etat.vault.kdf.cle_memorisee = octetsVersBase64(etat.cleMaitre);
      await sauvegarderVault();
      majEcranParametres();
      rendreFournisseurs();
      notifier(t("notif.mode_confort_active"), "succes");
    } catch (erreur) {
      notifier(t("notif.changement_mode_impossible", { detail: erreurRust(erreur) }), "erreur");
    }
    return;
  }

  try {
    etat.vault.mode = "strict";
    delete etat.vault.kdf.cle_memorisee;
    await sauvegarderVault();
    majEcranParametres();
    rendreFournisseurs();
    notifier(t("notif.mode_strict_active"), "succes");
  } catch (erreur) {
    notifier(t("notif.changement_mode_impossible", { detail: erreurRust(erreur) }), "erreur");
  }
}

async function changerMotDePasse() {
  const erreur = elt("erreur-mdp");
  const signaler = (message) => {
    erreur.textContent = message;
    erreur.classList.remove("cache");
    return false;
  };
  erreur.classList.add("cache");

  const actuel = elt("mdp-actuel").value;
  const nouveau = elt("mdp-nouveau").value;
  const confirmation = elt("mdp-nouveau2").value;

  if (!actuel) {
    return signaler(t("erreur.mdp_actuel_requis"));
  }
  if (nouveau.length < LONGUEUR_MINI_MDP) {
    return signaler(t("erreur.nouveau_court", { n: LONGUEUR_MINI_MDP }));
  }
  if (nouveau !== confirmation) {
    return signaler(t("erreur.nouveau_differents"));
  }

  const bouton = elt("btn-changer-mdp");
  bouton.disabled = true;
  bouton.textContent = t("parametres.mdp_bouton_en_cours");

  try {
    const ancien = await ouvrirAvecMotDePasse(actuel, etat.vault);
    if (!ancien) {
      return signaler(t("erreur.mdp_actuel_incorrect"));
    }

    // Nouveau salt + nouvelle cle de mot de passe.
    const parametres = await preparerMotDePasse(nouveau, null);

    if (ancien.cleMaitre) {
      // Format 2 : on ne rechiffre que la cle maitre du vault. Les cles API
      // restent inchangees, et la phrase de recuperation reste valable.
      const emballe = await emballerCleMaitre(parametres.cle, ancien.cleMaitre);
      etat.vault.kdf.iv_cle_maitre = emballe.iv;
      etat.vault.kdf.cle_maitre_chiffree = emballe.valeur_chiffree;
      etat.cle = await matiereVersCle(ancien.cleMaitre);
      etat.cleMaitre = ancien.cleMaitre;
    } else {
      // Format 1 : les cles API doivent etre rechiffrees une par une.
      for (const fournisseur of etat.vault.fournisseurs) {
        for (const cle of fournisseur.cles) {
          let valeur = null;
          try {
            valeur = await dechiffrerValeur(ancien.cleEffective, cle.iv, cle.valeur_chiffree);
          } catch (erreurDechiffrement) {
            throw new Error(t("erreur.dechiffrement_cle", { nom: fournisseur.nom }));
          }
          const chiffre = await chiffrerValeur(parametres.cle, valeur);
          cle.iv = chiffre.iv;
          cle.valeur_chiffree = chiffre.valeur_chiffree;
          valeur = null;
        }
      }
      etat.cle = parametres.cle;
      etat.cleMaitre = parametres.materiel;
    }

    etat.vault.kdf.salt = parametres.salt;
    etat.vault.kdf.iterations = parametres.iterations;
    etat.vault.kdf.verify_hash = parametres.verify_hash;
    etat.materielMotDePasse = parametres.materiel;
    if (etat.vault.mode === "confort") {
      etat.vault.kdf.cle_memorisee = octetsVersBase64(etat.cleMaitre);
    }

    await sauvegarderVault();
    elt("mdp-actuel").value = "";
    elt("mdp-nouveau").value = "";
    elt("mdp-nouveau2").value = "";
    notifier(t(ancien.cleMaitre ? "notif.mdp_change_v2" : "notif.mdp_change_v1"), "succes");
    rendreFournisseurs();
    return true;
  } catch (erreur$) {
    return signaler(erreurRust(erreur$));
  } finally {
    bouton.disabled = false;
    bouton.textContent = t("parametres.mdp_bouton");
  }
}

/**
 * Active (ou regenere) la recuperation par phrase.
 * Pour un vault de format 1, les cles API sont rechiffrees avec une nouvelle
 * cle maitre aleatoire : le vault passe au format 2.
 */
async function activerRecuperation() {
  const dejaActive = aUneRecuperation(etat.vault);
  if (dejaActive) {
    const confirme = await demanderConfirmation(
      "modale.regenerer_titre",
      "<p>" + echapper(t("modale.regenerer_corps")) + "</p>",
      "modale.regenerer_bouton",
      "principal"
    );
    if (!confirme) {
      return;
    }
  }

  const motDePasse = await demanderMotDePasse(
    "modale.activation_titre",
    t("modale.activation_corps"),
    "modale.mdp_label_actuel"
  );
  if (motDePasse === null) {
    return;
  }

  const bouton = elt("btn-recuperation");
  bouton.disabled = true;
  try {
    const ouverture = await ouvrirAvecMotDePasse(motDePasse, etat.vault);
    if (!ouverture) {
      notifier(t("erreur.mdp_actuel_incorrect"), "erreur");
      return;
    }

    let cleMaitre = ouverture.cleMaitre;
    if (!cleMaitre) {
      // Format 1 -> format 2 : nouvelle cle maitre et rechiffrement des cles.
      cleMaitre = genererCleMaitre();
      const nouvelleCle = await matiereVersCle(cleMaitre);
      for (const fournisseur of etat.vault.fournisseurs) {
        for (const cle of fournisseur.cles) {
          let valeur = null;
          try {
            valeur = await dechiffrerValeur(ouverture.cleEffective, cle.iv, cle.valeur_chiffree);
          } catch (erreurDechiffrement) {
            throw new Error(t("erreur.dechiffrement_cle", { nom: fournisseur.nom }));
          }
          const chiffre = await chiffrerValeur(nouvelleCle, valeur);
          cle.iv = chiffre.iv;
          cle.valeur_chiffree = chiffre.valeur_chiffree;
          valeur = null;
        }
      }
      const emballe = await emballerCleMaitre(ouverture.cleMotDePasse, cleMaitre);
      etat.vault.kdf.iv_cle_maitre = emballe.iv;
      etat.vault.kdf.cle_maitre_chiffree = emballe.valeur_chiffree;
      etat.vault.version = VERSION_FORMAT;
      etat.cle = nouvelleCle;
      etat.cleMaitre = cleMaitre;
      if (etat.vault.mode === "confort") {
        etat.vault.kdf.cle_memorisee = octetsVersBase64(cleMaitre);
      }
    }

    // Nouvelle phrase, emballant la meme cle maitre.
    const phrase = genererPhraseRecuperation();
    etat.vault.recuperation = await preparerRecuperation(cleMaitre, phrase.join(" "));
    await sauvegarderVault();
    etat.phraseTemporaire = phrase;
    etat.recuperationEnAttente = etat.vault.recuperation;
    afficherPhrase("activation");
  } catch (erreur) {
    notifier(t("notif.enregistrement_impossible", { detail: erreurRust(erreur) }), "erreur");
  } finally {
    bouton.disabled = false;
    majEcranParametres();
  }
}

async function basculerEffacementPressePapiers() {
  const actif = elt("case-presse-papiers").checked;
  etat.vault.parametres.effacement_presse_papiers = actif;
  try {
    await sauvegarderVault();
    notifier(t(actif ? "notif.presse_option_active" : "notif.presse_option_desactive"), "info");
  } catch (erreur) {
    notifier(t("notif.enregistrement_impossible", { detail: erreurRust(erreur) }), "erreur");
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

async function ecrireExport(nom, contenu) {
  const chemin = await appel("ecrire_export", { nom: nom, contenu: contenu });
  notifier(t("notif.export_ecrit", { chemin: chemin }), "succes");
  return chemin;
}

/** Export chiffre .vaultbackup (reutilise le mot de passe maitre). */
async function exporterChiffre() {
  try {
    const blocKdf = {
      algorithme: "PBKDF2-SHA256",
      salt: etat.vault.kdf.salt,
      iterations: etat.vault.kdf.iterations,
      verify_hash: etat.vault.kdf.verify_hash
    };
    if (etat.vault.kdf.iv_cle_maitre && etat.vault.kdf.cle_maitre_chiffree) {
      blocKdf.iv_cle_maitre = etat.vault.kdf.iv_cle_maitre;
      blocKdf.cle_maitre_chiffree = etat.vault.kdf.cle_maitre_chiffree;
    }
    // La sauvegarde force le mode strict : une restauration redemandera le mot de passe.
    const copie = JSON.parse(JSON.stringify(etat.vault));
    copie.mode = "strict";
    delete copie.kdf.cle_memorisee;
    const chiffre = await chiffrerDocument(etat.cle, JSON.stringify(copie, null, 2));
    const document = {
      format: "apivault-3-vaultbackup",
      version: 1,
      exporte_le: dateDuJour() + " " + heureLocale(),
      avertissement: t("export.backup_avertissement"),
      chiffrement: {
        algorithme: "AES-256-GCM",
        kdf: blocKdf,
        iv: chiffre.iv,
        donnees: chiffre.valeur_chiffree
      }
    };
    await ecrireExport("apivault-3-sauvegarde-" + horodatage() + ".vaultbackup", JSON.stringify(document, null, 2));
  } catch (erreur) {
    notifier(t("notif.export_impossible", { detail: erreurRust(erreur) }), "erreur");
  }
}

/** Construit la structure en clair (cles dechiffrees) pour les exports lisibles. */
async function construireStructureEnClair() {
  const fournisseurs = [];
  for (const fournisseur of trierFournisseurs(etat.vault.fournisseurs)) {
    const cles = [];
    for (const cle of fournisseur.cles) {
      let valeur = "";
      try {
        valeur = await dechiffrerValeur(etat.cle, cle.iv, cle.valeur_chiffree);
      } catch (erreur) {
        valeur = "[" + t("notif.dechiffrement_impossible", { detail: "" }).trim() + "]";
      }
      cles.push({ libelle: cle.libelle, valeur: valeur, date_ajout: cle.date_ajout });
    }
    fournisseurs.push({ id: fournisseur.id, nom: fournisseur.nom, urls: fournisseur.urls, cles: cles });
  }
  return fournisseurs;
}

/** Confirmation obligatoire avant tout export en clair. */
function confirmerExportEnClair() {
  return demanderConfirmation(
    "modale.export_clair_titre",
    "<p>" + echapper(t("modale.export_clair_corps")) + "</p>" +
      '<p class="avertissement">' + echapper(t("modale.export_clair_avertissement")) + "</p>",
    "modale.export_clair_bouton",
    "danger"
  );
}

async function exporterJsonClair() {
  const confirme = await confirmerExportEnClair();
  if (!confirme) {
    return;
  }
  try {
    const fournisseurs = await construireStructureEnClair();
    const document = {
      AVERTISSEMENT: t("export.avertissement_json"),
      version: VERSION_FORMAT,
      exporte_le: dateDuJour() + " " + heureLocale(),
      fournisseurs: fournisseurs
    };
    await ecrireExport("apivault-3-en-clair-" + horodatage() + ".json", JSON.stringify(document, null, 2));
  } catch (erreur) {
    notifier(t("notif.export_impossible", { detail: erreurRust(erreur) }), "erreur");
  }
}

async function exporterHtmlClair() {
  const confirme = await confirmerExportEnClair();
  if (!confirme) {
    return;
  }
  try {
    const fournisseurs = await construireStructureEnClair();
    const blocs = fournisseurs
      .map((fournisseur) => {
        const lignesUrls = fournisseur.urls
          .map((u) => "<tr><td>" + echapper(u.libelle) + "</td><td><code>" + echapper(u.adresse) + "</code></td></tr>")
          .join("");
        const lignesCles = fournisseur.cles
          .map(
            (c) =>
              "<tr><td>" + echapper(c.libelle) + "</td><td><code>" + echapper(c.valeur) + "</code></td><td>" + echapper(c.date_ajout) + "</td></tr>"
          )
          .join("");
        return (
          "<h2>" + echapper(fournisseur.nom) + "</h2>" +
          "<h3>" + t("export.urls_titre") + "</h3><table><thead><tr><th>" + t("export.col_libelle") + "</th><th>" + t("export.col_adresse") + "</th></tr></thead><tbody>" +
          (lignesUrls || '<tr><td colspan="2">' + t("export.aucune_url") + "</td></tr>") +
          "</tbody></table>" +
          "<h3>" + t("export.cles_titre") + "</h3><table><thead><tr><th>" + t("export.col_libelle") + "</th><th>" + t("export.col_valeur") + "</th><th>" + t("export.col_date") + "</th></tr></thead><tbody>" +
          (lignesCles || '<tr><td colspan="3">' + t("export.aucune_cle") + "</td></tr>") +
          "</tbody></table>"
        );
      })
      .join("");

    const page =
      '<!DOCTYPE html>\n<html lang="' + i18n.langue + '"><head><meta charset="UTF-8" />' +
      "<title>" + echapper(t("export.titre_page")) + "</title><style>" +
      "body{font-family:'Segoe UI',Tahoma,sans-serif;background:#fff;color:#111;margin:0;padding:28px;}" +
      "h1{font-size:24px;}h2{font-size:19px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:6px;}" +
      "h3{font-size:15px;color:#444;}" +
      ".banniere-rouge{background:#ffe5e3;border:3px solid #c0392b;color:#a01c12;padding:16px 18px;border-radius:8px;font-weight:700;font-size:16px;}" +
      "table{width:100%;border-collapse:collapse;margin:10px 0 22px;}" +
      "th,td{border:1px solid #ccc;padding:8px 10px;text-align:left;vertical-align:top;}" +
      "th{background:#f2f2f2;}code{background:#f6f6f6;padding:2px 5px;border-radius:4px;word-break:break-all;}" +
      "</style></head><body>" +
      "<h1>" + echapper(t("export.titre_page")) + "</h1>" +
      '<p class="banniere-rouge">' + echapper(t("export.banniere")) + "</p>" +
      "<p>" + echapper(t("export.exporte_le", { date: dateDuJour() + " " + heureLocale() })) + "</p>" +
      blocs +
      "</body></html>";

    await ecrireExport("apivault-3-en-clair-" + horodatage() + ".html", page);
  } catch (erreur) {
    notifier(t("notif.export_impossible", { detail: erreurRust(erreur) }), "erreur");
  }
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

function listeFichiersHtml(noms, avecSuppression) {
  if (!noms.length) {
    return '<p class="aide">' + t("import.aucun_fichier") + "</p>";
  }
  return noms
    .map(
      (nom) =>
        '<div class="ligne-fichier"><span class="nom">' + echapper(nom) + "</span>" +
        '<button class="btn principal mini" data-action="importer-fichier" data-nom="' + echapper(nom) + '">' + t("commun.importer") + "</button>" +
        (avecSuppression
          ? '<button class="btn danger mini" data-action="supprimer-fichier" data-nom="' + echapper(nom) + '">' + t("commun.supprimer") + "</button>"
          : "") +
        "</div>"
    )
    .join("");
}

async function rafraichirListeFichiers(zoneId, avecSuppression) {
  const zone = elt(zoneId);
  if (!zone) {
    return;
  }
  try {
    const noms = await appel("lister_exports");
    zone.innerHTML = listeFichiersHtml(noms, avecSuppression);
  } catch (erreur) {
    zone.innerHTML = '<p class="erreur">' + echapper(t("notif.lecture_exports_impossible", { detail: erreurRust(erreur) })) + "</p>";
  }
}

/** Determine le type d'un document importe. */
function analyserDocumentImporte(document) {
  if (!document || typeof document !== "object") {
    throw new Error(t("erreur.import_vide"));
  }
  if (document.format === "apivault-3-vaultbackup" && document.chiffrement) {
    return "chiffre";
  }
  if (Array.isArray(document.fournisseurs)) {
    const clair = document.fournisseurs.some(
      (f) => Array.isArray(f.cles) && f.cles.some((c) => typeof c.valeur === "string")
    );
    const chiffre = document.fournisseurs.some(
      (f) => Array.isArray(f.cles) && f.cles.some((c) => typeof c.valeur_chiffree === "string")
    );
    if (clair) {
      return "clair";
    }
    if (chiffre && document.kdf && document.kdf.verify_hash) {
      return "vault";
    }
  }
  throw new Error(t("erreur.import_format"));
}

/** Chiffre une liste de cles en clair avec la cle fournie. */
async function chiffrerClesEnClair(fournisseurs, cle) {
  const resultat = [];
  for (const fournisseur of fournisseurs) {
    const cles = [];
    for (const entree of Array.isArray(fournisseur.cles) ? fournisseur.cles : []) {
      const valeur = String(entree.valeur === undefined || entree.valeur === null ? "" : entree.valeur);
      if (valeur === "" || valeur.indexOf("[") === 0) {
        continue;
      }
      const chiffre = await chiffrerValeur(cle, valeur);
      cles.push({
        libelle: String(entree.libelle || "cle"),
        iv: chiffre.iv,
        valeur_chiffree: chiffre.valeur_chiffree,
        date_ajout: String(entree.date_ajout || dateDuJour())
      });
    }
    resultat.push({
      id: fournisseur.id || nouvelIdentifiant(),
      nom: String(fournisseur.nom || "?"),
      urls: (Array.isArray(fournisseur.urls) ? fournisseur.urls : []).map((u) => ({
        libelle: String(u.libelle || "URL"),
        adresse: String(u.adresse || "")
      })),
      cles: cles
    });
  }
  return resultat;
}

/** Verifie qu'aucun nom de fournisseur n'est duplique dans un import. */
function nomsUniques(fournisseurs) {
  const vus = new Set();
  for (const fournisseur of fournisseurs) {
    const cle = normaliserNom(fournisseur.nom);
    if (vus.has(cle)) {
      return fournisseur.nom;
    }
    vus.add(cle);
  }
  return null;
}

/**
 * Applique un document importe.
 * contexte.vaultOuvert = true si un vault est deja deverrouille.
 */
async function importerDocument(document, contexte) {
  const type = analyserDocumentImporte(document);

  if (type === "chiffre") {
    const chiffrement = document.chiffrement;
    const kdf = chiffrement.kdf || {};
    if (!kdf.salt || !kdf.verify_hash) {
      throw new Error(t("erreur.sauvegarde_incomplete"));
    }
    const motDePasse = await demanderMotDePasse(
      "modale.sauvegarde_titre",
      t("modale.sauvegarde_corps"),
      "modale.mdp_label_sauvegarde"
    );
    if (motDePasse === null) {
      return false;
    }
    const ouverture = await ouvrirAvecMotDePasse(motDePasse, { kdf: kdf });
    if (!ouverture) {
      notifier(t("notif.mdp_incorrect_sauvegarde"), "erreur");
      return false;
    }
    const clair = await dechiffrerDocument(ouverture.cleEffective, chiffrement.iv, chiffrement.donnees);
    const contenu = JSON.parse(clair);
    await appliquerVault(contenu, ouverture.cleEffective, ouverture.cleMaitre || ouverture.materiel);
    return true;
  }

  if (type === "vault") {
    const motDePasse = await demanderMotDePasse(
      "modale.import_vault_titre",
      t("modale.import_vault_corps"),
      "modale.mdp_label_document"
    );
    if (motDePasse === null) {
      return false;
    }
    const ouverture = await ouvrirAvecMotDePasse(motDePasse, document);
    if (!ouverture) {
      notifier(t("notif.mdp_incorrect_document"), "erreur");
      return false;
    }
    await appliquerVault(document, ouverture.cleEffective, ouverture.cleMaitre || ouverture.materiel);
    return true;
  }

  // type === "clair" : il faut une cle pour rechiffrer les valeurs.
  if (contexte && contexte.vaultOuvert && etat.cle) {
    const fournisseurs = await chiffrerClesEnClair(document.fournisseurs, etat.cle);
    const duplicat = nomsUniques(fournisseurs);
    if (duplicat) {
      throw new Error(t("erreur.import_doublon", { nom: duplicat }));
    }
    etat.vault.fournisseurs = fournisseurs;
    await sauvegarderVault();
    rendreFournisseurs();
    notifier(t("notif.import_termine", { n: fournisseurs.length }), "succes");
    return true;
  }

  // Premier lancement : on cree un mot de passe maitre pour proteger l'import.
  const motDePasse = await demanderMotDePasse(
    "modale.proteger_titre",
    t("modale.proteger_corps"),
    "modale.mdp_label_proteger"
  );
  if (motDePasse === null) {
    return false;
  }
  if (motDePasse.length < LONGUEUR_MINI_MDP) {
    notifier(t("erreur.mdp_court", { n: LONGUEUR_MINI_MDP }), "erreur");
    return false;
  }
  const parametres = await preparerMotDePasse(motDePasse, null);
  const cleMaitre = genererCleMaitre();
  const emballe = await emballerCleMaitre(parametres.cle, cleMaitre);
  const nouvelleCle = await matiereVersCle(cleMaitre);
  const fournisseurs = await chiffrerClesEnClair(document.fournisseurs, nouvelleCle);
  const duplicat = nomsUniques(fournisseurs);
  if (duplicat) {
    throw new Error(t("erreur.import_doublon", { nom: duplicat }));
  }
  const nouveau = vaultVide();
  nouveau.kdf = {
    salt: parametres.salt,
    iterations: parametres.iterations,
    verify_hash: parametres.verify_hash,
    iv_cle_maitre: emballe.iv,
    cle_maitre_chiffree: emballe.valeur_chiffree
  };
  nouveau.fournisseurs = fournisseurs;
  nouveau.parametres.langue = i18n.langue;
  etat.vault = nouveau;
  etat.cle = nouvelleCle;
  etat.cleMaitre = cleMaitre;
  await sauvegarderVault();
  entrerDansApplication();
  notifier(t("notif.import_termine_vault", { n: fournisseurs.length, mode: t("principal.mode_strict") }), "succes");
  return true;
}

/** Installe un vault importe comme vault courant et l'enregistre. */
async function appliquerVault(contenu, cle, cleMaitre) {
  const vault = normaliserVault(contenu);
  const duplicat = nomsUniques(vault.fournisseurs);
  if (duplicat) {
    throw new Error(t("erreur.import_doublon", { nom: duplicat }));
  }
  etat.vault = vault;
  etat.cle = cle;
  etat.cleMaitre = cleMaitre || null;
  await sauvegarderVault();
  entrerDansApplication();
  notifier(
    t("notif.import_termine_vault", {
      n: vault.fournisseurs.length,
      mode: vault.mode === "confort" ? t("principal.mode_confort") : t("principal.mode_strict")
    }),
    "succes"
  );
}

async function importerDepuisCollage(zoneId, contexte) {
  const zone = elt(zoneId);
  const contenu = zone.value.trim();
  if (!contenu) {
    notifier(t("notif.collez_contenu"), "avertir");
    return;
  }
  let document = null;
  try {
    document = JSON.parse(contenu);
  } catch (erreur) {
    notifier(t("notif.contenu_json_invalide"), "erreur");
    return;
  }
  try {
    const resultat = await importerDocument(document, contexte);
    if (resultat) {
      zone.value = "";
    }
  } catch (erreur) {
    notifier(t("notif.import_impossible", { detail: erreurRust(erreur) }), "erreur");
  }
}

async function importerDepuisFichier(nom, contexte) {
  let contenu = null;
  try {
    contenu = await appel("lire_export", { nom: nom });
  } catch (erreur) {
    notifier(t("notif.lecture_impossible", { detail: erreurRust(erreur) }), "erreur");
    return;
  }
  let document = null;
  try {
    document = JSON.parse(contenu);
  } catch (erreur) {
    notifier(t("notif.fichier_non_json", { nom: nom }), "erreur");
    return;
  }
  const confirme = await demanderConfirmation(
    "modale.import_fichier_titre",
    "<p>" + echapper(t("modale.import_fichier_corps", { nom: nom })) + "</p>" +
      '<p class="avertissement">' + echapper(t("modale.import_fichier_avertissement")) + "</p>",
    "commun.importer",
    "principal"
  );
  if (!confirme) {
    return;
  }
  try {
    await importerDocument(document, contexte);
  } catch (erreur) {
    notifier(t("notif.import_impossible", { detail: erreurRust(erreur) }), "erreur");
  }
}

// ---------------------------------------------------------------------------
// Branchement des evenements
// ---------------------------------------------------------------------------

function brancherEvenements() {
  // Ecran de bienvenue
  elt("btn-nouveau-vault").addEventListener("click", () => {
    elt("nouveau-mdp").value = "";
    elt("nouveau-mdp2").value = "";
    elt("erreur-creation").classList.add("cache");
    majJaugeForce();
    afficherEcran("ecran-creation-mdp");
    elt("nouveau-mdp").focus();
  });
  elt("btn-importer-vault").addEventListener("click", async () => {
    afficherEcran("ecran-import-bienvenue");
    await rafraichirListeFichiers("liste-fichiers-bienvenue", false);
  });
  elt("btn-retour-bienvenue").addEventListener("click", () => afficherEcran("ecran-bienvenue"));
  elt("btn-retour-creation").addEventListener("click", () => afficherEcran("ecran-bienvenue"));

  // Creation du vault
  elt("nouveau-mdp").addEventListener("input", majJaugeForce);
  elt("btn-creer-vault").addEventListener("click", creerVault);

  // Phrase de recuperation
  elt("case-phrase-notee").addEventListener("change", (ev) => {
    elt("btn-phrase-continuer").disabled = !ev.target.checked;
  });
  elt("btn-phrase-continuer").addEventListener("click", finaliserPhrase);

  // Connexion
  elt("onglet-mdp").addEventListener("click", () => basculerOngletConnexion("mdp"));
  elt("onglet-phrase").addEventListener("click", () => basculerOngletConnexion("phrase"));
  elt("btn-ouvrir-vault").addEventListener("click", ouvrirVault);
  elt("btn-ouvrir-phrase").addEventListener("click", ouvrirVaultParPhrase);
  elt("mdp-connexion").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ouvrirVault();
    }
  });

  // Ecran principal
  elt("recherche").addEventListener("input", (ev) => {
    etat.filtre = ev.target.value;
    rendreFournisseurs();
  });
  elt("btn-ajouter-fournisseur").addEventListener("click", () => ouvrirModaleFournisseur(null));
  elt("btn-verrouiller").addEventListener("click", verrouiller);
  elt("btn-parametres").addEventListener("click", async () => {
    majEcranParametres();
    await rafraichirListeFichiers("liste-fichiers-parametres", true);
    afficherEcran("ecran-parametres");
  });
  elt("btn-retour-parametres").addEventListener("click", () => {
    rendreFournisseurs();
    afficherEcran("ecran-principal");
  });

  // Actions de la liste des fournisseurs (delegation d'evenements)
  elt("liste-fournisseurs").addEventListener("click", async (ev) => {
    const bouton = ev.target.closest("button[data-action]");
    if (!bouton) {
      return;
    }
    const action = bouton.dataset.action;
    const id = bouton.dataset.id;
    const index = bouton.dataset.index === undefined ? null : Number(bouton.dataset.index);
    if (action === "copier-url") {
      await copierUrl(id, index);
    } else if (action === "copier-cle") {
      await copierCle(id, index);
    } else if (action === "copier-toutes-cles") {
      await copierToutesLesCles(id);
    } else if (action === "reveler") {
      await basculerRevelation(bouton, id, index);
    } else if (action === "modifier") {
      ouvrirModaleFournisseur(id);
    } else if (action === "supprimer") {
      await supprimerFournisseur(id);
    }
  });

  // Actions internes de la modale (lignes, suggestion de renommage)
  elt("modale-corps").addEventListener("click", (ev) => {
    const bouton = ev.target.closest("button[data-action]");
    if (!bouton) {
      return;
    }
    const action = bouton.dataset.action;
    if (action === "ajouter-url") {
      elt("lignes-urls").insertAdjacentHTML("beforeend", ligneUrlHtml(null));
    } else if (action === "ajouter-cle") {
      elt("lignes-cles").insertAdjacentHTML("beforeend", ligneCleHtml(null, -1));
    } else if (action === "retirer-ligne") {
      bouton.closest(".ligne-form").remove();
    } else if (action === "utiliser-suggestion") {
      elt("fournisseur-nom").value = bouton.dataset.suggestion;
      elt("erreur-fournisseur").classList.add("cache");
      elt("fournisseur-nom").focus();
    }
  });

  // Parametres
  elt("mode-strict").addEventListener("change", () => changerMode("strict"));
  elt("mode-confort").addEventListener("change", () => changerMode("confort"));
  elt("selecteur-langue").addEventListener("change", (ev) => definirLangue(ev.target.value));
  elt("btn-changer-mdp").addEventListener("click", changerMotDePasse);
  elt("btn-recuperation").addEventListener("click", activerRecuperation);
  elt("case-presse-papiers").addEventListener("change", basculerEffacementPressePapiers);
  elt("btn-export-chiffre").addEventListener("click", exporterChiffre);
  elt("btn-export-json").addEventListener("click", exporterJsonClair);
  elt("btn-export-html").addEventListener("click", exporterHtmlClair);
  elt("btn-rafraichir-parametres").addEventListener("click", () => rafraichirListeFichiers("liste-fichiers-parametres", true));
  elt("btn-rafraichir-bienvenue").addEventListener("click", () => rafraichirListeFichiers("liste-fichiers-bienvenue", false));
  elt("btn-importer-collage-parametres").addEventListener("click", () =>
    importerDepuisCollage("collage-parametres", { vaultOuvert: true })
  );
  elt("btn-importer-collage").addEventListener("click", () => importerDepuisCollage("collage-bienvenue", { vaultOuvert: false }));

  // Import : fichiers du dossier exports (delegation)
  ["liste-fichiers-bienvenue", "liste-fichiers-parametres"].forEach((zoneId) => {
    const zone = elt(zoneId);
    if (!zone) {
      return;
    }
    zone.addEventListener("click", async (ev) => {
      const bouton = ev.target.closest("button[data-action]");
      if (!bouton) {
        return;
      }
      const nom = bouton.dataset.nom;
      if (bouton.dataset.action === "importer-fichier") {
        await importerDepuisFichier(nom, { vaultOuvert: zoneId === "liste-fichiers-parametres" });
      } else if (bouton.dataset.action === "supprimer-fichier") {
        const confirme = await demanderConfirmation(
          "modale.suppr_fichier_titre",
          "<p>" + echapper(t("modale.suppr_fichier_corps", { nom: nom })) + "</p>",
          "commun.supprimer"
        );
        if (confirme) {
          try {
            await appel("supprimer_export", { nom: nom });
            await rafraichirListeFichiers(zoneId, zoneId === "liste-fichiers-parametres");
            notifier(t("notif.fichier_supprime"), "succes");
          } catch (erreur) {
            notifier(t("notif.suppression_impossible", { detail: erreurRust(erreur) }), "erreur");
          }
        }
      }
    });
  });

  // Fermeture de la modale par le fond ou Echap
  elt("fond-modale").addEventListener("click", (ev) => {
    if (ev.target.id === "fond-modale") {
      fermerModale();
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !elt("fond-modale").classList.contains("cache")) {
      fermerModale();
    }
  });

  // Effacement de la cle en memoire a la fermeture de l'application.
  window.addEventListener("beforeunload", () => {
    if (etat.cleMaitre) {
      etat.cleMaitre.fill(0);
    }
    if (etat.materielMotDePasse) {
      etat.materielMotDePasse.fill(0);
    }
    etat.cleMaitre = null;
    etat.materielMotDePasse = null;
    etat.cle = null;
    etat.phraseTemporaire = null;
    etat.recuperationEnAttente = null;
  });
}

// ---------------------------------------------------------------------------
// Lancement
// ---------------------------------------------------------------------------

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    demarrer().catch((erreur) => afficherErreurFatale(t("erreur.demarrage", { detail: erreurRust(erreur) })));
  });
} else {
  demarrer().catch((erreur) => afficherErreurFatale(t("erreur.demarrage", { detail: erreurRust(erreur) })));
}
