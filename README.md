# SAV-tech

Système de suivi de réparations pour les centres de contrôle technique,
sans serveur ni base de données centralisée. Le dépôt GitHub sert à la fois
de stockage des fichiers d'échange et d'hébergement des applis web.

## Architecture — 3 composants

| | Appli client | Appli technicien (terrain) | Programme de gestion |
|---|---|---|---|
| **Rôle** | Consultation du statut de réparation (lecture seule) | Déclaration de prise en charge + suivi initial | Déclaration/modification complète, alimentation des statuts |
| **Format** | HTML | HTML | Windows — Python (tkinter) + PyInstaller |
| **Écriture vers GitHub** | Aucune | Oui — via relais sécurisé | Oui — via relais sécurisé |

**Sécurité des écritures** : aucune appli ne détient de token GitHub. Les
écritures passent toutes par un relais [Cloudflare Workers](worker/) qui est
seul à détenir le token GitHub et vérifie une authentification avant
d'écrire dans le dépôt.

**Lecture** : le dépôt étant public, l'appli client lit directement les
fichiers via `fetch()`, sans token ni relais.

## Structure du dépôt

- [`client-app/`](client-app/) — appli HTML client (lecture seule)
- [`technicien-app/`](technicien-app/) — appli HTML technicien terrain (écriture via relais)
- [`data/clients/`](data/clients/) — fichiers `.txt` chiffrés, un par client
- [`worker/`](worker/) — relais Cloudflare Workers (seul détenteur du token GitHub)
- [`docs/`](docs/) — documentation technique du projet

Pour le contexte complet du projet (objectifs, décisions, points ouverts),
voir [`projet_suivi_reparations_resume.md`](projet_suivi_reparations_resume.md).
