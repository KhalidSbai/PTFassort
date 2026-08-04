// utils.js — fonctions utilitaires génériques, sans dépendance au DOM ni à IndexedDB

/** Ajoute un zéro devant les nombres < 10 (ex: 1 -> "01") */
function zeroPad(n) {
  return String(n).padStart(2, '0');
}

/** Construit une clé unique d'emplacement de cellule.
 *  Exemple : { allee: 2, facade: 'Gauche', etage: 3, cellule: 12 } -> "2-Gauche-3-12"
 *  Pour la façade "Sol", l'étage est toujours null.
 */
function cleEmplacement({ allee, facade, etage, cellule }) {
  const etageVal = facade === 'Sol' ? '0' : String(etage);
  return `${allee}-${facade}-${etageVal}-${cellule}`;
}

/** Libellé complet et lisible d'un emplacement (utilisé dans les titres) */
function libelleEmplacement({ allee, facade, etage, cellule }) {
  const lignes = [`Allée ${allee}`, `Façade ${facade}`];
  if (facade !== 'Sol') lignes.push(`Étage ${etage}`);
  lignes.push(`Cellule ${zeroPad(cellule)}`);
  return lignes.join(' — ');
}

/** Libellé d'une zone (allée/façade/étage) sans référence à une cellule précise */
function libelleZone({ allee, facade, etage }) {
  const lignes = [`Allée ${allee}`, `Façade ${facade}`];
  if (facade !== 'Sol') lignes.push(`Étage ${etage}`);
  return lignes.join(' — ');
}

/** Libellé court d'un emplacement (utilisé dans l'export Excel / listes compactes) */
function libelleEmplacementCourt({ allee, facade, etage, cellule }) {
  const etageTxt = facade === 'Sol' ? '-' : etage;
  return `A${allee} ${facade} É${etageTxt} C${zeroPad(cellule)}`;
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

/** Horodatage compact pour les noms de fichiers (ex: 2026-08-02_1830) */
function horodatageFichier() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
