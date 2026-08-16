// ui.js — rendu des écrans et gestion des interactions utilisateur.
// Toute la logique métier (DB, recherche, import/export) est déléguée aux autres modules ;
// ce fichier se contente d'orchestrer le DOM.

const etat = {
  emplacement: { allee: null, facade: null, etage: null }, // emplacement courant (allée/façade/étage)
  celluleOuverte: null,                                    // numéro de cellule ouverte (1-18) ou null
  rayonsCoches: new Set(),
  famillesCoches: new Set(),
  sortableInstance: null,
  selectionEtiquettes: new Set(), // ids d'affectations cochées dans la Vue, pour l'impression des étiquettes DLC
  stockRayonsCoches: new Set(),   // filtre par rayon dans l'écran Stock (aucun coché par défaut = pas de restriction)
};

// ---------- Écran 1 : choix de l'emplacement ----------

function initFormulaireEmplacement() {
  const selectAllee = document.getElementById('select-allee');
  const radiosFacade = document.querySelectorAll('input[name="facade"]');
  const selectEtage = document.getElementById('select-etage');
  const ligneFacade = document.getElementById('ligne-facade');
  const ligneEtage = document.getElementById('ligne-etage');
  const noteTable = document.getElementById('note-zone-table');

  function onChangement() {
    const allee = selectAllee.value;

    if (estZoneTable(allee)) {
      ligneFacade.classList.add('hidden');
      ligneEtage.classList.add('hidden');
      noteTable.classList.remove('hidden');
      radiosFacade.forEach((r) => (r.checked = false));
      selectEtage.value = '';
      etat.emplacement = { allee: 'Table', facade: null, etage: null };
      ouvrirTable();
      return;
    }

    ligneFacade.classList.remove('hidden');
    ligneEtage.classList.remove('hidden');
    noteTable.classList.add('hidden');

    const facadeInput = document.querySelector('input[name="facade"]:checked');
    const facade = facadeInput ? facadeInput.value : null;

    selectEtage.disabled = facade === 'Sol';
    if (facade === 'Sol') selectEtage.value = '';

    const etage = facade === 'Sol' ? null : selectEtage.value;
    const emplacementComplet = allee && facade && (facade === 'Sol' || etage);

    if (emplacementComplet) {
      etat.emplacement = { allee, facade, etage };
      afficherGrilleCellules();
    } else {
      document.getElementById('panel-cellules').classList.add('hidden');
      document.getElementById('panel-cellule-detail').classList.add('hidden');
    }
  }

  selectAllee.addEventListener('change', onChangement);
  radiosFacade.forEach((r) => r.addEventListener('change', onChangement));
  selectEtage.addEventListener('change', onChangement);
}

// ---------- Écran 2 : grille des 18 cellules ----------

// ---------- Mémorisation du dernier écran affiché (survit à la fermeture/réouverture) ----------

const CLE_NAVIGATION = 'cellules-entrepot-navigation';

/** Enregistre l'écran actuellement affiché pour le restaurer à la prochaine ouverture */
function sauvegarderNavigation(panel) {
  try {
    localStorage.setItem(CLE_NAVIGATION, JSON.stringify({
      panel,
      emplacement: etat.emplacement,
      celluleOuverte: etat.celluleOuverte,
      vueAllee: panel === 'vue' ? document.getElementById('select-vue-allee').value : undefined,
    }));
  } catch (e) {
    // stockage indisponible (navigation privée, quota...) : l'app continue sans bloquer
  }
}

/** Efface l'écran mémorisé (utilisé par le bouton Accueil, qui sert aussi de "réinitialiser") */
function effacerNavigationMemorisee() {
  try { localStorage.removeItem(CLE_NAVIGATION); } catch (e) { /* ignoré */ }
}

/** Restaure, au chargement de l'app, le dernier écran affiché (zone/cellule/Table/Vue) */
async function restaurerNavigation() {
  let donnees;
  try {
    const brut = localStorage.getItem(CLE_NAVIGATION);
    if (!brut) return;
    donnees = JSON.parse(brut);
  } catch (e) {
    return;
  }
  if (!donnees || !donnees.panel || donnees.panel === 'accueil') return;

  if (donnees.panel === 'vue') {
    if (donnees.vueAllee) document.getElementById('select-vue-allee').value = donnees.vueAllee;
    await afficherVueParZone();
    return;
  }

  const emp = donnees.emplacement;
  if (!emp || !emp.allee) return;

  if (estZoneTable(emp.allee)) {
    document.getElementById('select-allee').value = 'Table';
    document.getElementById('ligne-facade').classList.add('hidden');
    document.getElementById('ligne-etage').classList.add('hidden');
    document.getElementById('note-zone-table').classList.remove('hidden');
    etat.emplacement = { allee: 'Table', facade: null, etage: null };
    await ouvrirTable();
    return;
  }

  document.getElementById('select-allee').value = emp.allee;
  if (emp.facade) {
    const radio = document.querySelector(`input[name="facade"][value="${emp.facade}"]`);
    if (radio) radio.checked = true;
  }
  const selectEtage = document.getElementById('select-etage');
  selectEtage.disabled = emp.facade === 'Sol';
  if (emp.etage && emp.facade !== 'Sol') selectEtage.value = emp.etage;
  etat.emplacement = emp;

  if (donnees.panel === 'cellule' && donnees.celluleOuverte) {
    await ouvrirCellule(donnees.celluleOuverte);
  } else {
    await afficherGrilleCellules();
  }
}

async function afficherGrilleCellules() {
  document.getElementById('panel-cellule-detail').classList.add('hidden');
  const panel = document.getElementById('panel-cellules');
  panel.classList.remove('hidden');

  document.getElementById('cellules-titre').textContent = libelleZone(etat.emplacement);

  const compte = await compterParCle();
  const grille = document.getElementById('grille-cellules');
  grille.innerHTML = '';

  numerosCellules().forEach((numero) => {
    const cle = cleEmplacement({ ...etat.emplacement, cellule: numero });
    const n = compte.get(cle) || 0;

    const btn = document.createElement('button');
    btn.className = 'cellule-btn' + (n > 0 ? ' remplie' : '');
    btn.innerHTML = `${zeroPad(numero)}${n > 0 ? `<span class="compte">${n} art.</span>` : ''}`;
    btn.addEventListener('click', () => ouvrirCellule(numero));
    grille.appendChild(btn);
  });

  sauvegarderNavigation('grille');
}

