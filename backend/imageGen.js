/**
 * Génération d'images pour Kora IA.
 * Deux fournisseurs, essayés dans l'ordre IMAGE_PROVIDERS (défaut : pollinations,gemini) :
 *   - Pollinations : POLLINATIONS_API_KEY (modèle : POLLINATIONS_MODEL, défaut « flux »)
 *   - Gemini       : GEMINI_API_KEY (modèles : GEMINI_IMAGE_MODEL, puis modèles de secours)
 * Si le premier échoue (quota, panne, délai dépassé), on passe automatiquement au suivant.
 */
let sharp = null;
try {
  sharp = require('sharp'); // facultatif : sert à compresser l'image avant stockage
} catch {
  /* pas installé : l'image est stockée telle quelle */
}

const POLLINATIONS_URL = process.env.POLLINATIONS_API_URL || 'https://gen.pollinations.ai';
const POLLINATIONS_MODEL = process.env.POLLINATIONS_MODEL || 'flux';
const GEMINI_MODELS = [...new Set([process.env.GEMINI_IMAGE_MODEL, 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'].filter(Boolean))];
const PROVIDERS = (process.env.IMAGE_PROVIDERS || 'pollinations,gemini')
  .split(',')
  .map((p) => p.trim().toLowerCase())
  .filter((p) => p === 'pollinations' || p === 'gemini');
const TIMEOUT_MS = 60000;
const MAX_BYTES = 8 * 1024 * 1024;

function isConfigured() {
  return !!(process.env.POLLINATIONS_API_KEY || process.env.GEMINI_API_KEY);
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function viaPollinations(prompt) {
  const params = new URLSearchParams({ model: POLLINATIONS_MODEL, width: '1024', height: '1024', nologo: 'true', seed: String(Math.floor(Math.random() * 1e9)) });
  const headers = {};
  if (process.env.POLLINATIONS_API_KEY) headers.Authorization = `Bearer ${process.env.POLLINATIONS_API_KEY}`;
  const res = await fetchWithTimeout(`${POLLINATIONS_URL}/image/${encodeURIComponent(prompt)}?${params}`, { headers });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    const err = new Error(`Pollinations ${res.status} : ${detail}`);
    err.status = res.status;
    throw err;
  }
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!mime.startsWith('image/')) throw new Error(`Pollinations : réponse inattendue (${mime || 'type inconnu'})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error('Pollinations : image vide ou trop lourde');
  return { buffer, mime };
}

async function viaGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) throw new Error('Gemini : clé absente');
  let lastErr;
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        const err = new Error(`Gemini ${res.status} (${model}) : ${detail}`);
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const part = parts.find((p) => (p.inlineData || p.inline_data)?.data);
      const inline = part?.inlineData || part?.inline_data;
      if (!inline) throw new Error(`Gemini (${model}) : aucune image dans la réponse (refus de contenu ?)`);
      const buffer = Buffer.from(inline.data, 'base64');
      if (!buffer.length || buffer.length > MAX_BYTES * 2) throw new Error('Gemini : image vide ou trop lourde');
      return { buffer, mime: inline.mimeType || inline.mime_type || 'image/png' };
    } catch (err) {
      lastErr = err;
      // Modèle introuvable / non autorisé sur ce compte → on essaie le suivant ; quota ou clé invalide → inutile d'insister
      if (![400, 403, 404].includes(err.status)) break;
    }
  }
  throw lastErr;
}

/** Réduit l'image (1024 px max, JPEG) pour économiser le stockage Supabase, si `sharp` est disponible. */
async function optimize({ buffer, mime }) {
  if (!sharp) return { buffer, mime };
  try {
    const out = await sharp(buffer).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    if (out.length < buffer.length) return { buffer: out, mime: 'image/jpeg' };
  } catch (err) {
    console.error('Compression image ignorée :', err.message);
  }
  return { buffer, mime };
}

function extensionFor(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

/** Génère une image. Renvoie { buffer, mime, provider } ou lève l'erreur du dernier fournisseur essayé. */
async function generateImage(prompt) {
  let lastErr = new Error('Aucun fournisseur d\'images configuré');
  for (const provider of PROVIDERS) {
    if (provider === 'gemini' && !process.env.GEMINI_API_KEY) continue;
    try {
      const raw = provider === 'gemini' ? await viaGemini(prompt) : await viaPollinations(prompt);
      const img = await optimize(raw);
      return { ...img, provider };
    } catch (err) {
      lastErr = err;
      console.error(`Image (${provider}) :`, err.message);
    }
  }
  throw lastErr;
}

// ---------- Filtre de sécurité sur la demande (avant tout appel à un fournisseur) ----------
const BLOCKED = [
  'porn\\w*', 'sexe', 'sexy', 'sexuel\\w*', 'sex', 'erotic\\w*', 'erotique\\w*', 'nsfw', 'hentai', 'xxx', 'nude\\w*', 'nu', 'nue', 'nus', 'nues',
  'naked', 'nudite', 'topless', 'seins', 'poitrine nue', 'fesses', 'lingerie', 'fetich\\w*', 'fetish\\w*',
  'gore', 'decapit\\w*', 'torture\\w*', 'mutil\\w*', 'cadavre\\w*', 'suicide', 'se suicider',
  'nazi\\w*', 'swastika', 'svastika',
];
const BLOCKED_RE = new RegExp(`\\b(?:${BLOCKED.join('|')})\\b`, 'i');

function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** true si la demande contient un terme interdit (contenu sexuel, gore, haine…). */
function isBlockedPrompt(text) {
  return BLOCKED_RE.test(normalize(text));
}

module.exports = { isConfigured, generateImage, isBlockedPrompt, extensionFor };
