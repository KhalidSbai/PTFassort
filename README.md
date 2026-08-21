# Cellules Entrepôt — README

## 1. Objectif du projet

Application Web **Mobile First (PWA)**, très simple et légère, dont l'unique but est de **préparer le remplissage physique des cellules d'un entrepôt** : on associe des articles à des cellules, puis on exporte un tableau Excel imprimable distribué aux collaborateurs.

**Ce n'est PAS un WMS.** Elle ne gère ni les stocks réels, ni les mouvements, ni les réceptions/expéditions. Elle ne fait qu'associer des `codeArticle` à des emplacements physiques.

## 2. Contraintes techniques (non négociables)

- **Aucun framework.** HTML5 + CSS3 + JavaScript ES6 natif uniquement.
- Bibliothèques autorisées, en local dans `lib/` (pas de CDN, pour rester 100 % hors ligne) :
  - **SheetJS (xlsx)** → `lib/xlsx.full.min.js` (import/export Excel/CSV)
  - **SortableJS** → `lib/Sortable.min.js` (glisser-déposer)
- Interdits : React, Vue, Angular, Node.js (runtime), Vite, TypeScript, Tailwind.
- Doit fonctionner en ouvrant `index.html` directement, ou hébergé sur GitHub Pages.
- 100 % hors ligne, aucun serveur, aucune authentification, un seul utilisateur.
- Toutes les données persistent dans **IndexedDB** (pas de backend, pas de base distante).

## 3. Structure du projet

```
index.html          → écran unique, structure DOM de toute l'app
style.css            → styles mobile-first (variables CSS en haut du fichier)
utils.js             → fonctions pures sans dépendance DOM/DB (clés d'emplacement, libellés, debounce, toast, téléchargement...)
db.js                → toute la couche IndexedDB (articles + affectations)
search.js            → cache en mémoire du catalogue + recherche/filtrage instantané
import.js            → lecture et validation du fichier Excel/CSV théorique + import JSON de sauvegarde
export.js            → export Excel final + export JSON de sauvegarde
ui.js                → rendu des écrans, navigation, tous les event listeners (fichier le plus gros, ~310 lignes)
app.js               → bootstrap au chargement (ouvre la DB, initialise l'UI, enregistre le service worker)
manifest.json         → manifeste PWA
service-worker.js     → cache "cache d'abord" pour le mode hors ligne
lib/                 → SheetJS + SortableJS (copiés localement, pas de CDN)
assets/               → icônes PWA (192x192 et 512x512, actuellement des placeholders simples — à remplacer si besoin)
```

Ordre de chargement des scripts dans `index.html` (important si on ajoute du code) :
`xlsx.full.min.js` → `Sortable.min.js` → `utils.js` → `db.js` → `search.js` → `import.js` → `export.js` → `ui.js` → `app.js`

## 4. Structure de l'entrepôt (règles métier fixes)

- **4 allées** (numérotées 1 à 4)
- Chaque allée a 3 façades : **Gauche**, **Droite**, **Sol**
- Gauche et Droite ont chacune **5 étages** (1 à 5)
- Sol n'a **pas d'étage** (toujours traité comme étage `null` / `0` en interne)
- Chaque étage (ou le Sol) contient **18 cellules** numérotées 01 à 18
- **Exception : la zone "Table"** — un espace de dépôt unique, en plus des 4 allées, sans façade/étage/cellule (voir règle 16). `allee` y vaut la chaîne `'Table'` au lieu d'un nombre.

Un emplacement est donc défini par : `{ allee, facade, etage, cellule }`.
La clé unique interne est générée par `cleEmplacement()` dans `utils.js`, format : `"allee-facade-etage-cellule"` (étage = `0` si Sol).

> **Note de terminologie** : le champ interne s'appelle toujours `allee` dans le code et la base IndexedDB (pour ne pas casser les données déjà enregistrées), mais **tout ce qui est affiché à l'utilisateur dit "Zone"** (ex. "Zone 2 — Façade Gauche — Étage 3 — Cellule 12", colonne Excel "Zone", libellé court "Z2 Gauche É3 C12"). Si le vocabulaire interne doit lui aussi changer un jour, il faudrait renommer `allee` partout (HTML, JS, IndexedDB) en une seule passe cohérente — non fait ici pour rester rétrocompatible avec les données déjà sauvegardées.

## 5. Modèle de données (IndexedDB)

Base : `cellules-entrepot-db`, version 1 (voir `db.js`).

### Store `articles` (keyPath: `codeArticle`)
Le catalogue théorique complet, remplacé à chaque import du fichier théorique (le champ `codeBarre` est conservé lors du remplacement, voir `remplacerCatalogue()`).
```js
{
  codeArticle: string,     // identifiant unique de l'article
  designation: string,
  stockTheorique: number,
  rayon: string,
  famille: string,         // '' si non fourni
  codeBarre: string | null, // facultatif, saisi/modifié à tout moment via la modale 🏷️, partagé par toutes les occurrences de cet article
  epingle: boolean          // facultatif (undefined = false), pour l'ajout rapide sans recherche (règle 25)
}
```

