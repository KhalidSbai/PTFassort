// ui.js — rendu des écrans et gestion des interactions utilisateur.
// Toute la logique métier (DB, recherche, import/export) est déléguée aux autres modules ;
// ce fichier se contente d'orchestrer le DOM.

const etat = {
  emplacement: { allee: null, facade: null, etage: null }, // emplacement courant (allée/façade/étage)
  celluleOuverte: null,                                    // numéro de cellule ouverte (1-18) ou null
  rayonsCoches: new Set(),
  famillesCoches: new Set(),
  sortableInstance: null,
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

  // Par défaut, tous les rayons/familles sont cochés (aucun filtre actif)
  etat.rayonsCoches = new Set(getRayonsDisponibles());
  etat.famillesCoches = new Set(getFamillesDisponibles());

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
      </div>
      <div class="article-actions">
        <button class="icone-btn btn-deplacer" title="Déplacer">↔️</button>
        <button class="icone-btn btn-supprimer" title="Supprimer">🗑️</button>
      </div>
    `;
    li.querySelector('.btn-supprimer').addEventListener('click', () => supprimerArticleCellule(aff.id));
    li.querySelector('.btn-deplacer').addEventListener('click', () => ouvrirModaleDeplacer(aff.id));
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

// ---------- Vue de consultation : articles enregistrés par zone ----------

function masquerPanelsPrincipaux() {
  ['panel-emplacement', 'panel-cellules', 'panel-cellule-detail', 'panel-vue-zone'].forEach((id) =>
    document.getElementById(id).classList.add('hidden')
  );
}

async function afficherVueParZone() {
  masquerPanelsPrincipaux();
  document.getElementById('panel-vue-zone').classList.remove('hidden');
  await renderContenuVueZone();
}

function retourDepuisVueZone() {
  document.getElementById('panel-vue-zone').classList.add('hidden');
  document.getElementById('panel-emplacement').classList.remove('hidden');
  if (etat.celluleOuverte) document.getElementById('panel-cellule-detail').classList.remove('hidden');
  else if (etat.emplacement.allee) document.getElementById('panel-cellules').classList.remove('hidden');
}

async function renderContenuVueZone() {
  const alleeFiltre = document.getElementById('select-vue-allee').value;
  const [affectations, articles] = await Promise.all([getAllAffectations(), getAllArticles()]);
  const parCode = new Map(articles.map((a) => [a.codeArticle, a]));

  let liste = affectations;
  if (alleeFiltre) liste = liste.filter((a) => String(a.allee) === alleeFiltre);
  liste = trierAffectationsPourAffichage(liste);

  const conteneur = document.getElementById('contenu-vue-zone');
  conteneur.innerHTML = '';

  if (!liste.length) {
    conteneur.innerHTML = `<p class="message-vide">Aucun article enregistré${alleeFiltre ? ' pour cette allée.' : " pour l'instant."}</p>`;
    return;
  }

  let zoneCleActuelle = null;
  let zoneDiv = null;
  let celluleActuelle = null;
  let celluleDiv = null;

  liste.forEach((aff) => {
    const zoneCle = `${aff.allee}-${aff.facade}-${aff.etage ?? 0}`;
    if (zoneCle !== zoneCleActuelle) {
      zoneCleActuelle = zoneCle;
      zoneDiv = document.createElement('div');
      zoneDiv.className = 'zone-carte';
      zoneDiv.innerHTML = `<div class="zone-titre">${libelleZone({ allee: aff.allee, facade: aff.facade, etage: aff.etage })}</div>`;
      conteneur.appendChild(zoneDiv);
      celluleActuelle = null;
    }

    if (aff.cellule !== celluleActuelle) {
      celluleActuelle = aff.cellule;
      celluleDiv = document.createElement('div');
      celluleDiv.className = 'zone-cellule-groupe';
      celluleDiv.innerHTML = `<div class="zone-cellule-titre">Cellule ${zeroPad(aff.cellule)}</div>`;
      zoneDiv.appendChild(celluleDiv);
    }

    const art = parCode.get(aff.codeArticle) || { designation: '(article introuvable)', rayon: '', famille: '' };
    const ligne = document.createElement('div');
    ligne.className = 'zone-ligne-article';
    ligne.innerHTML = `<span class="code">${aff.codeArticle} — ${art.designation}</span><span class="meta">${art.rayon}${art.famille ? ' · ' + art.famille : ''}</span>`;
    celluleDiv.appendChild(ligne);
  });
}

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
  initActionsEntete();

  document.getElementById('btn-vue-zone').addEventListener('click', afficherVueParZone);
  document.getElementById('btn-retour-vue-zone').addEventListener('click', retourDepuisVueZone);
  document.getElementById('select-vue-allee').addEventListener('change', renderContenuVueZone);
}