// ---------- Écran 3 : contenu d'une cellule ----------

async function ouvrirCellule(numero) {
  etat.celluleOuverte = numero;
  document.getElementById('panel-cellules').classList.add('hidden');
  document.getElementById('panel-cellule-detail').classList.remove('hidden');
  document.getElementById('btn-retour-grille').textContent = '← Retour aux cellules';

  document.getElementById('cellule-titre').textContent = libelleEmplacement({ ...etat.emplacement, cellule: numero });
  document.getElementById('input-recherche').value = '';
  document.getElementById('checkbox-inclure-stock-negatif').checked = false;

  // Les rayons/familles cochés sont volontairement conservés d'une cellule à l'autre
  // (pas de réinitialisation ici) pour éviter de re-cocher le même rayon en boucle
  // quand on enregistre plusieurs articles du même rayon à la suite.
  renderFiltres();
  document.getElementById('resultats-recherche').classList.add('hidden');
  await renderListeArticlesCellule();
  sauvegarderNavigation('cellule');
}

/** Ouvre directement l'écran d'ajout d'articles pour la zone "Table" (pas de grille, pas de cellule) */
async function ouvrirTable() {
  etat.celluleOuverte = null;
  document.getElementById('panel-cellules').classList.add('hidden');
  document.getElementById('panel-cellule-detail').classList.remove('hidden');
  document.getElementById('btn-retour-grille').textContent = '← Retour';

  document.getElementById('cellule-titre').textContent = 'Table';
  document.getElementById('input-recherche').value = '';
  document.getElementById('checkbox-inclure-stock-negatif').checked = false;

  renderFiltres();
  document.getElementById('resultats-recherche').classList.add('hidden');
  await renderListeArticlesCellule();
  sauvegarderNavigation('table');
}

function retourGrille() {
  etat.celluleOuverte = null;

  if (estZoneTable(etat.emplacement.allee)) {
    // Pas de grille pour la zone Table : on revient à l'écran de choix d'emplacement
    document.getElementById('panel-cellule-detail').classList.add('hidden');
    document.getElementById('select-allee').value = '';
    document.getElementById('ligne-facade').classList.remove('hidden');
    document.getElementById('ligne-etage').classList.remove('hidden');
    document.getElementById('note-zone-table').classList.add('hidden');
    etat.emplacement = { allee: null, facade: null, etage: null };
    sauvegarderNavigation('accueil');
    return;
  }

  document.getElementById('panel-cellule-detail').classList.add('hidden');
  afficherGrilleCellules();
}

function renderFiltres() {
  const conteneur = document.getElementById('filtres-rayons');
  conteneur.innerHTML = '';

  const construireChip = (valeur, ensembleCoches) => {
    const chip = document.createElement('label');
    chip.className = 'filtre-chip' + (ensembleCoches.has(valeur) ? ' actif' : '');
    chip.innerHTML = `<input type="checkbox" ${ensembleCoches.has(valeur) ? 'checked' : ''}> ${valeur}`;
    chip.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) ensembleCoches.add(valeur);
      else ensembleCoches.delete(valeur);
      chip.classList.toggle('actif', e.target.checked);
      lancerRecherche();
    });
    return chip;
  };

  getRayonsDisponibles().forEach((r) => conteneur.appendChild(construireChip(r, etat.rayonsCoches)));
  getFamillesDisponibles().forEach((f) => conteneur.appendChild(construireChip(f, etat.famillesCoches)));
}

const lancerRecherche = debounce(() => {
  const texte = document.getElementById('input-recherche').value;
  const inclureStockNegatif = document.getElementById('checkbox-inclure-stock-negatif').checked;
  const resultats = rechercherArticles(texte, etat.rayonsCoches, etat.famillesCoches, inclureStockNegatif);
  renderResultatsRecherche(resultats, texte);
}, 120);

function renderResultatsRecherche(resultats, texte) {
  const conteneur = document.getElementById('resultats-recherche');
  const afficher = texte.trim().length > 0 || resultats.length <= 60;
  conteneur.classList.toggle('hidden', !afficher);
  conteneur.innerHTML = '';

  if (!resultats.length) {
    conteneur.innerHTML = '<p class="message-vide">Aucun article ne correspond.</p>';
    return;
  }

  resultats.forEach((art) => {
    const stockNegatif = Number(art.stockTheorique) <= 0;
    const item = document.createElement('div');
    item.className = 'resultat-item' + (stockNegatif ? ' resultat-stock-negatif' : '');
    item.innerHTML = `
      <div class="resultat-code">${stockNegatif ? '⚠️ ' : ''}${art.codeArticle}</div>
      <div class="resultat-designation">${art.designation}</div>
      <div class="resultat-meta">${art.rayon}${art.famille ? ' · ' + art.famille : ''}${stockNegatif ? ' · stock théorique : ' + (art.stockTheorique ?? 0) : ''}</div>
    `;
    item.addEventListener('click', () => ajouterArticleACelluleOuverte(art.codeArticle));
    conteneur.appendChild(item);
  });
}

async function ajouterArticleACelluleOuverte(codeArticle) {
  await ajouterAffectation({ codeArticle, ...etat.emplacement, cellule: etat.celluleOuverte });
  afficherToast('Article ajouté', 'succes');
  await renderListeArticlesCellule();
}

