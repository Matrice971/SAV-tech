/**
 * SAV-tech — Relais Cloudflare Workers
 *
 * Détient seul le token GitHub avec droits d'écriture. Reçoit les demandes
 * d'écriture des applis technicien/gestion, vérifie un mot de passe partagé,
 * puis écrit le fichier dans /data/clients/ du dépôt GitHub via l'API GitHub.
 *
 * Détient aussi, depuis l'ajout de /kdrive-upload, le token Infomaniak kDrive
 * (droits d'écriture) — même principe : reçoit un PDF (base64) + un chemin de
 * dossiers depuis technizen-app ou contrat-app, crée l'arborescence manquante
 * sur le kDrive puis y dépose le fichier.
 *
 * /read (lecture sans cache d'un fichier data/clients/, cf. handleRead).
 *
 * /kdrive-list et /kdrive-download (lecture) servent aux imports automatiques
 * de technizen-app et bureau-app ; ils sont limités aux sous-arbres
 * "Appli TECHNIZEN/Exports" et "Appli TECHNIZEN/Bureau" (RACINES_LECTURE) et ne
 * créent jamais de dossier.
 *
 * Variables d'environnement attendues (jamais en dur dans le code) :
 * - WRITE_PASSWORD    : mot de passe partagé (auth par technicien viendra plus tard)
 * - GITHUB_TOKEN      : token GitHub (fine-grained PAT) avec droit "Contents: Read and write"
 *                        sur le dépôt Matrice971/SAV-tech uniquement
 * - KDRIVE_API_TOKEN  : token Infomaniak (scope "drive") avec accès en écriture au kDrive
 * - DEPOT_TOKEN       : jeton de Dépôt Drive (depot-app), limité à /depot-clients et
 *                        /depot-upload — intégré à depot-drive.html à la compilation
 * - MAIL_USER         : adresse de la boîte Infomaniak lue par /mails-non-lus
 *                        (direction.technizen@etik.com, 08/11/2026)
 * - MAIL_PASSWORD     : mot de passe d'APPLICATION de cette boîte (double
 *                        authentification active) — jamais le mot de passe du compte
 * - KDRIVE_ID         : identifiant numérique du kDrive cible (visible dans son URL)
 * - KDRIVE_ROOT_ID    : id du dossier racine réellement inscriptible sur ce kDrive.
 *                        Le dossier "1" (racine absolue) n'est PAS inscriptible sur un
 *                        compte perso Infomaniak : il renvoie "permission_denied" à la
 *                        création. Le vrai dossier racine est "Private" (id 5 constaté
 *                        sur deux drives testés le 2026-09-26) — à vérifier par drive.
 */

import { connect } from "cloudflare:sockets";

const GITHUB_OWNER = "Matrice971";
const GITHUB_REPO = "SAV-tech";
const GITHUB_BRANCH = "main";

