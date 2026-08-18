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

/**
 * Articles encore en stock (stockTheorique > 0) : c'est cette liste réduite qui est
 * proposée quand on cherche un article à ajouter à une cellule, pour ne pas être
 * encombré par des articles qui n'ont plus de stock théorique. Les articles à 0
 * restent bien dans le catalogue complet (getAllArticles / getCacheArticles) pour
 * l'affichage des occurrences déjà enregistrées, l'export Excel, etc.
 */
function getCacheArticlesEnStock() {
  return _cacheArticles.filter((a) => Number(a.stockTheorique) > 0);
}

/** Liste triée des rayons détectés parmi les articles encore en stock */
function getRayonsDisponibles() {
  const set = new Set(getCacheArticlesEnStock().map((a) => a.rayon).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

/** Liste triée des familles détectées parmi les articles encore en stock */
function getFamillesDisponibles() {
  const set = new Set(getCacheArticlesEnStock().map((a) => a.famille).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

/**
 * Articles épinglés (⭐), triés par code article. Un article épinglé reste proposé
 * pour un ajout rapide même s'il n'est plus en stock théorique — l'épingle est un
 * choix explicite de l'utilisateur, il n'est pas soumis au filtre "en stock".
 */
function getCacheArticlesEpingles() {
  return _cacheArticles.filter((a) => a.epingle).sort((a, b) => a.codeArticle.localeCompare(b.codeArticle, 'fr'));
}

/**
 * Recherche + filtrage parmi le catalogue.
 * La recherche texte fonctionne par mots-clés indépendants : chaque mot tapé
 * doit se retrouver quelque part dans le code article ou la désignation,
 * sans tenir compte de l'ordre des mots ni de la présence d'autres mots entre eux.
 * Ex : "huile 5l" trouve "Huile de tournesol 5L", et "5l huile" donne le même résultat.
 *
 * Les chips de rayon/famille sont désactivées par défaut : tant qu'aucune n'est
 * cochée, aucune restriction n'est appliquée (tous les rayons/familles sortent).
 * Dès qu'on en coche une ou plusieurs, seuls les articles correspondants sortent.
 *
 * Par défaut (`inclureStockNegatif` = false), seuls les articles encore en stock
 * (`stockTheorique > 0`) sont proposés, pour optimiser le nombre de choix pendant
 * l'ajout. Cocher "Inclure aussi les articles à stock théorique ≤ 0" élargit la
 * recherche à tout le catalogue ; ces articles restent identifiables visuellement
 * dans les résultats (classe CSS ajoutée côté `ui.js`).
 * @param {string} texte - texte tapé par l'utilisateur
 * @param {Set<string>} rayonsCoches - rayons actuellement cochés (aucun par défaut)
 * @param {Set<string>} famillesCoches - familles actuellement cochées (aucune par défaut)
 * @param {boolean} inclureStockNegatif - si vrai, élargit la recherche aux articles à stock ≤ 0
 */
function rechercherArticles(texte, rayonsCoches, famillesCoches, inclureStockNegatif = false) {
  const pool = inclureStockNegatif ? _cacheArticles : getCacheArticlesEnStock();
  return pool.filter((art) => {
    if (rayonsCoches && rayonsCoches.size && !rayonsCoches.has(art.rayon)) return false;
    if (famillesCoches && famillesCoches.size && art.famille && !famillesCoches.has(art.famille)) return false;
    return correspondMotsCles(art.codeArticle + ' ' + art.designation, texte);
  }).slice(0, 60); // limite d'affichage pour rester rapide sur mobile
}