async function renderListeArticlesCellule() {
  const cle = cleEmplacement({ ...etat.emplacement, cellule: etat.celluleOuverte });
  const affectations = await getAffectationsParCellule(cle);
  const cache = getCacheArticles();
  const parCode = new Map(cache.map((a) => [a.codeArticle, a]));

  const liste = document.getElementById('liste-articles-cellule');
  liste.innerHTML = '';

  if (!affectations.length) {
    liste.innerHTML = '<p class="message-vide">Aucun article dans cette cellule pour le moment.</p>';
    return;
  }

  affectations.forEach((aff) => {
    const art = parCode.get(aff.codeArticle) || { designation: '(article introuvable)', rayon: '', famille: '' };
    const li = document.createElement('li');
    li.className = 'article-item';
    li.dataset.id = aff.id;
    li.innerHTML = `
      <span class="poignee" title="Glisser pour réordonner">⠿</span>
      <div class="article-infos">
        <div class="article-code">${aff.codeArticle}</div>
        <div class="article-designation">${art.designation}</div>
        <div class="article-meta">${art.rayon}${art.famille ? ' · ' + art.famille : ''}</div>
        ${libelleBadgeStockDLC(aff, art)}
      </div>
      <div class="article-actions">
        <button class="icone-btn btn-stock-dlc" title="Stock / DLC / Code-barres">🏷️</button>
        <button class="icone-btn btn-deplacer" title="Déplacer">↔️</button>
        <button class="icone-btn btn-supprimer" title="Supprimer">🗑️</button>
      </div>
    `;
    li.querySelector('.btn-supprimer').addEventListener('click', () => supprimerArticleCellule(aff.id));
    li.querySelector('.btn-deplacer').addEventListener('click', () => ouvrirModaleDeplacer(aff.id));
    li.querySelector('.btn-stock-dlc').addEventListener('click', () => ouvrirModaleStockDLC(aff, art));
    liste.appendChild(li);
  });

  if (etat.sortableInstance) etat.sortableInstance.destroy();
  etat.sortableInstance = new Sortable(liste, {
    handle: '.poignee',
    animation: 150,
    onEnd: async () => {
      const ids = [...liste.querySelectorAll('.article-item')].map((el) => el.dataset.id);
      await reordonnerCellule(cle, ids);
    },
  });
}

async function supprimerArticleCellule(id) {
  if (!confirm('Supprimer cette occurrence de la cellule ?')) return;
  await supprimerAffectation(id);
  afficherToast('Article supprimé', 'succes');
  await renderListeArticlesCellule();
}

/** Construit le petit badge "Stock: x · DLC: date · CB: y" affiché sous un article, si renseigné.
 *  Stock/DLC viennent de l'occurrence (aff), le code-barres vient de l'article du catalogue (art). */
function libelleBadgeStockDLC(aff, art) {
  if (aff.stockReel === null && !aff.dlc && !art?.codeBarre) return '';
  const parties = [];
  if (aff.stockReel !== null) parties.push(`Stock : ${aff.stockReel}`);
  if (aff.dlc) parties.push(`DLC : ${formatDLCCourt(aff.dlc)}`);
  if (art?.codeBarre) parties.push(`CB : ${art.codeBarre}`);
  // Comparaison au niveau du mois (le jour est toujours fixé au 1er, sans signification propre)
  const perime = aff.dlc && aff.dlc.slice(0, 7) < new Date().toISOString().slice(0, 7);
  return `<span class="badge-stock-dlc${perime ? ' perime' : ''}">${parties.join(' · ')}</span>`;
}

// ---------- Modale Infos complémentaires (Stock/DLC par occurrence, Code-barres par article) ----------

let _idStockDLC = null;
let _codeArticleStockDLC = null;
let _contexteStockDLC = 'cellule';

function ouvrirModaleStockDLC(aff, art, contexte = 'cellule') {
  _idStockDLC = aff.id;
  _codeArticleStockDLC = aff.codeArticle;
  _contexteStockDLC = contexte;
  document.getElementById('stock-dlc-titre').textContent = `Infos complémentaires — ${aff.codeArticle}`;
  document.getElementById('input-stock-reel').value = aff.stockReel ?? '';
  document.getElementById('input-dlc').value = aff.dlc ? aff.dlc.slice(0, 7) : '';
  document.getElementById('input-code-barre').value = art?.codeBarre || '';
  document.getElementById('modale-stock-dlc').classList.remove('hidden');
}

function initModaleStockDLC() {
  document.getElementById('btn-annuler-stock-dlc').addEventListener('click', () => {
    document.getElementById('modale-stock-dlc').classList.add('hidden');
  });
  document.getElementById('btn-confirmer-stock-dlc').addEventListener('click', async () => {
    const stockReel = document.getElementById('input-stock-reel').value;
    const moisAnnee = document.getElementById('input-dlc').value; // format "YYYY-MM"
    const dlc = moisAnnee ? `${moisAnnee}-01` : ''; // le jour est toujours fixé au 1er
    const codeBarre = document.getElementById('input-code-barre').value;
    // Stock/DLC = propres à cette occurrence ; code-barres = partagé par tout le catalogue (même codeArticle)
    await Promise.all([
      modifierStockDLC(_idStockDLC, { stockReel, dlc }),
      modifierCodeBarreArticle(_codeArticleStockDLC, codeBarre),
    ]);
    await rafraichirCacheArticles();
    document.getElementById('modale-stock-dlc').classList.add('hidden');
    afficherToast('Informations enregistrées', 'succes');
    if (_contexteStockDLC === 'vue') await renderContenuVueZone();
    else await renderListeArticlesCellule();
  });

  // Valider avec Entrée (clavier physique sur PC, touche "Entrée/OK" du clavier virtuel mobile)
  document.getElementById('modale-stock-dlc').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btn-confirmer-stock-dlc').click();
    }
  });
}

// ---------- Modale de déplacement ----------

let _idADeplacer = null;

function ouvrirModaleDeplacer(id) {
  _idADeplacer = id;
  document.getElementById('deplacer-allee').value = etat.emplacement.allee;
  if (!estZoneTable(etat.emplacement.allee)) {
    document.querySelector(`input[name="deplacer-facade"][value="${etat.emplacement.facade}"]`).checked = true;
    document.getElementById('deplacer-etage').value = etat.emplacement.etage || '1';
  }
  majSelectCelluleModale();
  document.getElementById('modale-deplacer').classList.remove('hidden');
}

