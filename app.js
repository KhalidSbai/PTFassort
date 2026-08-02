// app.js — bootstrap de l'application.

document.addEventListener('DOMContentLoaded', async () => {
  await ouvrirDB();
  await rafraichirCacheArticles();
  initUI();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {
      // L'app fonctionne même si le service worker échoue à s'enregistrer
      // (ex : ouverture directe du fichier via file://)
    });
  }
});
