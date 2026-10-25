// Fournisseur de GIFs et de stickers : KLIPY (gratuit). La clé reste sur le serveur (variable KLIPY_API_KEY sur Render).
// Seul le LIEN du GIF / sticker est enregistré dans le message : rien n'est stocké chez nous.
//
// Les adresses acceptées pour un message GIF / sticker sont uniquement celles que ce serveur a lui-même reçues de KLIPY
// (on retient les noms de domaine renvoyés par l'API) : impossible d'envoyer une adresse quelconque en se faisant passer pour un GIF.
const BASE = 'https://api.klipy.com/api/v1';
const PER_PAGE = 24;
const TIMEOUT_MS = 5000;
const CACHE_MAX = 400;
const TRENDING_TTL_MS = 10 * 60 * 1000;
const SEARCH_TTL_MS = 30 * 60 * 1000;

const learnedHosts = new Set();
const cache = new Map(); // clé -> { value, expires }

function apiKey() {
  return (process.env.KLIPY_API_KEY || '').trim();
}

function isConfigured() {
  return !!apiKey();
}

function cleanText(s, max) {
  return String(s || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Choisit le premier format disponible, dans l'ordre des tailles puis des formats demandés. */
function pick(file, sizes, formats) {
  for (const size of sizes) {
    for (const format of formats) {
      const o = file?.[size]?.[format];
      if (o && typeof o.url === 'string' && o.url) return o;
    }
  }
  return null;
}

function safeUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'https:' || u.username || u.password || String(raw).length > 600) return null;
    return u;
  } catch {
    return null;
  }
}

function normalizeItem(it) {
  if (!it || typeof it !== 'object') return null;
  const file = it.file || it.files || {};
  // Envoi : taille moyenne (légère pour les données mobiles), WebP animé si disponible sinon GIF
  const full = pick(file, ['md', 'hd', 'sm'], ['webp', 'gif']);
  const small = pick(file, ['sm', 'xs', 'md'], ['webp', 'gif', 'jpg']) || full;
  if (!full) return null;
  const fullUrl = safeUrl(full.url);
  const smallUrl = safeUrl(small.url);
  if (!fullUrl || !smallUrl) return null;
  const id = String(it.slug || it.id || '');
  if (!id) return null;
  return {
    id: id.slice(0, 120),
    title: cleanText(it.title, 80),
    url: fullUrl.toString(),
    preview: smallUrl.toString(),
    width: Number(full.width) || null,
    height: Number(full.height) || null,
    _hosts: [fullUrl.hostname, smallUrl.hostname],
  };
}

function cacheGet(key) {
  const hit = cache.get(key);
  return hit && hit.expires > Date.now() ? hit.value : null;
}

function cacheSet(key, value, ttl) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + ttl });
}

/** Recherche (ou tendances si q est vide). type = 'gif' | 'sticker'. Renvoie { items, next } (next = page suivante ou null). */
async function search({ type, q, page }) {
  const kind = type === 'sticker' ? 'stickers' : 'gifs';
  const query = cleanText(q, 60);
  const pageNum = Math.min(Math.max(parseInt(page, 10) || 1, 1), 20);
  const key = `${kind}|${query.toLowerCase()}|${pageNum}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const params = new URLSearchParams({ per_page: String(PER_PAGE), page: String(pageNum) });
  if (query) params.set('q', query);
  const url = `${BASE}/${encodeURIComponent(apiKey())}/${kind}/${query ? 'search' : 'trending'}?${params}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let body;
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch (err) {
    // On ne journalise jamais l'adresse complète : elle contient la clé
    throw new Error(`fournisseur de GIFs indisponible (${err.name === 'AbortError' ? 'délai dépassé' : err.message})`);
  } finally {
    clearTimeout(timer);
  }

  const payload = body && body.data && !Array.isArray(body.data) ? body.data : body;
  const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(body?.data) ? body.data : [];
  const items = [];
  for (const raw of list) {
    const item = normalizeItem(raw);
    if (!item) continue;
    item._hosts.forEach((h) => learnedHosts.add(h.toLowerCase()));
    delete item._hosts;
    items.push(item);
  }
  if (list.length && !items.length) console.warn('⚠️ GIFs : réponse du fournisseur reçue mais format non reconnu');
  const hasNext = !!(payload?.has_next ?? false);
  const value = { items, next: hasNext && items.length ? pageNum + 1 : null };
  cacheSet(key, value, query ? SEARCH_TTL_MS : TRENDING_TTL_MS);
  return value;
}

/** Une adresse de GIF / sticker est acceptée seulement si elle vient d'un domaine déjà renvoyé par le fournisseur. */
function isProviderMediaUrl(raw) {
  const u = safeUrl(raw);
  return !!u && learnedHosts.has(u.hostname.toLowerCase());
}

module.exports = { isConfigured, search, isProviderMediaUrl };