function majSelectCelluleModale() {
  const alleeCible = document.getElementById('deplacer-allee').value;
  const versTable = estZoneTable(alleeCible);

  document.getElementById('deplacer-ligne-facade').classList.toggle('hidden', versTable);
  document.getElementById('deplacer-ligne-etage').classList.toggle('hidden', versTable);
  document.getElementById('deplacer-ligne-cellule').classList.toggle('hidden', versTable);

  if (versTable) return;

  const facade = document.querySelector('input[name="deplacer-facade"]:checked').value;
  document.getElementById('deplacer-etage').disabled = facade === 'Sol';
  const select = document.getElementById('deplacer-cellule');
  select.innerHTML = numerosCellules().map((n) => `<option value="${n}">${zeroPad(n)}</option>`).join('');
}

function initModaleDeplacer() {
  document.getElementById('deplacer-allee').addEventListener('change', majSelectCelluleModale);
  document.querySelectorAll('input[name="deplacer-facade"]').forEach((r) =>
    r.addEventListener('change', majSelectCelluleModale)
  );
  document.getElementById('btn-annuler-deplacer').addEventListener('click', () => {
    document.getElementById('modale-deplacer').classList.add('hidden');
  });
  document.getElementById('btn-confirmer-deplacer').addEventListener('click', async () => {
    const alleeCible = document.getElementById('deplacer-allee').value;
    const nouvelEmplacement = estZoneTable(alleeCible)
      ? { allee: 'Table', facade: null, etage: null, cellule: null }
      : {
          allee: alleeCible,
          facade: document.querySelector('input[name="deplacer-facade"]:checked').value,
          etage: document.getElementById('deplacer-etage').value,
          cellule: document.getElementById('deplacer-cellule').value,
        };
    await deplacerAffectation(_idADeplacer, nouvelEmplacement);
    document.getElementById('modale-deplacer').classList.add('hidden');
    afficherToast('Article déplacé', 'succes');
    if (estZoneTable(etat.emplacement.allee)) await ouvrirTable();
    else await renderListeArticlesCellule();
  });
}

// ---------- Bouton Accueil ----------

function allerAccueil() {
  document.getElementById('select-allee').value = '';
  document.querySelectorAll('input[name="facade"]').forEach((r) => (r.checked = false));
  const selectEtage = document.getElementById('select-etage');
  selectEtage.value = '';
  selectEtage.disabled = false;
  document.getElementById('ligne-facade').classList.remove('hidden');
  document.getElementById('ligne-etage').classList.remove('hidden');
  document.getElementById('note-zone-table').classList.add('hidden');

  etat.emplacement = { allee: null, facade: null, etage: null };
  etat.celluleOuverte = null;

  masquerPanelsPrincipaux();
  document.getElementById('panel-emplacement').classList.remove('hidden');

  // Accueil sert aussi de bouton "réinitialiser" : on efface l'écran mémorisé,
  // pour ne pas le restaurer automatiquement à la prochaine ouverture de l'app.
  effacerNavigationMemorisee();
}

// ---------- Aide import ----------

function initAideImport() {
  document.getElementById('btn-aide-import').addEventListener('click', () => {
    document.getElementById('modale-aide-import').classList.remove('hidden');
  });
  document.getElementById('btn-fermer-aide-import').addEventListener('click', () => {
    document.getElementById('modale-aide-import').classList.add('hidden');
  });
  document.getElementById('btn-telecharger-modele').addEventListener('click', telechargerModeleImport);
}

// ---------- Import CSV : ajout massif d'articles dans la zone affichée ----------

function initImportCSVCellules() {
  const inputFichier = document.getElementById('file-import-csv-cellules');

  document.getElementById('btn-import-csv-cellules').addEventListener('click', () => inputFichier.click());

  inputFichier.addEventListener('change', async (e) => {
    const fichier = e.target.files[0];
    e.target.value = '';
    if (!fichier) return;

    try {
      const resultat = await importerAjoutCellulesParCSV(fichier, etat.emplacement);
      let message = `${resultat.ajoutes} article(s) ajouté(s) à la zone.`;
      if (resultat.ignores.length) {
        message += ` ⚠️ ${resultat.ignores.length} ligne(s) ignorée(s) : ${resultat.ignores.slice(0, 3).join(' | ')}${resultat.ignores.length > 3 ? '…' : ''}`;
      }
      afficherToast(message, resultat.ignores.length ? 'erreur' : 'succes', 6000);
      await afficherGrilleCellules();
    } catch (err) {
      afficherToast(err.message, 'erreur', 5000);
    }
  });

  document.getElementById('btn-aide-import-csv-cellules').addEventListener('click', () => {
    document.getElementById('modale-aide-import-csv-cellules').classList.remove('hidden');
  });
  document.getElementById('btn-fermer-aide-import-csv-cellules').addEventListener('click', () => {
    document.getElementById('modale-aide-import-csv-cellules').classList.add('hidden');
  });
  document.getElementById('btn-telecharger-modele-cellules').addEventListener('click', telechargerModeleAjoutCellules);
}

// ---------- Écran Stock : quantité la plus fréquente par palette + fiabilité ----------

async function afficherPanelStock() {
  masquerPanelsPrincipaux();
  document.getElementById('panel-stock').classList.remove('hidden');
  document.getElementById('input-recherche-stock').value = '';
  etat.stockRayonsCoches = new Set();
  await renderContenuStock();
}

function retourDepuisStock() {
  document.getElementById('panel-stock').classList.add('hidden');
  document.getElementById('panel-emplacement').classList.remove('hidden');
  if (estZoneTable(etat.emplacement.allee)) {
    ouvrirTable();
  } else if (etat.celluleOuverte) {
    document.getElementById('panel-cellule-detail').classList.remove('hidden');
    renderListeArticlesCellule();
  } else if (etat.emplacement.allee) {
    afficherGrilleCellules();
  }
}