// Sous-dossiers autorisés pour l'écriture via /write, choisis par le champ
// "dossier" du corps de la requête. Liste blanche stricte : la valeur reçue
// n'est jamais interpolée directement dans un chemin de fichier (elle sert
// uniquement de clé vers ce dictionnaire), pour empêcher tout path traversal
// via ce champ contrôlé par l'appelant.
const DOSSIERS_AUTORISES = {
  clients: "data/clients",
  interventions: "data/interventions",
};
const DOSSIER_PAR_DEFAUT = "clients";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Comparaison à temps constant pour éviter les attaques par timing sur le mot de passe.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// N'autorise qu'un nom de fichier simple (pas de "/", pas de "..") pour éviter
// toute écriture en dehors de /data/clients/.
function isValidFilename(filename) {
  return typeof filename === "string" && /^[A-Za-z0-9_-]+\.txt$/.test(filename);
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

async function githubRequest(env, path, options = {}) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
  return fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "sav-tech-worker",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

async function handleWrite(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corps JSON invalide." }, 400);
  }

  const { password, filename, content, dossier } = body;

  if (!env.WRITE_PASSWORD || !env.GITHUB_TOKEN) {
    return jsonResponse(
      { success: false, error: "Configuration serveur incomplète (variables d'environnement manquantes)." },
      500
    );
  }

  if (!safeEqual(password, env.WRITE_PASSWORD)) {
    return jsonResponse({ success: false, error: "Mot de passe incorrect." }, 401);
  }

  if (!isValidFilename(filename)) {
    return jsonResponse(
      { success: false, error: "Nom de fichier invalide (attendu : lettres/chiffres/-/_ et extension .txt)." },
      400
    );
  }

  if (typeof content !== "string") {
    return jsonResponse({ success: false, error: "Contenu manquant ou invalide." }, 400);
  }

  const cleDossier = (typeof dossier === "string" && Object.prototype.hasOwnProperty.call(DOSSIERS_AUTORISES, dossier))
    ? dossier
    : DOSSIER_PAR_DEFAUT;
  const dataDir = DOSSIERS_AUTORISES[cleDossier];

  const path = `${dataDir}/${filename}`;

  // Récupère le sha du fichier existant (nécessaire pour une mise à jour, absent pour une création).
  let sha;
  const existing = await githubRequest(env, path, { method: "GET" });
  if (existing.status === 200) {
    const existingData = await existing.json();
    sha = existingData.sha;
  } else if (existing.status !== 404) {
    const errorText = await existing.text();
    return jsonResponse(
      { success: false, error: `Erreur GitHub lors de la lecture du fichier existant : ${errorText}` },
      502
    );
  }

  const putResponse = await githubRequest(env, path, {
    method: "PUT",
    body: JSON.stringify({
      message: `Mise à jour de ${filename} via relais SAV-tech`,
      content: toBase64(content),
      branch: GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!putResponse.ok) {
    const errorText = await putResponse.text();
    return jsonResponse(
      { success: false, error: `Erreur GitHub lors de l'écriture : ${errorText}` },
      502
    );
  }

  return jsonResponse({ success: true, filename, path });
}

async function handleDelete(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corps JSON invalide." }, 400);
  }

  const { password, filename, dossier } = body;

  if (!env.WRITE_PASSWORD || !env.GITHUB_TOKEN) {
    return jsonResponse(
      { success: false, error: "Configuration serveur incomplète (variables d'environnement manquantes)." },
      500
    );
  }

  if (!safeEqual(password, env.WRITE_PASSWORD)) {
    return jsonResponse({ success: false, error: "Mot de passe incorrect." }, 401);
  }

  if (!isValidFilename(filename)) {
    return jsonResponse(
      { success: false, error: "Nom de fichier invalide (attendu : lettres/chiffres/-/_ et extension .txt)." },
      400
    );
  }

  const cleDossier = (typeof dossier === "string" && Object.prototype.hasOwnProperty.call(DOSSIERS_AUTORISES, dossier))
    ? dossier
    : DOSSIER_PAR_DEFAUT;
  const dataDir = DOSSIERS_AUTORISES[cleDossier];

  const path = `${dataDir}/${filename}`;

  const existing = await githubRequest(env, path, { method: "GET" });
  if (existing.status === 404) {
    return jsonResponse({ success: false, error: "Fichier introuvable." }, 404);
  }
  if (existing.status !== 200) {
    const errorText = await existing.text();
    return jsonResponse(
      { success: false, error: `Erreur GitHub lors de la lecture du fichier existant : ${errorText}` },
      502
    );
  }
  const existingData = await existing.json();
  const sha = existingData.sha;

  const deleteResponse = await githubRequest(env, path, {
    method: "DELETE",
    body: JSON.stringify({
      message: `Suppression de ${filename} via relais SAV-tech`,
      sha,
      branch: GITHUB_BRANCH,
    }),
  });

  if (!deleteResponse.ok) {
    const errorText = await deleteResponse.text();
    return jsonResponse(
      { success: false, error: `Erreur GitHub lors de la suppression : ${errorText}` },
      502
    );
  }

  return jsonResponse({ success: true, filename });
}

// Lecture d'un fichier client SANS le cache de raw.githubusercontent.com
// (max-age=300 : une relecture moins de 5 min après une écriture renvoyait
// l'ancienne version, et la publication suivante écrasait la précédente —
// visites perdues). Passe par l'API GitHub avec le token du relais. Limité à
// data/clients/ (fichiers chiffrés, illisibles sans le mot de passe client).
async function handleRead(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corps JSON invalide." }, 400);
  }

  const { password, filename } = body;

  if (!env.WRITE_PASSWORD || !env.GITHUB_TOKEN) {
    return jsonResponse(
      { success: false, error: "Configuration serveur incomplète (variables d'environnement manquantes)." },
      500
    );
  }

  if (!safeEqual(password, env.WRITE_PASSWORD)) {
    return jsonResponse({ success: false, error: "Mot de passe incorrect." }, 401);
  }

  if (!isValidFilename(filename)) {
    return jsonResponse(
      { success: false, error: "Nom de fichier invalide (attendu : lettres/chiffres/-/_ et extension .txt)." },
      400
    );
  }

  const path = `${DOSSIERS_AUTORISES.clients}/${filename}`;
  const res = await githubRequest(env, `${path}?ref=${GITHUB_BRANCH}`, {
    method: "GET",
    headers: { "Accept": "application/vnd.github.raw" },
  });
  if (res.status === 404) {
    return jsonResponse({ success: true, existe: false, filename });
  }
  if (!res.ok) {
    const errorText = await res.text();
    return jsonResponse({ success: false, error: `Erreur GitHub lors de la lecture : ${errorText}` }, 502);
  }
  return jsonResponse({ success: true, existe: true, filename, contenu: await res.text() });
}

// ============================================================
// KDRIVE — upload des PDF générés par technizen-app
// ============================================================

async function kdriveRequest(env, path, options = {}) {
  const url = `https://api.infomaniak.com${path}`;
  return fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${env.KDRIVE_API_TOKEN}`,
      ...(options.headers || {}),
    },
  });
}

// Un segment de dossier (nom de technicien, raison sociale, "09_2026"...) ne
// doit jamais contenir de quoi sortir du chemin prévu ("/", "\", "..").
function isValidFolderSegment(seg) {
  return typeof seg === "string" && seg.length > 0 && seg.length <= 150 &&
    !/[\/\\]/.test(seg) && seg !== "." && seg !== "..";
}

// Les noms de fichiers générés par technizen-app sont déjà nettoyés (accents/
// espaces retirés, cf. getNomClientFichier) : lettres/chiffres/-/_ + ".pdf",
// ou ".json" pour les exports (Export visite / base / moyens), ou
// "GNETDATA.txt" (régloscopes BOSCH, technizen V11.30 ; "GNETDATA-<n° de
// série>.txt" en V11.29) — seul .txt accepté.
// .xps : fichiers de mesures des bancs de freinage joints aux fiches banc
// (technizen V11.44), le PC du banc sortant du PDF ou du XPS.
// .zip : paramètres et calibration du banc, déposés depuis le PC du client
// (Dépôt Drive V1.00, 04/11/2026).
function isValidUploadFilename(name) {
  return typeof name === "string" &&
    (/^[A-Za-z0-9_-]+\.(pdf|json|xps|zip)$/.test(name) || /^GNETDATA[A-Za-z0-9_-]*\.txt$/.test(name));
}

function isValidJsonFilename(name) {
  return typeof name === "string" && /^[A-Za-z0-9_-]+\.json$/.test(name);
}

// Seul sous-arbre lisible via /kdrive-list et /kdrive-download : les exports
// JSON de technizen-app — jamais les dossiers clients (Drive_Client...).
const EXPORTS_RACINE = ["Appli TECHNIZEN", "Exports"];
// Sauvegardes de bureau-app (configuration, archives annuelles) : fichiers
// chiffrés par le mot de passe des sauvegardes de bureau-app, illisibles même
// avec le mot de passe du relais.
const BUREAU_RACINE = ["Appli TECHNIZEN", "Bureau"];
const RACINES_LECTURE = [EXPORTS_RACINE, BUREAU_RACINE];

function isCheminLectureAutorise(path) {
  return Array.isArray(path) && path.length <= 6 &&
    path.every(isValidFolderSegment) &&
    RACINES_LECTURE.some((racine) => path.length > racine.length && racine.every((seg, i) => path[i] === seg));
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Liste tous les enfants d'un dossier kDrive (uniquement les dossiers si
// dossiersSeulement, sinon dossiers + fichiers), en suivant la pagination par
// curseur si l'API en renvoie une.
async function listChildren(env, parentId, dossiersSeulement) {
  const enfants = [];
  let cursor = null;
  do {
    const params = new URLSearchParams(dossiersSeulement ? { "type[]": "dir" } : {});
    if (cursor) params.set("cursor", cursor);
    const response = await kdriveRequest(
      env,
      `/3/drive/${env.KDRIVE_ID}/files/${parentId}/files?${params}`
    );
    if (!response.ok) {
      throw new Error(`Lecture du dossier Drive ${parentId} échouée (HTTP ${response.status}).`);
    }
    const parsed = await response.json();
    const page = parsed.data || [];
    enfants.push(...page);
    cursor = parsed.has_more ? parsed.cursor : null;
  } while (cursor);
  return enfants;
}

async function listChildFolders(env, parentId) {
  return listChildren(env, parentId, true);
}

// Retrouve (ou crée) le sous-dossier "name" sous "parentId", et retourne son id.
async function resolveOrCreateFolder(env, parentId, name) {
  const enfants = await listChildFolders(env, parentId);
  const existant = enfants.find((f) => f.name === name);
  if (existant) return existant.id;

  const response = await kdriveRequest(
    env,
    `/3/drive/${env.KDRIVE_ID}/files/${parentId}/directory`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }
  );
  if (!response.ok) {
    throw new Error(`Création du dossier Drive "${name}" échouée (HTTP ${response.status}).`);
  }
  const parsed = await response.json();
  const created = parsed.data || parsed;
  if (!created || !created.id) {
    throw new Error(`Réponse Drive inattendue à la création du dossier "${name}".`);
  }
  return created.id;
}

// Résout la chaîne complète de dossiers (en créant ceux qui manquent), en
// partant de la racine du kDrive, et retourne l'id du dossier final.
async function resolveFolderPath(env, segments) {
  let currentId = env.KDRIVE_ROOT_ID;
  for (const segment of segments) {
    currentId = await resolveOrCreateFolder(env, currentId, segment);
  }
  return currentId;
}

// Variante lecture seule : retourne null dès qu'un dossier de la chaîne
// n'existe pas (aucune création).
async function findFolderPath(env, segments) {
  let currentId = env.KDRIVE_ROOT_ID;
  for (const segment of segments) {
    const enfants = await listChildFolders(env, currentId);
    const existant = enfants.find((f) => f.name === segment);
    if (!existant) return null;
    currentId = existant.id;
  }
  return currentId;
}

// conflict (API kDrive) : "error" refuse si un fichier du même nom existe
// déjà, "version" le remplace (nouvelle version du même fichier), "rename"
// crée une copie renommée. Non transmis si absent (comportement par défaut
// de l'API = refus).
async function uploadFileToKdrive(env, folderId, filename, bytes, conflict) {
  const params = new URLSearchParams({
    directory_id: String(folderId),
    file_name: filename,
    total_size: String(bytes.length),
  });
  if (conflict) params.set("conflict", conflict);
  const response = await kdriveRequest(
    env,
    `/3/drive/${env.KDRIVE_ID}/upload?${params}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Envoi vers le Drive échoué (HTTP ${response.status}) : ${errorText}`);
  }
  return response.json();
}

async function handleKdriveUpload(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corps JSON invalide." }, 400);
  }

  const { password, path, filename, contentBase64, versionContrat } = body;

  if (!env.WRITE_PASSWORD || !env.KDRIVE_API_TOKEN || !env.KDRIVE_ID || !env.KDRIVE_ROOT_ID) {
    return jsonResponse(
      { success: false, error: "Configuration serveur incomplète (variables d'environnement manquantes)." },
      500
    );
  }

  if (!safeEqual(password, env.WRITE_PASSWORD)) {
    return jsonResponse({ success: false, error: "Mot de passe incorrect." }, 401);
  }

  if (!Array.isArray(path) || path.length === 0 || path.length > 6 || !path.every(isValidFolderSegment)) {
    return jsonResponse({ success: false, error: "Chemin de dossiers invalide." }, 400);
  }

  if (!isValidUploadFilename(filename)) {
    return jsonResponse(
      { success: false, error: "Nom de fichier invalide (attendu : lettres/chiffres/-/_ et extension .pdf, .xps, .zip ou .json)." },
      400
    );
  }

  if (typeof contentBase64 !== "string" || contentBase64.length === 0) {
    return jsonResponse({ success: false, error: "Contenu du fichier manquant." }, 400);
  }

  let bytes;
  try {
    bytes = base64ToBytes(contentBase64);
  } catch {
    return jsonResponse({ success: false, error: "Contenu base64 invalide." }, 400);
  }

  try {
    const folderId = await resolveFolderPath(env, path);

    // Mode contrat-app ("versionContrat": true) : le 1er dépôt garde le nom
    // demandé et n'est plus jamais modifié ; tout dépôt suivant du même nom
    // va dans "<nom>_V2.pdf", créé la 1re fois puis écrasé les fois
    // suivantes. C'est le contenu réel du dossier kDrive qui fait foi (pas
    // un historique local à l'appli).
    if (versionContrat === true) {
      const enfants = await listChildren(env, folderId, false);
      const dejaDepose = enfants.some((f) => f.type !== "dir" && f.name === filename);
      const nomFinal = dejaDepose ? filename.replace(/\.pdf$/, "_V2.pdf") : filename;
      await uploadFileToKdrive(env, folderId, nomFinal, bytes, dejaDepose ? "version" : "error");
      return jsonResponse({
        success: true,
        path: path.join("/") + "/" + nomFinal,
        filename: nomFinal,
        version: dejaDepose ? 2 : 1,
      });
    }

    // technizen-app : une fiche corrigée puis réexportée porte le même nom
    // (type, client, [n° de série si plusieurs appareils du type], date) →
    // elle remplace la précédente. Sans cela le Drive refusait le 2e envoi,
    // qui restait bloqué en file d'attente (V11.28). Les exports JSON sont
    // horodatés à la seconde, donc jamais concernés.
    await uploadFileToKdrive(env, folderId, filename, bytes, "version");
    return jsonResponse({ success: true, path: path.join("/") + "/" + filename });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || "Erreur Drive inconnue." }, 502);
  }
}

// Contrôles communs à /kdrive-list et /kdrive-download. Retourne une réponse
// d'erreur, ou null si la requête peut être traitée.
function verifierRequeteLecture(env, password, path) {
  if (!env.WRITE_PASSWORD || !env.KDRIVE_API_TOKEN || !env.KDRIVE_ID || !env.KDRIVE_ROOT_ID) {
    return jsonResponse(
      { success: false, error: "Configuration serveur incomplète (variables d'environnement manquantes)." },
      500
    );
  }
  if (!safeEqual(password, env.WRITE_PASSWORD)) {
    return jsonResponse({ success: false, error: "Mot de passe incorrect." }, 401);
  }
  if (!isCheminLectureAutorise(path)) {
    return jsonResponse({ success: false, error: "Chemin de lecture non autorisé." }, 403);
  }
  return null;
}

// Liste les fichiers (pas les sous-dossiers) d'un dossier d'exports. Dossier
// absent = liste vide (aucun export n'y a encore été déposé).
async function handleKdriveList(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corps JSON invalide." }, 400);
  }
  const { password, path } = body;
  const erreur = verifierRequeteLecture(env, password, path);
  if (erreur) return erreur;

  try {
    const folderId = await findFolderPath(env, path);
    if (!folderId) return jsonResponse({ success: true, fichiers: [] });
    const enfants = await listChildren(env, folderId, false);
    const fichiers = enfants
      .filter((f) => f.type !== "dir")
      .map((f) => ({ name: f.name, size: f.size, modifie: f.last_modified_at || null }));
    return jsonResponse({ success: true, fichiers });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || "Erreur Drive inconnue." }, 502);
  }
}

// Renvoie le contenu texte d'un fichier JSON d'un dossier d'exports.
async function handleKdriveDownload(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corps JSON invalide." }, 400);
  }
  const { password, path, filename } = body;
  const erreur = verifierRequeteLecture(env, password, path);
  if (erreur) return erreur;
  if (!isValidJsonFilename(filename)) {
    return jsonResponse({ success: false, error: "Nom de fichier invalide (attendu : .json)." }, 400);
  }

  try {
    const folderId = await findFolderPath(env, path);
    const enfants = folderId ? await listChildren(env, folderId, false) : [];
    const fichier = enfants.find((f) => f.type !== "dir" && f.name === filename);
    if (!fichier) return jsonResponse({ success: false, error: "Fichier introuvable sur le Drive." }, 404);

    const response = await kdriveRequest(env, `/2/drive/${env.KDRIVE_ID}/files/${fichier.id}/download`);
    if (!response.ok) {
      throw new Error(`Téléchargement depuis le Drive échoué (HTTP ${response.status}).`);
    }
    const contenu = await response.text();
    return jsonResponse({ success: true, filename, contenu });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || "Erreur Drive inconnue." }, 502);
  }
}

// ============================================================
// DÉPÔT DRIVE — dépôt depuis le PC du client (depot-app V1.01, 04/11/2026)
// ============================================================
// Le fichier depot-drive.html circule sur une clé USB : il porte son propre
// jeton (DEPOT_TOKEN), jamais le mot de passe principal. Ce jeton ne permet
// que ces deux choses, plus la lecture des PDF de la visite en cours
// (/depot-liste, /depot-telecharger, V1.02, voir plus bas) :
// - /depot-clients : la liste réduite des clients actifs (nom, ville,
//   responsable, n°) du dernier export de la base — pas la base complète ;
// - /depot-upload : un PDF/XPS/ZIP dans Drive_Client/<Responsable>/<Client>/
//   <Mois Année>, pour un couple Responsable/Client présent dans cette base.
// Clé perdue : changer DEPOT_TOKEN (wrangler secret put) et redistribuer le
// fichier recompilé, sans toucher à WRITE_PASSWORD ni aux tablettes.

const DEPOT_RACINE = "Drive_Client";
const DEPOT_MOIS = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];

function verifierJetonDepot(env, jeton) {
  if (!env.DEPOT_TOKEN || !env.KDRIVE_API_TOKEN || !env.KDRIVE_ID || !env.KDRIVE_ROOT_ID) {
    return jsonResponse(
      { success: false, error: "Configuration serveur incomplète (variables d'environnement manquantes)." },
      500
    );
  }
  if (!safeEqual(jeton, env.DEPOT_TOKEN)) {
    return jsonResponse({ success: false, error: "Jeton de dépôt refusé." }, 401);
  }
  return null;
}

// Nom des exports de technizen-app (analyserNomFichierExport) :
// Export_<type>_<auteur>_JJ-MM-AAAA_HHhMMmSS.json
function analyserNomExportBase(nom) {
  const m = /^Export_base_([A-Za-z0-9-]+)_(\d{2})-(\d{2})-(\d{4})_(\d{2})h(\d{2})m(\d{2})\.json$/i.exec(nom || "");
  if (!m) return null;
  return {
    nom,
    auteur: m[1],
    horodatage: m[4] + m[3] + m[2] + m[5] + m[6] + m[7],
    dateTexte: `${m[2]}/${m[3]}/${m[4]} à ${m[5]} h ${m[6]}`,
  };
}

// Clients actifs du dernier export de la base, réduits aux champs utiles au
// dépôt. Lève une erreur si aucun export n'est lisible.
async function chargerClientsDepot(env) {
  const folderId = await findFolderPath(env, [...EXPORTS_RACINE, "Base"]);
  const enfants = folderId ? await listChildren(env, folderId, false) : [];
  const exportsBase = enfants
    .filter((f) => f.type !== "dir")
    .map((f) => ({ ...analyserNomExportBase(f.name), id: f.id }))
    .filter((f) => f.nom)
    .sort((a, b) => (a.horodatage < b.horodatage ? 1 : -1));
  if (!exportsBase.length) throw new Error("Aucun export de la base sur le Drive : faites « Exporter la base » depuis la tablette.");
  const base = exportsBase[0];
  const response = await kdriveRequest(env, `/2/drive/${env.KDRIVE_ID}/files/${base.id}/download`);
  if (!response.ok) throw new Error(`Téléchargement de la base échoué (HTTP ${response.status}).`);
  const donnees = JSON.parse(await response.text());
  if (!donnees || !Array.isArray(donnees.actifs)) throw new Error("Le fichier de base du Drive est illisible.");
  const texte = (v) => (v == null ? "" : String(v));
  return {
    base: { auteur: base.auteur, dateTexte: base.dateTexte },
    clients: donnees.actifs.map((c) => ({
      nom: texte(c.nom), contact: texte(c.contact), ville: texte(c.ville), numero: texte(c.numero),
    })),
  };
}

async function handleDepotClients(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corps JSON invalide." }, 400);
  }
  const erreur = verifierJetonDepot(env, body.jeton);
  if (erreur) return erreur;
  try {
    const resultat = await chargerClientsDepot(env);
    return jsonResponse({ success: true, ...resultat });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || "Erreur Drive inconnue." }, 502);
  }
}

async function handleDepotUpload(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corps JSON invalide." }, 400);
  }
  const { jeton, path, filename, contentBase64 } = body;
  const erreur = verifierJetonDepot(env, jeton);
  if (erreur) return erreur;

  // Uniquement Drive_Client/<Responsable>/<Client>/<Mois Année>.
  const moisValide = Array.isArray(path) && typeof path[3] === "string" &&
    DEPOT_MOIS.some((mois) => new RegExp(`^${mois} \\d{4}$`).test(path[3]));
  if (!Array.isArray(path) || path.length !== 4 || path[0] !== DEPOT_RACINE || !path.every(isValidFolderSegment) || !moisValide) {
    return jsonResponse({ success: false, error: "Dossier de dépôt non autorisé." }, 403);
  }
  if (typeof filename !== "string" || !/^[A-Za-z0-9_-]+\.(pdf|xps|zip)$/.test(filename)) {
    return jsonResponse(
      { success: false, error: "Nom de fichier invalide (attendu : lettres/chiffres/-/_ et extension .pdf, .xps ou .zip)." },
      400
    );
  }
  if (typeof contentBase64 !== "string" || contentBase64.length === 0) {
    return jsonResponse({ success: false, error: "Contenu du fichier manquant." }, 400);
  }

  let bytes;
  try {
    bytes = base64ToBytes(contentBase64);
  } catch {
    return jsonResponse({ success: false, error: "Contenu base64 invalide." }, 400);
  }

  try {
    const { clients } = await chargerClientsDepot(env);
    const connu = clients.some((c) => c.contact.trim() === path[1] && c.nom.trim() === path[2]);
    if (!connu) {
      return jsonResponse({ success: false, error: "Client absent du dernier export de la base." }, 403);
    }
    const folderId = await resolveFolderPath(env, path);
    // Même règle que /kdrive-upload pour technizen-app : un fichier du même
    // nom est remplacé.
    await uploadFileToKdrive(env, folderId, filename, bytes, "version");
    return jsonResponse({ success: true, path: path.join("/") + "/" + filename });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || "Erreur Drive inconnue." }, 502);
  }
}

// Lecture des documents de la visite en cours (depot-app V1.02) : pour les
// imprimer chez le client quand la clé USB ne passe pas sur la tablette.
// Téléchargement : PDF uniquement, et SEULEMENT le dossier du mois en cours
// (heure de la Guadeloupe) : aucun accès au contenu des visites passées avec
// le jeton (décision utilisateur, 04/11/2026). Ni suppression ni modification.
// depot-app V1.03 (06/11/2026) : /depot-liste donne aussi les NOMS des
// fichiers d'un mois passé (pas leur contenu), pour éviter d'écraser un
// fichier du même nom lors d'un dépôt à une date passée.

// "Nov 2026" pour aujourd'hui en Guadeloupe (UTC-4, sans heure d'été) —
// l'heure UTC du serveur ferait changer de mois 4 h trop tôt.
function moisEnCoursGuadeloupe() {
  const local = new Date(Date.now() - 4 * 3600 * 1000);
  return `${DEPOT_MOIS[local.getUTCMonth()]} ${local.getUTCFullYear()}`;
}

// Contrôles communs à /depot-liste et /depot-telecharger : renvoie une
// réponse d'erreur, ou null si le chemin est un dossier de visite
// Drive_Client/<Responsable>/<Client>/<Mois Année> d'un client présent dans le
// dernier export de la base — et, si exigerMoisEnCours, du mois en cours.
async function verifierDossierVisiteEnCours(env, path, exigerMoisEnCours = true) {
  const moisValide = Array.isArray(path) && typeof path[3] === "string" &&
    DEPOT_MOIS.some((mois) => new RegExp(`^${mois} \\d{4}$`).test(path[3]));
  if (!Array.isArray(path) || path.length !== 4 || path[0] !== DEPOT_RACINE || !path.every(isValidFolderSegment) || !moisValide) {
    return jsonResponse({ success: false, error: "Dossier non autorisé." }, 403);
  }
  if (exigerMoisEnCours && path[3] !== moisEnCoursGuadeloupe()) {
    return jsonResponse({ success: false, error: `Seul le dossier de la visite en cours (${moisEnCoursGuadeloupe()}) est consultable.` }, 403);
  }
  const { clients } = await chargerClientsDepot(env);
  if (!clients.some((c) => c.contact.trim() === path[1] && c.nom.trim() === path[2])) {
    return jsonResponse({ success: false, error: "Client absent du dernier export de la base." }, 403);
  }
  return null;
}

// Même résultat que bytesToBase64, par blocs de 32 Ko : un PDF de plusieurs
// Mo octet par octet coûterait trop de temps CPU (offre gratuite Cloudflare).
function bytesVersBase64ParBlocs(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function fichiersDossierVisite(env, path) {
  const folderId = await findFolderPath(env, path);
  const enfants = folderId ? await listChildren(env, folderId, false) : [];
  return enfants.filter((f) => f.type !== "dir");
}

async function pdfsDossierVisite(env, path) {
  return (await fichiersDossierVisite(env, path)).filter((f) => /\.pdf$/i.test(f.name || ""));
}

async function handleDepotListe(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corps JSON invalide." }, 400);
  }
  const erreur = verifierJetonDepot(env, body.jeton);
  if (erreur) return erreur;
  try {
    // Tous les mois : liste des noms seulement. « consultable » = mois en
    // cours (seul cas où /depot-telecharger accepte d'envoyer un PDF).
    const refus = await verifierDossierVisiteEnCours(env, body.path, false);
    if (refus) return refus;
    const consultable = body.path[3] === moisEnCoursGuadeloupe();
    const fichiers = (await fichiersDossierVisite(env, body.path))
      .map((f) => ({ name: f.name, size: f.size, modifie: f.last_modified_at || null }));
    return jsonResponse({ success: true, consultable, moisEnCours: moisEnCoursGuadeloupe(), fichiers });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || "Erreur Drive inconnue." }, 502);
  }
}

// Le nom n'est jamais utilisé comme chemin : il doit correspondre exactement
// à un PDF listé dans le dossier de la visite en cours.
async function handleDepotTelecharger(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corps JSON invalide." }, 400);
  }
  const erreur = verifierJetonDepot(env, body.jeton);
  if (erreur) return erreur;
  try {
    const refus = await verifierDossierVisiteEnCours(env, body.path);
    if (refus) return refus;
    const fichier = (await pdfsDossierVisite(env, body.path)).find((f) => f.name === body.filename);
    if (!fichier) return jsonResponse({ success: false, error: "Fichier introuvable sur le Drive." }, 404);
    const response = await kdriveRequest(env, `/2/drive/${env.KDRIVE_ID}/files/${fichier.id}/download`);
    if (!response.ok) throw new Error(`Téléchargement depuis le Drive échoué (HTTP ${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return jsonResponse({ success: true, filename: fichier.name, contentBase64: bytesVersBase64ParBlocs(bytes) });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || "Erreur Drive inconnue." }, 502);
  }
}

