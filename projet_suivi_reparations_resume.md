# Résumé projet — SAV-tech + TECHNIZEN

*Document de reprise — mise à jour du 31/08/2026 (session ergonomie bureau-app + fichier client vide + effacement auto 90j)*
*À partager en tout premier message d'une nouvelle conversation.*

---

## 0. À LIRE EN PREMIER — où on en est

**Contexte** : la présentation au patron et le test terrain client du 31/08 ont eu lieu. Suite à ça, deux chantiers ont été menés dans la foulée : une refonte ergonomique complète de bureau-app (structure, couleurs, tri, recherche), puis deux correctifs/fonctionnalités liés à l'usage réel avec un vrai client test (mailto de retour client, gestion des clients sans matériel en réparation).

**État des versions à la fin de cette session** :
- **TECHNIZEN** : V10.30 (inchangé cette session)
- **bureau-app** : V2.13
- **client-app** : V1.03

**Point de vigilance récurrent** : le dossier Drive partagé `SAV-tech-TECHNIZEN/` est fréquemment désynchronisé par rapport au dernier commit — **toujours vérifier `modifiedTime` du fichier avant de s'y fier**, et demander à Phip de resynchroniser (ou reteléverser en pièce jointe) avant tout diagnostic ou avant de préparer un nouveau prompt Claude Code.

**À vérifier par Phip (non fait à la fin de cette session)** :
- Confirmer que la 3ᵉ catégorie de statut ("Réparation terminée", ex-"Réparation finalisée") s'affiche bien avec sa couleur propre dans la grille — les tests Playwright de la refonte V2.12 n'ont montré que 2 des 3 groupes de statut sur les données démo utilisées.
- Redemander un retour au client test sur le mailto de retour corrigé.

---

## 1. Où trouver le code

- **TECHNIZEN** : dépôt Git séparé, racine = `index.html` + `src/js/app.js` + `src/js/database.js`. `PROJET_ETAT.md` + `PROJET_HISTORIQUE.md` à la racine. `CLAUDE.md` impose l'incrémentation automatique de version — actuellement **V10.30**.
- **SAV-tech** : dépôt GitHub `Matrice971/SAV-tech`, **public**, branche `main` uniquement. Structure : `client-app/`, `bureau-app/`, `worker/`, `docs/`. `CLAUDE.md` à la racine, incrémentation automatique de version — bureau-app actuellement **V2.13**, client-app **V1.03**.
- **Dossier Drive partagé** `SAV-tech-TECHNIZEN/` : copie miroir pour lecture par Claude (chat). Vérifier systématiquement la date de modification avant de s'y fier.
- Tout le travail se fait directement sur la branche `main`, dans les deux dépôts.

---

## 2. Architecture actuelle — vue d'ensemble

```
TECHNIZEN (V10.30, technicien, terrain, hors-ligne)
    │  bouton "Envoyer vers SAV-tech" — état à 3 valeurs, boutons radio,
    │  pieces_montees, pieces_a_prevoir, nom_rapport, matériel prêt/récupéré
    ▼
data/interventions/*.txt (GitHub, non chiffré, via relais Cloudflare /write)
    ▼
bureau-app (V2.13, onglets : Suivi réparation / Gestion clients / Suivi prêt / Configuration)
    │  Cache config auto (localStorage), structure {technicien, publication}
    │  Refonte ergonomique complète (voir section 4)
    │  Effacement auto à 90j des "Livrée et testée" + génération auto de
    │  fichier client vide quand plus aucune intervention active (voir section 4)
    │
    │  "📤 Publier la sélection" → construit l'appareil client à partir de
    │  "publication", chiffre et republie
    ▼
data/clients/{contact-slug}.txt (GitHub, chiffré AES-GCM/PBKDF2)
    ▼
client-app (V1.03) — lit et déchiffre UNIQUEMENT ce fichier
    │  Mailto de retour client fixé en dur sur contact.technizen@gmail.com
    │  (au lieu de l'email du client) — objet/corps inchangés
    │  Dates affichées au format français JJ Mois AAAA (plus de format ISO)
    │  Message déjà existant "Aucun matériel actuellement en réparation."
    │  pour les clients sans appareil — réutilisé tel quel par le fichier vide
```

