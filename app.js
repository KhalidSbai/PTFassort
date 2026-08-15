// app.js — bootstrap de l'application + détection de mise à jour du service worker.

document.addEventListener('DOMContentLoaded', async () => {
  await ouvrirDB();
  await rafraichirCacheArticles();
  initUI();
  await restaurerNavigation();
  initDetectionMiseAJour();
});

/**
 * Enregistre le service worker et surveille l'arrivée d'une nouvelle version.
 * Dès qu'une nouvelle version est installée et prête (mais pas encore active),
 * une bannière "Mettre à jour" s'affiche. Au clic, la nouvelle version est
 * activée puis la page se recharge automatiquement pour l'utiliser.
 */
function initDetectionMiseAJour() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('service-worker.js').then((registration) => {
    // Cas 1 : une version est déjà en attente au moment où la page se charge
    // (ex: mise à jour téléchargée lors d'une visite précédente, jamais activée)
    if (registration.waiting && navigator.serviceWorker.controller) {
      proposerMiseAJour(registration);
    }

    // Cas 2 : une nouvelle version se télécharge pendant que l'app est ouverte
    registration.addEventListener('updatefound', () => {
      const nouveauWorker = registration.installing;
      if (!nouveauWorker) return;
      nouveauWorker.addEventListener('statechange', () => {
        // "installed" + un controller déjà actif = vraie mise à jour (pas la 1ère installation)
        if (nouveauWorker.state === 'installed' && navigator.serviceWorker.controller) {
          proposerMiseAJour(registration);
        }
      });
    });

    // Vérifie s'il existe une nouvelle version toutes les heures (app ouverte longtemps)
    setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {
    // L'app fonctionne même si le service worker échoue à s'enregistrer
    // (ex : ouverture directe du fichier via file://)
  });

  // Une fois la nouvelle version activée, on recharge la page une seule fois
  let rechargementDejaFait = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (rechargementDejaFait) return;
    rechargementDejaFait = true;
    window.location.reload();
  });
}

function proposerMiseAJour(registration) {
  const banniere = document.getElementById('notif-maj');
  if (!banniere || banniere.dataset.affichee === '1') return; // déjà proposée
  banniere.dataset.affichee = '1';
  banniere.classList.remove('hidden');

  document.getElementById('btn-maj').addEventListener('click', () => {
    if (registration.waiting) {
      registration.waiting.postMessage('SKIP_WAITING');
    }
    banniere.classList.add('hidden');
  }, { once: true });
}
