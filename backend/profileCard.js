// Carte de profil (image 1200×630) utilisée comme aperçu quand on partage le lien d'un profil (WhatsApp, etc.).
// Elle montre : couverture, photo, nom, @pseudo et bio. JAMAIS la présence en ligne. Les statistiques (posts, abonnés,
// abonnements) n'apparaissent que si le membre a choisi de les afficher (users.public_preview_stats).
//
// L'image est dessinée en SVG puis convertie en PNG avec @resvg/resvg-js (polices DejaVu fournies dans assets/fonts :
// aucun besoin de polices sur le serveur). Si aucun convertisseur n'est installé, isAvailable() renvoie false et le site
// retombe sur la simple photo de profil. Ce module ne lève jamais d'erreur au chargement.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { width: textWidth } = require('./profileCardMetrics');
const { isOwnMediaUrl } = require('./mediaUrl');

let Resvg = null;
try { ({ Resvg } = require('@resvg/resvg-js')); } catch { Resvg = null; }
let sharp = null;
try { sharp = require('sharp'); } catch { sharp = null; }

const FONT_REGULAR = path.join(__dirname, 'assets/fonts/DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, 'assets/fonts/DejaVuSans-Bold.ttf');
const FAMILY = 'DejaVu Sans';

function isAvailable() {
  return !!(Resvg || sharp);
}

// ---------- Texte ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Garde seulement les caractères que la police sait dessiner (pas d'emojis ni de caractères exotiques). */
function plain(s) {
  return String(s || '')
    .replace(/[^\u0020-\u024F\u2010-\u2027\u2030-\u205E\u20AC\u0370-\u03FF\u0400-\u04FF\n]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fit(text, size, maxW, bold = false) {
  if (textWidth(text, size, bold) <= maxW) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}…`, size, bold) > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function wrap(text, size, maxW, maxLines) {
  const words = text.split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (let w of words) {
    // mot plus long qu'une ligne : on le coupe
    while (textWidth(w, size) > maxW) {
      let i = w.length;
      while (i > 1 && textWidth(w.slice(0, i), size) > maxW) i--;
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(w.slice(0, i));
      w = w.slice(i);
    }
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, size) <= maxW) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    // dernière ligne : on y remet la suite du texte puis on la raccourcit avec « … »
    kept[maxLines - 1] = fit(lines.slice(maxLines - 1).join(' '), size, maxW);
    return kept;
  }
  return lines;
}

function compact(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')} k`;
  return String(n);
}

// ---------- Dessin ----------
function buildSvg({ name, username, bio, avatar, cover, stats }) {
  const showStats = !!stats;
  const bioText = plain(bio) || 'Rejoins-moi sur Kalchat.';
  const bioLines = wrap(bioText, 26, 940, showStats ? 2 : 3);
  const displayName = fit(plain(name) || username, 44, 840, true);
  const initial = esc((plain(name) || username || 'K').charAt(0).toUpperCase());

  const coverEl = cover
    ? `<image xlink:href="${cover}" x="40" y="36" width="1120" height="194" preserveAspectRatio="xMidYMid slice" clip-path="url(#coverClip)"/>`
    : `<g clip-path="url(#coverClip)"><rect x="40" y="36" width="1120" height="194" fill="url(#coverDefault)"/>
        <circle cx="260" cy="60" r="150" fill="#fff" fill-opacity="0.08"/><circle cx="1010" cy="210" r="190" fill="#fff" fill-opacity="0.07"/></g>`;

  const avatarEl = avatar
    ? `<image xlink:href="${avatar}" x="82" y="154" width="156" height="156" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>`
    : `<circle cx="160" cy="232" r="78" fill="url(#btn)"/><text x="160" y="258" font-family="${FAMILY}" font-weight="700" font-size="76" fill="#fff" text-anchor="middle">${initial}</text>`;

  const bioEl = bioLines
    .map((l, i) => `<text x="104" y="${382 + i * 36}" font-family="${FAMILY}" font-size="26" fill="#e9e2ff">${esc(l)}</text>`)
    .join('');

  const statsEl = showStats
    ? [['Posts', stats.posts], ['Abonnés', stats.followers], ['Abonnements', stats.following]]
        .map(([label, n], i) => `<text x="${104 + i * 300}" y="478" font-family="${FAMILY}" font-weight="700" font-size="32" fill="#fff">${esc(compact(n))}</text><text x="${104 + i * 300}" y="504" font-family="${FAMILY}" font-size="20" fill="#a99bd6">${label}</text>`)
        .join('')
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a0618"/><stop offset="1" stop-color="#1c1042"/></linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#4f7cf6"/></linearGradient>
    <linearGradient id="btn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9b6cf8"/><stop offset="1" stop-color="#5a6df0"/></linearGradient>
    <linearGradient id="coverDefault" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c4dff"/><stop offset="1" stop-color="#2f6bf0"/></linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e0922" stop-opacity="0"/><stop offset="1" stop-color="#0e0922" stop-opacity="0.92"/></linearGradient>
    <clipPath id="coverClip"><path d="M40,230 V72 a36,36 0 0 1 36,-36 H1124 a36,36 0 0 1 36,36 V230 Z"/></clipPath>
    <clipPath id="avatarClip"><circle cx="160" cy="232" r="78"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="40" y="36" width="1120" height="558" rx="36" fill="#0e0922" stroke="url(#ring)" stroke-width="3"/>
  ${coverEl}
  <rect x="40" y="130" width="1120" height="100" fill="url(#fade)" clip-path="url(#coverClip)"/>
  <circle cx="160" cy="232" r="85" fill="#0e0922" stroke="url(#ring)" stroke-width="5"/>
  ${avatarEl}
  <text x="268" y="282" font-family="${FAMILY}" font-weight="700" font-size="44" fill="#fff">${esc(displayName)}</text>
  <text x="268" y="320" font-family="${FAMILY}" font-size="26" fill="#b79cff">@${esc(username)}</text>
  <rect x="80" y="356" width="5" height="${bioLines.length * 36 + 6}" rx="2.5" fill="#8b5cf6"/>
  ${bioEl}
  ${statsEl}
  <line x1="40" y1="522" x2="1160" y2="522" stroke="#ffffff" stroke-opacity="0.09" stroke-width="2"/>
  <rect x="80" y="536" width="48" height="48" rx="14" fill="url(#btn)"/>
  <text x="104" y="571" font-family="${FAMILY}" font-weight="700" font-size="34" fill="#fff" text-anchor="middle">K</text>
  <text x="144" y="560" font-family="${FAMILY}" font-weight="700" font-size="26" fill="#fff">Kalchat</text>
  <text x="144" y="580" font-family="${FAMILY}" font-size="16" fill="#a99bd6">Ta vibe, ta communauté</text>
  <rect x="900" y="536" width="220" height="48" rx="24" fill="url(#btn)"/>
  <text x="1010" y="568" font-family="${FAMILY}" font-weight="700" font-size="22" fill="#fff" text-anchor="middle">Voir le profil</text>
</svg>`;
}

// ---------- Images du profil (photo, couverture) ----------
function sniffMime(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null; // GIF, SVG et autres formats : ignorés
}

async function imageData(url, w, h) {
  if (!url || !/^https:\/\//.test(url) || !isOwnMediaUrl(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    if (Number(res.headers.get('content-length')) > 6 * 1024 * 1024) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 6 * 1024 * 1024) return null;
    const mime = sniffMime(buf);
    if (!mime) return null;
    if (sharp) {
      const out = await sharp(buf, { limitInputPixels: 40e6 }).rotate().resize(w, h, { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer();
      return `data:image/jpeg;base64,${out.toString('base64')}`;
    }
    return buf.length <= 700 * 1024 ? `data:${mime};base64,${buf.toString('base64')}` : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let active = 0;

/** Dessine la carte. user = { username, first_name, last_name, bio, avatar_url, cover_url } ; stats = null ou { posts, followers, following }. */
async function renderProfileCard(user, stats) {
  if (!isAvailable()) throw new Error('aucun convertisseur d\'image installé');
  if (active >= 2) throw new Error('busy');
  active++;
  try {
    const [avatar, cover] = await Promise.all([imageData(user.avatar_url, 256, 256), imageData(user.cover_url, 1120, 194)]);
    const name = [user.first_name, user.last_name].filter((x) => x && String(x).trim()).join(' ');
    const svg = buildSvg({ name, username: user.username, bio: user.bio, avatar, cover, stats });
    if (Resvg) {
      const r = new Resvg(svg, { fitTo: { mode: 'original' }, font: { fontFiles: [FONT_REGULAR, FONT_BOLD], loadSystemFonts: false, defaultFontFamily: FAMILY } });
      return Buffer.from(r.render().asPng());
    }
    return await sharp(Buffer.from(svg)).png().toBuffer();
  } finally {
    active--;
  }
}

/** Empreinte courte : change dès que le profil change (permet de renouveler l'image mise en cache par WhatsApp). */
function cardVersion(user, withStats) {
  const parts = [user.avatar_url, user.cover_url, user.bio, user.first_name, user.last_name, user.username, withStats ? `s${Math.floor(Date.now() / 3600000)}` : ''];
  return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 10);
}

module.exports = { isAvailable, renderProfileCard, cardVersion, buildSvg };
