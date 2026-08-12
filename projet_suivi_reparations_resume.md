# Résumé projet — Appli de suivi de réparations (client + technicien + gestion)

*Document de reprise — dernière mise à jour : 12/08/2026*

---

## 1. Objectif général

Donner à chaque client (71 centres de contrôle technique) un accès en ligne, simple et sécurisé, au suivi d'avancement des réparations de leur matériel — sans serveur ni base de données centralisée, dans la continuité de l'approche déjà utilisée pour TECHNIZEN. Objectif secondaire assumé : professionnaliser le service pour se démarquer de la concurrence (secteur où tout le monde se connaît et se sait déjà en concurrence sur les mêmes clients).

**Décision de gouvernance** : le collaborateur hiérarchique consulté laisse Phip libre du choix ("il trouve cela inutile"), comme pour TECHNIZEN à l'époque — projet qui est aujourd'hui utilisé au quotidien. Phip poursuit donc sur sa vision.

---

## 2. Dépôt du projet

- **GitHub créé** : github.com/Matrice971/sav.tech (dépôt public, "sav technizen")
- **Reste public volontairement** : la confidentialité des données matériel n'est pas jugée critique dans ce secteur (concurrents et clients partagent déjà largement l'information). La protection réelle repose sur le **chiffrement des fichiers clients**, pas sur la confidentialité du dépôt.
- Sert à la fois de stockage des fichiers d'échange et d'hébergement de l'appli client via **GitHub Pages**.

---

## 3. Architecture générale — 3 applications distinctes

| | Appli client | Appli technicien (terrain) | Programme de gestion |
|---|---|---|---|
| **Rôle** | Consultation statut uniquement | Déclaration prise en charge + suivi initial | Déclaration/modification complète, alimentation statuts |
| **Utilisateurs** | Clients (71 centres) | Techniciens en intervention | Phip / collègue / secrétaire |
| **Format** | HTML (page web) | HTML (page web) | Windows — Python (tkinter) + PyInstaller |
| **Plateforme** | Tout support, tout OS (mobile + PC) | Mobile/PC terrain, connexion instable | PC Windows fixe (bureau) |
| **Hébergement** | GitHub Pages (dépôt sav.tech) | GitHub Pages ou fichier local à trancher | Local, installé sur PC pro/perso |
| **Accès** | Mot de passe par client | Identifiant + mot de passe technicien | Libre (usage interne bureau) |
| **Écriture vers GitHub** | Aucune (lecture seule) | Oui — via relais sécurisé | Oui — via relais sécurisé |

---

## 4. Sécurité des écritures vers GitHub — point technique central

**Problème identifié** : un token GitHub avec droits d'écriture ne doit **jamais** être intégré en clair (ni même chiffré côté client) dans une appli HTML — il serait récupérable via les outils développeur du navigateur, donnant un accès complet en lecture/écriture à tout le dépôt.