function renderFiltresRayonsStock(articles) {
  const conteneur = document.getElementById('filtres-rayons-stock');
  conteneur.innerHTML = '';

  const rayons = [...new Set(articles.map((a) => a.rayon).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));

  rayons.forEach((rayon) => {
    const chip = document.createElement('label');
    chip.className = 'filtre-chip' + (etat.stockRayonsCoches.has(rayon) ? ' actif' : '');
    chip.innerHTML = `<input type="checkbox" ${etat.stockRayonsCoches.has(rayon) ? 'checked' : ''}> ${rayon}`;
    chip.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) etat.stockRayonsCoches.add(rayon);
      else etat.stockRayonsCoches.delete(rayon);
      chip.classList.toggle('actif', e.target.checked);
      renderContenuStock();
    });
    conteneur.appendChild(chip);
  });
}

/**
 * Affiche, pour chaque article : stock théorique, stock réel compté, écart entre les deux,
 * quantité la plus fréquemment comptée par palette avec sa fiabilité, une ESTIMATION du
 * nombre de palettes restantes non comptées (déduite de cette quantité fréquente — elle
 * suppose des palettes de taille uniforme, ce n'est jamais un fait garanti), et un badge
 * "✅ Conforme" quand théorique = réel (à condition qu'au moins une palette ait été comptée,
 * pour ne pas marquer par erreur un article jamais vérifié).
 * Tout est recalculé ici à partir des données actuellement en base (jamais une valeur mise
 * en cache) : après correction d'une quantité, rouvrir ou rafraîchir cet écran donne
 * toujours un résultat à jour.
 */
async function renderContenuStock() {
  const texteRecherche = document.getElementById('input-recherche-stock').value;
  const [articles, affectations] = await Promise.all([getAllArticles(), getAllAffectations()]);

  const donneesParArticle = new Map(); // codeArticle -> { quantites: [], total: number }
  affectations.forEach((aff) => {
    if (aff.stockReel === null || aff.stockReel === undefined) return;
    if (!donneesParArticle.has(aff.codeArticle)) donneesParArticle.set(aff.codeArticle, { quantites: [], total: 0 });
    const entree = donneesParArticle.get(aff.codeArticle);
    entree.quantites.push(aff.stockReel);
    entree.total += aff.stockReel;
  });

  renderFiltresRayonsStock(articles);

  let liste = [...articles].sort((a, b) => a.codeArticle.localeCompare(b.codeArticle, 'fr'));
  if (etat.stockRayonsCoches.size) {
    liste = liste.filter((a) => etat.stockRayonsCoches.has(a.rayon));
  }
  if (texteRecherche.trim()) {
    liste = liste.filter((a) => correspondMotsCles(a.codeArticle + ' ' + a.designation, texteRecherche));
  }

  const conteneur = document.getElementById('contenu-stock');
  conteneur.innerHTML = '';

  if (!liste.length) {
    conteneur.innerHTML = `<p class="message-vide">Aucun article${texteRecherche.trim() ? ' pour cette recherche' : ''}.</p>`;
    return;
  }

  liste.forEach((art) => {
    const donnees = donneesParArticle.get(art.codeArticle);
    const stat = calculerQuantiteFrequente(donnees ? donnees.quantites : []);
    const stockTheorique = Number(art.stockTheorique ?? 0);
    const aUneDonnee = !!donnees; // au moins une palette comptée
    const stockReel = aUneDonnee ? donnees.total : null;
    const ecart = aUneDonnee ? stockReel - stockTheorique : null;
    const conforme = aUneDonnee && ecart === 0;
    const palettesRestantes = aUneDonnee && stat ? estimerPalettesRestantes(stockTheorique, stockReel, stat.quantite) : null;

    const carte = document.createElement('div');
    carte.className = 'stock-carte' + (conforme ? ' stock-conforme' : '');

    const entete = document.createElement('div');
    entete.className = 'stock-entete';
    entete.innerHTML = `
      <div class="stock-code">${art.codeArticle} — ${art.designation}${conforme ? ' <span class="badge-conforme">✅ Conforme</span>' : ''}</div>
    `;
    carte.appendChild(entete);

    const grille = document.createElement('div');
    grille.className = 'stock-grille';
    grille.innerHTML = `
      <div class="stock-champ"><span class="stock-label">Théorique</span>${stockTheorique}</div>
      <div class="stock-champ"><span class="stock-label">Réel compté</span>${aUneDonnee ? stockReel : '—'}</div>
      <div class="stock-champ"><span class="stock-label">Écart</span>${aUneDonnee ? (ecart > 0 ? '+' + ecart : ecart) : '—'}</div>
      <div class="stock-champ"><span class="stock-label">Palettes comptées</span>${aUneDonnee ? stat.total : 0}</div>
      <div class="stock-champ"><span class="stock-label">Palettes restantes (est.)</span>${palettesRestantes !== null ? palettesRestantes : '—'}</div>
    `;
    carte.appendChild(grille);

    const quantite = document.createElement('div');
    quantite.className = 'stock-quantite';
    if (stat) {
      const classeFiabilite = stat.pourcentage >= 75 ? 'fiabilite-haute' : stat.pourcentage < 50 ? 'fiabilite-basse' : '';
      quantite.innerHTML = `Quantité la plus fréquente / palette : <strong>${stat.quantite}</strong><small class="stock-fiabilite ${classeFiabilite}">(${stat.pourcentage} %)</small>`;
    } else {
      quantite.innerHTML = `<small class="stock-fiabilite">Aucune palette comptée</small>`;
    }
    carte.appendChild(quantite);

    conteneur.appendChild(carte);
  });
}

const lancerRechercheStock = debounce(renderContenuStock, 120);

// ---------- Vue de consultation : articles enregistrés par zone ----------

function masquerPanelsPrincipaux() {
  ['panel-emplacement', 'panel-cellules', 'panel-cellule-detail', 'panel-vue-zone', 'panel-stock'].forEach((id) =>
    document.getElementById(id).classList.add('hidden')
  );
}

async function afficherVueParZone() {
  masquerPanelsPrincipaux();
  document.getElementById('panel-vue-zone').classList.remove('hidden');
  document.getElementById('input-recherche-vue').value = '';
  document.getElementById('checkbox-stock-negatif').checked = false;
  etat.selectionEtiquettes = new Set();
  await renderContenuVueZone();
  sauvegarderNavigation('vue');
}

