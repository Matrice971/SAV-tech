# Chiffrement des fichiers clients — spécification (étape B, pas encore implémentée)

Ce document décrit comment le chiffrement des fichiers `.txt` dans
`data/clients/` fonctionnera une fois implémenté. Il sert de référence
commune entre l'appli client (JS / Web Crypto API) et le programme de
gestion (Python), pour garantir que les deux produisent et lisent
exactement le même format.

**Algorithme retenu** : AES-GCM (chiffrement + authentification intégrée),
avec dérivation de clé PBKDF2 à partir du mot de passe client.

---

## 1. Format du fichier chiffré

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
- **ciphertext** : le JSON de données (voir structure dans le résumé du
  projet, section 6) chiffré en AES-GCM. Le tag d'authentification GCM est
  inclus automatiquement à la fin du ciphertext par la Web Crypto API et par
  `cryptography`/`pycryptodome` côté Python — pas de champ séparé à gérer.

Chaque composant est encodé en Base64 pour rester dans un fichier texte
simple, séparés par un point (`.`) pour un parsing trivial des deux côtés.

---

## 2. Saisie et dérivation du mot de passe (côté client HTML)

1. L'utilisateur saisit son mot de passe dans un champ `<input type="password">`.
2. Le mot de passe n'est **jamais envoyé** où que ce soit — tout le
   déchiffrement se fait localement dans le navigateur.
3. Le salt est lu depuis le fichier téléchargé (premier segment avant le
   premier `.`).
4. La clé AES est dérivée avec PBKDF2 :
   - Fonction : `crypto.subtle.deriveKey`
   - Hash : SHA-256
   - Itérations : au moins 100 000 (valeur exacte à figer à l'implémentation,
     identique côté Python)
   - Sortie : clé AES-GCM 256 bits

Si le mot de passe est incorrect, la dérivation produira une mauvaise clé et
l'étape de déchiffrement (section 3) échouera avec une erreur
d'authentification GCM — c'est ce qui sert de vérification du mot de passe,
sans jamais avoir à le stocker ni le comparer explicitement.

---

## 3. Déchiffrement (Web Crypto API, navigateur)

1. Télécharger le fichier `.txt` via `fetch()` (comme pour `test.txt`
   aujourd'hui, mais avec un nom de fichier par client).
2. Découper la chaîne sur les `.` → `salt`, `iv`, `ciphertext`.
3. Décoder chaque partie de Base64 vers `Uint8Array`.
4. Dériver la clé (section 2) à partir du mot de passe saisi + salt.
5. Appeler `crypto.subtle.decrypt({ name: "AES-GCM", iv }, clé, ciphertext)`.
6. En cas de succès : parser le résultat comme JSON (structure des
   appareils, voir résumé projet section 6) et afficher la liste.
7. En cas d'échec (exception levée par `decrypt`) : afficher un message
   « mot de passe incorrect », sans autre détail (ne pas distinguer
   « fichier corrompu » de « mauvais mot de passe » pour ne pas donner
   d'indice à un attaquant).

---

## 4. Chiffrement côté Python (programme de gestion)

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

## 5. Paramètres à figer avant l'implémentation

Ces valeurs doivent être identiques dans le JS et le Python — à définir une
fois pour toutes lors de l'implémentation de cette étape :

- Nombre d'itérations PBKDF2 (proposition : 100 000 minimum)
- Longueur de clé AES (256 bits)
- Longueur du salt (16 octets) et de l'IV (12 octets, standard pour GCM)
- Encodage de séparation des segments (`.` proposé, à confirmer qu'aucun
  caractère Base64 standard ne peut le produire — c'est le cas, Base64
  standard n'utilise pas `.`)
