// export.js — export Excel final (une ligne par occurrence) et sauvegarde JSON complète.

const ORDRE_FACADE = { Gauche: 0, Droite: 1, Sol: 2 };

/** Construit et télécharge le fichier Excel final : un seul onglet, trié Allée > Façade > Étage > Cellule */
async function exporterExcel() {
  const [affectations, articles] = await Promise.all([getAllAffectations(), getAllArticles()]);

  if (!affectations.length) {
    throw new Error("Aucun article n'a encore été affecté à une cellule.");
  }

  const articleParCode = new Map(articles.map((a) => [a.codeArticle, a]));

  const trie = [...affectations].sort((a, b) => {
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
    };
  });

  const feuille = XLSX.utils.json_to_sheet(lignes);
  feuille['!cols'] = [
    { wch: 6 }, { wch: 9 }, { wch: 7 }, { wch: 8 },
    { wch: 14 }, { wch: 30 }, { wch: 16 }, { wch: 16 },
  ];

  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, 'Remplissage cellules');

  XLSX.writeFile(classeur, `remplissage-cellules_${horodatageFichier()}.xlsx`);
}

/** Télécharge une sauvegarde JSON complète (articles + affectations) */
async function exporterSauvegardeJSON() {
  const donnees = await exporterEtatComplet();
  const blob = new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json' });
  telechargerBlob(blob, `sauvegarde-cellules_${horodatageFichier()}.json`);
}