function retourDepuisVueZone() {
  document.getElementById('panel-vue-zone').classList.add('hidden');
  document.getElementById('barre-impression').classList.add('hidden');
  document.getElementById('panel-emplacement').classList.remove('hidden');
  if (estZoneTable(etat.emplacement.allee)) {
    ouvrirTable();
  } else if (etat.celluleOuverte) {
    document.getElementById('panel-cellule-detail').classList.remove('hidden');
    renderListeArticlesCellule();
  } else if (etat.emplacement.allee) {
    afficherGrilleCellules();
  }
}

/** Construit une case à cocher qui sélectionne/désélectionne un groupe d'ids pour l'impression des étiquettes */
function caseSelection(ids) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'case-select';
  input.checked = ids.length > 0 && ids.every((id) => etat.selectionEtiquettes.has(id));
  input.addEventListener('change', (e) => {
    if (e.target.checked) ids.forEach((id) => etat.selectionEtiquettes.add(id));
    else ids.forEach((id) => etat.selectionEtiquettes.delete(id));
    renderContenuVueZone();
  });
  return input;
}

async function renderContenuVueZone() {
  const alleeFiltre = document.getElementById('select-vue-allee').value;
  const texteRecherche = document.getElementById('input-recherche-vue').value;

  document.getElementById('btn-vider-allee').classList.toggle('hidden', !alleeFiltre);

  const [affectations, articles] = await Promise.all([getAllAffectations(), getAllArticles()]);
  const parCode = new Map(articles.map((a) => [a.codeArticle, a]));

  let liste = affectations;
  if (alleeFiltre) liste = liste.filter((a) => String(a.allee) === alleeFiltre);
  if (texteRecherche.trim()) {
    liste = liste.filter((a) => {
      const art = parCode.get(a.codeArticle);
      const texteArticle = a.codeArticle + ' ' + (art ? art.designation : '');
      return correspondMotsCles(texteArticle, texteRecherche);
    });
  }
  if (document.getElementById('checkbox-stock-negatif').checked) {
    liste = liste.filter((a) => {
      const art = parCode.get(a.codeArticle);
      return !art || Number(art.stockTheorique) <= 0; // absent du catalogue (inconnu) OU ≤ 0
    });
  }
  liste = trierAffectationsPourAffichage(liste);

  majBarreImpression();

  const conteneur = document.getElementById('contenu-vue-zone');
  conteneur.innerHTML = '';

  if (!liste.length) {
    const filtreStockNegatif = document.getElementById('checkbox-stock-negatif').checked;
    const raison = texteRecherche.trim() ? ' pour cette recherche' : filtreStockNegatif ? ' avec un stock théorique ≤ 0 ou inconnu' : alleeFiltre ? ' pour cette zone' : '';
    conteneur.innerHTML = `<p class="message-vide">Aucun article enregistré${raison}.</p>`;
    return;
  }

  // Groupement imbriqué : Allée > Façade > Étage > Cellule, chaque niveau avec sa case
  // à cocher (sélectionne tous les articles en dessous, pour l'impression des étiquettes)
  // et son bouton "vider" (suppression en masse).
  let alleeDiv = null, alleeActuelle = null;
  let facadeDiv = null, facadeActuelle = null;
  let etageDiv = null, etageActuelle = null;
  let celluleDiv = null, celluleActuelle = null;

  const boutonVider = (libelle, critere) => {
    const btn = document.createElement('button');
    btn.className = 'bouton-vider';
    btn.textContent = '🗑️ Vider';
    btn.title = `Vider ${libelle}`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      viderParCritere(critere, libelle);
    });
    return btn;
  };

  const construireTitre = (classe, texte, ids, boutonViderEl) => {
    const titre = document.createElement('div');
    titre.className = classe;
    const groupeGauche = document.createElement('span');
    groupeGauche.appendChild(caseSelection(ids));
    groupeGauche.appendChild(document.createTextNode(texte));
    titre.appendChild(groupeGauche);
    titre.appendChild(boutonViderEl);
    return titre;
  };

  liste.forEach((aff) => {
    if (aff.allee !== alleeActuelle) {
      alleeActuelle = aff.allee;
      const idsAllee = liste.filter((a) => a.allee === aff.allee).map((a) => a.id);
      alleeDiv = document.createElement('div');
      alleeDiv.className = 'zone-carte';
      const libelleAllee = estZoneTable(aff.allee) ? 'Table' : `Zone ${aff.allee}`;
      const critereAllee = estZoneTable(aff.allee) ? "la zone Table" : `la zone ${aff.allee}`;
      alleeDiv.appendChild(construireTitre('zone-titre', libelleAllee, idsAllee, boutonVider(critereAllee, { allee: aff.allee })));
      conteneur.appendChild(alleeDiv);
      facadeActuelle = null;
    }

    if (estZoneTable(aff.allee)) {
      // Zone "Table" : pas de sous-niveau façade/étage/cellule, les articles
      // sont ajoutés directement dans la carte de zone.
      celluleDiv = alleeDiv;
      celluleDiv.appendChild(construireLigneArticleVue(aff, parCode));
      return;
    }

    if (aff.facade !== facadeActuelle) {
      facadeActuelle = aff.facade;
      const idsFacade = liste.filter((a) => a.allee === aff.allee && a.facade === aff.facade).map((a) => a.id);
      facadeDiv = document.createElement('div');
      facadeDiv.className = 'facade-groupe';
      facadeDiv.appendChild(construireTitre('facade-titre', `Façade ${aff.facade}`, idsFacade, boutonVider(`la façade ${aff.facade} (zone ${aff.allee})`, { allee: aff.allee, facade: aff.facade })));
      alleeDiv.appendChild(facadeDiv);
      etageActuelle = null;
    }

    const etageCle = aff.etage ?? 0;
    if (etageCle !== etageActuelle) {
      etageActuelle = etageCle;
      if (aff.facade === 'Sol') {
        etageDiv = facadeDiv; // pas de sous-niveau étage pour le Sol
      } else {
        const idsEtage = liste.filter((a) => a.allee === aff.allee && a.facade === aff.facade && (a.etage ?? 0) === etageCle).map((a) => a.id);
        etageDiv = document.createElement('div');
        etageDiv.className = 'etage-groupe';
        etageDiv.appendChild(construireTitre('etage-titre', `Étage ${aff.etage}`, idsEtage, boutonVider(
          `l'étage ${aff.etage} (zone ${aff.allee}, façade ${aff.facade})`,
          { allee: aff.allee, facade: aff.facade, etage: aff.etage }
        )));
        facadeDiv.appendChild(etageDiv);
      }
      celluleActuelle = null;
    }

    if (aff.cellule !== celluleActuelle) {
      celluleActuelle = aff.cellule;
      const idsCellule = liste.filter((a) => a.allee === aff.allee && a.facade === aff.facade && (a.etage ?? 0) === etageCle && a.cellule === aff.cellule).map((a) => a.id);
      celluleDiv = document.createElement('div');
      celluleDiv.className = 'zone-cellule-groupe';
      celluleDiv.appendChild(construireTitre('zone-cellule-titre', `Cellule ${zeroPad(aff.cellule)}`, idsCellule, boutonVider(
        `la cellule ${zeroPad(aff.cellule)} (zone ${aff.allee}, façade ${aff.facade}${aff.facade !== 'Sol' ? ', étage ' + aff.etage : ''})`,
        { allee: aff.allee, facade: aff.facade, etage: aff.facade === 'Sol' ? null : aff.etage, cellule: aff.cellule }
      )));
      etageDiv.appendChild(celluleDiv);
    }

    celluleDiv.appendChild(construireLigneArticleVue(aff, parCode));
  });
}

