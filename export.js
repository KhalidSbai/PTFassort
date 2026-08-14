// export.js — export Excel final (une ligne par occurrence) et sauvegarde JSON complète.

const ORDRE_FACADE = { Gauche: 0, Droite: 1, Sol: 2 };

/** Rang de tri d'une allée : les allées numériques d'abord (1,2,3,4), la zone "Table" toujours en dernier */
function rangAllee(allee) {
  return typeof allee === 'number' ? allee : Infinity;
}

/** Trie une liste d'affectations dans l'ordre Allée > Façade > Étage > Cellule > ordre.
 *  La zone "Table" (sans façade/étage/cellule) est toujours triée après les allées numériques.
 *  Utilisé à la fois par l'export Excel et par la vue de consultation par zone. */
function trierAffectationsPourAffichage(affectations) {
  return [...affectations].sort((a, b) => {
    const ra = rangAllee(a.allee), rb = rangAllee(b.allee);
    if (ra !== rb) return ra - rb;
    const fa = ORDRE_FACADE[a.facade] ?? 9;
    const fb = ORDRE_FACADE[b.facade] ?? 9;
    if (fa !== fb) return fa - fb;
    const ea = a.etage ?? 0;
    const eb = b.etage ?? 0;
    if (ea !== eb) return ea - eb;
    const ca = a.cellule ?? 0;
    const cb = b.cellule ?? 0;
    if (ca !== cb) return ca - cb;
    return a.ordre - b.ordre;
  });
}

/** Construit et télécharge le fichier Excel final : un seul onglet, trié Allée > Façade > Étage > Cellule */
async function exporterExcel() {
  const [affectations, articles] = await Promise.all([getAllAffectations(), getAllArticles()]);

  if (!affectations.length) {
    throw new Error("Aucun article n'a encore été affecté à une cellule.");
  }

  const articleParCode = new Map(articles.map((a) => [a.codeArticle, a]));
  const trie = trierAffectationsPourAffichage(affectations);

  const lignes = trie.map((aff) => {
    const art = articleParCode.get(aff.codeArticle) || {};
    return {
      'Zone': aff.allee,
      'Façade': aff.facade || '',
      'Étage': aff.facade === 'Sol' ? '-' : (aff.etage ?? ''),
      'Cellule': aff.cellule !== null && aff.cellule !== undefined ? zeroPad(aff.cellule) : '',
      'Code article': aff.codeArticle,
      'Désignation': art.designation || '',
      'Rayon': art.rayon || '',
      'Famille': art.famille || '',
      'Stock réel': aff.stockReel ?? '',
      'DLC': aff.dlc || '',
      'Code-barres': art.codeBarre || '',
    };
  });

  const feuille = XLSX.utils.json_to_sheet(lignes);
  feuille['!cols'] = [
    { wch: 6 }, { wch: 9 }, { wch: 7 }, { wch: 8 },
    { wch: 14 }, { wch: 30 }, { wch: 16 }, { wch: 16 },
    { wch: 10 }, { wch: 12 }, { wch: 16 },
  ];

  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, 'Remplissage cellules');

  XLSX.writeFile(classeur, `remplissage-cellules_${horodatageFichier()}.xlsx`);
}

/** Télécharge un fichier Excel exemple avec les bons en-têtes, pour aider à préparer l'import théorique */
function telechargerModeleImport() {
  const lignesExemple = [
    { 'Code article': '123456', 'Désignation': 'Huile de tournesol 5L', 'Stock théorique': 24, 'Rayon': 'Liquides', 'Famille': 'Huiles' },
    { 'Code article': '789654', 'Désignation': 'Sucre 1 kg', 'Stock théorique': 50, 'Rayon': 'Épicerie', 'Famille': 'Sucres' },
  ];
  const feuille = XLSX.utils.json_to_sheet(lignesExemple);
  feuille['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];

  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, 'Modèle import');
  XLSX.writeFile(classeur, 'modele-import-etat-theorique.xlsx');
}

/** Télécharge un fichier Excel exemple pour l'import CSV d'ajout massif d'articles dans une zone */
function telechargerModeleAjoutCellules() {
  const lignesExemple = [
    { 'Code-barre': '3760012345678', 'Code article': '123456', 'Case': 5, 'Quantité': 12, 'DLC': '2027-07-01' },
    { 'Code-barre': '', 'Code article': '789654', 'Case': 12, 'Quantité': '', 'DLC': '' },
  ];
  const feuille = XLSX.utils.json_to_sheet(lignesExemple);
  feuille['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 12 }];

  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, 'Modèle ajout cellules');
  XLSX.writeFile(classeur, 'modele-ajout-articles-cellules.xlsx');
}

/** Télécharge un CSV listant le stock de chaque article (Code article, Désignation, Stock,
 *  quantité la plus fréquente par palette et son pourcentage de fiabilité).
 *  Ces deux dernières colonnes sont recalculées à chaque appel à partir des stockReel
 *  actuellement enregistrés sur les occurrences — jamais une valeur mise en cache. */
async function exporterStockCSV() {
  const [articles, affectations] = await Promise.all([getAllArticles(), getAllAffectations()]);
  if (!articles.length) {
    throw new Error("Le catalogue est vide — importe d'abord l'état théorique.");
  }

  const quantitesParArticle = new Map();
  affectations.forEach((aff) => {
    if (aff.stockReel === null || aff.stockReel === undefined) return;
    if (!quantitesParArticle.has(aff.codeArticle)) quantitesParArticle.set(aff.codeArticle, []);
    quantitesParArticle.get(aff.codeArticle).push(aff.stockReel);
  });

  const lignes = [...articles]
    .sort((a, b) => a.codeArticle.localeCompare(b.codeArticle, 'fr'))
    .map((a) => {
      const stat = calculerQuantiteFrequente(quantitesParArticle.get(a.codeArticle) || []);
      return {
        'Code article': a.codeArticle,
        'Désignation': a.designation || '',
        'Stock': a.stockTheorique ?? 0,
        'Quantité la plus fréquente / palette': stat ? stat.quantite : '',
        'Fiabilité (%)': stat ? stat.pourcentage : '',
        'Palettes comptées': stat ? stat.total : 0,
      };
    });

  const feuille = XLSX.utils.json_to_sheet(lignes);
  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, 'Stock');
  XLSX.writeFile(classeur, `stock-articles_${horodatageFichier()}.csv`, { bookType: 'csv' });
}

/** Télécharge une sauvegarde JSON complète (articles + affectations) */
async function exporterSauvegardeJSON() {
  const donnees = await exporterEtatComplet();
  const blob = new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json' });
  telechargerBlob(blob, `sauvegarde-cellules_${horodatageFichier()}.json`);
}
