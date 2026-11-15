# Résumé projet — SAV-tech + TECHNIZEN

*Document de reprise — mise à jour du 13/09/2026*
*À partager en tout premier message d'une nouvelle conversation.*

---

## 0. À LIRE EN PREMIER — où on en est

Grosse session, deux chantiers principaux :
1. **TECHNIZEN** : corrections de fiches (retours terrain semestrielles), refonte du calcul des tolérances opacimètre/gaz, nettoyage de l'en-tête, mécanisme de fusion à l'import/export de base.
2. **SAV-tech / bureau-app** : deux nouveaux onglets ("Semestrielles" et "VP") pour que l'opérateur bureau suive à distance l'avancement des contrôles terrain, alimentés par un nouvel export TECHNIZEN.

**États des versions à la fin de cette session** :
- **TECHNIZEN (index.html)** : **V10.57**
- **bureau-app** : **V5.00** (bond de version demandé explicitement par Phip après l'ajout des onglets Semestrielles + VP, plutôt qu'une continuité 4.04→4.05→4.06)
- **client-app** : inchangé, V2.04 (voir résumé de session précédente)

**⚠️ Point bloquant à traiter en priorité à la prochaine session** : les onglets "Semestrielles" et "VP" de bureau-app tournent sur un **schéma de fichier supposé**, jamais confirmé face à un vrai export TECHNIZEN — le prompt qui doit générer réellement ce fichier côté TECHNIZEN (export `exporterVisites()` incluant `derniereVisite` et surtout `prochaineVP`) a été discuté et scopé en détail dans cette session, mais **le prompt de capture des dates de VP n'a pas encore été envoyé à Claude Code** (Phip a d'abord traité le second prompt, celui de bureau-app). Sans ce premier prompt, le champ `prochaineVP` restera vide dans tous les exports réels, et l'onglet "VP" affichera tout en "❌ Aucune VP" par manque de donnée, pas par bug. Le prompt exact à envoyer est détaillé en section 4.

**Autre point ouvert** : l'exploration d'une architecture de remplacement de Google Drive/GitHub par des solutions souveraines (Infomaniak kDrive, Codeberg) — voir section 6, rien d'implémenté, au stade du plan validé.

---

## 1. Où trouver le code