// ============================================================
// GNETDATA — dernier fichier d'un régloscope BOSCH (technizen V11.29)
// ============================================================
// Seule lecture autorisée dans les dossiers clients : les fichiers
// "GNETDATA*.txt" (nom libre après GNETDATA, casse ignorée) rangés
// directement dans Drive_Client/<Responsable>/<Client>/ ou un niveau en
// dessous (dossiers de visite « Oct 2026 », « Mars 25 »…), ou dans le
// sous-dossier <n° de série> d'un dossier de visite (client à plusieurs
// régloscopes BOSCH, technizen V11.30). Le régloscope est reconnu par la
// ligne 5 du fichier (n° de série), le plus récent par la ligne 17 (date de
// dernière maintenance, JJMMAAAA) — pas par le nom.

// Plafond de sous-requêtes Infomaniak par appel (limite Cloudflare : 50 sur
// l'offre gratuite) ; les dossiers les plus récents sont parcourus d'abord.
const GNETDATA_MAX_REQUETES = 44;

const MOIS_DOSSIER = [
  ["janv", 1], ["fevr", 2], ["fev", 2], ["mars", 3], ["avr", 4], ["mai", 5], ["juin", 6],
  ["juil", 7], ["aout", 8], ["sept", 9], ["oct", 10], ["nov", 11], ["dec", 12],
];

