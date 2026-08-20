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

/**
 * Télécharge le CSV "sans emplacement" de l'écran DLC : une ligne par couple
 * (article, DLC), avec le stock réel total et le nombre de palettes regroupés.
 * @param {Array<{aff:object, art:object}>} liste - la liste déjà filtrée affichée à l'écran
 */
function exporterDLCSansEmplacement(liste) {
  if (!liste.length) {
    throw new Error('Aucun article à exporter avec ces filtres.');
  }

  const groupes = new Map(); // "codeArticle|dlc" -> { ...totaux }
  liste.forEach(({ aff, art }) => {
    const cle = `${aff.codeArticle}|${aff.dlc}`;
    if (!groupes.has(cle)) {
      groupes.set(cle, {
        codeArticle: aff.codeArticle,
        designation: art.designation || '',
        rayon: art.rayon || '',
        dlc: aff.dlc,
        stockTotal: 0,
        nombrePalettes: 0,
      });
    }
    const g = groupes.get(cle);
    g.nombrePalettes += 1;
    if (aff.stockReel !== null && aff.stockReel !== undefined) g.stockTotal += aff.stockReel;
  });

  const lignes = [...groupes.values()]
    .sort((a, b) => a.dlc.localeCompare(b.dlc) || a.codeArticle.localeCompare(b.codeArticle, 'fr'))
    .map((g) => ({
      'Code article': g.codeArticle,
      'Désignation': g.designation,
      'Stock réel': g.stockTotal,
      'Nombre de palettes': g.nombrePalettes,
      'DLC': formatDLCCourt(g.dlc),
      'Rayon': g.rayon,
    }));

  const feuille = XLSX.utils.json_to_sheet(lignes);
  const csv = XLSX.utils.sheet_to_csv(feuille, { FS: ';' });
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  telechargerBlob(blob, `dlc-sans-emplacement_${horodatageFichier()}.csv`);
}

/**
 * Télécharge le CSV "avec emplacement" de l'écran DLC : une ligne par occurrence
 * (aucun regroupement), avec sa localisation complète.
 * @param {Array<{aff:object, art:object}>} liste - la liste déjà filtrée affichée à l'écran
 */
function exporterDLCAvecEmplacement(liste) {
  if (!liste.length) {
    throw new Error('Aucun article à exporter avec ces filtres.');
  }

  const trie = [...liste].sort((a, b) =>
    a.aff.dlc.localeCompare(b.aff.dlc) || a.aff.codeArticle.localeCompare(b.aff.codeArticle, 'fr')
  );

  const lignes = trie.map(({ aff, art }) => ({
    'Zone': aff.allee,
    'Façade': aff.facade || '',
    'Étage': aff.facade === 'Sol' ? '-' : (aff.etage ?? ''),
    'Cellule': aff.cellule !== null && aff.cellule !== undefined ? zeroPad(aff.cellule) : '',
    'Code article': aff.codeArticle,
    'Désignation': art.designation || '',
    'Stock réel': aff.stockReel ?? '',
    'DLC': formatDLCCourt(aff.dlc),
    'Code-barres': art.codeBarre || '',
    'Rayon': art.rayon || '',
  }));

  const feuille = XLSX.utils.json_to_sheet(lignes);
  const csv = XLSX.utils.sheet_to_csv(feuille, { FS: ';' });
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  telechargerBlob(blob, `dlc-avec-emplacement_${horodatageFichier()}.csv`);
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

  // Pour chaque article : toutes les quantités de palettes connues (stockReel), et leur somme
  const donneesParArticle = new Map();
  affectations.forEach((aff) => {
    if (aff.stockReel === null || aff.stockReel === undefined) return;
    if (!donneesParArticle.has(aff.codeArticle)) donneesParArticle.set(aff.codeArticle, { quantites: [], total: 0 });
    const entree = donneesParArticle.get(aff.codeArticle);
    entree.quantites.push(aff.stockReel);
    entree.total += aff.stockReel;
  });

  const lignes = [...articles]
    .sort((a, b) => a.codeArticle.localeCompare(b.codeArticle, 'fr'))
    .map((a) => {
      const donnees = donneesParArticle.get(a.codeArticle);
      const stat = calculerQuantiteFrequente(donnees ? donnees.quantites : []);
      return {
        'Code article': a.codeArticle,
        'Désignation': a.designation || '',
        'Stock théorique': a.stockTheorique ?? 0,
        'Stock réel': donnees ? donnees.total : '',
        'Quantité la plus fréquente / palette': stat ? stat.quantite : '',
        'Fiabilité (%)': stat ? stat.pourcentage : '',
        'Palettes comptées': stat ? stat.total : 0,
      };
    });

  const feuille = XLSX.utils.json_to_sheet(lignes);
  const csv = XLSX.utils.sheet_to_csv(feuille, { FS: ';' }); // délimiteur point-virgule demandé
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM pour un bon affichage des accents dans Excel
  telechargerBlob(blob, `stock-articles_${horodatageFichier()}.csv`);
}

/** Télécharge une sauvegarde JSON complète (articles + affectations) */
async function exporterSauvegardeJSON() {
  const donnees = await exporterEtatComplet();
  const blob = new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json' });
  telechargerBlob(blob, `sauvegarde-cellules_${horodatageFichier()}.json`);
}
