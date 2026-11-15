# Relais Cloudflare Workers — SAV-tech

Ce Worker est le seul composant du projet à détenir un token GitHub avec droit
d'écriture. Il expose un endpoint `POST /write` qui vérifie un mot de passe
puis écrit/met à jour un fichier dans `data/clients/` du dépôt
`Matrice971/SAV-tech`.

**Étape actuelle (test)** : un seul mot de passe global. L'authentification
par technicien viendra dans une étape ultérieure.

## Endpoints

### `POST /write`

Corps JSON attendu :

```json
{
  "password": "le-mot-de-passe",
  "filename": "client-12345.txt",
  "content": "contenu texte du fichier"
}
```

- `filename` doit être un nom simple : lettres/chiffres/`-`/`_` + extension `.txt` (pas de `/`, pas de `..`).
- Réponse succès : `{ "success": true, "filename": "...", "path": "data/clients/..." }`
- Réponse erreur : `{ "success": false, "error": "..." }` avec un code HTTP approprié (400/401/500/502).

### `POST /kdrive-upload`

Reçoit un PDF (base64) depuis technizen-app, crée l'arborescence de dossiers
manquante sur le kDrive configuré puis y dépose le fichier. Même mot de passe
partagé que `/write` (`WRITE_PASSWORD`).

Corps JSON attendu :

```json
{
  "password": "le-mot-de-passe",
  "path": ["Jean Dupont", "AFG Auto Controle", "09_2026"],
  "filename": "Fiche_OBD-AFGAutoControle-240926.pdf",
  "contentBase64": "JVBERi0xLjQK..."
}
```

