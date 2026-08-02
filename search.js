// search.js — cache en mémoire du catalogue d'articles + recherche/filtrage instantanés.
// Le cache est rechargé au démarrage et après chaque import théorique.

let _cacheArticles = [];

async function rafraichirCacheArticles() {
  _cacheArticles = await getAllArticles();
  return _cacheArticles;
}

function getCacheArticles() {
  return _cacheArticles;
}

/** Liste triée des rayons détectés dans le catalogue */
function getRayonsDisponibles() {
  const set = new Set(_cacheArticles.map((a) => a.rayon).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

/** Liste triée des familles détectées (vide si la colonne Famille n'est jamais renseignée) */
function getFamillesDisponibles() {
  const set = new Set(_cacheArticles.map((a) => a.famille).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

/**
 * Recherche + filtrage dans le catalogue.
 * @param {string} texte - texte tapé par l'utilisateur
 * @param {Set<string>} rayonsCoches - rayons actuellement cochés (tous cochés par défaut)
 * @param {Set<string>} famillesCoches - familles actuellement cochées (tous cochés par défaut)
 */
function rechercherArticles(texte, rayonsCoches, famillesCoches) {
  const q = normaliser(texte);
  const rayonsDispo = getRayonsDisponibles();
  const famillesDispo = getFamillesDisponibles();

  return _cacheArticles.filter((art) => {
    if (rayonsDispo.length && rayonsCoches && !rayonsCoches.has(art.rayon)) return false;
    if (famillesDispo.length && famillesCoches && art.famille && !famillesCoches.has(art.famille)) return false;
    if (!q) return true;
    return normaliser(art.codeArticle).includes(q) || normaliser(art.designation).includes(q);
  }).slice(0, 60); // limite d'affichage pour rester rapide sur mobile
}