### Store `affectations` (keyPath: `id`, index sur `cle` et `codeArticle`)
Une ligne = une occurrence d'un article placé dans une cellule (les doublons sont volontaires et représentent plusieurs palettes).
```js
{
  id: string,               // généré via genererId() dans utils.js
  codeArticle: string,
  allee: number,
  facade: 'Gauche' | 'Droite' | 'Sol',
  etage: number | null,     // null si facade === 'Sol'
  cellule: number,          // 1 à 18
  cle: string,              // cleEmplacement() — sert à l'index 'parCellule'
  ordre: number,            // position dans la cellule, pour le glisser-déposer
  stockReel: number | null, // facultatif, propre à cette occurrence, saisi/modifié à tout moment via la modale 🏷️
  dlc: string | null,       // facultatif, propre à cette occurrence, format 'YYYY-MM-DD'
  misAJourLe: string        // horodatage ISO, mis à jour à la création et à chaque modification stock/DLC (règle 24)
}
```

## 6. Règles métier importantes (à ne pas casser)

1. **Jamais de quantité demandée.** Cliquer sur un article dans les résultats de recherche l'ajoute immédiatement à la cellule ouverte.
2. **Doublons autorisés et volontaires** : un même `codeArticle` peut apparaître plusieurs fois dans la même cellule, ou dans plusieurs cellules. Ne jamais dédupliquer.
3. **Suppression indépendante** : supprimer une occurrence (`supprimerAffectation(id)`) ne touche jamais les autres occurrences du même article.
4. **Ordre des articles dans une cellule** = important, sauvegardé via le champ `ordre`, modifiable par glisser-déposer (SortableJS, géré dans `renderListeArticlesCellule()` dans `ui.js`).
5. **Déplacement d'un article vers une autre cellule** : l'occurrence est retirée de sa cellule d'origine et ajoutée **en fin** de la cellule de destination (nouvel `ordre` = max + 1). Voir `deplacerAffectation()` dans `db.js`.
6. **Sauvegarde automatique** : chaque action (ajout, suppression, déplacement, réorganisation) écrit directement dans IndexedDB. Aucun bouton "Enregistrer" n'existe pour les données courantes — seuls les boutons "Sauver/Restaurer" gèrent l'export/import JSON complet en tant que backup externe.
7. **Recherche par mots-clés indépendants** : chaque mot tapé doit se retrouver dans le code article ou la désignation, sans tenir compte de l'ordre ni des mots intercalés (ex. "huile 5l" ≡ "5l huile"). Voir `correspondMotsCles()` dans `utils.js`.
8. **Filtres rayon/famille désactivés par défaut et mémorisés** : les chips ne sont **pas** cochées au départ (aucune restriction, tous les articles sortent). Dès qu'une chip est cochée, elle **reste cochée d'une cellule à l'autre** (l'état n'est plus réinitialisé à chaque ouverture de cellule). L'état persiste dans `etat.rayonsCoches` / `etat.famillesCoches` pour toute la session, et n'est nettoyé des valeurs devenues invalides qu'après un import du catalogue ou une restauration de sauvegarde.
9. **Seuls les articles encore en stock sont proposés à l'ajout, par défaut** : `rechercherArticles()` (et les chips de rayon/famille) dans `search.js` ne portent par défaut que sur les articles dont `stockTheorique > 0`, pour optimiser le nombre de choix pendant l'ajout. Une case à cocher "Inclure aussi les articles à stock théorique ≤ 0" au-dessus de la recherche (`checkbox-inclure-stock-negatif`) élargit la recherche à tout le catalogue à la demande — ces articles restent alors identifiables dans les résultats par un signe ⚠️, une bordure et un fond orangés, et leur stock théorique affiché (`resultat-stock-negatif` dans `style.css`/`ui.js`). Cette case est décochée par défaut à chaque nouvelle ouverture d'une cellule ou de la Table. Un article à 0 reste de toute façon visible partout où il a déjà été placé (détail de cellule, Vue par zone, export Excel, écran Stock) — seule la liste de *nouveaux* articles proposés à l'ajout est concernée par ce filtre.
9bis. **Le catalogue n'oublie jamais un article** : `remplacerCatalogue()` dans `db.js` ne vide plus le store `articles` à chaque import théorique. Un article déjà connu (désignation, rayon, famille, code-barre) qui disparaît d'un nouvel import n'est **jamais supprimé** — il est conservé tel quel, avec juste son `stockTheorique` ramené à `0`. C'est ce qui permet au filtre "stock théorique ≤ 0" de la Vue (règle 20) et à l'écran Stock (règle 18) de continuer à afficher sa désignation/rayon/code-barre au lieu de "(article introuvable)", et à l'export Excel/aux étiquettes PDF de rester complets même pour ces articles-là. Le résumé après import théorique indique combien d'articles ont été conservés ainsi (`resultat.conserves`).
10. **Stock et DLC sont facultatifs, par occurrence** ; **le code-barres est facultatif, par article (partagé)** — tous modifiables à tout moment, jamais demandés à l'ajout. `stockReel` et `dlc` sont des champs sur chaque *affectation* (propres à une palette précise). `codeBarre` est un champ sur l'*article* du catalogue (comme la désignation ou le rayon) : il est donc automatiquement le même pour toutes les occurrences d'un même code article, et le modifier depuis n'importe quelle occurrence le met à jour partout instantanément. Il est distinct du "Code article" lui-même (ex : l'EAN réel imprimé sur la palette peut différer de la référence interne). Un ré-import du fichier théorique conserve les codes-barres déjà saisis (voir `remplacerCatalogue()` dans `db.js`). Voir `modifierStockDLC()` (occurrence) et `modifierCodeBarreArticle()` (article) dans `db.js`, et le bouton 🏷️ sur chaque ligne d'article dans `ui.js`.
11. **Saisie de la DLC en mois/année uniquement** : la modale "Infos complémentaires" utilise un champ `<input type="month">` (pas `type="date"`) pour éviter d'avoir à faire défiler jour/mois/année sur mobile — l'utilisateur ne tape que le mois et l'année. Le jour est **toujours fixé au 1er** avant d'être stocké (`dlc` reste au format `'YYYY-MM-01'` en base, pour rester compatible avec tout le reste de l'app). Le badge d'affichage et l'étiquette PDF montrent la DLC au format court `MM/AAAA` (`formatDLCCourt()`). Le statut "périmé" (classe `.perime` sur le badge) compare désormais au niveau du **mois** (`aff.dlc.slice(0,7)` vs le mois en cours), pas du jour exact, pour ne pas marquer un article périmé dès le 2 du mois de sa DLC. L'import CSV en masse (règle 13) n'est pas concerné par cette limitation : il accepte toujours une date complète.
12. **Suppression en masse par zone** : depuis l'écran "Vue" (par zone), un bouton "🗑️ Vider" à chaque niveau (allée, façade, étage, cellule) supprime en une fois toutes les affectations correspondantes, après confirmation. Voir `supprimerAffectationsParCritere()` dans `db.js` et `viderParCritere()` dans `ui.js`.
13. **Étiquettes DLC imprimables (PDF)** : dans l'écran "Vue", une case à cocher sur chaque zone/façade/étage/cellule/article sélectionne tous les articles en dessous (`etat.selectionEtiquettes`, un `Set` d'ids d'affectations). Une barre flottante "🖨️ Générer PDF" génère **une page A4 paysage par occurrence sélectionnée** (pas par article unique — chaque palette a sa propre page, car DLC/quantité sont propres à l'occurrence, et le code-barres est propre à l'article) : DLC en très grand en haut (format `MM/AAAA`, zone haute nettement plus grande que le bas — `flex: 1.9`, police en `vw` pour occuper un maximum de largeur/hauteur), puis en bas **3 colonnes égales** — Code article en grand (avec le mini-libellé "Code" au-dessus), Quantité en grand (mini-libellé "Quantité" au-dessus, `—` si non renseignée), et le reste des infos disponibles (désignation, code-barres, emplacement résumé via `libelleEmplacementCourt()`, rayon) en petite police, uniquement les champs renseignés. Marges de page réduites (`@page { margin: 8mm }`) pour laisser un maximum de place au contenu. Implémenté avec `window.print()` et une mise en page `@media print` dans `style.css` — pas de bibliothèque PDF, l'utilisateur choisit "Enregistrer en PDF" dans la fenêtre d'impression du navigateur (fonctionne aussi sur mobile). Voir `genererPDFEtiquettes()` dans `ui.js`.
14. **Ajout massif d'articles par CSV, dans une zone déjà sélectionnée** : sur l'écran de la grille des 18 cellules (`panel-cellules`), le bouton "📥 Importer un CSV" lit un fichier avec les colonnes strictes `Code-barre` (facultatif), `Code article`, `Case` (1 à 18), `Quantité` (facultatif), `DLC` (facultatif). Chaque ligne valide crée une **nouvelle occurrence** (doublons toujours autorisés, règle 2) dans la zone déjà choisie (`allee`/`facade`/`etage` viennent de `etat.emplacement`, jamais du fichier). Une ligne est **ignorée individuellement** (pas de rejet global) si le code article n'existe pas dans le catalogue ou si la case est hors de 1-18 ; le résumé après import liste les lignes ignorées et leur raison. Le code-barre, s'il est fourni, est écrit sur l'article du catalogue (partagé, voir règle 10), pas sur l'occurrence. La DLC accepte une date Excel réelle, `JJ/MM/AAAA` ou `AAAA-MM-JJ` (normalisée par `normaliserDLCImport()`). Voir `importerAjoutCellulesParCSV()` dans `import.js` et `initImportCSVCellules()` dans `ui.js`.
15. **Pied de page sur les étiquettes PDF** : chaque page imprimée affiche "Plateforme SIDI GHANEM" en petit, centré en bas (`.etiquette-pied` dans `style.css`).
17. **Zone spéciale "Table"** : sélectionnable dans le menu déroulant "Zone" (à la place d'une allée 1-4), elle **n'a ni façade, ni étage, ni cellule** — c'est un espace de dépôt unique. La choisir masque les champs Façade/Étage et ouvre directement l'écran d'ajout d'articles (pas de grille de 18 cellules). En interne, `allee: 'Table'` (chaîne, pas un nombre) avec `facade`/`etage`/`cellule` toujours `null` ; `estZoneTable()` dans `utils.js` centralise cette détection et est utilisée dans `db.js`, `ui.js` et `export.js` partout où l'allée est traitée comme un nombre. La zone Table apparaît dans la Vue (affichage à plat, sans sous-niveaux), peut recevoir un article déplacé depuis n'importe quelle cellule (et inversement), et peut être vidée en masse comme les autres zones. **Sur les étiquettes PDF, le champ "Emplacement" est automatiquement masqué** pour les articles qui viennent de la Table (`genererPDFEtiquettes()` dans `ui.js`).
18. **Stock affiché et suppression individuelle dans la Vue** : chaque ligne d'article de l'écran "Vue" affiche désormais son stock réel (`Stock : X`) s'il est renseigné, et un bouton 🗑️ permet de supprimer cette occurrence précise directement depuis la Vue (avec confirmation), sans devoir rouvrir la cellule concernée. Voir `construireLigneArticleVue()` dans `ui.js`, réutilisée pour toutes les zones (y compris la Table).
19. **Écran "📦 Stock" complet** : le bouton "📦 Stock" de l'en-tête ouvre un écran listant chaque article sous forme de carte, avec :
    - **Stock théorique** (`stockTheorique` du catalogue) et **Stock réel compté** (somme des `stockReel` de toutes les palettes de l'article — affiché `—` si aucune palette n'a encore été comptée, à ne pas confondre avec un réel de 0 explicitement compté).
    - **Écart** = réel − théorique (affiché seulement si au moins une palette a été comptée ; positif = plus compté que prévu, négatif = il manque du stock par rapport au théorique).
    - **Quantité la plus fréquente par palette + fiabilité**, affichée `10 (75 %)` — voir détail ci-dessous.
    - **Palettes restantes (estimation)** : `estimerPalettesRestantes()` dans `utils.js` calcule `arrondi_sup((théorique − réel) / quantité la plus fréquente)`, uniquement si la quantité fréquente est connue. **C'est une estimation** (suppose des palettes de taille uniforme), jamais un fait garanti — étiquetée comme telle à l'écran.
    - **Badge "✅ Conforme"** (bordure gauche verte sur la carte) quand théorique = réel exactement, **à condition qu'au moins une palette ait été comptée** (sinon un article jamais vérifié serait marqué conforme à tort).
    - **Filtres par rayon** au-dessus de la recherche : chips désactivées par défaut (même logique que la règle 8 — aucune restriction tant qu'aucune n'est cochée), calculées sur tout le catalogue (pas seulement les articles en stock), via `renderFiltresRayonsStock()`.

    **Rien de tout cela n'est jamais stocké** : `calculerQuantiteFrequente()` (choix déterministe de la plus petite quantité en cas d'égalité) et `estimerPalettesRestantes()` sont des fonctions pures recalculées à chaque ouverture de l'écran (ou recherche/filtre) à partir des `stockReel` actuellement enregistrés — après correction d'une quantité via 🏷️, rouvrir cet écran reflète toujours l'état à jour, jamais une ancienne valeur. Un bouton "📤 Exporter en CSV" télécharge **exactement les articles actuellement filtrés à l'écran** (zone/rayon/recherche/écart+/écart-, règle 30 incluse) — `exporterStockCSV(liste, donneesParArticle)` dans `export.js` n'est plus `async` et ne recharge plus rien depuis la base : elle réutilise directement `_stockListeCourante`/`_stockDonneesCourantes`, les deux variables mémorisées par `renderContenuStock()` à chaque rendu, pour garantir que le fichier correspond toujours pile à ce qui est affiché (aucun filtre = tout le catalogue sort, comme avant). Ce CSV utilise le **point-virgule comme délimiteur** (`XLSX.utils.sheet_to_csv(feuille, { FS: ';' })`, téléchargé via `telechargerBlob()` avec un BOM UTF-8 pour un bon affichage des accents dans Excel) et contient, dans l'ordre : `Code article`, `Désignation`, `Stock théorique`, `Stock réel`, `Quantité la plus fréquente / palette`, `Fiabilité (%)`, `Palettes comptées`.
20. **Filtre "stock théorique ≤ 0 ou inconnu" dans la Vue** : une case à cocher dans l'écran "Vue" filtre la liste (combinable avec le filtre par zone et la recherche) pour ne montrer que les occurrences dont l'article a un `stockTheorique` négatif ou nul, **ou dont l'article est totalement absent du catalogue** (`!art || Number(art.stockTheorique) <= 0`) — utile pour identifier les articles déjà placés en cellule qui n'ont plus de stock connu. Grâce à la règle 9bis (le catalogue ne supprime plus jamais un article), le cas "absent du catalogue" ne devrait normalement plus arriver via un import théorique classique (l'article est conservé avec `stockTheorique: 0`) ; il reste néanmoins couvert pour les cas résiduels (restauration d'une ancienne sauvegarde JSON, etc.). Chaque ligne y garde ses boutons 🏷️ (modifier stock/DLC/code-barres, ouvre la même modale que dans le détail de cellule) et 🗑️ (supprimer cette occurrence), pour corriger ou nettoyer directement depuis cette vue filtrée. La case est décochée à chaque nouvelle ouverture de la Vue. Voir `checkbox-stock-negatif` dans `renderContenuVueZone()` (`ui.js`).
21. **Le dernier écran affiché est mémorisé et restauré à la réouverture de l'app** (changement de fenêtre/onglet, fermeture puis réouverture) : `sauvegarderNavigation(panel)` dans `ui.js` écrit dans `localStorage` (clé `cellules-entrepot-navigation`) l'écran actif (`grille` / `cellule` / `table` / `vue`), l'emplacement courant et, pour la Vue, le filtre de zone sélectionné. `restaurerNavigation()`, appelée une fois au démarrage (`app.js`), reconstruit exactement cet écran. **Le bouton "🏠 Accueil" sert aussi de bouton "réinitialiser"** : il efface l'écran mémorisé (`effacerNavigationMemorisee()`) en plus de revenir à l'écran de sélection, donc la prochaine ouverture de l'app repart bien de zéro. Le stockage échoue silencieusement (navigation privée, quota) sans jamais bloquer l'app.
22. **Validation au clavier (Entrée) de la modale "Infos complémentaires"** : appuyer sur Entrée dans n'importe lequel des 3 champs (stock réel, DLC, code-barres) déclenche le même enregistrement que le bouton "Enregistrer", aussi bien au clavier physique (PC) qu'au clavier virtuel (mobile). Voir le listener `keydown` sur `#modale-stock-dlc` dans `initModaleStockDLC()` (`ui.js`).
23. **Ligne d'article de la Vue : passe à la ligne plutôt que de déborder hors écran** : `.zone-ligne-article` utilise `flex-wrap: wrap` et les zones de texte (code/désignation, méta) sont tronquées avec ellipsis (`text-overflow: ellipsis`) plutôt que forcées sur une seule ligne — sur un mobile étroit avec beaucoup de contenu, les boutons 🏷️/🗑️ passent à la ligne suivante au lieu d'être poussés hors de l'écran et donc intappables.
24. **Ajout rapide avec dernière quantité/DLC pré-remplies** : chaque résultat de recherche a un bouton 🏷️ "Ajouter avec quantité/DLC" qui ouvre `#modale-ajout-qte-dlc`, pré-remplie avec les **dernières valeurs connues pour ce même article** (n'importe où dans l'entrepôt) — voir `getDerniereQuantiteDLC()` dans `db.js`, qui s'appuie sur le nouveau champ `misAJourLe` (horodatage ISO) présent sur chaque affectation, mis à jour à la création (`ajouterAffectation()`) et à chaque modification (`modifierStockDLC()`). L'ajout instantané au clic reste inchangé (comportement par défaut conservé) ; ce bouton est une option en plus. Entrée valide directement, comme les autres modales.
25. **Articles épinglés (⭐) pour un ajout sans recherche** : un bouton ☆/⭐ sur chaque résultat de recherche épingle/désépingle un article (`epingle: boolean` sur l'article du catalogue, voir `modifierArticleEpingle()` dans `db.js`). Les articles épinglés apparaissent dans une section dédiée en haut de l'écran de cellule (`#epingles-conteneur`, visible seulement si au moins un article est épinglé), sous forme de boutons à un tap = ajout instantané — pratique quand un même article revient dans plusieurs cellules d'une même zone/façade/étage. Chaque bouton épinglé a aussi un petit ✖️ collé à droite pour le désépingler **directement depuis cette section**, sans repasser par la recherche (`bouton-retirer-epingle` dans `ui.js`/`style.css`). Un article épinglé reste proposé même s'il n'est plus en stock théorique (l'épingle est un choix explicite, non soumis au filtre de la règle 9).
26. **Duplication d'un article vers plusieurs emplacements (`#modale-dupliquer`)** : le bouton 📋 sur une ligne d'article ouvre une modale avec la quantité/DLC de la source pré-remplies (modifiables) et un sélecteur de zone/façade/étage. **Chaque tap sur une cellule de la grille ajoute immédiatement une nouvelle occurrence** de l'article (avec les valeurs actuelles des champs quantité/DLC) — retaper sur la même cellule en ajoute une autre (doublons volontaires, règle 2), et un badge numéroté sur chaque cellule affiche combien cet article y est déjà présent, mis à jour en direct sans recharger toute la grille. On peut changer de zone/façade/étage (ou choisir la Table, qui remplace la grille par un simple bouton) sans jamais fermer la modale, pour dupliquer vers plusieurs emplacements différents en une seule session. "Terminé" ferme la modale et rafraîchit l'écran sous-jacent si des occurrences ont été ajoutées dans la cellule/Table actuellement ouverte. Voir `getAffectationsParArticle()` (nouvelle requête groupée par article, `db.js`) et `ouvrirModaleDupliquer()`/`majZoneDupliquer()`/`ajouterDansCelluleDupliquer()` (`ui.js`).
27. **Écran "📅 DLC" (gestion des articles proches de leur péremption)** : le bouton d'en-tête ouvre `panel-dlc`, qui liste **toutes les occurrences ayant une DLC renseignée**, triées par DLC la plus proche en premier (carte à bordure rouge si déjà dépassée). Trois filtres combinables : une **date maximum** (`type="month"`, cohérent avec la saisie DLC ailleurs dans l'app — ne montre que les articles dont la DLC est ≤ à ce mois), une **recherche texte** (mêmes mots-clés indépendants que le reste de l'app), et des **chips de rayon** (même logique désactivée-par-défaut que les règles 8/19/20, calculées sur la liste déjà filtrée par date+recherche). Chaque carte a les mêmes actions 🏷️ (modifier stock/DLC/code-barres — la modale partagée `#modale-stock-dlc` reconnaît le contexte `'dlc'` et rafraîchit cet écran après enregistrement) et 🗑️ (supprimer) que la Vue.
    - **Génère deux fichiers CSV séparés** (délimiteur `;`, BOM UTF-8, mêmes conventions que les autres exports), à partir de **la liste exactement affichée à l'écran** au moment du clic (`_dlcListeCourante`, jamais recalculée séparément — garantit que le fichier correspond toujours à ce qui est filtré) :
      - **Sans emplacement** (`exporterDLCSansEmplacement()`) : une ligne par couple (article, DLC), avec `Stock réel` = somme des `stockReel` du groupe et `Nombre de palettes` = nombre d'occurrences du groupe. Colonnes : `Code article`, `Désignation`, `Stock réel`, `Nombre de palettes`, `DLC`, `Rayon`.
      - **Avec emplacement** (`exporterDLCAvecEmplacement()`) : une ligne par occurrence, sans regroupement. Colonnes : `Zone`, `Façade`, `Étage`, `Cellule`, `Code article`, `Désignation`, `Stock réel`, `DLC`, `Code-barres`, `Rayon`.
      - Dans les deux fichiers, la colonne `DLC` affiche uniquement `MM/AAAA` (`formatDLCCourt()`, déplacée dans `utils.js` pour être accessible depuis `export.js` sans dépendre de l'ordre de chargement des scripts) — le tri par DLC, lui, continue d'utiliser la date complète en interne pour rester chronologiquement exact.
28. **Rayons "sans DLC obligatoire" (ENTRETIEN, BEAUTE-SANTE)** : `estRayonSansDLCObligatoire()` dans `utils.js` compare le rayon d'un article de façon robuste (normalisation via `normaliserRayonCourt()` — minuscule, sans accents, sans espaces ni tirets) contre la liste `RAYONS_SANS_DLC_OBLIGATOIRE = ['entretien', 'beautesante']`, pour tolérer les variations d'orthographe/casse du fichier théorique. Cette fonction est utilisée par les règles 29 et 30 ci-dessous.
29. **Vue : case "quantité ou DLC non saisie"** : une case à cocher `checkbox-non-saisi` (bleue, distincte de l'alerte rouge du filtre stock ≤ 0) filtre la Vue pour ne montrer que les occurrences où `stockReel` est vide, **ou** où `dlc` est vide — sauf pour les rayons ENTRETIEN/BEAUTE-SANTE (règle 28), où une DLC absente est normale et n'est donc jamais comptée comme "non saisie". Combinable avec les autres filtres de la Vue (zone, recherche, stock ≤ 0). Décochée par défaut à chaque nouvelle ouverture de la Vue.
30. **Stock : filtres Écart+/Écart- et couleur de l'écart** : deux chips `checkbox-ecart-positif`/`checkbox-ecart-negatif` (désactivées par défaut = pas de restriction) filtrent l'écran Stock pour ne montrer que les articles à écart strictement positif, strictement négatif, ou les deux à la fois si les deux sont cochées (un article sans aucune palette comptée, à l'écart inconnu, est exclu dès qu'un des deux filtres est actif). Dans chaque carte, le champ "Écart" prend une couleur distincte dès qu'il est différent de 0 : bleu accent si positif (excédent), rouge si négatif (manque) — inchangé (couleur neutre) quand l'écart est à 0 ou inconnu. Les deux chips sont décochées à chaque nouvelle ouverture de l'écran Stock.
31. **PDF : désignation à la place de la DLC pour ENTRETIEN/BEAUTE-SANTE sans DLC** : dans `genererPDFEtiquettes()`, si un article n'a pas de DLC et appartient à un rayon "sans DLC obligatoire" (règle 28), la grande zone du haut de l'étiquette affiche sa **désignation** au lieu de "—", avec une taille de police bien plus modeste et le retour à la ligne autorisé (classe `.etiquette-haut-texte` dans `style.css`, texte potentiellement long contrairement à un "MM/AAAA"). Pour tous les autres rayons, une DLC absente continue d'afficher "—" comme avant. Si la DLC existe (peu importe le rayon), elle s'affiche normalement dans son emplacement d'origine — la substitution ne s'applique jamais si la DLC est renseignée.
32. **Vue : filtres façade/étage en chips** : en plus du filtre par zone (menu déroulant), deux rangées de chips filtrent par façade (`Gauche`/`Droite`/`Sol`) et par étage (`1` à `5`) — valeurs fixes, pas dérivées des données, toujours affichées. Même logique que partout ailleurs dans l'app : aucune chip cochée par défaut = pas de restriction, plusieurs chips cochées dans une même rangée = OR (n'importe laquelle correspond), combinables avec le filtre par zone, la recherche et les autres cases de la Vue. Un article de façade "Sol" (donc sans étage) ne peut jamais correspondre si un filtre d'étage est actif — résultat vide plutôt qu'une erreur, comportement attendu. Réinitialisées à chaque nouvelle ouverture de la Vue. Voir `renderFiltresFacadeEtageVue()` dans `ui.js`.

## 7. Décisions prises suite aux clarifications (importantes pour la cohérence)

Le cahier des charges original laissait 3 points ambigus ; voici les décisions validées avec l'utilisateur :

1. **Ré-import du fichier théorique** : le catalogue (`articles`) est entièrement remplacé par le nouveau fichier (il sert de "base de référence" pour limiter la sélection aux articles réellement valides), **mais les affectations existantes ne sont jamais supprimées automatiquement**. Si un article encore affecté à une cellule n'existe plus dans le nouvel import, l'app le signale comme "orphelin" (compteur affiché en toast) pour permettre à l'utilisateur de vérifier la synchronisation entre état théorique et état réel. Voir `remplacerCatalogue()` dans `db.js`.
2. **Export Excel** : un seul onglet, toutes les occurrences triées par **Allée > Façade (Gauche, Droite, Sol) > Étage > Cellule > ordre**. Voir `exporterExcel()` dans `export.js`.
3. **Import Excel/CSV** : validation **stricte** des en-têtes (orthographe ET ordre exacts : `Code article`, `Désignation`, `Stock théorique`, `Rayon`, `Famille` facultative en 5e colonne). En cas d'erreur, le message précise exactement quelle colonne est fautive et ce qui était attendu. Voir `validerEntetes()` dans `import.js`.

## 8. Interface / UX

- Écran unique en 4 "panneaux" qui s'affichent/masquent (pas de routing) :
  1. `panel-emplacement` : sélection allée/façade/étage
  2. `panel-cellules` : grille des 18 cellules avec compteur d'articles, plus un bouton "📥 Importer un CSV" (+ "❓" d'aide) pour ajouter des articles en masse dans cette zone (voir règle 13) sans passer par la recherche manuelle.
  3. `panel-cellule-detail` : contenu d'une cellule (recherche, filtres, liste réordonnable, badge stock/DLC par article)
  4. `panel-vue-zone` : **vue de consultation** (bouton "👁️ Vue" dans l'en-tête) — liste en lecture seule de tous les articles enregistrés, groupés en **Allée > Façade > Étage > Cellule**, avec un filtre par allée, un bouton "🗑️ Vider toute cette allée", **un bouton "🗑️ Vider" à chaque niveau du groupement** (allée, façade, étage, cellule — suppression en masse avec confirmation), **une case à cocher à chaque niveau** (sélection en cascade pour l'impression d'étiquettes, voir point 12 ci-dessus), et une barre de recherche (code ou désignation, mêmes mots-clés indépendants que l'écran de cellule — voir `correspondMotsCles()` dans `utils.js`) pour retrouver rapidement où se trouve un article donné. Utilise le même ordre de tri que l'export Excel (`trierAffectationsPourAffichage()` dans `export.js`). Le bouton "← Retour" restaure l'écran précédent (grille ou détail de cellule selon le contexte).
  5. `panel-stock` : voir règle 19 (fiches par article, écart, palettes restantes estimées, badge conforme, filtres rayon).
  6. `panel-dlc` : voir règle 27 (articles triés par DLC, filtres date max/recherche/rayon, deux exports CSV).
- **Bouton "🏠 Accueil"** dans l'en-tête (`allerAccueil()` dans `ui.js`) : réinitialise la sélection d'emplacement et revient à l'écran de départ, depuis n'importe quel écran.
- **Bouton "❓ Aide"** dans l'en-tête, à côté d'Import : ouvre une modale (`#modale-aide-import`) qui explique la structure attendue du fichier théorique (colonnes, ordre, exemple) et propose un bouton "Télécharger un exemple" qui génère un `.xlsx` modèle prêt à remplir (`telechargerModeleImport()` dans `export.js`).
- Une **modale** (`#modale-deplacer`) pour choisir la cellule de destination lors d'un déplacement.
- Une **modale** (`#modale-stock-dlc`) pour renseigner ou modifier, à tout moment, le stock réel et la DLC d'une occurrence précise (bouton 🏷️ sur chaque ligne d'article dans une cellule).
- Design volontairement sobre : peu de couleurs (1 accent bleu `#2563eb`), gros boutons tactiles (min. 44px), grille responsive 3/4 colonnes.
- Toutes les interactions passent par l'objet `etat` en haut de `ui.js` (emplacement courant, cellule ouverte, filtres cochés, instance SortableJS active).

## 9. Comment tester / lancer

- Double-cliquer sur `index.html` (fonctionne en `file://`), ou servir le dossier avec n'importe quel serveur statique (ex. `npx serve .`), ou déployer sur GitHub Pages.
- Aucune installation, aucun build, aucune dépendance npm à l'exécution (les libs sont déjà en fichiers statiques dans `lib/`).
- Pour régénérer les libs si besoin : `npm install xlsx sortablejs` puis copier `node_modules/xlsx/dist/xlsx.full.min.js` et `node_modules/sortablejs/Sortable.min.js` dans `lib/`.

## 10. Limites connues / pistes d'évolution possibles

- Les icônes PWA (`assets/icon-192.png`, `icon-512.png`) sont des placeholders générés (grille bleue) — à remplacer par une vraie identité visuelle si besoin.
- La recherche limite l'affichage à 60 résultats (`search.js`, `rechercherArticles()`) pour rester rapide sur mobile — ajustable si le catalogue est très volumineux.
- Pas de undo/historique des actions (seulement la sauvegarde JSON manuelle comme filet de sécurité).
- Le service worker utilise une stratégie "cache d'abord" simple (`service-worker.js`).

## 11. Détection de nouvelle version

Le service worker ne s'active plus automatiquement (`self.skipWaiting()` retiré) : quand une nouvelle version est déployée, elle reste "en attente" tant que l'utilisateur n'a pas cliqué sur le bouton de mise à jour. Flux complet :

1. **À chaque déploiement**, il faut changer la constante `CACHE_NOM` dans `service-worker.js` (ex. `v1` → `v2`). C'est ce changement qui fait que le navigateur détecte un nouveau fichier de service worker et déclenche l'événement `updatefound`.
2. `app.js` (`initDetectionMiseAJour()`) écoute cet événement. Dès qu'une nouvelle version est installée (state `installed`) alors qu'un `controller` est déjà actif (donc pas une 1ère installation), la bannière `#notif-maj` en bas d'écran s'affiche avec le bouton **"Mettre à jour"**.
3. Il vérifie aussi au chargement si une version est déjà en attente (`registration.waiting`), et relance une vérification (`registration.update()`) **toutes les heures** si l'app reste ouverte longtemps.
4. Au clic sur "Mettre à jour", un message `SKIP_WAITING` est envoyé au service worker en attente (écouté dans `service-worker.js` via `self.addEventListener('message', ...)`), qui s'active alors immédiatement.
5. Quand le nouveau service worker prend le contrôle (`controllerchange`), la page se recharge automatiquement une seule fois pour charger les nouveaux fichiers.

Ce choix (bouton plutôt que rechargement 100 % automatique et silencieux) évite d'interrompre un utilisateur en train de saisir des articles dans une cellule. Pour passer en rechargement totalement automatique, il suffirait de sauter l'affichage de la bannière et d'appeler directement `registration.waiting.postMessage('SKIP_WAITING')` dès sa détection.

## 12. Pour reprendre le projet avec une autre IA

Donne-lui ce README + le contenu des fichiers `db.js`, `ui.js` et `utils.js` en priorité (ce sont les 3 fichiers qui portent le plus de logique et de règles métier). Les sections 4, 6 et 7 ci-dessus sont les règles à ne surtout pas casser lors de toute modification.
