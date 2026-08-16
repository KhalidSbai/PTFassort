// utils.js — fonctions utilitaires génériques, sans dépendance au DOM ni à IndexedDB

/** Ajoute un zéro devant les nombres < 10 (ex: 1 -> "01") */
function zeroPad(n) {
  return String(n).padStart(2, '0');
}

/** Vrai si l'allée désigne la zone spéciale "Table" (pas de façade/étage/cellule) */
function estZoneTable(allee) {
  return allee === 'Table';
}

/** Construit une clé unique d'emplacement de cellule.
 *  Exemple : { allee: 2, facade: 'Gauche', etage: 3, cellule: 12 } -> "2-Gauche-3-12"
 *  Pour la façade "Sol", l'étage est toujours null.
 *  Pour la zone "Table" (pas de façade/étage/cellule), la clé est toujours "Table".
 */
function cleEmplacement({ allee, facade, etage, cellule }) {
  if (estZoneTable(allee)) return 'Table';
  const etageVal = facade === 'Sol' ? '0' : String(etage);
  return `${allee}-${facade}-${etageVal}-${cellule}`;
}

/** Libellé complet et lisible d'un emplacement (utilisé dans les titres) */
function libelleEmplacement({ allee, facade, etage, cellule }) {
  if (estZoneTable(allee)) return 'Table';
  const lignes = [`Zone ${allee}`, `Façade ${facade}`];
  if (facade !== 'Sol') lignes.push(`Étage ${etage}`);
  lignes.push(`Cellule ${zeroPad(cellule)}`);
  return lignes.join(' — ');
}

/** Libellé d'une zone (allée/façade/étage) sans référence à une cellule précise */
function libelleZone({ allee, facade, etage }) {
  if (estZoneTable(allee)) return 'Table';
  const lignes = [`Zone ${allee}`, `Façade ${facade}`];
  if (facade !== 'Sol') lignes.push(`Étage ${etage}`);
  return lignes.join(' — ');
}

/** Libellé court d'un emplacement (utilisé dans l'export Excel / listes compactes) */
function libelleEmplacementCourt({ allee, facade, etage, cellule }) {
  if (estZoneTable(allee)) return 'Table';
  const etageTxt = facade === 'Sol' ? '-' : etage;
  return `Z${allee} ${facade} É${etageTxt} C${zeroPad(cellule)}`;
}

/** Retourne un tableau [1..18] : numéros de cellules d'un étage/sol */
function numerosCellules() {
  return Array.from({ length: 18 }, (_, i) => i + 1);
}

/** Debounce simple pour la recherche instantanée */
function debounce(fn, delai = 150) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delai);
  };
}

/** Normalise une chaîne pour comparaison (minuscule, sans accents, sans espaces superflus) */
function normaliser(texte) {
  return String(texte ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Vérifie que chaque mot de `texteRecherche` se retrouve quelque part dans `texteCible`,
 * sans tenir compte de l'ordre des mots ni des mots intercalés.
 * Ex : correspondMotsCles("Huile de tournesol 5L", "5l huile") -> true
 */
function correspondMotsCles(texteCible, texteRecherche) {
  const mots = normaliser(texteRecherche).split(/\s+/).filter(Boolean);
  if (!mots.length) return true;
  const cible = normaliser(texteCible);
  return mots.every((mot) => cible.includes(mot));
}

/** Génère un identifiant unique simple (pour les occurrences d'articles en cellule) */
function genererId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Affiche une notification temporaire en bas d'écran */
function afficherToast(message, type = 'info', duree = 2200) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'toast' + (type === 'erreur' ? ' erreur' : type === 'succes' ? ' succes' : '');
  toast.classList.remove('hidden');
  clearTimeout(afficherToast._timer);
  afficherToast._timer = setTimeout(() => toast.classList.add('hidden'), duree);
}

/** Déclenche le téléchargement d'un Blob avec un nom de fichier donné */
function telechargerBlob(blob, nomFichier) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomFichier;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Calcule, à partir d'une liste de quantités de palettes (les stockReel actuels de
 * toutes les occurrences d'un article), la quantité la plus fréquente et le pourcentage
 * de fiabilité associé (nb de palettes avec cette quantité / nb total de palettes × 100).
 * En cas d'égalité entre plusieurs quantités, la plus petite est retenue (choix déterministe).
 * Retourne null si la liste est vide (aucune palette avec une quantité renseignée).
 *
 * IMPORTANT : cette fonction ne fait aucune lecture ni écriture en base — elle doit
 * toujours être appelée avec les quantités fraîchement lues depuis IndexedDB (jamais
 * une valeur mise en cache), pour que le résultat reflète toujours les corrections les
 * plus récentes. Rien de ce calcul n'est jamais persisté.
 */
function calculerQuantiteFrequente(quantites) {
  if (!quantites.length) return null;

  const comptage = new Map();
  quantites.forEach((q) => comptage.set(q, (comptage.get(q) || 0) + 1));

  let quantiteRetenue = null;
  let effectifMax = -1;
  [...comptage.keys()].sort((a, b) => a - b).forEach((q) => {
    const effectif = comptage.get(q);
    if (effectif > effectifMax) {
      effectifMax = effectif;
      quantiteRetenue = q;
    }
  });

  return {
    quantite: quantiteRetenue,
    effectif: effectifMax,
    total: quantites.length,
    pourcentage: Math.round((effectifMax / quantites.length) * 100),
  };
}

/**
 * Estime le nombre de palettes restantes (non comptées) pour atteindre le stock théorique,
 * à partir de la quantité la plus fréquente par palette. C'EST UNE ESTIMATION (suppose des
 * palettes de taille uniforme), jamais un fait garanti — à afficher comme telle.
 * Retourne null si non calculable (quantité fréquente inconnue/nulle).
 */
function estimerPalettesRestantes(stockTheorique, stockReelTotal, quantiteFrequente) {
  if (!quantiteFrequente || quantiteFrequente <= 0) return null;
  const ecart = Number(stockTheorique) - Number(stockReelTotal);
  if (ecart <= 0) return 0;
  return Math.ceil(ecart / quantiteFrequente);
}

/** Horodatage compact pour les noms de fichiers (ex: 2026-08-02_1830) */
function horodatageFichier() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