---

## 3. TECHNIZEN — état actuel (V10.30)

Aucun changement cette session. Voir résumés précédents pour le détail (`CATEGORIES_CONTROLE`, bouton "Envoyer vers SAV-tech", suivi de complétude par équipement, etc.).

---

## 4. SAV-tech — évolutions de cette session

### bureau-app — Refonte ergonomique (V2.12)

Suite à un retour du patron peu enthousiaste, refonte visuelle complète pour un rendu plus "produit fini" :
1. **Statuts renommés + triés** : "Réparation en cours" (ex-En attente de pièce, ambre) → "Réparation terminée" (ex-Réparation finalisée) → "Livrée et testée" (bleu), chacun avec sa couleur. Tri chronologique croissant (plus ancien en premier) dans chaque catégorie. Valeurs internes des états (1/2/3) inchangées, seuls les libellés affichés changent.
2. **Grille responsive pleine largeur** (1/2/3 colonnes selon l'espace, optimisée PC 1920×1080) remplaçant l'ancienne liste. Cartes condensées : type de matériel / centre / date (JJ Mois AA) + boutons "🔍 Détail" et "🗑️ Supprimer" tous deux toujours visibles.
3. **En-tête** avec dégradé de fond, "Gestion suivi réparation" + version + pastille "TechniZen", sans logo.
4. **Colonnes technicien/publication** différenciées visuellement (grise/verrouillée vs blanche/bordure active).
5. Espacement généralement augmenté (pensé pour usage PC en local d'entreprise).
6. Icônes cohérentes sur les actions.
7. Recherche globale (client, centre, matériel, commentaires, pièces — tous les champs).

Vérifié par Playwright (screenshots en scratchpad local, non commités) : en-tête, grille, colonnes détail, client add/edit/delete, aucune erreur console.

### bureau-app — Correctifs et fonctionnalités liés à l'usage réel (V2.13)

Suite à un premier retour terrain d'un client test :

1. **Bouton "📬 Vérifier les mails clients"** dans l'en-tête, à côté d'Enregistrer — ouvre `https://mail.google.com/mail/u/0/?authuser=contact.technizen@gmail.com#inbox` dans un nouvel onglet. Le compte `contact.technizen@gmail.com` (déjà utilisé pour héberger les liens Drive clients) sert désormais aussi de boîte de réception dédiée aux retours clients — ne reçoit normalement aucun autre mail, ce qui permet de repérer facilement une demande.
2. **Effacement automatique à 90 jours des interventions "Livrée et testée"** : un nouveau champ `date_passage_livree` est horodaté quand une intervention passe à l'état 3 (effacé si l'état repasse à 1/2). Au chargement, toute intervention "Livrée et testée" avec `date_passage_livree` > 90 jours est automatiquement supprimée (relais `/delete`) et déplacée en corbeille, silencieusement — même rétention 90 jours que la suppression manuelle.
3. **Génération automatique d'un fichier client "vide"** : dès qu'un client (identifié par son slug) n'a plus aucune intervention active — suite à une suppression manuelle ou à l'effacement automatique du point 2 — un fichier `data/clients/{slug}.txt` est généré et chiffré avec le **mot de passe client courant** (jamais figé en dur), contenant `{contact, email_contact, appareils: []}`. Résout le problème où un client sans matériel en réparation recevait un message "Identifiant client ou fichier introuvable" indiscernable d'une erreur de mot de passe.
4. **Identifiant client visible** : le slug de connexion apparaît désormais sous chaque contact dans l'onglet Gestion clients ("Identifiant : {slug}"), pour que Phip puisse le communiquer facilement aux clients.

Vérifié par Playwright : purge d'une intervention "Livrée et testée" fictivement vieille de 100 jours + génération correcte du fichier vide chiffré ; test négatif confirmant qu'un client avec une 2ᵉ intervention encore active ne déclenche pas la génération du fichier vide à tort. Aucune erreur console.

### client-app — Évolutions de cette session

- **V1.03** : mailto de retour client fixé en dur sur `contact.technizen@gmail.com` (au lieu de l'email du client). Objet/corps du mail inchangés.
- Dates affichées au format français **JJ Mois AAAA** (ex: 31 Août 2026) au lieu du format ISO (2026-08-31), dans la liste comme dans le détail.
- Le message existant pour liste d'appareils vide ("Aucun matériel actuellement en réparation.") a été confirmé suffisant pour le fichier client vide — aucune modification nécessaire côté client-app pour ce point.

### Relais Cloudflare Workers (`worker/index.js`)

Inchangé cette session.

---

## 5. Sujets ouverts / évolutions à discuter

1. **Vérifier la 3ᵉ catégorie de statut** ("Réparation terminée") avec une vraie intervention dans cet état — non testé explicitement pendant la session (données démo n'avaient que 2 des 3 catégories représentées).
2. Recueillir un retour du client test sur le mailto corrigé et sur l'ergonomie globale.
3. Mode de fonctionnement de la base clients à trancher en équipe (préférence technicien / admin / bases indépendantes / synchro protégée) — toujours en suspens, sujet à raborder avec le patron.
4. Écran de comparaison à l'import TECHNIZEN (local vs importé) — toujours pas codé, non prioritaire (Phip a confirmé que l'écran d'import actuel lui convient tel quel).
5. Ne jamais rendre le dépôt `SAV-tech` privé sans upgrade payant (casserait GitHub Pages pour client-app).
6. Filtres opacimètre AT605/ECOPA100 — confirmés fonctionnels par Phip, sujet clos.

---

## 6. Repères pratiques utiles

- **Git qui refuse de pousser (branches divergentes)** : `git pull --no-rebase`, puis `git commit --no-edit` si un message de fusion s'ouvre, puis `git push`. Cas normal et fréquent, pas une erreur à corriger dans le code.
- **Vérifier qu'un push a bien été publié** : `git status`, ou comparer avec `https://github.com/Matrice971/SAV-tech/commits/main`.
- **Tester bureau-app/client-app sans serveur (`file://`)** : fonctionne, mais attention au cache navigateur (`Ctrl+Shift+R`) et au portail XDG qui peut servir une version périmée — préférer taper l'URL `file:///chemin/complet/index.html` directement.
- **Lancer via serveur local** : `python3 -m http.server 8000` depuis le dossier de l'appli, puis `http://localhost:8000/`.
- **Changer le mot de passe du relais** — 3 endroits à synchroniser : secret Cloudflare (`wrangler secret put WRITE_PASSWORD`), champ bureau-app (Configuration), champ TECHNIZEN (fenêtre d'envoi).
- **`wrangler deploy`** : nécessaire après toute modification de `worker/index.js` — un `git push` seul ne redéploie pas le worker.
- **Supprimer des fichiers sur GitHub en masse** : plus simple en local via `git rm fichier1 fichier2 ... && git commit -m "..." && git push`.
- **Adresse mail commune de retour client** : `contact.technizen@gmail.com` (Gmail), utilisée à la fois pour héberger les liens Drive clients et recevoir les retours via le mailto de client-app. Le lien "Vérifier les mails clients" dans bureau-app (`https://mail.google.com/mail/u/0/?authuser=...`) est spécifique à Gmail — à adapter si le fournisseur mail change un jour.
- **Vérifier le dossier Drive avant tout diagnostic** : comparer `modifiedTime` du fichier Drive avec l'heure attendue du dernier commit ; demander à Phip de resynchroniser sinon.

---

*Fin du résumé. Bonne continuation, Phip !*
