// Aperçu des liens externes envoyés dans les conversations (titre, description, miniature).
//
// SÉCURITÉ — ce module fait des requêtes réseau à la place d'un membre, donc :
//  - seulement http/https, ports 80/443, sans identifiants dans l'adresse ;
//  - l'adresse IP réelle est vérifiée AU MOMENT de la connexion (pas de contournement par DNS) et toute IP privée,
//    locale ou réservée est refusée (réseau interne, métadonnées cloud 169.254.169.254, etc.) ;
//  - chaque redirection est revalidée (4 maximum) ;
//  - délai total, taille de réponse et types de contenu limités ; aucun cookie ni en-tête d'authentification envoyé ;
//  - les textes sont nettoyés et raccourcis (le front les affiche en texte, jamais en HTML) ;
//  - l'image est téléchargée par le SERVEUR puis réduite : le téléphone du membre ne contacte jamais le site externe.
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const zlib = require('zlib');

let sharp = null;
try {
  sharp = require('sharp'); // facultatif : sans lui, seules les petites images déjà légères sont gardées
} catch {
  sharp = null;
}

const UA = 'Mozilla/5.0 (compatible; KalchatLinkPreview/1.0; +https://kalchat.site)';
const MAX_REDIRECTS = 4;
const HTML_MAX_BYTES = 512 * 1024;
const IMAGE_MAX_BYTES = 1.5 * 1024 * 1024;
const THUMB_MAX_BYTES = 45 * 1024; // taille maximale de la miniature renvoyée au téléphone
const TOTAL_TIMEOUT_MS = 6000;
const OK_TTL_MS = 24 * 60 * 60 * 1000;
const FAIL_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 500;
const MAX_CONCURRENT = 4;

// ---------- Adresses interdites ----------
function ipv4Blocked(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // partage d'adresses des opérateurs (CGNAT)
  if (a === 169 && b === 254) return true; // lien local + métadonnées cloud
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true; // multicast, réservé, diffusion
  return false;
}

function ipv6Blocked(ip) {
  let s = ip.toLowerCase().split('%')[0];
  // IPv4 « mappée » (::ffff:a.b.c.d ou ::ffff:7f00:1) : on vérifie l'IPv4 cachée dedans
  const dotted = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return ipv4Blocked(dotted[1]);
  const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return ipv4Blocked(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  // On n'autorise que les adresses publiques « globales » 2000::/3, sauf documentation, 6to4 et Teredo
  const first = parseInt(s.split(':')[0] || '0', 16);
  if (!(first >= 0x2000 && first <= 0x3fff)) return true;
  if (s.startsWith('2001:db8') || s.startsWith('2002:') || s.startsWith('2001:0:') || s.startsWith('2001::')) return true;
  return false;
}

function isBlockedIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return ipv4Blocked(ip);
  if (v === 6) return ipv6Blocked(ip);
  return true;
}

// Vérifie l'IP réelle au moment de la connexion (tous les résultats DNS doivent être publics)
function safeLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) return cb(new Error('Adresse non autorisée'));
    if (options && options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

const OWN_HOSTS = ['kalchat.site'];

/** Renvoie l'objet URL si l'adresse est autorisée, sinon null. */
function validateUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return null;
  if (OWN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null; // nos propres pages : pas de requête vers soi-même
  if (net.isIP(host)) return isBlockedIp(host) ? null : u; // une IP écrite en toutes lettres ne passe pas par le DNS
  if (!host.includes('.') || /\.(local|localhost|internal|lan|home|corp|intranet)$/.test(host)) return null;
  u.hash = '';
  return u;
}

// ---------- Téléchargement limité ----------
let active = 0;

function fetchLimited(urlObj, { accept, maxBytes, deadline }) {
  return new Promise((resolve, reject) => {
    const lib = urlObj.protocol === 'https:' ? https : http;
    const req = lib.request(
      urlObj,
      {
        method: 'GET',
        lookup: safeLookup,
        agent: false,
        headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'fr,en;q=0.8', 'Accept-Encoding': 'gzip, deflate, br' },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location || null, body: null, headers: res.headers });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return resolve({ status, body: null, headers: res.headers });
        }
        let stream = res;
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
        else if (enc && enc !== 'identity') {
          res.resume();
          return reject(new Error('Encodage non géré'));
        }
        const chunks = [];
        let total = 0;
        let done = false;
        const finish = (truncated) => {
          if (done) return;
          done = true;
          req.destroy();
          resolve({ status, body: Buffer.concat(chunks), headers: res.headers, truncated });
        };
        stream.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (total - maxBytes))));
            finish(true);
          } else {
            chunks.push(chunk);
          }
        });
        stream.on('end', () => finish(false));
        stream.on('error', (e) => { if (!done) { done = true; reject(e); } });
      }
    );
    const left = Math.max(500, deadline - Date.now());
    const timer = setTimeout(() => req.destroy(new Error('Délai dépassé')), left);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end();
  });
}

