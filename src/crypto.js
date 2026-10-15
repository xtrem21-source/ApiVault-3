// ApiVault-3 - primitives cryptographiques.
// Uniquement la Web Crypto API du navigateur embarque (WebView2) :
// PBKDF2-SHA256 (100 000 iterations) pour les derivations, AES-256-GCM pour le
// chiffrement. Aucune bibliotheque externe, aucun appel reseau.
"use strict";

const ITERATIONS_PBKDF2 = 100000;
const TAILLE_SALT = 16; // octets
const TAILLE_IV = 12; // octets (taille recommandee pour AES-GCM)
const TAILLE_CLE = 32; // 256 bits

// Version du format de vault.json produite par cette version de l'application.
//   1 : les cles API sont chiffrees directement avec la cle derivee du mot de passe ;
//   2 : les cles API sont chiffrees avec une cle maitre aleatoire (VMK), elle-meme
//       chiffree par la cle du mot de passe et par celle de la phrase de recuperation.
// Les vaults de version 1 restent lisibles : voir cleEffectiveDepuisVault().
const VERSION_FORMAT = 2;

// Etiquette fixe melangee a la matiere derivee pour produire la preuve de
// derivation (verify_hash). Elle n'est pas secrete : elle sert seulement a ce
// que la preuve ne soit pas directement reutilisable comme cle AES.
const ETIQUETTE_VERIFICATION = "ApiVault-3|preuve-de-derivation|v1";

// --------------------------------------------------------------------------
// Conversions base64 <-> octets (vault.json ne contient que de l'ASCII)
// --------------------------------------------------------------------------

function octetsVersBase64(octets) {
  let binaire = "";
  for (let i = 0; i < octets.length; i++) {
    binaire += String.fromCharCode(octets[i]);
  }
  return btoa(binaire);
}

function base64VersOctets(texteBase64) {
  const binaire = atob(texteBase64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) {
    octets[i] = binaire.charCodeAt(i);
  }
  return octets;
}

function octetsAleatoires(nombre) {
  return crypto.getRandomValues(new Uint8Array(nombre));
}

// --------------------------------------------------------------------------
// Derivations
// --------------------------------------------------------------------------

/** Renvoie la matiere derivee (32 octets) a partir d'un secret et d'un sel. */
async function deriverMatiere(secret, salt, iterations) {
  const iterationsEffectives = iterations || ITERATIONS_PBKDF2;
  const encodeur = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", encodeur.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: iterationsEffectives,
      hash: "SHA-256"
    },
    base,
    TAILLE_CLE * 8
  );
  return new Uint8Array(bits);
}

/** Transforme une matiere de 32 octets en cle AES-256-GCM non exportable. */
async function matiereVersCle(matiere) {
  return crypto.subtle.importKey("raw", matiere, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Preuve de derivation : SHA-256(matiere || etiquette). Jamais le secret. */
async function calculerPreuveDerivation(matiere) {
  const encodeur = new TextEncoder();
  const etiquette = encodeur.encode(ETIQUETTE_VERIFICATION);
  const donnees = new Uint8Array(matiere.length + etiquette.length);
  donnees.set(matiere, 0);
  donnees.set(etiquette, matiere.length);
  const empreinte = await crypto.subtle.digest("SHA-256", donnees);
  return octetsVersBase64(new Uint8Array(empreinte));
}

/**
 * Prepare un (nouveau) mot de passe maitre : sel aleatoire (ou reutilise),
 * matiere derivee, preuve de derivation et cle AES correspondante.
 */
async function preparerMotDePasse(motDePasse, selExistantBase64) {
  const sel = selExistantBase64 ? base64VersOctets(selExistantBase64) : octetsAleatoires(TAILLE_SALT);
  const materiel = await deriverMatiere(motDePasse, sel, ITERATIONS_PBKDF2);
  return {
    salt: octetsVersBase64(sel),
    iterations: ITERATIONS_PBKDF2,
    verify_hash: await calculerPreuveDerivation(materiel),
    materiel: materiel,
    cle: await matiereVersCle(materiel)
  };
}

// --------------------------------------------------------------------------
// Chiffrement / dechiffrement d'une valeur (une cle API a la fois)
// --------------------------------------------------------------------------

/** Chaque valeur est chiffree avec sa propre IV aleatoire (AES-256-GCM). */
async function chiffrerValeur(cle, texteClair) {
  const iv = octetsAleatoires(TAILLE_IV);
  const encodeur = new TextEncoder();
  const chiffre = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, cle, encodeur.encode(texteClair));
  return {
    iv: octetsVersBase64(iv),
    valeur_chiffree: octetsVersBase64(new Uint8Array(chiffre))
  };
}

/** Dechiffre une valeur. Leve une erreur si la cle ou les donnees sont invalides. */
async function dechiffrerValeur(cle, ivBase64, valeurChiffreeBase64) {
  const iv = base64VersOctets(ivBase64);
  const chiffre = base64VersOctets(valeurChiffreeBase64);
  const clair = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, cle, chiffre);
  return new TextDecoder().decode(clair);
}

async function chiffrerDocument(cle, texte) {
  return chiffrerValeur(cle, texte);
}

async function dechiffrerDocument(cle, ivBase64, valeurChiffreeBase64) {
  return dechiffrerValeur(cle, ivBase64, valeurChiffreeBase64);
}

