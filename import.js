// import.js — lecture du fichier d'état théorique (Excel/CSV) et de la sauvegarde JSON.

const COLONNES_ATTENDUES = ['Code article', 'Désignation', 'Stock théorique', 'Rayon'];
const COLONNE_FAMILLE = 'Famille';

/**
 * Vérifie que les en-têtes du fichier correspondent exactement (orthographe + ordre)
 * à ce qui est attendu. Retourne { valide, erreur, aFamille }.
 */
function validerEntetes(entetes) {
  const entetesNettoyees = entetes.map((e) => String(e ?? '').trim());

  for (let i = 0; i < COLONNES_ATTENDUES.length; i++) {
    const attendu = COLONNES_ATTENDUES[i];
    const trouve = entetesNettoyees[i];
    if (trouve !== attendu) {
      return {
        valide: false,
        erreur: `Colonne ${i + 1} incorrecte : attendu "${attendu}", trouvé "${trouve || '(vide)'}".`,
      };
    }
  }

  const aFamille = entetesNettoyees[COLONNES_ATTENDUES.length] === COLONNE_FAMILLE;
  if (entetesNettoyees.length > COLONNES_ATTENDUES.length && !aFamille) {
    return {
      valide: false,
      erreur: `Colonne ${COLONNES_ATTENDUES.length + 1} incorrecte : attendu "${COLONNE_FAMILLE}" (facultative), trouvé "${entetesNettoyees[COLONNES_ATTENDUES.length]}".`,
    };
  }

  return { valide: true, aFamille };
}

/** Transforme les lignes brutes de la feuille en objets articles */
function construireArticles(lignes, aFamille) {
  const articles = [];
  for (const ligne of lignes) {
    const codeArticle = String(ligne[0] ?? '').trim();
    if (!codeArticle) continue; // ignore les lignes vides
    articles.push({
      codeArticle,
      designation: String(ligne[1] ?? '').trim(),
      stockTheorique: Number(ligne[2]) || 0,
      rayon: String(ligne[3] ?? '').trim(),
      famille: aFamille ? String(ligne[4] ?? '').trim() : '',
      codeBarre: null, // sera préservé automatiquement lors d'un ré-import si déjà renseigné (voir remplacerCatalogue)
    });
  }
  return articles;
}

/**
 * Lit un fichier Excel/CSV et retourne le tableau de lignes brutes de la première feuille.
 */
function lireFeuilleFichier(fichier) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = (evt) => {
      try {
        const donnees = new Uint8Array(evt.target.result);
        const classeur = XLSX.read(donnees, { type: 'array', cellDates: true });
        const premiereFeuille = classeur.Sheets[classeur.SheetNames[0]];
        const lignes = XLSX.utils.sheet_to_json(premiereFeuille, { header: 1, defval: '' });
        resolve(lignes);
      } catch (err) {
        reject(err);
      }
    };
    lecteur.onerror = () => reject(lecteur.error);
    lecteur.readAsArrayBuffer(fichier);
  });
}

/**
 * Point d'entrée : importe le fichier d'état théorique choisi par l'utilisateur.
 * Met à jour le catalogue (remplacerCatalogue conserve les affectations existantes)
 * et retourne un résumé à afficher.
 */
async function importerEtatTheorique(fichier) {
  const lignes = await lireFeuilleFichier(fichier);
  if (!lignes.length) {
    throw new Error("Le fichier est vide.");
  }

  const validation = validerEntetes(lignes[0]);
  if (!validation.valide) {
    throw new Error(validation.erreur);
  }

  const articles = construireArticles(lignes.slice(1), validation.aFamille);
  if (!articles.length) {
    throw new Error("Aucune ligne d'article valide n'a été trouvée dans le fichier.");
  }

  const resultat = await remplacerCatalogue(articles);
  await rafraichirCacheArticles();
  return resultat;
}

// ---------- Import CSV : ajout massif d'articles dans une zone (par étage) ----------

const COLONNES_AJOUT_CELLULES = ['Code-barre', 'Code article', 'Case', 'Quantité', 'DLC'];

