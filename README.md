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

Un emplacement est donc défini par : `{ allee, facade, etage, cellule }`.
La clé unique interne est générée par `cleEmplacement()` dans `utils.js`, format : `"allee-facade-etage-cellule"` (étage = `0` si Sol).

## 5. Modèle de données (IndexedDB)

Base : `cellules-entrepot-db`, version 1 (voir `db.js`).

### Store `articles` (keyPath: `codeArticle`)
Le catalogue théorique complet, remplacé à chaque import du fichier théorique.
```js
{
  codeArticle: string,     // identifiant unique de l'article
  designation: string,
  stockTheorique: number,
  rayon: string,
  famille: string          // '' si non fourni
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
  ordre: number             // position dans la cellule, pour le glisser-déposer
}
```

## 6. Règles métier importantes (à ne pas casser)

1. **Jamais de quantité demandée.** Cliquer sur un article dans les résultats de recherche l'ajoute immédiatement à la cellule ouverte.
2. **Doublons autorisés et volontaires** : un même `codeArticle` peut apparaître plusieurs fois dans la même cellule, ou dans plusieurs cellules. Ne jamais dédupliquer.
3. **Suppression indépendante** : supprimer une occurrence (`supprimerAffectation(id)`) ne touche jamais les autres occurrences du même article.
4. **Ordre des articles dans une cellule** = important, sauvegardé via le champ `ordre`, modifiable par glisser-déposer (SortableJS, géré dans `renderListeArticlesCellule()` dans `ui.js`).
5. **Déplacement d'un article vers une autre cellule** : l'occurrence est retirée de sa cellule d'origine et ajoutée **en fin** de la cellule de destination (nouvel `ordre` = max + 1). Voir `deplacerAffectation()` dans `db.js`.
6. **Sauvegarde automatique** : chaque action (ajout, suppression, déplacement, réorganisation) écrit directement dans IndexedDB. Aucun bouton "Enregistrer" n'existe pour les données courantes — seuls les boutons "Sauver/Restaurer" gèrent l'export/import JSON complet en tant que backup externe.
7. **Recherche par mots-clés indépendants** : chaque mot tapé doit se retrouver dans le code article ou la désignation, sans tenir compte de l'ordre ni des mots intercalés (ex. "huile 5l" ≡ "5l huile"). Voir `rechercherArticles()` dans `search.js`.
8. **Filtres rayon/famille désactivés par défaut et mémorisés** : les chips ne sont **pas** cochées au départ (aucune restriction, tous les articles sortent). Dès qu'une chip est cochée, elle **reste cochée d'une cellule à l'autre** (l'état n'est plus réinitialisé à chaque ouverture de cellule) — pratique pour enregistrer plusieurs articles du même rayon à la suite sans re-sélectionner le filtre à chaque fois. L'état persiste dans `etat.rayonsCoches` / `etat.famillesCoches` (objet `etat` en haut de `ui.js`) pour toute la session, et n'est nettoyé des valeurs devenues invalides qu'après un import du catalogue ou une restauration de sauvegarde (`nettoyerFiltresApresImport()`).

## 7. Décisions prises suite aux clarifications (importantes pour la cohérence)

Le cahier des charges original laissait 3 points ambigus ; voici les décisions validées avec l'utilisateur :

1. **Ré-import du fichier théorique** : le catalogue (`articles`) est entièrement remplacé par le nouveau fichier (il sert de "base de référence" pour limiter la sélection aux articles réellement valides), **mais les affectations existantes ne sont jamais supprimées automatiquement**. Si un article encore affecté à une cellule n'existe plus dans le nouvel import, l'app le signale comme "orphelin" (compteur affiché en toast) pour permettre à l'utilisateur de vérifier la synchronisation entre état théorique et état réel. Voir `remplacerCatalogue()` dans `db.js`.
2. **Export Excel** : un seul onglet, toutes les occurrences triées par **Allée > Façade (Gauche, Droite, Sol) > Étage > Cellule > ordre**. Voir `exporterExcel()` dans `export.js`.
3. **Import Excel/CSV** : validation **stricte** des en-têtes (orthographe ET ordre exacts : `Code article`, `Désignation`, `Stock théorique`, `Rayon`, `Famille` facultative en 5e colonne). En cas d'erreur, le message précise exactement quelle colonne est fautive et ce qui était attendu. Voir `validerEntetes()` dans `import.js`.

## 8. Interface / UX

- Écran unique en 4 "panneaux" qui s'affichent/masquent (pas de routing) :
  1. `panel-emplacement` : sélection allée/façade/étage
  2. `panel-cellules` : grille des 18 cellules avec compteur d'articles
  3. `panel-cellule-detail` : contenu d'une cellule (recherche, filtres, liste réordonnable)
  4. `panel-vue-zone` : **vue de consultation** (bouton "👁️ Vue" dans l'en-tête) — liste en lecture seule de tous les articles enregistrés, groupés par zone (Allée/Façade/Étage) puis par cellule, avec un filtre optionnel par allée. Utilise le même ordre de tri que l'export Excel (`trierAffectationsPourAffichage()` dans `export.js`, partagé avec `ui.js`). Le bouton "← Retour" restaure l'écran précédent (grille ou détail de cellule selon le contexte).
- Une **modale** (`#modale-deplacer`) pour choisir la cellule de destination lors d'un déplacement.
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
