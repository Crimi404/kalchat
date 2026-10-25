// Aperçus des liens Kalchat (WhatsApp, Telegram, Facebook…) : ces applications lisent le HTML SANS exécuter JavaScript.
// Pour les adresses partagées (/u/pseudo, /post/id, /?k=id, /communaute/id, /groupe/jeton), on renvoie donc index.html
// avec des balises Open Graph déjà remplies. Le site fonctionne ensuite exactement comme avant (même page, même appli).
//
// VIE PRIVÉE : profils et publications ne sont détaillés (nom, avatar, bio, extrait, image) que si le membre a activé
// « Aperçu public » dans Confidentialité (users.public_preview). Sinon : carte neutre Kalchat, identique pour un compte
// inexistant ou refusé (on ne révèle rien). Communautés, groupes et stories : toujours neutres.
// En cas d'erreur, on laisse la main au site normal (next()).
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { isOwnMediaUrl } = require('./mediaUrl');
const { USERNAME_RE } = require('./usernamePolicy');
const profileCard = require('./profileCard');

const SITE = (process.env.PUBLIC_URL || 'https://kalchat.site').replace(/\/+$/, '');
const DEFAULT_IMAGE = `${SITE}/og-default.png`;
const DEFAULT_TITLE = 'Kalchat — Ta vibe, ta communauté';
const DEFAULT_DESC = "Kalchat, l'application de messagerie sociale : communication, liberté, confidentialité et innovation.";
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cut(s, max) {
  const t = String(s || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function fullName(u) {
  return [u.first_name, u.last_name].filter((x) => x && String(x).trim()).join(' ').trim() || u.username;
}

function imageOrDefault(url) {
  return url && /^https:\/\//.test(url) && isOwnMediaUrl(url) ? url : DEFAULT_IMAGE;
}

function card(partial) {
  return { title: DEFAULT_TITLE, description: DEFAULT_DESC, image: DEFAULT_IMAGE, type: 'website', pagePath: '/', ...partial };
}

function render(template, c) {
  const large = c.large ?? c.image === DEFAULT_IMAGE;
  const tags = [
    `<title>${esc(c.title)}</title>`,
    `<meta name="description" content="${esc(c.description)}" />`,
    `<meta property="og:site_name" content="Kalchat" />`,
    `<meta property="og:locale" content="fr_FR" />`,
    `<meta property="og:type" content="${esc(c.type)}" />`,
    `<meta property="og:title" content="${esc(c.title)}" />`,
    `<meta property="og:description" content="${esc(c.description)}" />`,
    `<meta property="og:url" content="${esc(SITE + c.pagePath)}" />`,
    `<meta property="og:image" content="${esc(c.image)}" />`,
    ...(large ? [`<meta property="og:image:width" content="1200" />`, `<meta property="og:image:height" content="630" />`] : []),
    `<meta name="twitter:card" content="${large ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(c.title)}" />`,
    `<meta name="twitter:description" content="${esc(c.description)}" />`,
    `<meta name="twitter:image" content="${esc(c.image)}" />`,
  ].join('\n    ');
  const stripped = template
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+(?:property|name)=["'](?:og:|twitter:|description)[^>]*>\s*/gi, '');
  return stripped.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

module.exports = function ogPages(frontDist) {
  const router = express.Router();
  let template; // index.html lu une seule fois

  function load() {
    if (template === undefined) {
      try {
        template = fs.readFileSync(path.join(frontDist, 'index.html'), 'utf8');
      } catch {
        template = null;
      }
    }
    return template;
  }

  // Évite qu'un robot ne fasse travailler la base en boucle : au-delà, carte neutre sans requête
  const hits = new Map();
  function allowed(ip) {
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < 60 * 1000);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) hits.clear();
    return recent.length <= 60;
  }

  function send(req, res, next, c) {
    const tpl = load();
    if (!tpl) return next();
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=120');
    res.send(render(tpl, c));
  }

  const route = (build) => async (req, res, next) => {
    try {
      const c = await build(req);
      if (!c) return next();
      send(req, res, next, c);
    } catch (err) {
      console.error('Aperçu de lien :', err.message);
      next(); // le site normal prend le relais
    }
  };

  router.get('/u/:username', route(async (req) => {
    const username = String(req.params.username || '').toLowerCase();
    const neutral = card({ title: 'Un profil sur Kalchat', description: "Ouvre ce profil sur Kalchat, l'application de messagerie sociale.", pagePath: '/' });
    if (!USERNAME_RE.test(username) || !allowed(req.ip)) return neutral;
    const u = await db.prepare('SELECT username, first_name, last_name, avatar_url, cover_url, bio, is_blocked, public_preview, public_preview_stats FROM users WHERE username = ?').get(username);
    if (!u || u.is_blocked || Number(u.public_preview) !== 1) return neutral;
    // Carte de profil complète (couverture, photo, nom, bio) si le convertisseur d'images est installé ; sinon, simple photo
    const cardOk = profileCard.isAvailable();
    return card({
      title: `${fullName(u)} (@${u.username}) sur Kalchat`,
      description: cut(u.bio, 160) || `Retrouve @${u.username} sur Kalchat.`,
      image: cardOk ? `${SITE}/og/u/${u.username}.png?v=${profileCard.cardVersion(u, Number(u.public_preview_stats) === 1)}` : imageOrDefault(u.avatar_url),
      large: cardOk,
      type: 'profile',
      pagePath: `/u/${u.username}`,
    });
  }));

  router.get('/post/:id', route(async (req) => {
    const neutral = card({ title: 'Une publication sur Kalchat', description: 'Ouvre cette publication sur Kalchat, l\'application de messagerie sociale.', pagePath: '/' });
    const id = String(req.params.id || '');
    if (!ID_RE.test(id) || !allowed(req.ip)) return neutral;
    const p = await db
      .prepare(
        `SELECT p.content, p.media_url, p.media_type, p.community_id, u.username, u.first_name, u.last_name, u.is_blocked, u.public_preview
         FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`
      )
      .get(id);
    if (!p || p.community_id || p.is_blocked || Number(p.public_preview) !== 1) return neutral;
    const isImage = p.media_url && (!p.media_type || p.media_type === 'image') && !/\.(mp4|webm|mov|m4v|3gp|mkv|avi)(\?|#|$)/i.test(p.media_url);
    return card({
      title: `Publication de ${fullName(p)} sur Kalchat`,
      description: cut(p.content, 200) || 'Voir cette publication sur Kalchat.',
      image: isImage ? imageOrDefault(p.media_url) : DEFAULT_IMAGE,
      pagePath: `/post/${id}`,
    });
  }));

  // Image de la carte de profil (1200×630). Même règle de vie privée que la page : sans « Aperçu public », image neutre.
  const defaultImage = () => {
    try { return fs.readFileSync(path.join(frontDist, 'og-default.png')); } catch { return null; }
  };
  const cardCache = new Map(); // clé : pseudo + empreinte du profil
  router.get(/^\/og\/u\/([A-Za-z0-9_.-]{1,40})\.png$/, async (req, res, next) => {
    const sendDefault = () => {
      const buf = defaultImage();
      if (!buf) return next();
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=300');
      res.send(buf);
    };
    try {
      const username = String(req.params[0] || '').toLowerCase();
      if (!USERNAME_RE.test(username) || !profileCard.isAvailable() || !allowed(req.ip)) return sendDefault();
      const u = await db
        .prepare('SELECT id, username, first_name, last_name, avatar_url, cover_url, bio, is_blocked, public_preview, public_preview_stats FROM users WHERE username = ?')
        .get(username);
      if (!u || u.is_blocked || Number(u.public_preview) !== 1) return sendDefault();

      const withStats = Number(u.public_preview_stats) === 1;
      const key = `${u.username}|${profileCard.cardVersion(u, withStats)}`;
      let png = cardCache.get(key);
      if (!png) {
        let stats = null;
        if (withStats) {
          const n = async (sql) => Number((await db.prepare(sql).get(u.id))?.n) || 0;
          stats = {
            posts: await n('SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND community_id IS NULL'),
            followers: await n("SELECT COUNT(*) AS n FROM follows WHERE followed_id = ? AND status = 'accepted'"),
            following: await n("SELECT COUNT(*) AS n FROM follows WHERE follower_id = ? AND status = 'accepted'"),
          };
        }
        png = await profileCard.renderProfileCard(u, stats);
        if (cardCache.size >= 100) cardCache.delete(cardCache.keys().next().value);
        cardCache.set(key, png);
      }
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=3600');
      res.send(png);
    } catch (err) {
      console.error('Carte de profil :', err.message);
      sendDefault();
    }
  });

  // Vidéo K-Short : /?k=identifiant (la page d'accueil sans ?k= reste servie normalement)
  router.get('/', route(async (req) => {
    const k = req.query.k;
    if (typeof k !== 'string') return null;
    const neutral = card({ title: 'Une vidéo K-Short sur Kalchat', description: 'Regarde cette vidéo courte sur Kalchat.', pagePath: '/' });
    if (!ID_RE.test(k) || !allowed(req.ip)) return neutral;
    const s = await db
      .prepare(
        `SELECT s.caption, s.status, s.expires_at, u.username, u.first_name, u.last_name, u.is_blocked, u.public_preview
         FROM shorts s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`
      )
      .get(k);
    const live = s && s.status === 'active' && s.expires_at && new Date(s.expires_at) > new Date();
    if (!live || !s.username || s.is_blocked || Number(s.public_preview) !== 1) return neutral;
    return card({
      title: `K-Short de ${fullName(s)} sur Kalchat`,
      description: cut(s.caption, 200) || 'Regarde cette vidéo sur Kalchat.',
      pagePath: `/?k=${k}`,
    });
  }));

  // Communautés et groupes : toujours neutres (aucune requête en base)
  router.get('/communaute/:id', route(async () => card({ title: 'Une communauté sur Kalchat', description: 'Rejoins cette communauté sur Kalchat.', pagePath: '/' })));
  router.get('/groupe/:token', route(async () => card({ title: 'Invitation à un groupe Kalchat', description: 'Tu es invité(e) à rejoindre un groupe sur Kalchat.', pagePath: '/' })));

  return router;
};