/** Construit une ligne d'article dans la Vue : case de sélection, code/désignation, stock, méta, suppression */
function construireLigneArticleVue(aff, parCode) {
  const art = parCode.get(aff.codeArticle) || { designation: '(article introuvable)', rayon: '', famille: '' };

  const ligne = document.createElement('div');
  ligne.className = 'zone-ligne-article';
  ligne.appendChild(caseSelection([aff.id]));

  const code = document.createElement('span');
  code.className = 'code';
  code.textContent = `${aff.codeArticle} — ${art.designation}`;
  ligne.appendChild(code);

  if (aff.stockReel !== null && aff.stockReel !== undefined) {
    const stock = document.createElement('span');
    stock.className = 'stock';
    stock.textContent = `Stock : ${aff.stockReel}`;
    ligne.appendChild(stock);
  }

  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = `${art.rayon}${art.famille ? ' · ' + art.famille : ''}`;
  ligne.appendChild(meta);

  const btnModifier = document.createElement('button');
  btnModifier.className = 'icone-btn-mini';
  btnModifier.title = 'Modifier (stock / DLC / code-barres)';
  btnModifier.textContent = '🏷️';
  btnModifier.addEventListener('click', (e) => {
    e.stopPropagation();
    ouvrirModaleStockDLC(aff, art, 'vue');
  });
  ligne.appendChild(btnModifier);

  const btnSupprimer = document.createElement('button');
  btnSupprimer.className = 'icone-btn-mini';
  btnSupprimer.title = 'Supprimer cet article';
  btnSupprimer.textContent = '🗑️';
  btnSupprimer.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Supprimer "${aff.codeArticle} — ${art.designation}" de cet emplacement ?`)) return;
    await supprimerAffectation(aff.id);
    etat.selectionEtiquettes.delete(aff.id);
    afficherToast('Article supprimé', 'succes');
    await renderContenuVueZone();
  });
  ligne.appendChild(btnSupprimer);

  return ligne;
}

/** Met à jour le texte et la visibilité de la barre flottante de sélection pour l'impression */
function majBarreImpression() {
  const barre = document.getElementById('barre-impression');
  const n = etat.selectionEtiquettes.size;
  document.getElementById('compte-selection').textContent = `${n} article(s) sélectionné(s)`;
  barre.classList.toggle('hidden', n === 0);
}

/** Convertit une DLC 'YYYY-MM-DD' en format court bien visible 'MM/AAAA' */
function formatDLCCourt(dlc) {
  if (!dlc) return '';
  const [annee, mois] = dlc.split('-');
  return `${mois}/${annee}`;
}

/**
 * Construit une page A4 paysage par occurrence sélectionnée (DLC en très grand en haut,
 * puis en bas 3 colonnes : Code article en grand, Quantité en grand, reste des infos
 * disponibles) et lance l'impression du navigateur (l'utilisateur choisit
 * "Enregistrer en PDF" dans la fenêtre d'impression).
 */
async function genererPDFEtiquettes() {
  const idsSelectionnes = new Set(etat.selectionEtiquettes);
  if (!idsSelectionnes.size) {
    afficherToast('Coche au moins un article à imprimer', 'erreur');
    return;
  }

  const [affectations, articles] = await Promise.all([getAllAffectations(), getAllArticles()]);
  const parCode = new Map(articles.map((a) => [a.codeArticle, a]));

  let selection = affectations.filter((a) => idsSelectionnes.has(a.id));
  selection = trierAffectationsPourAffichage(selection);

  const conteneur = document.getElementById('zone-impression');
  conteneur.innerHTML = selection.map((aff) => {
    const art = parCode.get(aff.codeArticle) || {};
    const quantite = aff.stockReel !== null && aff.stockReel !== undefined ? aff.stockReel : '—';

    const champs = [];
    if (art.designation) champs.push(champEtiquette('Désignation', art.designation));
    if (art.codeBarre) champs.push(champEtiquette('Code-barres', art.codeBarre));
    if (aff.allee !== 'Table') {
      champs.push(champEtiquette('Emplacement', libelleEmplacementCourt({ allee: aff.allee, facade: aff.facade, etage: aff.etage, cellule: aff.cellule })));
    }
    if (art.rayon) champs.push(champEtiquette('Rayon', art.rayon));

    return `
      <div class="page-etiquette">
        <div class="etiquette-haut">${aff.dlc ? formatDLCCourt(aff.dlc) : '—'}</div>
        <div class="etiquette-bas">
          <div class="etiquette-code">
            <span class="etiquette-mini-titre">Code</span>
            <div class="etiquette-valeur">${aff.codeArticle}</div>
          </div>
          <div class="etiquette-quantite">
            <span class="etiquette-mini-titre">Quantité</span>
            <div class="etiquette-valeur">${quantite}</div>
          </div>
          <div class="etiquette-details">${champs.join('')}</div>
        </div>
        <div class="etiquette-pied">Plateforme SIDI GHANEM</div>
      </div>
    `;
  }).join('');

  // Laisse le DOM se mettre à jour avant d'ouvrir la fenêtre d'impression
  requestAnimationFrame(() => window.print());
}

function champEtiquette(label, valeur) {
  return `<div class="etiquette-champ"><span class="etiquette-label">${label}</span>${valeur}</div>`;
}

/** Supprime en masse les affectations correspondant à un critère (allée/façade/étage/cellule), avec confirmation */
async function viderParCritere(critere, libelle) {
  if (!confirm(`Supprimer toutes les affectations de ${libelle} ? Cette action est irréversible.`)) return;
  const nombre = await supprimerAffectationsParCritere(critere);
  afficherToast(`${nombre} occurrence(s) supprimée(s)`, 'succes');
  await renderContenuVueZone();
}

/** Retire des filtres mémorisés les rayons/familles qui n'existent plus après un import du catalogue */
function nettoyerFiltresApresImport() {
  const rayonsDispo = new Set(getRayonsDisponibles());
  const famillesDispo = new Set(getFamillesDisponibles());
  etat.rayonsCoches = new Set([...etat.rayonsCoches].filter((r) => rayonsDispo.has(r)));
  etat.famillesCoches = new Set([...etat.famillesCoches].filter((f) => famillesDispo.has(f)));
}

const lancerRechercheVueZone = debounce(renderContenuVueZone, 120);

// ---------- En-tête : import / export ----------

function initActionsEntete() {
  const inputTheorique = document.getElementById('file-import-theorique');
  const inputJSON = document.getElementById('file-import-json');

  document.getElementById('btn-import-theorique').addEventListener('click', () => inputTheorique.click());
  inputTheorique.addEventListener('change', async (e) => {
    const fichier = e.target.files[0];
    e.target.value = '';
    if (!fichier) return;
    try {
      const resultat = await importerEtatTheorique(fichier);
      let message = `Import OK : ${resultat.ajoutes} nouveaux, ${resultat.misAJour} mis à jour (${resultat.total} au total).`;
      if (resultat.conserves) {
        message += ` ${resultat.conserves} article(s) absent(s) de ce fichier conservé(s) avec un stock ramené à 0.`;
      }
      if (resultat.orphelins.length) {
        message += ` ⚠️ ${resultat.orphelins.length} article(s) affecté(s) à une cellule ne sont plus dans l'état théorique.`;
      }
      afficherToast(message, resultat.orphelins.length ? 'erreur' : 'succes', 6000);
      nettoyerFiltresApresImport();
      renderFiltres();
      if (etat.emplacement.allee) afficherGrilleCellules();
    } catch (err) {
      afficherToast(err.message, 'erreur', 5000);
    }
  });

  document.getElementById('btn-export-excel').addEventListener('click', async () => {
    try {
      await exporterExcel();
      afficherToast('Export Excel généré', 'succes');
    } catch (err) {
      afficherToast(err.message, 'erreur');
    }
  });

  document.getElementById('btn-export-json').addEventListener('click', async () => {
    await exporterSauvegardeJSON();
    afficherToast('Sauvegarde exportée', 'succes');
  });

  document.getElementById('btn-stock-csv').addEventListener('click', afficherPanelStock);

  document.getElementById('btn-import-json').addEventListener('click', () => inputJSON.click());
  inputJSON.addEventListener('change', async (e) => {
    const fichier = e.target.files[0];
    e.target.value = '';
    if (!fichier) return;
    if (!confirm("Restaurer cette sauvegarde va remplacer toutes les données actuelles. Continuer ?")) return;
    try {
      await importerSauvegardeJSON(fichier);
      afficherToast('Sauvegarde restaurée', 'succes');
      nettoyerFiltresApresImport();
      renderFiltres();
      if (etat.celluleOuverte) await renderListeArticlesCellule();
      else if (etat.emplacement.allee) await afficherGrilleCellules();
    } catch (err) {
      afficherToast(err.message, 'erreur', 5000);
    }
  });
}