- **TECHNIZEN** : dépôt Git séparé, racine = `index.html` + `src/js/app.js` + `src/js/database.js`. `PROJET_ETAT.md` + `PROJET_HISTORIQUE.md` à la racine. `CLAUDE.md` impose l'incrémentation automatique de version.
- **SAV-tech** : dépôt GitHub `Matrice971/SAV-tech`, **public**, branche `main` uniquement. Structure : `client-app/`, `bureau-app/`, `worker/`, `docs/`. `CLAUDE.md` à la racine, incrémentation automatique de version.
- **Dossier Drive partagé** `SAV-tech-TECHNIZEN/` (https://drive.google.com/drive/folders/1EpWKf830vg-LVZc4jDyjNtsen6oI0IiX) : copie miroir pour lecture par Claude (chat), avec sous-dossiers `Capture d'écran/`, `image/` (pictogrammes), `resume/`. **Attention** : cette copie s'est révélée plusieurs fois périmée cette session (jusqu'à plusieurs jours de retard) — privilégier l'envoi direct en pièce jointe dans le chat pour tout fichier de code à faire lire par Claude, la lecture Drive n'est fiable que pour du texte simple après confirmation explicite que la resynchro vient d'être faite.
- Tout le travail se fait directement sur la branche `main`, dans les deux dépôts.
- **Astuce** : `search_files` avec `fullText contains 'nomFonction' and title = 'nomFichier'` pour vérifier la présence d'une fonction sans tout décoder.

---

## 2. Architecture — vue d'ensemble mise à jour

```
TECHNIZEN (technicien, terrain, hors-ligne)
    │
    ├─ Fiches de contrôle semestriel (Opacimètre, Gaz, Pont, Régloscope, etc.)
    │   → historique local (chargerHistoriqueVisites, rétention 3 ans)
    │
    ├─ Rapport semestriel → coche Pollution/Pollution 2, saisit VP Poll.1/VP Poll.2
    │   (mois/année lus sur l'étiquette verte de l'appareil)
    │   ⚠️ capture de cette donnée PAS ENCORE implémentée (voir section 0 et 4)
    │
    ├─ "Export visite" (bouton en-tête) → fichier JSON technizen_visites_{préfixe}_{JJMMAA}.json
    │   contient clients + équipements (actif/inactif, dernière visite, à terme prochaineVP)
    │   → transfert MANUEL (clé USB, mail...) vers le poste bureau
    │
    ├─ "Export/Import base" (fusion intelligente, clé = n° de compte client)
    │   → synchronisation manuelle entre postes techniciens (toi / Raymond)
    │
    └─ Fiche standard / Fiche HC — envoi vers SAV-tech (inchangé, via relais Cloudflare)
    ▼
data/interventions/*.txt (GitHub, non chiffré, via relais Cloudflare /write)
    ▼
bureau-app (onglets : Suivi réparation / Gestion clients / Suivi prêt /
            Historique / Configuration / Semestrielles [NOUVEAU] / VP [NOUVEAU])
    │
    ├─ Onglets Semestrielles + VP : alimentés par import MANUEL du fichier
    │   technizen_visites_*.json (indépendant du canal GitHub/relais ci-dessus)
    │
    └─ Reste de bureau-app inchangé (chaîne "visite programmée" vers client-app,
       voir résumés antérieurs)
    ▼
data/clients/{contact-slug}.txt (GitHub, chiffré) → client-app
```

---

## 3. TECHNIZEN — évolutions de cette session (V10.44 → V10.57)

Dans l'ordre chronologique :

1. **Case "Contrôle plombage et marquage réglementaire"** ajoutée sur les fiches Opacimètre et Analyseur de gaz, juste après "Transmission informatique (liaison OTC-LAN) fonctionnelle".
2. **Signature technicien** sur Opacimètre/Gaz : remplacement d'un canevas de signature manuelle (bug d'implémentation initiale) par le mécanisme standard déjà utilisé sur les autres fiches (signature du technicien connecté, insérée directement).
3. **Fiche Régloscope — saisie négative** : bouton +/- ajouté à côté de "Inclinaison pente de zone" (le clavier tactile Android n'exposait pas de "-").
4. **Refonte complète des tolérances Opacimètre** (méthode officielle CAPELEC, remplace l'ancien système à tolérance fixe par filtre) :
   - 5 filtres de référence répartis en 2 groupes : 2 filtres "plage basse" (0,1-0,5 m⁻¹), 3 filtres "plage haute" (0,5-5 m⁻¹).
   - **Exactitude** = moyenne des erreurs absolues des 5 filtres, limite fixe ≤ 0,15 m⁻¹.
   - **Linéarité** = écart max-min des erreurs, calculée séparément par groupe : ≤ 0,1 m⁻¹ (plage basse), ≤ 0,3 m⁻¹ (plage haute).
   - Logique générique, vérifiée fonctionnelle pour les 3 modèles d'opacimètre (AT605, CAP3030-4+S, ECOPA100) sans modification nécessaire.
5. **Fiche opacimètre — ligne "Flux d'air"** : remplacée par une case à cocher "Contrôle Flux d'air".
6. **Tolérances réglementaires Analyseur de gaz** : logique CO/CO2/O2/HC avec tolérance = max(valeur absolue configurable, pourcentage configurable de la valeur bouteille), 8 valeurs de configuration (4 absolues + 4 pourcentages) unifiées pour toutes les bouteilles, dans "Gestion des techniciens". Tolérance jamais affichée sur la fiche d'intervention elle-même (seulement bouteille + mesure).
7. **Fiche gaz — champ "Etat sonde O2"** : passé de pourcentage (défaut 60%, rouge si <50%) à **mV**, plage 0-15, sans valeur par défaut, sans code couleur.
8. **Fiche gaz — libellé** : "Contrôle du dispositif de décantation" → "test d'étanchéité réussi".
9. **Titres bancs corrigés** (fiches utilisées pour plusieurs modèles) : Capelec "CAP9020" → "CAP90XX", Muller "XG-VL" → "BANC".
10. **Bug export PDF Android — titre banc Muller** : "FICHE D'ETALONNAGEBANC" (espace disparu) uniquement sur tablette Android, pas sur PC — à vérifier/corriger (prompt envoyé, résultat non confirmé dans cette conversation).
11. **Pictogrammes** ajoutés en haut à droite des fiches Opacimètre (`src/img/opa.png`) et Analyseur de gaz (`src/img/gaz.png`), même style que Pont/Régloscope.
12. **Titres agrandis** (×1,5, pas ×2 finalement) sur les 9 fiches "Contrôle semestrielle" ; bancs et Rapport semestriel inchangés.
13. **Statut actif/inactif par équipement** : un équipement inactif n'est plus exigé pour valider un client ; réactivable ; suppression réservée aux équipements inactifs.
14. **Visite automatique à l'ajout d'un équipement** : un nouvel équipement est marqué "visité" à la date du jour (pas de champ "mise en service" séparé).
15. **Fenêtre réglementaire clarifiée et harmonisée à 4-8 mois** (6 mois ± 2) pour tous les équipements de la visite semestrielle, y compris bancs/manomètres (suivi global) — seuil unique `DELAI_VALIDITE_MOIS = 8`, plus de divergence possible entre le résumé détaillé et le badge global (bug corrigé). Affichage informatif (non bloquant) de la fenêtre 4-8 mois par équipement dans "Gestion clients".
    - ⚠️ **Distinct de la VP** (Vérification Périodique, annuelle, Opacimètre/Gaz uniquement, saisie sur le Rapport semestriel — voir section 0 et 4, capture pas encore implémentée).
16. **Fusion intelligente à l'import de base** (remplace l'ancien remplacement total) : nouveau client/équipement ajouté automatiquement ; désactivation, conflit nom/contact/téléphone, et désormais aussi conflit type/modèle d'un équipement existant → confirmation demandée au technicien, groupée par client.
17. **Deux commandes en en-tête** : "Export visite" / "Import visite" (fusion ciblée sur les équipements et leur statut de visite, indépendante de l'export/import base complète).
18. **En-tête nettoyé** : les commandes Export/Import visite + Export/Import base + Export/Import moyens regroupées sous une seule commande texte "Import/Export" (modale récapitulative, même style que l'onglet Imp/Exp existant) ; "Documentation Technique" → "Docs Technique", icône séparée supprimée ; cadre + espacement ajoutés autour de ces deux commandes pour l'usage tactile.
19. **Nom de fichier "Export visite"** : doit inclure le préfixe technicien pour éviter les collisions entre postes (`technizen_visites_{préfixe}_{JJMMAA}.json`) — prompt envoyé.
20. **⚠️ Capture des dates de VP (Vérification Périodique) — PAS ENCORE ENVOYÉ.** Prompt entièrement rédigé et prêt (voir section 4), à envoyer en priorité à la prochaine session.

---

## 4. Le chantier VP — état détaillé et prompt prêt à envoyer

### Contexte réglementaire (important, à ne pas confondre avec la visite semestrielle)

- La **VP** (Vérification Périodique) est **annuelle**, concerne **uniquement Opacimètre et Analyseur de gaz** (pollution), granularité mois/année (le jour précis n'est pas exigé par les inspecteurs).
- Actuellement, **seul le patron de Phip est habilité** à faire les VP (les autres techniciens font la visite semestrielle classique).
- La date de VP est lue sur l'**étiquette verte** de l'appareil (prochaine échéance obligatoire) et transcrite par le technicien sur le **Rapport semestriel**, champs `rs-vp1-mois`/`rs-vp1-annee` (VP Poll.1) et `rs-vp2-mois`/`rs-vp2-annee` (VP Poll.2) — **actuellement purement visuels, jamais lus ni enregistrés nulle part dans le code**.
- Logique d'association déjà présente dans le code (pour l'affichage du rapport) : **VP Poll.1** = 1er Analyseur de gaz (`rsGetEquip('Gaz', 0)`) + 1er Opacimètre (`rsGetEquip('Opacimètre', 0)`) ; **VP Poll.2** = 2ème Analyseur de gaz + 2ème Opacimètre (si présents — un client peut n'avoir que l'un des deux en double, ex. Madinina Contrôle a 2 analyseurs de gaz).
- Historiquement, le patron faisait VP + semestrielle en même temps ; depuis ~2 ans il les a dissociées, et des dépassements de délai ont commencé à apparaître — d'où le besoin d'un outil de suivi qui ne dépende pas de CoMet (logiciel PC dédié, pas consultable sur le terrain).

### Prompt TECHNIZEN à envoyer (capture + export)

```
Contexte : dépôt TECHNIZEN, index.html (+ app.js/database.js). CLAUDE.md impose l'incrémentation automatique de version.

Objectif : capturer et persister les dates de VP (Vérification Périodique) saisies par le technicien sur le Rapport semestriel (champs rs-vp1-mois/rs-vp1-annee, rs-vp2-mois/rs-vp2-annee), actuellement uniquement visuelles (jamais lues ni enregistrées), et les inclure dans l'export "visite" pour bureau-app.

## Contexte réglementaire

La VP concerne uniquement Opacimètre et Analyseur de gaz, granularité mois/année (pas de jour précis — toléré par les inspecteurs tant que c'est fait dans le bon mois). La date saisie est celle lue sur l'étiquette verte de l'appareil : la PROCHAINE date d'échéance, pas une date de dernière visite — à stocker telle quelle, sans recalcul.

## Logique d'association équipement ↔ date de VP (déjà présente dans le code pour l'affichage, à réutiliser à l'identique)

- **VP Poll.1** (rs-vp1-mois/annee) s'applique à : l'Analyseur de gaz à l'index 0 (`rsGetEquip('Gaz', 0)`) ET l'Opacimètre à l'index 0 (`rsGetEquip('Opacimètre', 0)`) du client — leurs n° de série respectifs.
- **VP Poll.2** (rs-vp2-mois/annee, uniquement si la case Pollution 2 est cochée) s'applique à : l'Analyseur de gaz à l'index 1 ET l'Opacimètre à l'index 1 du client (2ème exemplaire de chaque, si présent) — leurs n° de série respectifs. Un client peut avoir seulement l'un des deux (ex. Madinina Contrôle avec 2 analyseurs de gaz mais peut-être un seul opacimètre, ou l'inverse) — traiter chaque équipement indépendamment, ne pas supposer qu'ils vont toujours par paire.

## Ce qui doit se passer à la validation du Rapport semestriel

Dans le flux de validation du Rapport semestriel (`validerControleTZN` pour le ficheCode du rapport semestriel, ou équivalent — repérer le point d'entrée exact), si la case Pollution et/ou Pollution 2 est cochée :
1. Lire les valeurs sélectionnées dans rs-vp1-mois/rs-vp1-annee (et rs-vp2-mois/rs-vp2-annee si applicable).
2. Associer cette échéance (format simple "AAAA-MM", ex. "2027-03") au(x) n° de série concerné(s) selon la logique ci-dessus.
3. Stocker cette association de façon persistante (nouvelle structure localStorage dédiée, ou extension de l'historique existant — au choix le plus cohérent avec l'architecture actuelle), indexée par client + n° de série d'équipement, de façon à ce qu'une nouvelle saisie remplace la précédente pour le même équipement (toujours la plus récente échéance qui prévaut).

## Export

Étendre `exporterVisites()` pour inclure, pour chaque équipement Opacimètre/Analyseur de gaz concerné, sa prochaine échéance de VP connue (champ du type `prochaineVP: "2027-03"`, absent/null si jamais renseignée).

## Non concerné
- Aucune autre fiche, aucun autre type d'équipement (la VP ne concerne que Opacimètre et Analyseur de gaz).
- La logique de visite semestrielle existante (délai 4-8 mois) reste totalement indépendante et inchangée.

## Test à décrire dans le retour
- Valider un Rapport semestriel avec Pollution seule cochée, VP Poll.1 = un mois/année choisi → vérifier que le gaz ET l'opacimètre (index 0) du client récupèrent bien cette échéance.
- Valider un Rapport semestriel avec Pollution + Pollution 2 cochées, dates différentes → vérifier la bonne association par index pour chacun des 4 équipements potentiels (gaz 1, opa 1, gaz 2, opa 2).
- Cas d'un client n'ayant qu'un 2ème opacimètre mais pas de 2ème analyseur de gaz (ou l'inverse) → vérifier qu'aucune erreur ne se produit, seul l'équipement réellement présent reçoit une échéance.
- Revalider un Rapport semestriel plus tard avec une nouvelle date → vérifier que l'ancienne échéance est bien remplacée, pas cumulée.
- Générer un export visite → vérifier la présence du champ `prochaineVP` pour les équipements concernés.
```

---

## 5. bureau-app (SAV-tech) — évolutions de cette session (V4.03 → V5.00)

### Onglet "Semestrielles" (V4.04)

- Import accumulatif de fichiers `technizen_visites_{préfixe}_{JJMMAA}.json` (bouton en haut de l'onglet), stocké en localStorage, indépendant du canal GitHub/relais.
- Équipement identifié par n° de compte client + n° de série ; en cas de ré-import, la date de dernière visite la plus récente est conservée automatiquement, sans confirmation.
- 4 statuts par équipement : ❌ Non Contrôlé / 🔴 Dépassé (>8 mois) / 🟡 À prévoir (6-8 mois) / ✅ Conforme (<6 mois) — équipements inactifs ignorés.
- Badge global par client = pire statut parmi ses équipements actifs, type d'équipement précisé.
- Recherche texte (nom, numéro, contact, téléphone) + filtres de statut multi-sélection, combinables.
- Tri : critiques (❌/🔴, par zone géographique 971→972→970 déduite des 3 premiers caractères du n° de compte, puis alphabétique) → à prévoir (par échéance) → conformes.
- Récapitulatif chiffré dynamique.
- ⚠️ Schéma de fichier supposé (`{clients:[{numero, nom, contact, telephone, ville, equipements:[{type, serie, actif, derniere_visite}]}]}`), jamais confirmé face à un vrai export.

### Onglet "VP" (V4.05)

- Réutilise le même import que "Semestrielles" (pas de bouton dupliqué), extrait en plus le champ `prochaineVP` par équipement Opacimètre/Analyseur de gaz.
- 4 statuts mensuels : ❌ Aucune VP renseignée / 🔴 Dépassée / 🟡 À prévoir (mois courant ou suivant) / ✅ À jour.
- Une ligne par équipement concerné (pas par client), avec recherche/tri/récapitulatif réutilisant la même logique générique que "Semestrielles" (fonctions extraites, pas dupliquées).
- **Rappel pop-up quotidien** : vérification toutes les heures via `setInterval` (indépendant des rechargements de page, car le poste bureau reste allumé en continu) ; se déclenche si au moins un équipement est 🔴/🟡, une fois par jour calendaire max, avec bouton de bascule direct vers l'onglet VP ; s'arrête dès que la situation repasse en ✅/❌.
- ⚠️ Même réserve que "Semestrielles" : `prochaineVP` sera vide tant que le prompt TECHNIZEN de la section 4 n'est pas envoyé.

### Passage à V5.00

Bond de version demandé explicitement par Phip (plutôt que 4.05→4.06) pour marquer cette étape.

---

## 6. Chantier séparé — souveraineté numérique (kDrive / GitHub)

*(Sans lien direct avec TECHNIZEN/SAV-tech au quotidien — projet distinct, "projet prof"/kdrive-upload, mentionné ici car discuté en profondeur cette session)*

- Motivation : anticiper un possible durcissement réglementaire (stratégie française "Cloud Souverain 2030"), sortir de la dépendance à des entreprises américaines soumises au CLOUD Act (Google, GitHub/Microsoft, Cloudflare, Dropbox).
- **Google Drive écarté** : validation d'application obligatoire, incompatible avec une appli HTML seule.
- **Infomaniak kDrive testé** : jeton d'accès personnel simple à générer (pas de review d'app comme Google), mais **CORS bloqué** en appel direct navigateur (testé et confirmé, page de test dédiée fournie).
- **Architecture retenue** (rien codé) : contourner le blocage CORS en sortant du navigateur — une appli locale PC (pas soumise à CORS) récupère les données brutes déposées par TECHNIZEN via le canal GitHub existant, régénère chaque fiche en réutilisant la logique d'export HTML de TECHNIZEN, puis upload directement vers kDrive. Infos techniques API kDrive déjà recueillies (endpoints, contraintes) — voir détail dans l'historique de conversation si besoin de les régénérer.
- **GitHub** : remplacement envisagé (Codeberg identifié comme piste la plus simple, GitLab en alternative) mais **reporté faute de temps** — sujet à reprendre en session dédiée.

---

## 7. Sujets ouverts / tests à faire

1. **Envoyer le prompt VP (section 4)** — priorité absolue, tout le reste du chantier VP en dépend.
2. **Vérifier le schéma réel du fichier `technizen_visites_*.json`** une fois un vrai export disponible, ajuster bureau-app si les noms de champs ne correspondent pas aux suppositions de Claude Code.
3. **Bug espace manquant** "FICHE D'ETALONNAGEBANC" sur export PDF Android (Muller) — prompt envoyé, résultat non confirmé.
4. **Autre appli "bureau"** (mentionnée une fois par Phip, à ne pas confondre avec bureau-app) qui consomme aussi l'export de base clients TECHNIZEN — à revoir si elle doit être adaptée aux nouveautés (statut actif/inactif, etc.), reporté à plus tard.
5. **Suggestion non actée** : relier automatiquement l'attestation de non-dérive (`Attestation_VP`, déjà existante côté pollution) au moment où un équipement passe "hors délai" — évoqué, pas tranché.
6. Sujets anciens toujours en suspens (voir résumés antérieurs) : mot de passe attribué après coup à un client SAV-tech, mode de fonctionnement de la base clients à trancher en équipe.

---

## 8. Repères pratiques utiles

- **Préfixes techniciens** : 78 = Chathuant Philippe, 58 = Raymond Zenon.
- **Zone géographique** : déduite des 3 premiers caractères du n° de compte client (971 = Guadeloupe, 972 = Martinique, 970 = Îles du Nord).
- **Générer un jeton API Infomaniak** : `https://manager.infomaniak.com/v3/ng/profile/user/token/list` (ne pas toucher aux 6 tokens existants "kDrive Desktop", utilisés par la synchro locale).
- **Git qui refuse de pousser (branches divergentes)** : `git pull --no-rebase`, puis `git commit --no-edit` si besoin, puis `git push`.
- **`wrangler deploy`** nécessaire après toute modification de `worker/index.js` — un `git push` seul ne redéploie pas le worker.
- **Changer le mot de passe du relais** — 3 endroits à synchroniser : secret Cloudflare, bureau-app (Configuration), TECHNIZEN (fenêtre d'envoi).

---

*Fin du résumé. Bonne continuation, Phip !*
