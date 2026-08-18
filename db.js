// db.js — toute la logique de persistance IndexedDB.
// Deux stores :
//  - "articles"     : catalogue théorique (clé = codeArticle)
//  - "affectations" : occurrences d'articles placées dans des cellules (clé auto)

const DB_NOM = 'cellules-entrepot-db';
const DB_VERSION = 1;

let _dbPromise = null;

function ouvrirDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const requete = indexedDB.open(DB_NOM, DB_VERSION);

    requete.onupgradeneeded = (evt) => {
      const db = evt.target.result;

      if (!db.objectStoreNames.contains('articles')) {
        db.createObjectStore('articles', { keyPath: 'codeArticle' });
      }

      if (!db.objectStoreNames.contains('affectations')) {
        const store = db.createObjectStore('affectations', { keyPath: 'id' });
        store.createIndex('parCellule', 'cle', { unique: false });
        store.createIndex('parArticle', 'codeArticle', { unique: false });
      }
    };

    requete.onsuccess = (evt) => resolve(evt.target.result);
    requete.onerror = (evt) => reject(evt.target.error);
  });
  return _dbPromise;
}

function _transaction(nomsStores, mode = 'readonly') {
  return ouvrirDB().then((db) => db.transaction(nomsStores, mode));
}

function _promesseRequete(requete) {
  return new Promise((resolve, reject) => {
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });
}

// ---------- Articles (catalogue) ----------

async function getAllArticles() {
  const tx = await _transaction(['articles']);
  return _promesseRequete(tx.objectStore('articles').getAll());
}

async function getArticleByCode(codeArticle) {
  const tx = await _transaction(['articles']);
  return _promesseRequete(tx.objectStore('articles').get(codeArticle));
}

/**
 * Remplace le catalogue par la nouvelle liste théorique importée.
 * Les affectations existantes ne sont jamais touchées ici : on détecte
 * simplement les codes articles qui n'existent plus dans le nouvel import
 * (affectations "orphelines") pour permettre à l'utilisateur de vérifier
 * la synchronisation entre état théorique et état réel.
 */
async function remplacerCatalogue(nouveauxArticles) {
  const db = await ouvrirDB();

  const anciens = await getAllArticles();
  const ancienneMap = new Map(anciens.map((a) => [a.codeArticle, a]));
  const nouveauxCodes = new Set(nouveauxArticles.map((a) => a.codeArticle));

  let ajoutes = 0;
  let misAJour = 0;

  const tx = db.transaction(['articles'], 'readwrite');
  const store = tx.objectStore('articles');

  // On NE VIDE PLUS le store : un article déjà connu (code article, désignation, rayon,
  // code-barre) ne doit jamais être perdu, même s'il disparaît d'un futur import théorique.
  // C'est le seul moyen de garder ses informations pour les occurrences encore placées
  // physiquement en cellule ("orphelines") et pour l'écran Stock.
  for (const art of nouveauxArticles) {
    const ancien = ancienneMap.get(art.codeArticle);
    if (ancien) {
      misAJour++;
      if (ancien.codeBarre) art.codeBarre = ancien.codeBarre; // conservé lors du ré-import
    } else {
      ajoutes++;
    }
    store.put(art);
  }

  // Articles déjà connus mais absents de ce nouvel import : on les conserve tels quels
  // (désignation/rayon/famille/code-barre inchangés) mais avec un stock théorique ramené
  // à 0, puisqu'ils ne figurent plus dans l'état théorique actuel.
  const articlesConserves = anciens.filter((a) => !nouveauxCodes.has(a.codeArticle));
  articlesConserves.forEach((a) => {
    store.put({ ...a, stockTheorique: 0 });
  });

  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  // Détection des affectations orphelines (article retiré du nouvel état théorique,
  // mais toujours physiquement placé dans une cellule)
  const affectations = await getAllAffectations();
  const codesAffectes = new Set(affectations.map((a) => a.codeArticle));
  const orphelins = [...codesAffectes].filter((code) => !nouveauxCodes.has(code));

  return { ajoutes, misAJour, conserves: articlesConserves.length, total: nouveauxArticles.length, orphelins };
}

// ---------- Affectations (placement dans les cellules) ----------

async function getAllAffectations() {
  const tx = await _transaction(['affectations']);
  return _promesseRequete(tx.objectStore('affectations').getAll());
}