/** Suit les redirections (max 4), en revalidant chaque adresse. */
async function fetchFollowing(startUrl, opts) {
  let current = validateUrl(startUrl);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (!current) throw new Error('Adresse non autorisée');
    const r = await fetchLimited(current, opts);
    if (r.status >= 300 && r.status < 400 && r.location) {
      let next;
      try { next = new URL(r.location, current).toString(); } catch { throw new Error('Redirection invalide'); }
      current = validateUrl(next);
      continue;
    }
    return { ...r, finalUrl: current };
  }
  throw new Error('Trop de redirections');
}

// ---------- Lecture des balises ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', eacute: 'é', egrave: 'è', agrave: 'à' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 31 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function clean(s, max) {
  if (!s) return '';
  const t = decodeEntities(String(s)).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function decodeBody(buf, contentType) {
  let charset = (/charset=["']?([\w-]+)/i.exec(contentType || '') || [])[1];
  if (!charset) charset = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1')) || [])[1];
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

function parseMeta(html, baseUrl) {
  const end = html.search(/<\/head>/i);
  const head = end > 0 ? html.slice(0, end) : html.slice(0, 200 * 1024);
  const meta = {};
  const tagRe = /<meta\s[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(head)) !== null) {
    const attrs = {};
    const attrRe = /([a-zA-Z_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let a;
    while ((a = attrRe.exec(m[0])) !== null) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content !== undefined && !(key in meta)) meta[key] = attrs.content;
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const title = clean(meta['og:title'] || meta['twitter:title'] || (titleTag ? titleTag[1] : ''), 140);
  const description = clean(meta['og:description'] || meta['twitter:description'] || meta.description, 220);
  const siteName = clean(meta['og:site_name'], 60);
  let image = null;
  const rawImage = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'];
  if (rawImage) {
    try {
      const abs = new URL(decodeEntities(rawImage).trim(), baseUrl);
      if (abs.protocol === 'http:' || abs.protocol === 'https:') image = abs.toString();
    } catch { /* image ignorée */ }
  }
  return { title, description, siteName, image };
}

// ---------- Miniature ----------
function sniffImage(buf) {
  if (buf.length > 12) {
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
    if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    if (buf.toString('latin1', 0, 3) === 'GIF') return 'image/gif';
  }
  return null; // SVG et autres formats : refusés
}

async function makeThumbnail(imageUrl, deadline) {
  const r = await fetchFollowing(imageUrl, { accept: 'image/avif,image/webp,image/*;q=0.8', maxBytes: IMAGE_MAX_BYTES, deadline });
  if (!r.body || r.truncated) return null; // image trop lourde : on ne garde pas de miniature
  const mime = sniffImage(r.body);
  if (!mime) return null;
  if (sharp) {
    for (const [width, quality] of [[480, 72], [360, 55], [280, 40]]) {
      const out = await sharp(r.body, { limitInputPixels: 24e6 }).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (out.length <= THUMB_MAX_BYTES) return `data:image/jpeg;base64,${out.toString('base64')}`;
    }
    return null;
  }
  return r.body.length <= THUMB_MAX_BYTES && mime !== 'image/gif' ? `data:${mime};base64,${r.body.toString('base64')}` : null;
}

// ---------- Cache + une seule requête à la fois par adresse ----------
const cache = new Map(); // adresse -> { value, expires }
const inflight = new Map();

function cacheSet(key, value, ttl) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + ttl });
}

async function build(urlObj) {
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  const r = await fetchFollowing(urlObj.toString(), { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', maxBytes: HTML_MAX_BYTES, deadline });
  const type = String(r.headers['content-type'] || '').toLowerCase();
  if (!r.body || !/text\/html|application\/xhtml\+xml/.test(type)) return null;
  const info = parseMeta(decodeBody(r.body, type), r.finalUrl);
  if (!info.title && !info.description) return null; // rien d'exploitable : pas de carte
  let image = null;
  if (info.image) {
    try { image = await makeThumbnail(info.image, deadline); } catch { image = null; }
  }
  return {
    url: r.finalUrl.toString(),
    domain: r.finalUrl.hostname.replace(/^www\./, ''),
    title: info.title || info.siteName || r.finalUrl.hostname,
    description: info.title ? info.description : '',
    site_name: info.siteName || null,
    image,
  };
}

/** Renvoie l'aperçu d'une adresse, ou null. Lève une erreur « busy » si le serveur est déjà très occupé. */
async function getLinkPreview(rawUrl) {
  const urlObj = validateUrl(rawUrl);
  if (!urlObj) return null;
  const key = urlObj.toString();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  if (active >= MAX_CONCURRENT) {
    const e = new Error('busy');
    e.code = 'BUSY';
    throw e;
  }
  active++;
  const p = build(urlObj)
    .then((v) => { cacheSet(key, v, v ? OK_TTL_MS : FAIL_TTL_MS); return v; })
    .catch(() => { cacheSet(key, null, FAIL_TTL_MS); return null; })
    .finally(() => { active--; inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

module.exports = { getLinkPreview, validateUrl, isBlockedIp, _test: { parseMeta, clean } };
