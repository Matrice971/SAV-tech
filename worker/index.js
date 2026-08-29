/**
 * SAV-tech — Relais Cloudflare Workers
 *
 * Détient seul le token GitHub avec droits d'écriture. Reçoit les demandes
 * d'écriture des applis technicien/gestion, vérifie un mot de passe partagé,
 * puis écrit le fichier dans /data/clients/ du dépôt GitHub via l'API GitHub.
 *
 * Variables d'environnement attendues (jamais en dur dans le code) :
 * - WRITE_PASSWORD : mot de passe partagé pour ce test (auth par technicien viendra plus tard)
 * - GITHUB_TOKEN    : token GitHub (fine-grained PAT) avec droit "Contents: Read and write"
 *                      sur le dépôt Matrice971/SAV-tech uniquement
 */

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/write" && request.method === "POST") {
      return handleWrite(request, env);
    }

    return jsonResponse({ success: false, error: "Route inconnue." }, 404);
  },
};
