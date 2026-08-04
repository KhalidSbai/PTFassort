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
 * La recherche texte fonctionne par mots-clés indépendants : chaque mot tapé
 * doit se retrouver quelque part dans le code article ou la désignation,
 * sans tenir compte de l'ordre des mots ni de la présence d'autres mots entre eux.
 * Ex : "huile 5l" trouve "Huile de tournesol 5L", et "5l huile" donne le même résultat.
 *
 * Les chips de rayon/famille sont désactivées par défaut : tant qu'aucune n'est
 * cochée, aucune restriction n'est appliquée (tous les rayons/familles sortent).
 * Dès qu'on en coche une ou plusieurs, seuls les articles correspondants sortent.
 * @param {string} texte - texte tapé par l'utilisateur
 * @param {Set<string>} rayonsCoches - rayons actuellement cochés (aucun par défaut)
 * @param {Set<string>} famillesCoches - familles actuellement cochées (aucune par défaut)
 */
function rechercherArticles(texte, rayonsCoches, famillesCoches) {
  const mots = normaliser(texte).split(/\s+/).filter(Boolean);

  return _cacheArticles.filter((art) => {
    if (rayonsCoches && rayonsCoches.size && !rayonsCoches.has(art.rayon)) return false;
    if (famillesCoches && famillesCoches.size && art.famille && !famillesCoches.has(art.famille)) return false;
    if (!mots.length) return true;
    const texteArticle = normaliser(art.codeArticle) + ' ' + normaliser(art.designation);
    return mots.every((mot) => texteArticle.includes(mot));
  }).slice(0, 60); // limite d'affichage pour rester rapide sur mobile
}