// --------------------------------------------------------------------------
// Cle maitre du vault (VMK)
//
// Les cles API sont chiffrees avec une cle maitre aleatoire de 32 octets. Cette
// cle maitre est elle-meme emballee (chiffree) deux fois :
//   - avec la cle derivee du mot de passe maitre  -> kdf.iv_cle_maitre / kdf.cle_maitre_chiffree
//   - avec la cle derivee de la phrase de recuperation -> recuperation.*
// Un changement de mot de passe ne rechiffre donc que la cle maitre : la phrase
// de recuperation reste valable, et les cles API ne sont pas touchees.
// --------------------------------------------------------------------------

/** Genere une nouvelle cle maitre aleatoire (32 octets). */
function genererCleMaitre() {
  return octetsAleatoires(TAILLE_CLE);
}

/** Emballe (chiffre) la cle maitre avec une autre cle AES. */
async function emballerCleMaitre(cleDeChiffrement, cleMaitre) {
  return chiffrerValeur(cleDeChiffrement, octetsVersBase64(cleMaitre));
}

/** Deballage. Renvoie la cle maitre (Uint8Array) ou null si le dechiffrement echoue. */
async function deballerCleMaitre(cleDeChiffrement, ivBase64, chiffreBase64) {
  try {
    return base64VersOctets(await dechiffrerValeur(cleDeChiffrement, ivBase64, chiffreBase64));
  } catch (erreur) {
    return null;
  }
}

// --------------------------------------------------------------------------
// Phrase de recuperation
// --------------------------------------------------------------------------

/**
 * Derive la cle AES a partir de la phrase de recuperation.
 * La phrase est normalisee (minuscules, sans accents, espaces reduits) par
 * normaliserPhraseSaisie(), definie dans bip39.js.
 */
async function deriverClePhrase(phrase, selBase64, iterations) {
  const materiel = await deriverMatiere(
    normaliserPhraseSaisie(phrase),
    base64VersOctets(selBase64),
    iterations || ITERATIONS_PBKDF2
  );
  return matiereVersCle(materiel);
}

/**
 * Construit le bloc "recuperation" enregistre dans vault.json.
 * Ne contient que : sel_phrase, iterations, iv et cle_maitre_chiffree.
 * La phrase elle-meme n'est jamais conservee.
 */
async function preparerRecuperation(cleMaitre, phrase) {
  const sel = octetsAleatoires(TAILLE_SALT);
  const clePhrase = await deriverClePhrase(phrase, octetsVersBase64(sel), ITERATIONS_PBKDF2);
  const emballe = await emballerCleMaitre(clePhrase, cleMaitre);
  return {
    sel_phrase: octetsVersBase64(sel),
    iterations: ITERATIONS_PBKDF2,
    iv: emballe.iv,
    cle_maitre_chiffree: emballe.valeur_chiffree
  };
}

/** Un vault dispose-t-il d'une recuperation par phrase exploitable ? */
function aUneRecuperation(vault) {
  const bloc = vault && vault.recuperation;
  return !!(bloc && bloc.sel_phrase && bloc.iv && bloc.cle_maitre_chiffree);
}

/** Ouvre le vault avec la phrase de recuperation. Renvoie null si elle est fausse. */
async function ouvrirAvecPhrase(phrase, vault) {
  if (!aUneRecuperation(vault)) {
    return null;
  }
  const bloc = vault.recuperation;
  const clePhrase = await deriverClePhrase(phrase, bloc.sel_phrase, bloc.iterations);
  const cleMaitre = await deballerCleMaitre(clePhrase, bloc.iv, bloc.cle_maitre_chiffree);
  if (!cleMaitre) {
    return null;
  }
  return { cleMaitre: cleMaitre, cleEffective: await matiereVersCle(cleMaitre) };
}

// --------------------------------------------------------------------------
// Ouverture d'un vault avec le mot de passe maitre
// --------------------------------------------------------------------------

/** Un vault utilise-t-il une cle maitre separee (format 2) ? */
function aUneCleMaitre(vault) {
  const kdf = vault && vault.kdf;
  return !!(kdf && kdf.iv_cle_maitre && kdf.cle_maitre_chiffree);
}

/**
 * Ouvre un conteneur (vault.json, sauvegarde chiffree...) avec le mot de passe.
 * `conteneur` doit exposer un champ `kdf`.
 * Renvoie null si le mot de passe est faux.
 *  - cleMaitre    : la cle maitre du vault (format 2), sinon null ;
 *  - cleEffective : la cle qui dechiffre les cles API (cle maitre, ou matiere
 *                   derivee du mot de passe pour un vault de format 1).
 */
async function ouvrirAvecMotDePasse(motDePasse, conteneur) {
  const kdf = conteneur && conteneur.kdf;
  if (!kdf || !kdf.salt || !kdf.verify_hash) {
    return null;
  }
  const sel = base64VersOctets(kdf.salt);
  const materiel = await deriverMatiere(motDePasse, sel, kdf.iterations || ITERATIONS_PBKDF2);
  if ((await calculerPreuveDerivation(materiel)) !== kdf.verify_hash) {
    return null;
  }
  const cleMotDePasse = await matiereVersCle(materiel);
  let cleMaitre = null;
  if (kdf.iv_cle_maitre && kdf.cle_maitre_chiffree) {
    cleMaitre = await deballerCleMaitre(cleMotDePasse, kdf.iv_cle_maitre, kdf.cle_maitre_chiffree);
    if (!cleMaitre) {
      return null;
    }
  }
  return {
    materiel: materiel,
    cleMotDePasse: cleMotDePasse,
    cleMaitre: cleMaitre,
    cleEffective: cleMaitre ? await matiereVersCle(cleMaitre) : cleMotDePasse
  };
}