**Solution retenue** : un **service intermédiaire (relais)**, probablement **Cloudflare Workers** (gratuit pour ce volume d'usage), qui :
- Détient seul le token GitHub, jamais exposé au navigateur
- Reçoit de l'appli technicien/gestion : identifiant + mot de passe + données à écrire
- Vérifie l'authentification, puis effectue lui-même l'écriture réelle vers GitHub

**S'applique aux deux** : appli technicien terrain **et** programme de gestion Windows — aucun accès direct au token, pour cohérence et sécurité sur toute la ligne (même le programme de gestion, utilisé aussi par le collègue et la secrétaire, passe par ce relais).

**Lecture** : ne nécessite aucun token — dépôt public, fetch() simple suffit (utilisé par l'appli client).

---

## 5. Chiffrement des fichiers clients

- **Algorithme** : AES-GCM + dérivation de mot de passe via PBKDF2
- **Compatibilité native des deux côtés** : Web Crypto API (JS, tous navigateurs y compris Safari desktop/mobile) et librairie Python (cryptography ou pycryptodome) côté gestion
- **Format du fichier** : .txt, IV + données chiffrées encodées en Base64
- **Un fichier par client** (isolation — pas de fichier global pour les 71 centres), nommé avec un identifiant opaque (pas de nom devinable)

---

## 6. Structure des données — statut de réparation

**4 états d'avancement retenus** ("pièce en commande" est un champ annexe de l'état 2, pas un état séparé) :
1. Prise en charge (site/atelier) — date
2. En attente de pièce — date + pièce commandée (oui/non)
3. Réparation en cours — date
4. Matériel livré et testé — date

Seuls les appareils **pris en charge** (pas encore livrés) apparaissent sur l'écran d'accueil client.

**Exemple de structure JSON (avant chiffrement)** :

```json
{
  "compte_client": "12345",
  "appareils": [
    {
      "type": "Banc de frein",
      "num_serie": "BF-2024-0088",
      "centre": "Centre Contrôle Nord",
      "adresse": "...",
      "etat": 2,
      "date_etat": "2026-07-25",
      "piece_en_commande": true,
      "description_panne": "...",
      "pieces_montees": ["..."],
      "pieces_a_prevoir": ["..."],
      "photos": ["..."]
    }
  ]
}
```

---

## 7. Appli client (HTML)

- Une appli par client, lien Drive/GitHub du client en dur dans le code (ou paramètre d'URL si hébergement en ligne)
- Demande le mot de passe → déchiffre le fichier → affiche la liste des appareils pris en charge :
  - Nom du centre + adresse
  - Type de matériel + n° de série
- Clic sur un appareil → détail de son état d'avancement
- Doit fonctionner identiquement sur mobile (iOS/Android) et PC (tout navigateur, y compris Safari)
- **Hébergement en ligne retenu** (GitHub Pages) plutôt que fichier local distribué, pour résoudre les limitations de fetch() en file:// sur mobile

---

## 8. Appli technicien terrain (HTML) — fonctionnalités détaillées

- **Authentification** : identifiant + mot de passe technicien
- **Sélecteurs** client + matériel, sur le modèle de l'appli TECHNIZEN existante
- **Nouvelle prise en charge** :
  - Description de la panne
  - Ajout de photo(s) — **à compresser/redimensionner automatiquement avant stockage** pour limiter la taille des fichiers
  - Pièces déjà montées / pièces à prévoir (champs texte libres)
- **Client occasionnel (garage) / matériel hors base** :
  - Saisie libre simple (texte), sans structure complexe
  - **Pas de suivi après intervention, pas d'accès client, pas de synchronisation vers une fiche permanente** — ces clients sont déjà gérés manuellement en dehors du système, la mention sert uniquement de traçabilité de l'intervention
- **Mode hors-ligne obligatoire** : le technicien travaille souvent plusieurs semaines sur d'autres îles sans connexion fiable
  - Enregistrement local (navigateur — IndexedDB envisagé pour gérer les photos)
  - Synchronisation vers GitHub (via le relais) dès qu'une connexion redevient disponible, automatique ou via bouton "synchroniser"
- **Écriture vers GitHub** : jamais directe, toujours via le relais Cloudflare Workers (voir section 4)

---

## 9. Programme de gestion (Windows, Python/PyInstaller)

### Rôle
- Déclare/modifie les prises en charge
- Alimente les statuts de réparation en continu
- Utilisé par Phip, le collègue, et la secrétaire (donc pas d'accès direct au token — passe par le relais comme l'appli terrain)

### Structure de base déjà cadrée précédemment
- Chemin de stockage local **configurable** via une commande dans l'appli
- Bouton de fermeture en haut à droite → déclenche l'export/sauvegarde
- **Import base clients/matériel** : boîte de dialogue, depuis un export TECHNIZEN
- **Import base techniciens intervenants** : également depuis un export TECHNIZEN
- **Fichier de sauvegarde interne** (suivi de travail, différent du fichier client) :
  - Pas de chiffrement (usage interne uniquement)
  - Nom horodaté au format français : hh-mm__jj-mm-aa__data-repar.txt
  - Chargement manuel via boîte de dialogue ouvrant dans le dossier configuré
  - Sauvegarde automatique vers ce dossier
  - Synchronisation entre machines (PC pro/perso) via dossier cloud synchronisé (Drive/Dropbox/Nextcloud — **outil final à trancher selon rapidité de synchro**)
  - Suppression des anciens fichiers : manuelle
  - Risque connu : écrasement possible si une machine charge une version non à jour avant synchro complète — géré par discipline de travail, pas de fusion automatique prévue

### Interface de saisie
- Menu sélection client → menu sélection matériel → validation
- Écran de saisie des 4 états + dates (+ champs panne/pièces/photos si alimentés depuis la gestion aussi)
- Export du fichier client chiffré, avec chemin suggéré affiché à l'écran

---

## 10. Points tranchés au fil des sessions

- Fichier par client (isolation sécurité), nom opaque, format .txt
- Chiffrement AES-GCM + PBKDF2, compatible Web Crypto API (JS) et Python
- Dépôt GitHub public assumé — chiffrement suffisant, pas besoin de dépôt privé
- Programme de gestion en Python/PyInstaller (accès disque direct, pas de restriction navigateur)
- Chemin de sauvegarde technicien (gestion) : configurable, pas fixe
- Synchronisation entre machines de gestion : dossier cloud automatique (pas de clé USB manuelle)
- Écriture vers GitHub : jamais de token direct côté client/terrain — toujours via relais (Cloudflare Workers)
- Clients occasionnels/garages : traçabilité simple uniquement, aucun suivi ni accès portail
- Photos autorisées côté terrain, avec compression nécessaire pour maîtriser la taille des fichiers
- Odoo (ERP) évalué et écarté pour ce besoin précis : Field Service exclu du plan gratuit "Une App Gratuite", nécessite une licence Enterprise payante ; solution jugée surdimensionnée et dépendante d'une connexion fiable, incompatible avec le travail terrain sur zones peu connectées

---

## 11. Points encore ouverts

1. **Hébergement de l'appli technicien terrain** : GitHub Pages (comme l'appli client) ou distribution locale — à trancher en fonction du besoin hors-ligne
2. **Choix final Google Drive / Dropbox / Nextcloud** pour la synchro du dossier de gestion entre machines
3. **Alignement du format d'export TECHNIZEN** avec les champs attendus par la nouvelle appli (clients, matériel, ET techniciens intervenants)
4. **Mise en place concrète du relais Cloudflare Workers** (configuration, authentification technicien/gestion côté relais)
5. **Gestion du stockage local des photos en mode hors-ligne prolongé** (plusieurs semaines sans connexion) — capacité, nettoyage après synchro réussie

---

## 12. Découpage prévu des prompts pour Claude Code

Le nombre de prompts va probablement augmenter par rapport à l'estimation initiale (3), compte tenu de l'ajout du relais Cloudflare, du mode hors-ligne, et des photos. Prompts envisagés à ce stade :

- **Prompt 1** — Appli client HTML : mot de passe → déchiffrement AES-GCM → liste appareils → détail état
- **Prompt 2** — Relais Cloudflare Workers : réception identifiant/mot de passe + données, vérification, écriture sécurisée vers GitHub
- **Prompt 3** — Appli technicien terrain HTML : authentification, sélecteurs, formulaire prise en charge (panne, photos compressées, pièces), client occasionnel, mode hors-ligne + sync
- **Prompt 4** — Programme de gestion Windows, structure de base : config chemin, import TECHNIZEN (clients + techniciens), chargement/sauvegarde horodatée, écriture vers relais
- **Prompt 5** — Programme de gestion Windows, interface de saisie : sélection client/matériel → saisie des 4 états → déclaration/modification prise en charge

*(Ce découpage sera affiné une fois les points ouverts de la section 11 tranchés.)*

---

*Fin du résumé — reprendre au point 11 (points ouverts) à la prochaine session.*
