# Chiffrement des fichiers clients — spécification

Ce document décrit le chiffrement des fichiers `.txt` dans `data/clients/`.
Il sert de référence commune entre l'appli client (JS / Web Crypto API) et le
programme de gestion (Python), pour garantir que les deux produisent et
lisent exactement le même format.

**Implémenté côté appli client** (`client-app/index.html`) et via le script
de test `docs/generer_fichier_test.py`. Le programme de gestion Windows
reproduira la même logique de chiffrement (section 5) dans un prompt
ultérieur.

**Algorithme retenu** : AES-GCM (chiffrement + authentification intégrée),
avec dérivation de clé PBKDF2 à partir du mot de passe client.

---

## 1. Structure des données (JSON avant chiffrement)

C'est ce JSON qui est chiffré pour produire le fichier `.txt` (section 2).

```json
{
  "contact": "Nom du contact/responsable de centre (identifiant fiable du regroupement client)",
  "appareils": [
    {
      "type": "Banc de frein",
      "num_serie": "BF-2024-0088",
      "centre_origine": "Centre Nord",
      "adresse": "12 rue Example, 97100 Basse-Terre",
      "etat": 2,
      "date_prise_charge": "2026-07-20",
      "lieu_prise_charge": "atelier",
      "piece_en_commande": true,
      "materiel_prete_num_serie": "PRET-0012",
      "commentaire_technicien": "Diagnostic en cours, pièce commandée",
      "date_remise_service": null
    }
  ]
}
```

**Pas de champ `photos`** : les photos restent exclusivement des données
locales, gérées côté technicien/gestion (stockage local, IndexedDB pour le
mode hors-ligne terrain). Elles ne sont **jamais** incluses dans le JSON
chiffré envoyé vers GitHub, pour deux raisons : taille de fichier (le dépôt
et le relais ne sont pas dimensionnés pour des binaires images) et
confidentialité (le dépôt est public — voir section 2 du résumé du projet).

**Règle d'affichage des appareils** (à documenter ici, pas encore implémentée
dans l'appli — l'étape actuelle affiche le JSON brut sans filtre) : un
appareil n'apparaît dans la liste que si `date_remise_service` est `null`,
ou si elle date de moins de 90 jours. Au-delà de 90 jours après
`date_remise_service`, l'appareil doit être filtré et ne plus apparaître.
Ce filtre sera implémenté côté appli client dans un prompt ultérieur, en
même temps que la vraie interface de liste.

---

## 2. Format du fichier chiffré

Le fichier `.txt` stocké dans `data/clients/` contient une seule chaîne,
structurée ainsi :

```
<salt_base64>.<iv_base64>.<ciphertext_base64>
```

- **salt** : 16 octets aléatoires, généré à la création du fichier, utilisé
  par PBKDF2 pour dériver la clé. Doit être stocké car il est nécessaire
  pour redériver la même clé à partir du mot de passe lors du déchiffrement.
