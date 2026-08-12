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
};

// ---------- Écran 1 : choix de l'emplacement ----------

function initFormulaireEmplacement() {
  const selectAllee = document.getElementById('select-allee');
  const radiosFacade = document.querySelectorAll('input[name="facade"]');
  const selectEtage = document.getElementById('select-etage');

  function onChangement() {
    const allee = selectAllee.value;
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
}

// ---------- Écran 3 : contenu d'une cellule ----------

async function ouvrirCellule(numero) {
  etat.celluleOuverte = numero;
  document.getElementById('panel-cellules').classList.add('hidden');
  document.getElementById('panel-cellule-detail').classList.remove('hidden');

  document.getElementById('cellule-titre').textContent = libelleEmplacement({ ...etat.emplacement, cellule: numero });
  document.getElementById('input-recherche').value = '';

  // Les rayons/familles cochés sont volontairement conservés d'une cellule à l'autre
  // (pas de réinitialisation ici) pour éviter de re-cocher le même rayon en boucle
  // quand on enregistre plusieurs articles du même rayon à la suite.
  renderFiltres();
  document.getElementById('resultats-recherche').classList.add('hidden');
  await renderListeArticlesCellule();
}

function retourGrille() {
  etat.celluleOuverte = null;
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
  const resultats = rechercherArticles(texte, etat.rayonsCoches, etat.famillesCoches);
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
    const item = document.createElement('div');
    item.className = 'resultat-item';
    item.innerHTML = `
      <div class="resultat-code">${art.codeArticle}</div>
      <div class="resultat-designation">${art.designation}</div>
      <div class="resultat-meta">${art.rayon}${art.famille ? ' · ' + art.famille : ''}</div>
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
  if (aff.dlc) parties.push(`DLC : ${aff.dlc}`);
  if (art?.codeBarre) parties.push(`CB : ${art.codeBarre}`);
  const perime = aff.dlc && aff.dlc < new Date().toISOString().slice(0, 10);
  return `<span class="badge-stock-dlc${perime ? ' perime' : ''}">${parties.join(' · ')}</span>`;
}

// ---------- Modale Infos complémentaires (Stock/DLC par occurrence, Code-barres par article) ----------

let _idStockDLC = null;
let _codeArticleStockDLC = null;

function ouvrirModaleStockDLC(aff, art) {
  _idStockDLC = aff.id;
  _codeArticleStockDLC = aff.codeArticle;
  document.getElementById('stock-dlc-titre').textContent = `Infos complémentaires — ${aff.codeArticle}`;
  document.getElementById('input-stock-reel').value = aff.stockReel ?? '';
  document.getElementById('input-dlc').value = aff.dlc || '';
  document.getElementById('input-code-barre').value = art?.codeBarre || '';
  document.getElementById('modale-stock-dlc').classList.remove('hidden');
}

function initModaleStockDLC() {
  document.getElementById('btn-annuler-stock-dlc').addEventListener('click', () => {
    document.getElementById('modale-stock-dlc').classList.add('hidden');
  });
  document.getElementById('btn-confirmer-stock-dlc').addEventListener('click', async () => {
    const stockReel = document.getElementById('input-stock-reel').value;
    const dlc = document.getElementById('input-dlc').value;
    const codeBarre = document.getElementById('input-code-barre').value;
    // Stock/DLC = propres à cette occurrence ; code-barres = partagé par tout le catalogue (même codeArticle)
    await Promise.all([
      modifierStockDLC(_idStockDLC, { stockReel, dlc }),
      modifierCodeBarreArticle(_codeArticleStockDLC, codeBarre),
    ]);
    await rafraichirCacheArticles();
    document.getElementById('modale-stock-dlc').classList.add('hidden');
    afficherToast('Informations enregistrées', 'succes');
    await renderListeArticlesCellule();
  });
}

// ---------- Modale de déplacement ----------

let _idADeplacer = null;

function ouvrirModaleDeplacer(id) {
  _idADeplacer = id;
  document.getElementById('deplacer-allee').value = etat.emplacement.allee;
  document.querySelector(`input[name="deplacer-facade"][value="${etat.emplacement.facade}"]`).checked = true;
  document.getElementById('deplacer-etage').value = etat.emplacement.etage || '1';
  majSelectCelluleModale();
  document.getElementById('modale-deplacer').classList.remove('hidden');
}

function majSelectCelluleModale() {
  const facade = document.querySelector('input[name="deplacer-facade"]:checked').value;
  document.getElementById('deplacer-etage').disabled = facade === 'Sol';
  const select = document.getElementById('deplacer-cellule');
  select.innerHTML = numerosCellules().map((n) => `<option value="${n}">${zeroPad(n)}</option>`).join('');
}

function initModaleDeplacer() {
  document.querySelectorAll('input[name="deplacer-facade"]').forEach((r) =>
    r.addEventListener('change', majSelectCelluleModale)
  );
  document.getElementById('btn-annuler-deplacer').addEventListener('click', () => {
    document.getElementById('modale-deplacer').classList.add('hidden');
  });
  document.getElementById('btn-confirmer-deplacer').addEventListener('click', async () => {
    const nouvelEmplacement = {
      allee: document.getElementById('deplacer-allee').value,
      facade: document.querySelector('input[name="deplacer-facade"]:checked').value,
      etage: document.getElementById('deplacer-etage').value,
      cellule: document.getElementById('deplacer-cellule').value,
    };
    await deplacerAffectation(_idADeplacer, nouvelEmplacement);
    document.getElementById('modale-deplacer').classList.add('hidden');
    afficherToast('Article déplacé', 'succes');
    await renderListeArticlesCellule();
  });
}

// ---------- Bouton Accueil ----------

function allerAccueil() {
  document.getElementById('select-allee').value = '';
  document.querySelectorAll('input[name="facade"]').forEach((r) => (r.checked = false));
  const selectEtage = document.getElementById('select-etage');
  selectEtage.value = '';
  selectEtage.disabled = false;

  etat.emplacement = { allee: null, facade: null, etage: null };
  etat.celluleOuverte = null;

  masquerPanelsPrincipaux();
  document.getElementById('panel-emplacement').classList.remove('hidden');
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

// ---------- Vue de consultation : articles enregistrés par zone ----------

function masquerPanelsPrincipaux() {
  ['panel-emplacement', 'panel-cellules', 'panel-cellule-detail', 'panel-vue-zone'].forEach((id) =>
    document.getElementById(id).classList.add('hidden')
  );
}

async function afficherVueParZone() {
  masquerPanelsPrincipaux();
  document.getElementById('panel-vue-zone').classList.remove('hidden');
  document.getElementById('input-recherche-vue').value = '';
  etat.selectionEtiquettes = new Set();
  await renderContenuVueZone();
}

function retourDepuisVueZone() {
  document.getElementById('panel-vue-zone').classList.add('hidden');
  document.getElementById('barre-impression').classList.add('hidden');
  document.getElementById('panel-emplacement').classList.remove('hidden');
  if (etat.celluleOuverte) {
    document.getElementById('panel-cellule-detail').classList.remove('hidden');
    renderListeArticlesCellule();
  } else if (etat.emplacement.allee) {
    afficherGrilleCellules();
  }
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
  liste = trierAffectationsPourAffichage(liste);

  majBarreImpression();

  const conteneur = document.getElementById('contenu-vue-zone');
  conteneur.innerHTML = '';

  if (!liste.length) {
    const raison = texteRecherche.trim() ? ' pour cette recherche' : alleeFiltre ? ' pour cette zone' : '';
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

  const caseSelection = (ids) => {
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
      alleeDiv.appendChild(construireTitre('zone-titre', `Zone ${aff.allee}`, idsAllee, boutonVider(`la zone ${aff.allee}`, { allee: aff.allee })));
      conteneur.appendChild(alleeDiv);
      facadeActuelle = null;
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

    const art = parCode.get(aff.codeArticle) || { designation: '(article introuvable)', rayon: '', famille: '' };
    const ligne = document.createElement('div');
    ligne.className = 'zone-ligne-article';
    ligne.appendChild(caseSelection([aff.id]));
    const code = document.createElement('span');
    code.className = 'code';
    code.textContent = `${aff.codeArticle} — ${art.designation}`;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${art.rayon}${art.famille ? ' · ' + art.famille : ''}`;
    ligne.appendChild(code);
    ligne.appendChild(meta);
    celluleDiv.appendChild(ligne);
  });
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
    champs.push(champEtiquette('Emplacement', libelleEmplacementCourt({ allee: aff.allee, facade: aff.facade, etage: aff.etage, cellule: aff.cellule })));
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
      if (resultat.orphelins.length) {
        message += ` ⚠️ ${resultat.orphelins.length} article(s) affecté(s) à une cellule ne sont plus dans l'état théorique.`;
      }
      afficherToast(message, resultat.orphelins.length ? 'erreur' : 'succes', 5000);
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
  initModaleDeplacer();
  initModaleStockDLC();
  initAideImport();
  initImportCSVCellules();
  initActionsEntete();

  document.getElementById('btn-accueil').addEventListener('click', allerAccueil);
  document.getElementById('btn-vue-zone').addEventListener('click', afficherVueParZone);
  document.getElementById('btn-retour-vue-zone').addEventListener('click', retourDepuisVueZone);
  document.getElementById('select-vue-allee').addEventListener('change', renderContenuVueZone);
  document.getElementById('input-recherche-vue').addEventListener('input', lancerRechercheVueZone);
  document.getElementById('btn-vider-allee').addEventListener('click', () => {
    const allee = document.getElementById('select-vue-allee').value;
    if (allee) viderParCritere({ allee }, `toute la zone ${allee}`);
  });
  document.getElementById('btn-generer-pdf').addEventListener('click', genererPDFEtiquettes);
  window.addEventListener('afterprint', () => {
    document.getElementById('zone-impression').innerHTML = '';
  });
}
