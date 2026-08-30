# Résumé projet — SAV-tech + TECHNIZEN

*Document de reprise — mise à jour du 30/08/2026 (session complémentaire, suite à la refonte ergonomique de bureau-app)*
*À partager en tout premier message d'une nouvelle conversation.*

---

## 0. À LIRE EN PREMIER — où on en est

Le chantier "améliorer l'ergonomie/présentation de bureau-app" est **terminé et validé en usage réel** : navigation par onglets, suppression sécurisée avec corbeille, publication vers les clients, recherche, gestion des paramètres du relais — tout est en place et bureau-app est passé de **V1.03 à V1.06**.

**Étape majeure franchie cette session : la chaîne complète fonctionne de bout en bout pour la première fois**, confirmé par un test réel (Will Sainte-Rose, Gaz n° série 25294) : TECHNIZEN → intervention sur GitHub → bureau-app traite et publie → client-app affiche l'intervention après déchiffrement. Avant cette session, la fonction "Publier" décrite dans un résumé précédent comme déjà fonctionnelle **n'existait en réalité pas du tout** dans le code — c'est maintenant corrigé.

**🎯 CHANTIER IMMÉDIAT DE LA PROCHAINE SESSION : passer à client-app.** Deux volets :
1. Un dernier correctif en attente côté bureau-app (voir section 5, point 1) — à valider avant de basculer, mais ne bloque pas de commencer à réfléchir à client-app en parallèle.
2. Refonte de la présentation visuelle de client-app pour la rendre agréable pour les clients (rien de figé actuellement, client-app n'a jamais été déployé publiquement — on peut la refaire librement si besoin, y compris changer la façon dont un client s'identifie).

---

## 1. Où trouver le code

- **TECHNIZEN** : dépôt Git séparé, racine du dépôt = `index.html` + `src/js/app.js` + `src/js/database.js`. Fichier `PROJET_ETAT.md` + `PROJET_HISTORIQUE.md` à la racine. **Nouveau cette session** : `CLAUDE.md` créé à la racine de ce dépôt (sur le modèle de celui de SAV-tech) imposant l'incrémentation automatique du numéro de version affiché dans le header à chaque modification d'`index.html`.
- **SAV-tech** : dépôt GitHub `Matrice971/SAV-tech`, **public**. Structure : `client-app/`, `bureau-app/`, `worker/`, `docs/`. `CLAUDE.md` à la racine avec incrémentation automatique de version pour `client-app/index.html` et `bureau-app/index.html`.
- **Dossier Drive partagé** `SAV-tech-TECHNIZEN/` : copie miroir pour lecture par Claude (chat) — contient `bureau-app/index.html`, `client-app/index.html`, TECHNIZEN (`index.html`, `app.js`, `database.js`), et maintenant aussi `worker/index.js`. Toujours demander à Phip de resynchroniser avant de diagnostiquer un bug.
- **Pour lire un gros fichier Drive** : `download_file_content`, décoder le base64 stocké proprement (jamais retaper à la main).

Tout le travail se fait directement sur la branche `main`, dans les deux dépôts.

---

## 2. Architecture actuelle — vue d'ensemble (inchangée, désormais opérationnelle de bout en bout)

```
TECHNIZEN (technicien, terrain, hors-ligne) — affiche désormais V10.29 dans le header
    │  bouton "Envoyer vers SAV-tech" sur la fiche d'intervention standard
    ▼
data/interventions/*.txt (GitHub, non chiffré, écrit via le relais Cloudflare /write)
    │  lu par bureau-app (API GitHub publique)
    ▼
bureau-app (V1.06, onglets : Suivi réparation / Gestion clients / Suivi prêt / Configuration)
    │  "📤 Publier la sélection" → déchiffre le fichier client existant (si présent),
    │  fusionne les interventions sélectionnées, rechiffre, republie
    ▼
data/clients/{contact-slug}.txt (GitHub, chiffré AES-GCM/PBKDF2) — ✅ confirmé fonctionnel
    │  lu par client-app (identifiant client + mot de passe)
    ▼
client-app (V1.02, appli HTML publique, jamais déployée publiquement à ce jour)
```

---

## 3. TECHNIZEN — état actuel

- **V10.29** : ajout de l'affichage du numéro de version dans le header (`<span class="app-version">`), à côté du sous-titre. Règle d'incrémentation automatique posée dans un nouveau `CLAUDE.md`.
- Reste par ailleurs inchangé depuis le dernier résumé (système de suivi de complétude par équipement, bouton "Envoyer vers SAV-tech" à 3 états, etc. — voir résumé précédent pour le détail si besoin).
- Le champ "Mot de passe du relais" demandé dans la fenêtre "Envoyer vers SAV-tech" est normal et attendu — il correspond au secret Cloudflare `WRITE_PASSWORD` (voir section 6).

