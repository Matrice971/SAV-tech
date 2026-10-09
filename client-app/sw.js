// Service worker de client-app (V2.16) : rend l'appli installable sur
// l'écran d'accueil. Aucune mise en cache — l'appli et les données sont
// toujours relues en ligne (une nouvelle version publiée arrive aussitôt) ;
// sans connexion, un message clair remplace la page d'erreur du navigateur.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(
      '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>TECHNIZEN</title></head>' +
      '<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;text-align:center;padding:3rem 1.5rem;color:#1c1e21;background:#f5f6f8;">' +
      '<h1 style="color:#1a3a5c;">TECHNIZEN</h1>' +
      '<p>Pas de connexion Internet.</p><p>Vérifiez le Wi-Fi ou les données mobiles, puis rouvrez l\'appli.</p>' +
      '</body></html>',
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    ))
  );
});