async function getAffectationsParCellule(cle) {
  const tx = await _transaction(['affectations']);
  const index = tx.objectStore('affectations').index('parCellule');
  const resultats = await _promesseRequete(index.getAll(cle));
  return resultats.sort((a, b) => a.ordre - b.ordre);
}

/** Retourne toutes les occurrences d'un article donné, tous emplacements confondus */
async function getAffectationsParArticle(codeArticle) {
  const tx = await _transaction(['affectations']);
  const index = tx.objectStore('affectations').index('parArticle');
  return _promesseRequete(index.getAll(codeArticle));
}

/** Retourne une map { cle -> nombre d'articles } pour toutes les cellules connues */
async function compterParCle() {
  const tout = await getAllAffectations();
  const compte = new Map();
  for (const a of tout) {
    compte.set(a.cle, (compte.get(a.cle) || 0) + 1);
  }
  return compte;
}

async function ajouterAffectation({ codeArticle, allee, facade, etage, cellule, stockReel = null, dlc = null }) {
  const cle = cleEmplacement({ allee, facade, etage, cellule });
  const existantes = await getAffectationsParCellule(cle);
  const ordreMax = existantes.reduce((max, a) => Math.max(max, a.ordre), -1);

  const nouvelle = {
    id: genererId(),
    codeArticle,
    allee: estZoneTable(allee) ? 'Table' : Number(allee),
    facade: estZoneTable(allee) ? null : facade,
    etage: estZoneTable(allee) || facade === 'Sol' ? null : Number(etage),
    cellule: estZoneTable(allee) ? null : Number(cellule),
    cle,
    ordre: ordreMax + 1,
    stockReel: stockReel === null || stockReel === undefined || stockReel === '' ? null : Number(stockReel), // facultatif
    dlc: dlc || null, // facultatif, format 'YYYY-MM-DD'
    misAJourLe: new Date().toISOString(), // sert à retrouver la dernière quantité/DLC saisie pour cet article
  };

  const tx = await _transaction(['affectations'], 'readwrite');
  tx.objectStore('affectations').add(nouvelle);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return nouvelle;
}

async function supprimerAffectation(id) {
  const tx = await _transaction(['affectations'], 'readwrite');
  tx.objectStore('affectations').delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/** Déplace une occurrence vers une nouvelle cellule ; elle est ajoutée en fin de la cellule cible */
async function deplacerAffectation(id, nouvelEmplacement) {
  const tx = await _transaction(['affectations'], 'readwrite');
  const store = tx.objectStore('affectations');
  const affectation = await _promesseRequete(store.get(id));
  if (!affectation) throw new Error('Affectation introuvable');

  const nouvelleCle = cleEmplacement(nouvelEmplacement);
  const cibles = await getAffectationsParCellule(nouvelleCle);
  const ordreMax = cibles.reduce((max, a) => Math.max(max, a.ordre), -1);

  affectation.allee = estZoneTable(nouvelEmplacement.allee) ? 'Table' : Number(nouvelEmplacement.allee);
  affectation.facade = estZoneTable(nouvelEmplacement.allee) ? null : nouvelEmplacement.facade;
  affectation.etage = estZoneTable(nouvelEmplacement.allee) || nouvelEmplacement.facade === 'Sol' ? null : Number(nouvelEmplacement.etage);
  affectation.cellule = estZoneTable(nouvelEmplacement.allee) ? null : Number(nouvelEmplacement.cellule);
  affectation.cle = nouvelleCle;
  affectation.ordre = ordreMax + 1;

  store.put(affectation);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(affectation);
    tx.onerror = () => reject(tx.error);
  });
}

