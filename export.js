// export.js — export Excel final (une ligne par occurrence) et sauvegarde JSON complète.

const ORDRE_FACADE = { Gauche: 0, Droite: 1, Sol: 2 };

/** Trie une liste d'affectations dans l'ordre Allée > Façade > Étage > Cellule > ordre.
 *  Utilisé à la fois par l'export Excel et par la vue de consultation par zone. */
function trierAffectationsPourAffichage(affectations) {
  return [...affectations].sort((a, b) => {
    if (a.allee !== b.allee) return a.allee - b.allee;
    const fa = ORDRE_FACADE[a.facade] ?? 9;
    const fb = ORDRE_FACADE[b.facade] ?? 9;
    if (fa !== fb) return fa - fb;
    const ea = a.etage ?? 0;
    const eb = b.etage ?? 0;
    if (ea !== eb) return ea - eb;
    if (a.cellule !== b.cellule) return a.cellule - b.cellule;
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
      'Allée': aff.allee,
      'Façade': aff.facade,
      'Étage': aff.facade === 'Sol' ? '-' : aff.etage,
      'Cellule': zeroPad(aff.cellule),
      'Code article': aff.codeArticle,
      'Désignation': art.designation || '',
      'Rayon': art.rayon || '',
      'Famille': art.famille || '',
      'Stock réel': aff.stockReel ?? '',
      'DLC': aff.dlc || '',
    };
  });

  const feuille = XLSX.utils.json_to_sheet(lignes);
  feuille['!cols'] = [
    { wch: 6 }, { wch: 9 }, { wch: 7 }, { wch: 8 },
    { wch: 14 }, { wch: 30 }, { wch: 16 }, { wch: 16 },
    { wch: 10 }, { wch: 12 },
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

/** Télécharge une sauvegarde JSON complète (articles + affectations) */
async function exporterSauvegardeJSON() {
  const donnees = await exporterEtatComplet();
  const blob = new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json' });
  telechargerBlob(blob, `sauvegarde-cellules_${horodatageFichier()}.json`);
}
