# Relais Cloudflare Workers — SAV-tech

Ce Worker est le seul composant du projet à détenir un token GitHub avec droit
d'écriture. Il expose un endpoint `POST /write` qui vérifie un mot de passe
puis écrit/met à jour un fichier dans `data/clients/` du dépôt
`Matrice971/SAV-tech`.

**Étape actuelle (test)** : un seul mot de passe global. L'authentification
par technicien viendra dans une étape ultérieure.

## Endpoint

`POST /write`

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

## 1. Configurer les variables d'environnement (secrets)

Deux secrets sont nécessaires. Ils ne doivent **jamais** être écrits dans le
code ni dans `wrangler.toml` — ils se configurent via la CLI Wrangler (ou le
dashboard Cloudflare) et restent chiffrés côté Cloudflare.

Depuis le dossier `worker/` :

```bash
wrangler secret put WRITE_PASSWORD
# → invite à saisir la valeur, ex : un mot de passe fort généré aléatoirement

wrangler secret put GITHUB_TOKEN
# → invite à saisir le token GitHub (voir génération ci-dessous)
```

Ces commandes peuvent aussi être faites sans CLI, via le dashboard
Cloudflare : **Workers & Pages → sav-tech-relay → Settings → Variables and
Secrets → Add** (type "Secret", pas "Text", pour ne pas les afficher en clair).

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