- **iv** (vecteur d'initialisation) : 12 octets aléatoires, requis par
  AES-GCM. Généré à chaque écriture/chiffrement (jamais réutilisé avec la
  même clé).
- **ciphertext** : le JSON de données (voir structure en section 1) chiffré
  en AES-GCM. Le tag d'authentification GCM est
  inclus automatiquement à la fin du ciphertext par la Web Crypto API et par
  `cryptography`/`pycryptodome` côté Python — pas de champ séparé à gérer.

Chaque composant est encodé en Base64 pour rester dans un fichier texte
simple, séparés par un point (`.`) pour un parsing trivial des deux côtés.

---

## 3. Saisie et dérivation du mot de passe (côté client HTML)

1. L'utilisateur saisit son mot de passe dans un champ `<input type="password">`.
2. Le mot de passe n'est **jamais envoyé** où que ce soit — tout le
   déchiffrement se fait localement dans le navigateur.
3. Le salt est lu depuis le fichier téléchargé (premier segment avant le
   premier `.`).
4. La clé AES est dérivée avec PBKDF2 :
   - Fonction : `crypto.subtle.deriveKey`
   - Hash : SHA-256
   - Itérations : 100 000 (identique côté Python)
   - Sortie : clé AES-GCM 256 bits

Si le mot de passe est incorrect, la dérivation produira une mauvaise clé et
l'étape de déchiffrement (section 4) échouera avec une erreur
d'authentification GCM — c'est ce qui sert de vérification du mot de passe,
sans jamais avoir à le stocker ni le comparer explicitement.

---

## 4. Déchiffrement (Web Crypto API, navigateur)

1. Télécharger le fichier `.txt` via `fetch()` (comme pour `test.txt`
   aujourd'hui, mais avec un nom de fichier par client).
2. Découper la chaîne sur les `.` → `salt`, `iv`, `ciphertext`.
3. Décoder chaque partie de Base64 vers `Uint8Array`.
4. Dériver la clé (section 3) à partir du mot de passe saisi + salt.
5. Appeler `crypto.subtle.decrypt({ name: "AES-GCM", iv }, clé, ciphertext)`.
6. En cas de succès : parser le résultat comme JSON (structure en section 1).
   **Étape actuelle** : affichage du JSON brut formaté, sans liste ni filtre.
   La vraie interface de liste et le filtre des 90 jours (section 1) seront
   implémentés dans un prompt ultérieur.
7. En cas d'échec (exception levée par `decrypt`) : afficher un message
   « mot de passe incorrect », sans autre détail (ne pas distinguer
   « fichier corrompu » de « mauvais mot de passe » pour ne pas donner
   d'indice à un attaquant).

---

## 5. Chiffrement côté Python (programme de gestion)

Pour que les fichiers produits par le programme de gestion soient lisibles
par l'appli client (et vice versa), le code Python doit reproduire
exactement le même format :

1. Générer un salt aléatoire de 16 octets (`os.urandom(16)`).
2. Dériver la clé avec PBKDF2-HMAC-SHA256, même nombre d'itérations que côté
   JS (valeur à figer une fois, partagée dans le code des deux côtés — ne
   jamais la modifier sans mettre à jour les deux implémentations).
3. Générer un IV aléatoire de 12 octets (`os.urandom(12)`).
4. Chiffrer le JSON (encodé en UTF-8) avec AES-GCM (bibliothèque
   `cryptography`, `AESGCM` de `cryptography.hazmat.primitives.ciphers.aead`,
   ou équivalent `pycryptodome`).
5. Encoder `salt`, `iv` et `ciphertext` (tag GCM inclus) chacun en Base64.
6. Assembler la chaîne `salt.iv.ciphertext` et écrire le fichier `.txt`.
7. Envoyer ce contenu au relais Cloudflare Workers (`POST /write`) pour
   écriture dans `data/clients/` — le programme de gestion ne touche jamais
   directement au dépôt GitHub.

---

## 6. Paramètres figés

Ces valeurs sont identiques dans le JS (`client-app/index.html`) et le
Python (`docs/generer_fichier_test.py`) — ne pas les modifier d'un côté sans
les modifier de l'autre, sous peine de casser la compatibilité avec les
fichiers déjà chiffrés :

- Itérations PBKDF2 : 100 000
- Hash PBKDF2 : SHA-256
- Longueur de clé AES : 256 bits
- Longueur du salt : 16 octets
- Longueur de l'IV : 12 octets (standard pour AES-GCM)
- Séparateur des segments : `.` (absent de l'alphabet Base64 standard, donc
  sans ambiguïté au parsing)

---

## 7. Comment tester

Étapes pour valider le circuit complet chiffrement → écriture → lecture →
déchiffrement, de bout en bout :

1. **Générer un fichier chiffré de test** (depuis `docs/`) :

   ```bash
   pip install cryptography
   python3 generer_fichier_test.py
   ```

   Produit `test_chiffre.txt` dans le dossier courant, chiffré avec le mot
   de passe défini en haut du script (`motdepasse-test` par défaut).

2. **Envoyer ce fichier au relais Cloudflare**, pour qu'il écrase
   `data/clients/test.txt` avec le contenu chiffré :

   ```bash
   CONTENT=$(cat test_chiffre.txt)
   curl -X POST https://sav-tech-relay.matrice971.workers.dev/write \
     -H "Content-Type: application/json" \
     -d "{\"password\":\"<mot-de-passe-du-relais>\",\"filename\":\"test.txt\",\"content\":\"$CONTENT\"}"
   ```

   (`<mot-de-passe-du-relais>` est le `WRITE_PASSWORD` configuré côté
   Cloudflare — à ne pas confondre avec le mot de passe de chiffrement du
   client, qui sert à un tout autre usage.)

3. **Tester le déchiffrement dans l'appli client** : ouvrir
   `client-app/index.html`, saisir le mot de passe utilisé à l'étape 1
   (`motdepasse-test` par défaut) et cliquer sur "Valider". Le JSON déchiffré
   doit s'afficher. Un mot de passe incorrect doit afficher le message
   « Mot de passe incorrect ou fichier corrompu. ».
