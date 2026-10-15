// ApiVault-3 - moteur de traduction minimal, sans dependance externe.
//
// Les textes sont dans src/i18n/<langue>.json. Ils sont embarques dans le
// binaire par Tauri et servis par le protocole local (http://tauri.localhost) :
// aucun acces reseau.
"use strict";

const LANGUES_DISPONIBLES = ["fr", "en"];
const LANGUE_PAR_DEFAUT = "fr";
// Le choix de langue est memorise dans le profil du navigateur embarque, qui se
// trouve lui aussi dans le dossier de l'application (donnees-webview2).
const CLE_STOCKAGE_LANGUE = "apivault3.langue";

const i18n = {
  langue: LANGUE_PAR_DEFAUT,
  dictionnaires: {},
  dictionnaire: {}
};

/** Lit la langue memorisee, sinon la langue du systeme, sinon le francais. */
function detecterLangue() {
  try {
    const enregistree = window.localStorage.getItem(CLE_STOCKAGE_LANGUE);
    if (enregistree && LANGUES_DISPONIBLES.indexOf(enregistree) >= 0) {
      return enregistree;
    }
  } catch (erreur) {
    // Stockage local indisponible : on passe a la detection systeme.
  }
  const langues = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
  for (let i = 0; i < langues.length; i++) {
    const code = String(langues[i] || "").toLowerCase().slice(0, 2);
    if (LANGUES_DISPONIBLES.indexOf(code) >= 0) {
      return code;
    }
  }
  return LANGUE_PAR_DEFAUT;
}

async function chargerDictionnaire(langue) {
  const reponse = await fetch("i18n/" + langue + ".json", { cache: "no-store" });
  if (!reponse.ok) {
    throw new Error("HTTP " + reponse.status);
  }
  const contenu = await reponse.json();
  if (!contenu || typeof contenu !== "object") {
    throw new Error("dictionnaire invalide");
  }
  return contenu;
}

/** Charge les dictionnaires. La langue detectee est prioritaire ; l'autre
 *  langue est chargee aussi, pour servir de repli et de reference pour la
 *  traduction des messages d'erreur techniques (qui sont en anglais). */
async function initialiserI18n() {
  const choisie = detecterLangue();
  const ordre = [choisie].concat(
    LANGUES_DISPONIBLES.filter(function (langue) {
      return langue !== choisie;
    })
  );
  let derniereErreur = null;
  for (let i = 0; i < ordre.length; i++) {
    try {
      i18n.dictionnaires[ordre[i]] = await chargerDictionnaire(ordre[i]);
    } catch (erreur) {
      derniereErreur = erreur;
    }
  }
  if (!i18n.dictionnaires[choisie]) {
    const secours = LANGUES_DISPONIBLES.find(function (langue) {
      return !!i18n.dictionnaires[langue];
    });
    if (!secours) {
      throw new Error("Fichiers de langue illisibles (" + (derniereErreur ? derniereErreur.message : "raison inconnue") + ")");
    }
    i18n.langue = secours;
  } else {
    i18n.langue = choisie;
  }
  i18n.dictionnaire = i18n.dictionnaires[i18n.langue];
  return true;
}

/** Traduit une cle. Les parametres remplacent les {crochets} du texte. */
function t(cle, parametres) {
  let texte = i18n.dictionnaire ? i18n.dictionnaire[cle] : undefined;
  if (texte === undefined) {
    // Repli : le francais, puis l'anglais, puis la cle elle-meme (visible en dev).
    const autres = [i18n.dictionnaires.fr, i18n.dictionnaires.en];
    for (let i = 0; i < autres.length && texte === undefined; i++) {
      if (autres[i] && autres[i][cle] !== undefined) {
        texte = autres[i][cle];
      }
    }
  }
  if (texte === undefined) {
    return cle;
  }
  if (parametres) {
    texte = texte.replace(/\{(\w+)\}/g, function (marqueur, nom) {
      return parametres[nom] === undefined ? marqueur : String(parametres[nom]);
    });
  }
  return texte;
}

/**
 * Traduit une cle au singulier ou au pluriel : tPluriel("principal.cles", 3).
 * Le singulier n'est utilise que pour 1 : zero prend la forme du pluriel
 * ("0 fournisseur" se lirait comme un seul fournisseur).
 */
function tPluriel(cleBase, nombre, parametres) {
  const parametresFinaux = Object.assign({ n: nombre }, parametres || {});
  return t(cleBase + (nombre === 1 ? "_un" : "_plusieurs"), parametresFinaux);
}

/** Change la langue de l'interface et la memorise. */
async function changerLangue(langue) {
  if (LANGUES_DISPONIBLES.indexOf(langue) < 0 || langue === i18n.langue) {
    return false;
  }
  if (!i18n.dictionnaires[langue]) {
    i18n.dictionnaires[langue] = await chargerDictionnaire(langue);
  }
  i18n.langue = langue;
  i18n.dictionnaire = i18n.dictionnaires[langue];
  try {
    window.localStorage.setItem(CLE_STOCKAGE_LANGUE, langue);
  } catch (erreur) {
    // Sans stockage local, le choix ne vaut que pour la session en cours.
  }
  return true;
}

/**
 * Applique les traductions aux elements marques :
 *   data-i18n            -> textContent
 *   data-i18n-placeholder-> attribut placeholder
 *   data-i18n-title      -> attribut title (infobulle)
 */
function appliquerTraductions(racine) {
  const portee = racine || document;
  portee.querySelectorAll("[data-i18n]").forEach(function (element) {
    element.textContent = t(element.getAttribute("data-i18n"));
  });
  portee.querySelectorAll("[data-i18n-placeholder]").forEach(function (element) {
    element.setAttribute("placeholder", t(element.getAttribute("data-i18n-placeholder")));
  });
  portee.querySelectorAll("[data-i18n-title]").forEach(function (element) {
    element.setAttribute("title", t(element.getAttribute("data-i18n-title")));
  });
  document.title = t("app.nom");
  document.documentElement.setAttribute("lang", i18n.langue);
}

/**
 * Traduit un message d'erreur technique (ecrit en anglais par Rust).
 * Le message anglais est retrouve par le plus long prefixe connu, puis remplace
 * par sa traduction ; le detail eventuel (apres le premier ":") est conserve.
 * Les messages inconnus sont renvoyes tels quels.
 */
function traduireErreurTechnique(message) {
  const texte = String(message === undefined || message === null ? "" : message);
  if (!texte) {
    return "";
  }
  const reference = i18n.dictionnaires.en || {};
  let meilleureCle = null;
  let meilleurTexte = "";
  Object.keys(reference).forEach(function (cle) {
    if (cle.indexOf("erreur_technique.") !== 0) {
      return;
    }
    const anglais = String(reference[cle] || "");
    if (anglais && texte.indexOf(anglais) === 0 && anglais.length > meilleurTexte.length) {
      meilleureCle = cle;
      meilleurTexte = anglais;
    }
  });
  if (meilleureCle === null) {
    return texte;
  }
  const detail = texte.slice(meilleurTexte.length).replace(/^:\s*/, "");
  const traduit = t(meilleureCle);
  return detail ? traduit + " : " + detail : traduit;
}