// Rang chronologique d'un nom de dossier de visite (« Oct 2026 », « Sept 25 »,
// « 2024 »…) : AAAAMM, AAAA00 si seule l'année est lisible, -1 sinon.
function rangDossierVisite(nom) {
  const n = String(nom || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const mois = MOIS_DOSSIER.find(([m]) => new RegExp("(^|[^a-z])" + m).test(n));
  const a4 = /(?:^|[^0-9])(20\d\d)(?![0-9])/.exec(n);
  // Année sur 2 chiffres seulement avec un mois (« Sept 25 ») : un nombre
  // seul (« 04-ATTESTATION », « Vide 79 ») n'est pas une date.
  const a2 = mois ? /(?:^|[^0-9])(\d\d)(?![0-9])/.exec(n) : null;
  let annee = null;
  if (a4) annee = parseInt(a4[1], 10);
  else if (a2) annee = 2000 + parseInt(a2[1], 10);
  if (annee === null) return -1;
  return annee * 100 + (mois ? mois[1] : 0);
}

function estNomGnetdata(nom) {
  return /^gnetdata.*\.txt$/i.test(String(nom || ""));
}

function normaliserSerie(serie) {
  return String(serie || "").replace(/\s+/g, "").toUpperCase();
}

// Nom de sous-dossier <n° de série> (technizen : caractères hors
// [A-Za-z0-9_-] remplacés par "-") comparé sans ponctuation ni casse.
function estDossierSerie(nom, serie) {
  const cle = (v) => String(v || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return cle(nom) !== "" && cle(nom) === cle(serie);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// "JJMMAAAA" → "AAAAMMJJ" (comparable), null si illisible.
function dateGnetdataComparable(jjmmaaaa) {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(String(jjmmaaaa || "").trim());
  return m ? m[3] + m[2] + m[1] : null;
}

async function handleKdriveGnetdata(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corps JSON invalide." }, 400);
  }
  const { password, path, serie } = body;

  if (!env.WRITE_PASSWORD || !env.KDRIVE_API_TOKEN || !env.KDRIVE_ID || !env.KDRIVE_ROOT_ID) {
    return jsonResponse(
      { success: false, error: "Configuration serveur incomplète (variables d'environnement manquantes)." },
      500
    );
  }
  if (!safeEqual(password, env.WRITE_PASSWORD)) {
    return jsonResponse({ success: false, error: "Mot de passe incorrect." }, 401);
  }
  if (!Array.isArray(path) || path.length !== 3 || path[0] !== "Drive_Client" || !path.every(isValidFolderSegment)) {
    return jsonResponse({ success: false, error: "Chemin de lecture non autorisé." }, 403);
  }
  if (typeof serie !== "string" || !/^[A-Za-z0-9 /_-]{1,30}$/.test(serie.trim())) {
    return jsonResponse({ success: false, error: "N° de série invalide." }, 400);
  }
  const serieCherchee = normaliserSerie(serie);

  try {
    const clientId = await findFolderPath(env, path);
    if (!clientId) {
      return jsonResponse({ success: true, trouve: false, raison: "dossier du client introuvable sur le Drive" });
    }
    let requetes = path.length + 1;
    const enfants = await listChildren(env, clientId, false);

    // Fichiers directement dans le dossier client, puis dossiers de visite du
    // plus récent au plus ancien (nom illisible : date de modification).
    const lots = [{ dossier: "", fichiers: enfants.filter((f) => f.type !== "dir") }];
    const dossiers = enfants
      .filter((f) => f.type === "dir")
      .map((f) => ({ f, rang: rangDossierVisite(f.name) }))
      .sort((a, b) => (b.rang - a.rang) || ((b.f.last_modified_at || 0) - (a.f.last_modified_at || 0)));

    let meilleur = null;
    let incomplet = false;
    const examiner = async (dossier, fichiers) => {
      for (const fichier of fichiers.filter((x) => x.type !== "dir" && estNomGnetdata(x.name))) {
        if (requetes >= GNETDATA_MAX_REQUETES) { incomplet = true; return; }
        requetes++;
        const response = await kdriveRequest(env, `/2/drive/${env.KDRIVE_ID}/files/${fichier.id}/download`);
        if (!response.ok) continue;
        const bytes = new Uint8Array(await response.arrayBuffer());
        let texte = "";
        for (let i = 0; i < bytes.length; i++) texte += String.fromCharCode(bytes[i]);
        const lignes = texte.split(/\r?\n/);
        if (lignes.length < 17 || normaliserSerie(lignes[4]) !== serieCherchee) continue;
        const date = dateGnetdataComparable(lignes[16]) || "";
        if (!meilleur || date > meilleur.date) {
          meilleur = { date, dossier, fichier: fichier.name, contentBase64: bytesToBase64(bytes), derniereMaintenance: lignes[16].trim() };
        }
      }
    };

    await examiner(lots[0].dossier, lots[0].fichiers);
    // Une fois trouvé dans un dossier daté, les dossiers datés plus anciens
    // sont ignorés (ceux au nom sans date restent examinés).
    let rangTrouve = null;
    for (const { f, rang } of dossiers) {
      if (rangTrouve !== null && rang >= 0 && rang < rangTrouve) continue;
      if (requetes >= GNETDATA_MAX_REQUETES) { incomplet = true; break; }
      requetes++;
      const avant = meilleur;
      const fichiers = await listChildren(env, f.id, false);
      await examiner(f.name, fichiers);
      for (const sous of fichiers.filter((x) => x.type === "dir" && estDossierSerie(x.name, serieCherchee))) {
        if (requetes >= GNETDATA_MAX_REQUETES) { incomplet = true; break; }
        requetes++;
        await examiner(f.name + "/" + sous.name, await listChildren(env, sous.id, false));
      }
      if (rangTrouve === null && meilleur && meilleur !== avant && rang >= 0) rangTrouve = rang;
    }

    if (!meilleur) {
      return jsonResponse({
        success: true,
        trouve: false,
        raison: incomplet
          ? "trop de dossiers à parcourir dans le dossier du client, recherche interrompue"
          : "aucun GNETDATA de ce n° de série dans le dossier du client",
      });
    }
    return jsonResponse({
      success: true,
      trouve: true,
      dossier: meilleur.dossier,
      fichier: meilleur.fichier,
      derniereMaintenance: meilleur.derniereMaintenance,
      contentBase64: meilleur.contentBase64,
      incomplet,
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || "Erreur Drive inconnue." }, 502);
  }
}

// ---------------------------------------------------------------------------
// MAILS NON LUS — alerte de l'appli bureau (V5.32, 08/11/2026)
// ---------------------------------------------------------------------------
// Lit la boîte de réception Infomaniak (MAIL_USER / MAIL_PASSWORD) en IMAP,
// ouverte par EXAMINE (lecture seule : aucun mail n'est marqué comme lu), et
// renvoie le nombre de mails NON LUS (nonLus) et, pour les seuls avis de
// dépôt et demandes « Question - … » non lus : expéditeur, objet, date —
// jamais leur contenu ni leurs pièces jointes. 50 au plus (les plus récents).
// Protégé par WRITE_PASSWORD, comme les autres routes du bureau.

const IMAP_HOTE = "mail.infomaniak.com";
const IMAP_PORT = 993;
const IMAP_MAX_MAILS = 50;
const IMAP_DELAI_MS = 20000;

function imapGuillemets(texte) {
  return '"' + String(texte).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

// Mots encodés des en-têtes (=?utf-8?B?...?= / =?iso-8859-1?Q?...?=).
function decoderEnteteMail(valeur) {
  return String(valeur || "")
    .replace(/(\?=)\s+(=\?)/g, "$1$2")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (tout, jeu, codage, texte) => {
      try {
        let octets;
        if (codage.toUpperCase() === "B") {
          const brut = atob(texte);
          octets = Uint8Array.from(brut, (c) => c.charCodeAt(0));
        } else {
          const brut = texte.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
          octets = Uint8Array.from(brut, (c) => c.charCodeAt(0));
        }
        if (/^utf-?8$/i.test(jeu)) return new TextDecoder("utf-8").decode(octets);
        return String.fromCharCode(...octets);
      } catch {
        return tout;
      }
    });
}

function lireEntetesMail(bloc) {
  const entetes = {};
  bloc.replace(/\r\n[ \t]+/g, " ").split("\r\n").forEach((ligne) => {
    const m = ligne.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (m) entetes[m[1].toLowerCase()] = m[2];
  });
  return entetes;
}

function analyserExpediteur(valeur) {
  const texte = decoderEnteteMail(valeur).trim();
  const m = texte.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (m) {
    const nom = m[1].replace(/^"(.*)"$/, "$1").trim();
    return { nom: nom || m[2].trim(), adresse: m[2].trim() };
  }
  return { nom: texte, adresse: texte };
}

async function lireMailsNonLus(env) {
  const socket = connect({ hostname: IMAP_HOTE, port: IMAP_PORT }, { secureTransport: "on" });
  const ecrivain = socket.writable.getWriter();
  const lecteur = socket.readable.getReader();
  const encodeur = new TextEncoder();
  const decodeur = new TextDecoder("utf-8");
  let tampon = new Uint8Array(0);
  let numero = 0;

  const lireJusqua = async (estComplet) => {
    for (;;) {
      const texte = decodeur.decode(tampon);
      if (estComplet(texte)) {
        tampon = new Uint8Array(0);
        return texte;
      }
      const { value, done } = await lecteur.read();
      if (done) throw new Error("Connexion fermée par le serveur mail.");
      const suite = new Uint8Array(tampon.length + value.length);
      suite.set(tampon);
      suite.set(value, tampon.length);
      tampon = suite;
    }
  };

  const commande = async (texteCommande, libelle) => {
    const etiquette = "T" + (++numero);
    await ecrivain.write(encodeur.encode(etiquette + " " + texteCommande + "\r\n"));
    const fin = new RegExp("(^|\\r\\n)" + etiquette + " (OK|NO|BAD)([^\\r\\n]*)\\r\\n");
    const reponse = await lireJusqua((t) => fin.test(t));
    const m = reponse.match(fin);
    if (m[2] !== "OK") throw new Error(libelle + " refusé par la boîte mail" + (m[3] ? " :" + m[3] : "") + ".");
    return reponse;
  };

  try {
    const accueil = await lireJusqua((t) => t.includes("\r\n"));
    if (!/^\* OK/.test(accueil)) throw new Error("Réponse inattendue du serveur mail.");
    await commande("LOGIN " + imapGuillemets(env.MAIL_USER) + " " + imapGuillemets(env.MAIL_PASSWORD),
      "Identifiant ou mot de passe d'application");
    await commande("EXAMINE INBOX", "Ouverture de la boîte de réception");
    const chercher = async (criteres) => {
      const reponse = await commande("UID SEARCH " + criteres, "Recherche des mails non lus");
      const ligne = reponse.match(/^\* SEARCH([^\r\n]*)/m);
      return ligne ? ligne[1].trim().split(/\s+/).filter(Boolean).map(Number) : [];
    };
    // V5.33 : tous les non lus sont seulement comptés ; les en-têtes ne sont
    // lus que pour les avis de dépôt et les demandes de l'appli client
    // (« Question - … »), recherchés directement — un dépôt ancien n'est plus
    // noyé parmi des mails ordinaires non lus.
    const uids = await chercher("UNSEEN");
    const candidats = new Set([
      ...(await chercher('UNSEEN SUBJECT "des fichiers sur votre kDrive"')),
      ...(await chercher('UNSEEN SUBJECT "Question"')),
    ]);
    const mails = [];
    if (candidats.size > 0) {
      const choisis = [...candidats].sort((a, b) => a - b).slice(-IMAP_MAX_MAILS);
      const reponse = await commande("UID FETCH " + choisis.join(",") + " (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])",
        "Lecture des en-têtes");
      const morceaux = reponse.split(/\r\n(?=\* \d+ FETCH)|^(?=\* \d+ FETCH)/);
      morceaux.forEach((morceau) => {
        const uid = morceau.match(/UID (\d+)/);
        const debut = morceau.indexOf("}\r\n");
        if (!uid || debut === -1) return;
        const entetes = lireEntetesMail(morceau.slice(debut + 3));
        const expediteur = analyserExpediteur(entetes.from);
        const date = entetes.date ? new Date(entetes.date) : null;
        mails.push({
          uid: Number(uid[1]),
          de: expediteur.nom,
          adresse: expediteur.adresse,
          objet: decoderEnteteMail(entetes.subject || "").trim(),
          date: date && !isNaN(date) ? date.toISOString() : null,
        });
      });
      mails.sort((a, b) => b.uid - a.uid);
    }
    try { await commande("LOGOUT", "Déconnexion"); } catch { /* sans importance */ }
    return { nonLus: uids.length, mails };
  } finally {
    try { lecteur.releaseLock(); } catch { /* déjà libéré */ }
    try { ecrivain.releaseLock(); } catch { /* déjà libéré */ }
    try { await socket.close(); } catch { /* déjà fermé */ }
  }
}

async function handleMailsNonLus(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corps JSON invalide." }, 400);
  }
  if (!env.WRITE_PASSWORD) {
    return jsonResponse({ success: false, error: "Relais mal configuré (mot de passe absent)." }, 500);
  }
  if (!safeEqual(body.password, env.WRITE_PASSWORD)) {
    return jsonResponse({ success: false, error: "Mot de passe incorrect." }, 401);
  }
  if (!env.MAIL_USER || !env.MAIL_PASSWORD) {
    return jsonResponse({ success: false, error: "Boîte mail non configurée sur le relais (MAIL_USER / MAIL_PASSWORD)." }, 503);
  }
  try {
    let minuteur;
    const delai = new Promise((_, refuser) => {
      minuteur = setTimeout(() => refuser(new Error("Le serveur mail ne répond pas.")), IMAP_DELAI_MS);
    });
    const resultat = await Promise.race([lireMailsNonLus(env), delai]);
    clearTimeout(minuteur);
    return jsonResponse({ success: true, ...resultat, verifieLe: new Date().toISOString() });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || "Erreur de lecture de la boîte mail." }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/write" && request.method === "POST") {
      return handleWrite(request, env);
    }

    if (url.pathname === "/delete" && request.method === "POST") {
      return handleDelete(request, env);
    }

    if (url.pathname === "/read" && request.method === "POST") {
      return handleRead(request, env);
    }

    if (url.pathname === "/kdrive-upload" && request.method === "POST") {
      return handleKdriveUpload(request, env);
    }

    if (url.pathname === "/kdrive-list" && request.method === "POST") {
      return handleKdriveList(request, env);
    }

    if (url.pathname === "/kdrive-download" && request.method === "POST") {
      return handleKdriveDownload(request, env);
    }

    if (url.pathname === "/kdrive-gnetdata" && request.method === "POST") {
      return handleKdriveGnetdata(request, env);
    }

    if (url.pathname === "/depot-clients" && request.method === "POST") {
      return handleDepotClients(request, env);
    }

    if (url.pathname === "/depot-upload" && request.method === "POST") {
      return handleDepotUpload(request, env);
    }

    if (url.pathname === "/depot-liste" && request.method === "POST") {
      return handleDepotListe(request, env);
    }

    if (url.pathname === "/depot-telecharger" && request.method === "POST") {
      return handleDepotTelecharger(request, env);
    }

    if (url.pathname === "/mails-non-lus" && request.method === "POST") {
      return handleMailsNonLus(request, env);
    }

    return jsonResponse({ success: false, error: "Route inconnue." }, 404);
  },
};