- `path` : tableau de noms de dossiers (créés automatiquement s'ils n'existent pas encore), du plus haut niveau au plus bas — partent toujours de la racine du kDrive.
- `filename` : lettres/chiffres/`-`/`_` + extension `.pdf` ou `.json` (exports technizen-app).
- Réponse succès : `{ "success": true, "path": "Jean Dupont/AFG Auto Controle/09_2026/Fiche_OBD-....pdf" }`
- Réponse erreur : `{ "success": false, "error": "..." }`.
- Sans `versionContrat` (technizen-app) : un fichier du même nom déjà présent est
  **remplacé** (`conflict=version` de l'API kDrive) — une fiche corrigée et
  réexportée écrase la précédente (depuis technizen V11.28, octobre 2026).
- `versionContrat` (optionnel, utilisé par contrat-app) : si `true`, le 1er dépôt
  garde le nom demandé et n'est plus jamais modifié ; tout dépôt suivant du même
  nom va dans `<nom>_V2.pdf` (créé la 1re fois, écrasé ensuite). La réponse
  contient alors aussi `filename` (nom réellement déposé) et `version` (`1` ou `2`).

### `POST /kdrive-gnetdata` (technizen V11.29)

`{ "password", "path": ["Drive_Client", "<Responsable>", "<Client>"], "serie": "0799" }` → dernier `GNETDATA*.txt` du régloscope (ligne 5 = série, ligne 17 = date de dernière maintenance) dans le dossier client ou un dossier de visite juste en dessous. Seule lecture autorisée dans `Drive_Client`, limitée à ces fichiers. Réponse `{ success, trouve, dossier, fichier, derniereMaintenance, contentBase64 }` ou `{ success: true, trouve: false, raison }`. `/kdrive-upload` accepte en plus `GNETDATA<…>.txt`.

### `POST /kdrive-list` et `POST /kdrive-download` (lecture)

Utilisés par la modale Import/Export de technizen-app (depuis v11.23) pour les
imports automatiques. Même mot de passe que les autres routes. **Limités au
sous-arbre `Appli TECHNIZEN/Exports/...`** (`EXPORTS_RACINE`) : tout autre
chemin (ex. `Drive_Client`) est refusé (403). Ne créent jamais de dossier.

```json
{ "password": "le-mot-de-passe", "path": ["Appli TECHNIZEN", "Exports", "Visites"] }
```

- `/kdrive-list` → `{ "success": true, "fichiers": [{ "name", "size", "modifie" }] }` (fichiers seulement ; dossier absent = liste vide).
- `/kdrive-download` (+ `"filename": "Export_Visite_....json"`, `.json` uniquement) → `{ "success": true, "filename", "contenu": "<texte du fichier>" }` ; 404 si absent. Utilise l'API Infomaniak `GET /2/drive/{id}/files/{fileId}/download`.

### `POST /depot-clients`, `/depot-upload`, `/depot-liste`, `/depot-telecharger` (Dépôt Drive, depot-app)

Utilisés par `depot-drive.html` (clé USB, PC du client). Authentification par
le **jeton de dépôt** (`DEPOT_TOKEN`), jamais par `WRITE_PASSWORD` : le jeton
est intégré au fichier compilé, personne n'a rien à taper.

- `/depot-clients` : `{ "jeton": "..." }` → `{ "success": true, "base": { "auteur", "dateTexte" }, "clients": [{ "nom", "contact", "ville", "numero" }] }`
  — clients actifs du dernier `Export_Base_*.json` de `Appli TECHNIZEN/Exports/Base`, réduits à ces 4 champs.
- `/depot-upload` : `{ "jeton", "path": ["Drive_Client", "<Responsable>", "<Client>", "<Mois Année>"], "filename", "contentBase64" }`
  — `.pdf`, `.xps` ou `.zip` uniquement ; mois au format technizen (`Nov 2026`, `Févr 2027`…) ;
  le couple Responsable/Client doit exister dans le dernier export de la base (403 sinon). Fichier du même nom remplacé.

- `/depot-liste` : `{ "jeton", "path": [...4 segments] }` → `{ "success": true, "fichiers": [{ "name", "size", "modifie" }] }`
  — PDF du dossier de visite (depot-app V1.02).
- `/depot-telecharger` : `{ "jeton", "path", "filename" }` → `{ "success": true, "filename", "contentBase64" }`
  — le nom doit être celui d'un PDF listé dans ce dossier (jamais utilisé comme chemin).

Lecture limitée au dossier du **mois en cours** (heure de la Guadeloupe,
`moisEnCoursGuadeloupe`), d'un client présent dans le dernier export de la
base, PDF uniquement, et sans suppression ni modification. Un autre mois est
refusé (403).

Le jeton ne donne accès à rien d'autre (ni visites passées, ni exports, ni `/kdrive-upload`).

**Clé USB perdue ou jeton à changer** : voir `apps/depot-app/README.md`, section « Changer le jeton ».

### `POST /mails-non-lus` (bureau-app V5.32, 08/11/2026)

Corps : `{ "password": WRITE_PASSWORD }`. Le relais lit la boîte de réception Infomaniak en
IMAP (`mail.infomaniak.com:993`, TLS) et l'ouvre en lecture seule (`EXAMINE`, `BODY.PEEK`) :
**aucun mail n'est marqué comme lu**. Réponse : `{ success, nonLus, mails: [{ uid, de, adresse,
objet, date }], verifieLe }`, avec les 30 plus récents au plus. Le contenu des mails et les pièces jointes ne sont jamais renvoyés.

Secrets nécessaires (type **Secret** sur le dashboard) :
- `MAIL_USER` = `direction.technizen@etik.com` (l'alias clients `contact.technizen@ikmail.com`
  arrive dans cette même boîte) ;
- `MAIL_PASSWORD` = **mot de passe d'application** Infomaniak (la double authentification est
  active, donc jamais le mot de passe du compte).

Erreurs : 401 si le mot de passe relais est faux, 503 si les secrets mail manquent, 502 si la boîte refuse la connexion ou ne répond pas dans les 20 s.
Le code utilise `import { connect } from "cloudflare:sockets"`, accepté tel quel par l'éditeur du dashboard.

## 1. Configurer les variables d'environnement (secrets)

Quatre secrets sont nécessaires au total. Ils ne doivent **jamais** être
écrits dans le code ni dans `wrangler.toml` — ils se configurent via le
dashboard Cloudflare (ou la CLI Wrangler) et restent chiffrés côté Cloudflare.

**Sans CLI (recommandé si vous n'êtes pas à l'aise avec un terminal)**, tout se
fait depuis le dashboard :

1. Va sur [dash.cloudflare.com](https://dash.cloudflare.com) et connecte-toi.
2. Dans le menu de gauche, clique sur **Workers & Pages**.
3. Clique sur le Worker **sav-tech-relay**.
4. Onglet **Settings** → section **Variables and Secrets** → **Add**.
5. Ajoute chacune des 4 lignes ci-dessous, une par une, en choisissant bien le type **"Secret"** (pas "Text") pour que la valeur ne s'affiche jamais en clair ensuite :

| Nom de la variable | Valeur |
|---|---|
| `WRITE_PASSWORD` | un mot de passe fort choisi (le même sert pour `/write` et `/kdrive-upload`) |
| `GITHUB_TOKEN` | le token GitHub généré à l'étape 2 ci-dessous |
| `KDRIVE_API_TOKEN` | le token Infomaniak (scope "drive") généré depuis [manager.infomaniak.com](https://manager.infomaniak.com/v3/ng/profile/user/token/list) |
| `KDRIVE_ID` | l'identifiant numérique du kDrive cible (visible dans son URL, ex. `.../drive/4085333/...` → `4085333`) |
| `DEPOT_TOKEN` | le contenu de `apps/depot-app/jeton-depot.txt` (jeton de Dépôt Drive, ajouté le 04/11/2026) |

6. Clique sur **Deploy** (ou "Save and deploy") pour appliquer.

**Avec la CLI Wrangler** (si vous préférez), depuis le dossier `worker/` :

```bash
wrangler secret put WRITE_PASSWORD
wrangler secret put GITHUB_TOKEN
wrangler secret put KDRIVE_API_TOKEN
wrangler secret put KDRIVE_ID
wrangler secret put DEPOT_TOKEN   # coller le contenu de apps/depot-app/jeton-depot.txt
```

## 2. Générer le token GitHub

Créer un **fine-grained personal access token** (pas un token classique) :

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. **Repository access** : "Only select repositories" → `Matrice971/SAV-tech`
3. **Permissions** → **Repository permissions** → `Contents` → **Read and write**
   (aucune autre permission n'est nécessaire)
4. Définir une expiration raisonnable (à renouveler périodiquement)
5. Copier le token généré et le coller dans `wrangler secret put GITHUB_TOKEN`

## 3. Déployer le Worker

Prérequis : Node.js installé, puis :

```bash
npm install -g wrangler   # si pas déjà installé
wrangler login             # ouvre le navigateur pour lier le compte Cloudflare
```

Depuis le dossier `worker/` :

```bash
wrangler deploy
```

Wrangler affiche l'URL du Worker déployé (ex :
`https://sav-tech-relay.<ton-sous-domaine>.workers.dev`). C'est cette URL que
les applis technicien/gestion utiliseront pour appeler `POST /write`.

## 4. Tester

```bash
curl -X POST https://sav-tech-relay.<ton-sous-domaine>.workers.dev/write \
  -H "Content-Type: application/json" \
  -d '{"password":"le-mot-de-passe","filename":"test.txt","content":"hello"}'
```

Vérifier ensuite que le fichier `data/clients/test.txt` apparaît bien dans le
dépôt GitHub.