/** Réécrit l'ordre des occurrences d'une cellule selon un tableau d'ids ordonné */
async function reordonnerCellule(cle, idsOrdonnes) {
  const tx = await _transaction(['affectations'], 'readwrite');
  const store = tx.objectStore('affectations');
  idsOrdonnes.forEach((id, index) => {
    const requete = store.get(id);
    requete.onsuccess = () => {
      const affectation = requete.result;
      if (affectation) {
        affectation.ordre = index;
        store.put(affectation);
      }
    };
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/** Met à jour le stock réel et/ou la DLC d'une occurrence précise (facultatif, modifiable à tout moment) */
async function modifierStockDLC(id, { stockReel, dlc }) {
  const tx = await _transaction(['affectations'], 'readwrite');
  const store = tx.objectStore('affectations');
  const affectation = await _promesseRequete(store.get(id));
  if (!affectation) throw new Error('Affectation introuvable');

  affectation.stockReel = stockReel === '' || stockReel === null || stockReel === undefined ? null : Number(stockReel);
  affectation.dlc = dlc || null;
  affectation.misAJourLe = new Date().toISOString();

  store.put(affectation);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(affectation);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Met à jour le code-barres d'un article du catalogue. Le code-barres est un attribut
 * de l'ARTICLE (comme la désignation ou le rayon), pas de l'occurrence : il est donc
 * automatiquement partagé par tous les emplacements où cet article est enregistré, et
 * toute modification se répercute immédiatement partout.
 */
async function modifierCodeBarreArticle(codeArticle, codeBarre) {
  const tx = await _transaction(['articles'], 'readwrite');
  const store = tx.objectStore('articles');
  const article = await _promesseRequete(store.get(codeArticle));
  if (!article) throw new Error('Article introuvable');

  article.codeBarre = codeBarre ? String(codeBarre).trim() : null;

  store.put(article);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(article);
    tx.onerror = () => reject(tx.error);
  });
}

/** Épingle/désépingle un article, pour l'ajouter rapidement sans le rechercher à chaque fois */
async function modifierArticleEpingle(codeArticle, epingle) {
  const tx = await _transaction(['articles'], 'readwrite');
  const store = tx.objectStore('articles');
  const article = await _promesseRequete(store.get(codeArticle));
  if (!article) throw new Error('Article introuvable');

  article.epingle = !!epingle;

  store.put(article);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(article);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retourne la dernière quantité (stockReel) et DLC connues pour un article, à partir de
 * son occurrence la plus récemment mise à jour (misAJourLe) parmi celles où au moins l'une
 * des deux est renseignée. Retourne { stockReel, dlc } ou null si rien n'est connu.
 */
async function getDerniereQuantiteDLC(codeArticle) {
  const tx = await _transaction(['affectations']);
  const index = tx.objectStore('affectations').index('parArticle');
  const occurrences = await _promesseRequete(index.getAll(codeArticle));

  const connues = occurrences.filter((a) => a.stockReel !== null || a.dlc !== null);
  if (!connues.length) return null;

  connues.sort((a, b) => (b.misAJourLe || '').localeCompare(a.misAJourLe || ''));
  const derniere = connues[0];
  return { stockReel: derniere.stockReel, dlc: derniere.dlc };
}

/**
 * Supprime en masse toutes les affectations correspondant à un critère partiel
 * (allée seule, allée+façade, allée+façade+étage, ou emplacement complet avec cellule).
 * Retourne le nombre d'occurrences supprimées.
 */
async function supprimerAffectationsParCritere(critere) {
  const correspond = (a) => {
    if (critere.allee !== undefined && String(a.allee) !== String(critere.allee)) return false;
    if (critere.facade !== undefined && a.facade !== critere.facade) return false;
    if (critere.etage !== undefined && (a.etage ?? null) !== (critere.etage === null ? null : Number(critere.etage))) return false;
    if (critere.cellule !== undefined && Number(a.cellule) !== Number(critere.cellule)) return false;
    return true;
  };

  const tout = await getAllAffectations();
  const aSupprimer = tout.filter(correspond);
  if (!aSupprimer.length) return 0;

  const tx = await _transaction(['affectations'], 'readwrite');
  const store = tx.objectStore('affectations');
  aSupprimer.forEach((a) => store.delete(a.id));

  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  return aSupprimer.length;
}

// ---------- Sauvegarde / restauration JSON complète ----------

async function exporterEtatComplet() {
  const [articles, affectations] = await Promise.all([getAllArticles(), getAllAffectations()]);
  return {
    version: DB_VERSION,
    dateExport: new Date().toISOString(),
    articles,
    affectations,
  };
}

/** Restaure exactement l'état précédent (remplace tout le contenu des deux stores) */
async function restaurerEtatComplet(donnees) {
  const db = await ouvrirDB();
  const tx = db.transaction(['articles', 'affectations'], 'readwrite');
  const storeArticles = tx.objectStore('articles');
  const storeAffectations = tx.objectStore('affectations');

  storeArticles.clear();
  storeAffectations.clear();

  (donnees.articles || []).forEach((a) => storeArticles.put(a));
  (donnees.affectations || []).forEach((a) => storeAffectations.put(a));

  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