---

## 4. SAV-tech — état actuel

### bureau-app (V1.03 → V1.06 cette session)

**Navigation** : 4 onglets (Suivi réparation avec badge du nombre d'interventions non traitées / Gestion clients / Suivi prêt / Configuration). Onglet Configuration regroupe désormais : import TECHNIZEN, paramètres du relais (URL + mot de passe, éditables et sauvegardés dans la config), et la corbeille.

**Bouton de sauvegarde** : renommé "💾 Enregistrer" (ne prétend plus fermer l'onglet). Protection `beforeunload` native si modifications non sauvegardées (`hasUnsavedChanges`).

**Interventions à traiter** : cartes groupées par statut (Réparation finalisée / En attente de pièce / Livrée et testée), code couleur, triées par date.

**Suppression sécurisée** : bouton 🗑️ avec confirmation → copie dans `configState.interventionsSupprimees` (config JSON) → suppression réelle sur GitHub via la nouvelle route `/delete` du relais → purge automatique après 90 jours → écran "Corbeille" consultable dans Configuration (pas de restauration automatique, juste vérification manuelle).

**Publication ("📤 Publier la sélection")** — ✅ **fonctionnalité qui n'existait pas du tout avant cette session**, entièrement créée :
- Sélection multiple par cases à cocher sur les interventions à traiter.
- Pour chaque client concerné : télécharge `data/clients/{slug}.txt` s'il existe (404 = premier envoi), déchiffre (mot de passe client), fusionne les interventions dans `appareils` (clé : `num_serie` + `type`), rechiffre (AES-GCM/PBKDF2, format `salt.iv.ciphertext` en base64, identique au format attendu par client-app), republie via `/write` avec `dossier: "clients"`.
- **Publication partielle** : si un client de la sélection n'a pas de mot de passe défini, il est exclu de la publication mais **les autres clients valides sont publiés quand même** — un message final liste séparément les échecs réseau et les clients non publiés faute de mot de passe.
- Badge "✅ Publié le JJ/MM" sur les interventions publiées avec succès.

**Gestion des clients** : vue condensée (contact + statut mot de passe + liste des centres attribués avec leur adresse), reste modifiable en détail (email, lien Drive) uniquement via "Modifier". Barre de recherche (contact, nom de centre, ou commune), insensible à la casse et aux accents. Import TECHNIZEN enrichi : capture désormais aussi la liste des centres (nom, adresse, ville) par contact, non-destructif comme avant.

**Paramètres du relais** : formulaire dans Configuration pour éditer `relais.url` et `relais.writePassword` directement depuis l'appli (avant, modification uniquement possible en éditant le JSON à la main).

### client-app (V1.01 → V1.02)

- **Corrigé** : `FILE_URL` n'est plus codé en dur sur `test.txt` — un champ "Identifiant client" (slug) a été ajouté à l'écran de connexion, combiné au mot de passe.
- **Corrigé** : texte de dev "Étape C — liste et détail des appareils" retiré du footer.
- **Testé et confirmé fonctionnel** avec un vrai client (Will Sainte-Rose / slug `will-sainte-rose`) : appareil publié depuis bureau-app bien visible après déchiffrement.
- N'a jamais été déployé publiquement — reste entièrement libre à retravailler (présentation, voire logique d'identification) sans contrainte de compatibilité avec des clients existants.

### Relais Cloudflare Workers (`worker/index.js`)

- Nouvelle route **`POST /delete`** ajoutée et déployée (`wrangler deploy` confirmé fait, testé via `curl` avec réponse JSON correcte).
- CORS géré au niveau global (`OPTIONS` → 204 avec les bons en-têtes), commun à `/write` et `/delete` — pas de régression CORS malgré l'ajout de la route.
- `dossier` reste une clé de correspondance stricte (`clients` → `data/clients`, `interventions` → `data/interventions`), jamais interpolée directement — protection contre le path traversal confirmée dans le code.
- Le mot de passe (`WRITE_PASSWORD`) est comparé en temps constant (`safeEqual`) — bonne pratique déjà en place.

---

## 5. Sujets ouverts / évolutions à discuter

1. **Correctif en attente sur bureau-app (prochaine session)** : un premier correctif tentait de bloquer l'envoi réseau si `configState.relais.url` était vide, mais ça n'a pas fonctionné comme prévu en test réel (donnait encore une erreur "HTTP 501" au lieu du message clair). Remplacé par une approche plus simple, déjà spécifiée mais **pas encore testée** : ajouter la phrase *"Vérifiez l'adresse et le mot de passe du relais dans l'onglet Configuration."* à la fin de tout message d'échec réseau (dans `saveInterventionChanges`, `deleteIntervention`, `publishSelection`), sans tenter de pré-valider l'URL. Prompt prêt, à lancer et tester en priorité à la reprise.
2. **Refonte visuelle de client-app** : à faire, sans contrainte de compatibilité (jamais déployée publiquement). Réfléchir à la présentation ET à l'ergonomie de l'écran de connexion (identifiant + mot de passe) pendant cette refonte.
3. **Écran de comparaison à l'import TECHNIZEN** (local vs importé, champ par champ) — toujours pas codé, l'import reste non-destructif par défaut. Note : l'import capture désormais aussi les centres (nom/adresse/ville), donc si cet écran est fait un jour, il faudra aussi couvrir les conflits sur ce nouveau champ.
4. **Mode de fonctionnement de la base clients à trancher en équipe** (préférence technicien / admin / bases indépendantes / synchro protégée) — toujours en suspens. Rappel : ne jamais publier la base clients complète en clair sur le dépôt public GitHub si une synchro automatique est un jour choisie.
5. **Point de vigilance GitHub Pages** inchangé : ne jamais rendre le dépôt `SAV-tech` privé sans upgrade payant (couperait `client-app`).
6. Les 2 bugs anciens de `client-app` (section précédente) sont **résolus** cette session (`FILE_URL` dynamique + texte de dev retiré) — à retirer du suivi.
7. Compléter les filtres opacimètre AT605/ECOPA100 (toujours en attente, non traité cette session).

---

## 6. Repères pratiques utiles

- **Git qui refuse de pousser (branches divergentes)** : `git pull --no-rebase`, puis `git commit --no-edit` si un message de fusion s'ouvre (l'éditeur `nano` peut s'ouvrir : `Ctrl+O` puis `Entrée` pour valider, `Ctrl+X` pour quitter), puis `git push`. Rencontré et résolu cette session (des interventions techniciens avaient été poussées entre-temps par TECHNIZEN — comportement normal, pas une erreur).
- **Vérifier si un déploiement Worker est à jour** : `wrangler deployments list` (comparer l'horodatage au dernier commit concerné), ou tester directement la route via `curl -X POST .../[route] -d '{...}'` — une réponse JSON du Worker (même une erreur du type "mot de passe incorrect") confirme que le déploiement est bien en place.
- **Diagnostiquer un échec réseau dans le navigateur** : ouvrir les outils de développement (F12) → onglet Réseau, reproduire l'action, inspecter la requête en échec (URL complète, réponse). A permis de découvrir que le champ "URL du relais" vide provoque un `fetch()` en URL relative vers la page elle-même (`http://localhost:8000/write`) plutôt que vers le relais Cloudflare — d'où des erreurs cryptiques ("HTTP 501") qui n'ont rien à voir avec Cloudflare, GitHub ou le code métier.
- **Changer le mot de passe du relais (`WRITE_PASSWORD`)** — 3 endroits à synchroniser, sinon "Mot de passe incorrect" partout :
  1. Le secret Cloudflare lui-même : `wrangler secret put WRITE_PASSWORD` (depuis `worker/`), ou via le tableau de bord web [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → `sav-tech-relay` → Settings → Variables and Secrets (utile si on change de PC, ex. PC Windows du travail — aucune installation requise par cette voie).
  2. Le champ "Mot de passe du relais" dans bureau-app (onglet Configuration → Enregistrer les paramètres du relais → 💾 Enregistrer).
  3. Le champ équivalent dans TECHNIZEN (fenêtre "Envoyer vers SAV-tech") — emplacement exact dans le code encore à vérifier si besoin.
- **`wrangler deploy`** : nécessaire après toute modification de `worker/index.js` — un `git push` seul ne redéploie pas le worker.
- **Fichiers HTML ouverts en `file://` sous Linux (Zorin OS)** : peuvent afficher une version périmée à cause du portail XDG — préférer `python3 -m http.server` + `http://localhost:8000/`. Nuance découverte cette session : ce n'est pas systématique (le fichier TECHNIZEN ouvert en `file://` était bien à jour lors d'un test) — donc utile pour vérifier via le numéro de version affiché, mais ne pas assumer que `file://` est *toujours* périmé ni *jamais* périmé.

---

*Fin du résumé.*