function initUI() {
  initFormulaireEmplacement();
  document.getElementById('btn-retour-grille').addEventListener('click', retourGrille);
  document.getElementById('input-recherche').addEventListener('input', lancerRecherche);
  document.getElementById('checkbox-inclure-stock-negatif').addEventListener('change', lancerRecherche);
  initModaleDeplacer();
  initModaleStockDLC();
  initAideImport();
  initImportCSVCellules();
  initActionsEntete();

  document.getElementById('btn-accueil').addEventListener('click', allerAccueil);
  document.getElementById('btn-vue-zone').addEventListener('click', afficherVueParZone);
  document.getElementById('btn-retour-vue-zone').addEventListener('click', retourDepuisVueZone);
  document.getElementById('select-vue-allee').addEventListener('change', renderContenuVueZone);
  document.getElementById('checkbox-stock-negatif').addEventListener('change', renderContenuVueZone);
  document.getElementById('input-recherche-vue').addEventListener('input', lancerRechercheVueZone);
  document.getElementById('btn-vider-allee').addEventListener('click', () => {
    const allee = document.getElementById('select-vue-allee').value;
    if (allee) viderParCritere({ allee }, `toute la zone ${allee}`);
  });
  document.getElementById('btn-generer-pdf').addEventListener('click', genererPDFEtiquettes);
  window.addEventListener('afterprint', () => {
    document.getElementById('zone-impression').innerHTML = '';
  });

  document.getElementById('btn-retour-stock').addEventListener('click', retourDepuisStock);
  document.getElementById('input-recherche-stock').addEventListener('input', lancerRechercheStock);
  document.getElementById('btn-export-stock-csv').addEventListener('click', async () => {
    try {
      await exporterStockCSV();
      afficherToast('Fichier stock généré', 'succes');
    } catch (err) {
      afficherToast(err.message, 'erreur');
    }
  });
}