/** Vérifie que les en-têtes du CSV d'ajout massif correspondent exactement (orthographe + ordre) */
function validerEntetesAjoutCellules(entetes) {
  const nettoyees = entetes.map((e) => String(e ?? '').trim());
  for (let i = 0; i < COLONNES_AJOUT_CELLULES.length; i++) {
    if (nettoyees[i] !== COLONNES_AJOUT_CELLULES[i]) {
      return {
        valide: false,
        erreur: `Colonne ${i + 1} incorrecte : attendu "${COLONNES_AJOUT_CELLULES[i]}", trouvé "${nettoyees[i] || '(vide)'}".`,
      };
    }
  }
  return { valide: true };
}

/** Normalise une valeur de DLC venant du fichier (date Excel, texte JJ/MM/AAAA, ou déjà AAAA-MM-JJ) */
function normaliserDLCImport(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  if (valeur instanceof Date && !isNaN(valeur)) return valeur.toISOString().slice(0, 10);

  const texte = String(valeur).trim();
  if (!texte) return null;

  const matchJourMoisAnnee = texte.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (matchJourMoisAnnee) {
    const [, jour, mois, annee] = matchJourMoisAnnee;
    return `${annee}-${mois.padStart(2, '0')}-${jour.padStart(2, '0')}`;
  }

  return texte; // suppose déjà au format AAAA-MM-JJ
}

/**
 * Importe un CSV/Excel listant des articles à ajouter directement dans les cellules
 * d'une zone déjà sélectionnée (allée/façade/étage), colonne "Case" = numéro de cellule
 * (1 à 18). Quantité et DLC peuvent être vides. Le code-barre, s'il est fourni, est
 * enregistré sur l'article du catalogue (partagé, voir modifierCodeBarreArticle).
 * Chaque ligne valide crée une NOUVELLE occurrence (les doublons restent autorisés).
 */
async function importerAjoutCellulesParCSV(fichier, zone) {
  const lignes = await lireFeuilleFichier(fichier);
  if (!lignes.length) {
    throw new Error("Le fichier est vide.");
  }

  const validation = validerEntetesAjoutCellules(lignes[0]);
  if (!validation.valide) {
    throw new Error(validation.erreur);
  }

  const resultat = { ajoutes: 0, ignores: [] };

  for (let i = 1; i < lignes.length; i++) {
    const ligne = lignes[i];
    const codeBarre = String(ligne[0] ?? '').trim();
    const codeArticle = String(ligne[1] ?? '').trim();
    const caseTexte = String(ligne[2] ?? '').trim();
    const quantiteTexte = String(ligne[3] ?? '').trim();
    const dlc = normaliserDLCImport(ligne[4]);

    if (!codeArticle && !caseTexte) continue; // ligne complètement vide, ignorée silencieusement

    const numeroLigne = i + 1;

    if (!codeArticle) {
      resultat.ignores.push(`Ligne ${numeroLigne} : code article manquant`);
      continue;
    }

    const cellule = Number(caseTexte);
    if (!Number.isInteger(cellule) || cellule < 1 || cellule > 18) {
      resultat.ignores.push(`Ligne ${numeroLigne} : case "${caseTexte}" invalide (doit être un nombre entre 1 et 18)`);
      continue;
    }

    const article = await getArticleByCode(codeArticle);
    if (!article) {
      resultat.ignores.push(`Ligne ${numeroLigne} : code article "${codeArticle}" introuvable dans le catalogue`);
      continue;
    }

    await ajouterAffectation({
      codeArticle,
      allee: zone.allee,
      facade: zone.facade,
      etage: zone.etage,
      cellule,
      stockReel: quantiteTexte === '' ? null : Number(quantiteTexte),
      dlc,
    });

    if (codeBarre) {
      await modifierCodeBarreArticle(codeArticle, codeBarre);
    }

    resultat.ajoutes++;
  }

  await rafraichirCacheArticles();
  return resultat;
}

/** Lit un fichier JSON de sauvegarde et restaure l'état complet de l'application */
function importerSauvegardeJSON(fichier) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = async (evt) => {
      try {
        const donnees = JSON.parse(evt.target.result);
        if (!donnees || !Array.isArray(donnees.articles) || !Array.isArray(donnees.affectations)) {
          throw new Error("Fichier de sauvegarde invalide.");
        }
        await restaurerEtatComplet(donnees);
        await rafraichirCacheArticles();
        resolve(donnees);
      } catch (err) {
        reject(err);
      }
    };
    lecteur.onerror = () => reject(lecteur.error);
    lecteur.readAsText(fichier, 'utf-8');
  });
}
