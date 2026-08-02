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
        const classeur = XLSX.read(donnees, { type: 'array' });
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
