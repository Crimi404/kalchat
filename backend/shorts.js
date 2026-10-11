const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('./db');
const r2 = require('./r2');
const authMiddleware = require('./middleware/auth');

// =====================================================================================
// K-Short — vidéos courtes verticales (phase 1 : serveur)
// - Fichiers sur Cloudflare R2 (bucket PRIVÉ) ; données dans Postgres (Supabase).
// - Désactivé tant que les variables R2_* ne sont pas renseignées sur Render : aucun effet sur le reste de Kalchat.
// - L'expiration est calculée par le SERVEUR (60 jours maximum, contrainte aussi en base).
// =====================================================================================

// ---------- Réglages ----------
const MAX_DAYS = 60;
const DEFAULT_DAYS = 30;
const MAX_SECONDS = 60;
const MAX_MB = Number(process.env.SHORTS_MAX_MB) || 50;
const SHORTS_PER_DAY = Number(process.env.SHORTS_PER_DAY) || 10; // envois par membre et par 24 h
const MAX_PENDING = 3; // envois commencés mais pas terminés
const PUT_TTL_SEC = 600; // l'URL d'envoi vaut 10 minutes
const GET_TTL_SEC = Math.min(3600, Math.max(300, Number(process.env.SHORTS_GET_TTL_SEC) || 1800)); // l'URL de lecture vaut 30 min
const FEED_PAGE = 10;
const COMMENT_MAX = 500;
const CAPTION_MAX = 500;
const DELETE_MAX_ATTEMPTS = 10;
const TOMBSTONE_DAYS = 90; // trace minimale conservée après expiration (modération, liens partagés)

const ALLOWED_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

// ---------- Schéma ----------
// Statuts : pending (envoi en cours) -> active -> expired | deleted ; abandoned (envoi jamais terminé) ; rejected (fichier refusé).
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS shorts (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    caption TEXT,
    r2_key TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    size_bytes BIGINT,
    duration_seconds REAL,
    retention_days INTEGER NOT NULL CHECK (retention_days BETWEEN 1 AND ${MAX_DAYS}),
    in_feed BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    r2_deleted_at TIMESTAMPTZ,
    delete_attempts INTEGER NOT NULL DEFAULT 0,
    delete_next_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_shorts_feed ON shorts (published_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_shorts_user ON shorts (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_shorts_status ON shorts (status, delete_next_at);

  CREATE TABLE IF NOT EXISTS short_likes (
    short_id TEXT NOT NULL REFERENCES shorts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (short_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS short_comments (
    id TEXT PRIMARY KEY,
    short_id TEXT NOT NULL REFERENCES shorts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_short_comments_short ON short_comments (short_id, created_at);
  ALTER TABLE short_comments ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES short_comments(id) ON DELETE CASCADE;

  ALTER TABLE shorts ADD COLUMN IF NOT EXISTS allow_download BOOLEAN NOT NULL DEFAULT TRUE;

  CREATE TABLE IF NOT EXISTS short_saves (
    short_id TEXT NOT NULL REFERENCES shorts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (short_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS short_reposts (
    short_id TEXT NOT NULL REFERENCES shorts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (short_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS short_hidden (
    short_id TEXT NOT NULL REFERENCES shorts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (short_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS short_comment_likes (
    comment_id TEXT NOT NULL REFERENCES short_comments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (comment_id, user_id)
  );
`;

// ---------- Outils ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
  console.error('K-Short :', err.message);
  if (!res.headersSent) res.status(500).json({ error: 'Erreur du serveur K-Short' });
});

function parseBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function isStaffRow(u) {
  return !!u && (!!u.is_admin || u.role === 'moderator');
}

/** Forme envoyée au client. L'URL de lecture n'est fournie que pour une vidéo active ET non expirée. */
function present(row, viewerId) {
  const live = row.status === 'active' && row.expires_at && new Date(row.expires_at) > new Date();
  return {
    id: row.id,
    caption: row.caption,
    author: row.user_id ? { id: row.user_id, username: row.username, avatar_url: row.avatar_url, badge: row.badge, role: row.role, first_name: row.first_name, last_name: row.last_name } : null,
    content_type: row.content_type,
    duration_seconds: row.duration_seconds,
    in_feed: !!row.in_feed,
    published_at: row.published_at,
    expires_at: row.expires_at,
    like_count: Number(row.like_count || 0),
    comment_count: Number(row.comment_count || 0),
    repost_count: Number(row.repost_count || 0),
    liked: !!row.liked,
    reposted: !!row.reposted,
    saved: !!row.saved,
    allow_download: row.allow_download !== false,
    follow_status: row.follow_status === 'accepted' || row.follow_status === 'pending' ? row.follow_status : 'none',
    mine: row.user_id === viewerId,
    video_url: live ? r2.signedUrl('GET', row.r2_key, { expiresSec: GET_TTL_SEC }) : null,
    video_url_ttl: live ? GET_TTL_SEC : null,
  };
}

const SELECT_SHORT = `
  SELECT s.id, s.user_id, s.caption, s.r2_key, s.content_type, s.duration_seconds, s.in_feed, s.status, s.published_at, s.expires_at,
         s.allow_download, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name,
         to_char(s.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS published_cursor,
         (SELECT COUNT(*) FROM short_likes l WHERE l.short_id = s.id) AS like_count,
         (SELECT COUNT(*) FROM short_comments c WHERE c.short_id = s.id) AS comment_count,
         (SELECT COUNT(*) FROM short_reposts rp WHERE rp.short_id = s.id) AS repost_count,
         EXISTS (SELECT 1 FROM short_likes l WHERE l.short_id = s.id AND l.user_id = ?) AS liked,
         EXISTS (SELECT 1 FROM short_reposts rp WHERE rp.short_id = s.id AND rp.user_id = ?) AS reposted,
         EXISTS (SELECT 1 FROM short_saves sv WHERE sv.short_id = s.id AND sv.user_id = ?) AS saved,
         (SELECT f.status FROM follows f WHERE f.follower_id = ? AND f.followed_id = s.user_id) AS follow_status
  FROM shorts s
  LEFT JOIN users u ON u.id = s.user_id
`;

// SELECT_SHORT attend 4 fois l'identifiant du spectateur (aimé, republié, enregistré, abonnement), avant les autres paramètres
const V4 = (v) => [v, v, v, v];

// Hors blocages dans les deux sens et comptes bloqués par l'équipe
const NOT_BLOCKED = `
  AND u.is_blocked = 0
  AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = s.user_id) OR (b.blocker_id = s.user_id AND b.blocked_id = ?))
`;

/** Une vidéo qu'on peut montrer : active, non expirée, auteur non bloqué (et pas bloqué par / bloquant le spectateur). */
async function findLive(id, viewerId) {
  return db
    .prepare(`${SELECT_SHORT} WHERE s.id = ? AND s.status = 'active' AND s.expires_at > NOW() AND s.user_id IS NOT NULL ${NOT_BLOCKED}`)
    .get(...V4(viewerId), id, viewerId, viewerId);
}

// ---------- Routes (membres connectés) ----------
const router = express.Router();
router.use(authMiddleware);

// 1) Demande d'envoi : le serveur valide, crée la ligne « pending » et donne une URL d'envoi valable 10 min pour CE fichier uniquement
router.post('/upload-url', wrap(async (req, res) => {
  const contentType = String(req.body.content_type || '').split(';')[0].trim().toLowerCase();
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) return res.status(415).json({ error: 'Format non accepté (MP4, WebM ou MOV)' });

  const size = Number(req.body.size);
  if (!Number.isInteger(size) || size < 1) return res.status(400).json({ error: 'Taille du fichier manquante' });
  if (size > MAX_MB * 1024 * 1024) return res.status(413).json({ error: `Vidéo trop lourde (max ${MAX_MB} Mo)` });

  let duration = null;
  if (req.body.duration !== undefined && req.body.duration !== null && req.body.duration !== '') {
    duration = Number(req.body.duration);
    if (!Number.isFinite(duration) || duration <= 0) return res.status(400).json({ error: 'Durée invalide' });
    if (duration > MAX_SECONDS + 0.5) return res.status(400).json({ error: `Vidéo trop longue (max ${MAX_SECONDS} secondes)` });
  }

  // Durée de disponibilité choisie par l'auteur : 1 à 60 jours, jamais plus (contrôlé ici ET par une contrainte en base)
  const days = req.body.days === undefined || req.body.days === null || req.body.days === '' ? DEFAULT_DAYS : Number(req.body.days);
  if (!Number.isInteger(days) || days < 1) return res.status(400).json({ error: 'Durée de disponibilité invalide' });
  if (days > MAX_DAYS) return res.status(400).json({ error: `La durée maximale est de ${MAX_DAYS} jours` });

  const caption = typeof req.body.caption === 'string' ? req.body.caption.trim().slice(0, CAPTION_MAX) : '';

  const recent = await db.prepare("SELECT COUNT(*) AS n FROM shorts WHERE user_id = ? AND created_at > NOW() - INTERVAL '24 hours'").get(req.user.id);
  if (recent.n >= SHORTS_PER_DAY) return res.status(429).json({ error: `Limite atteinte : ${SHORTS_PER_DAY} vidéos par 24 h` });
  const pending = await db.prepare("SELECT COUNT(*) AS n FROM shorts WHERE user_id = ? AND status = 'pending' AND created_at > NOW() - INTERVAL '1 hour'").get(req.user.id);
  if (pending.n >= MAX_PENDING) return res.status(429).json({ error: 'Termine tes envois en cours avant d\'en commencer un autre' });

  const id = uuid();
  const key = `shorts/${req.user.id}/${id}.${ext}`;
  await db
    .prepare('INSERT INTO shorts (id, user_id, caption, r2_key, content_type, size_bytes, duration_seconds, retention_days, in_feed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.user.id, caption || null, key, contentType, size, duration, days, parseBool(req.body.in_feed));

  res.json({
    id,
    upload_url: r2.signedUrl('PUT', key, { expiresSec: PUT_TTL_SEC, contentType, contentLength: process.env.SHORTS_SIGN_LENGTH === '1' ? size : null }),
    headers: { 'Content-Type': contentType },
    expires_in: PUT_TTL_SEC,
  });
}));

// 2) Fin d'envoi : le serveur VÉRIFIE le fichier réellement reçu (existence, taille, type) avant de publier
router.post('/:id/complete', wrap(async (req, res) => {
  const s = await db.prepare('SELECT id, user_id, r2_key, content_type, status, retention_days FROM shorts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!s) return res.status(404).json({ error: 'Vidéo introuvable' });
  if (s.status === 'active') {
    const row = await findLive(s.id, req.user.id);
    return res.json(row ? present(row, req.user.id) : { id: s.id });
  }
  if (s.status !== 'pending') return res.status(409).json({ error: 'Cet envoi n\'est plus valable, recommence' });

  let info;
  try {
    info = await r2.head(s.r2_key);
  } catch (err) {
    console.error('K-Short (vérification R2) :', err.message);
    return res.status(502).json({ error: 'Stockage indisponible, réessaie dans un instant' });
  }
  if (!info.exists) return res.status(400).json({ error: 'Fichier introuvable : l\'envoi n\'est pas terminé' });

  const tooBig = info.size > MAX_MB * 1024 * 1024;
  const wrongType = info.contentType !== s.content_type;
  if (tooBig || wrongType || info.size < 1) {
    // Fichier refusé : il sera supprimé de R2 par la tâche de nettoyage
    await db.prepare("UPDATE shorts SET status = 'rejected', delete_next_at = NOW() WHERE id = ? AND status = 'pending'").run(s.id);
    if (tooBig) return res.status(413).json({ error: `Vidéo trop lourde (max ${MAX_MB} Mo)` });
    return res.status(415).json({ error: 'Le fichier reçu ne correspond pas à une vidéo valide' });
  }

  // La date d'expiration est calculée ICI, par le serveur, à partir de l'instant de publication
  await db
    .prepare("UPDATE shorts SET status = 'active', size_bytes = ?, published_at = NOW(), expires_at = NOW() + (retention_days * INTERVAL '1 day') WHERE id = ? AND status = 'pending'")
    .run(info.size, s.id);

  const row = await findLive(s.id, req.user.id);
  res.json(present(row, req.user.id));
}));

// Flux : vidéos actives, de la plus récente à la plus ancienne (curseur = « date|id » de la dernière vidéo reçue)
router.get('/feed', wrap(async (req, res) => {
  const params = [...V4(req.user.id), req.user.id, req.user.id, req.user.id];
  let cursorSql = '';
  if (req.query.cursor) {
    const [ts, cid] = String(req.query.cursor).split('|');
    if (!ts || !cid || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(ts)) return res.status(400).json({ error: 'Curseur invalide' });
    cursorSql = 'AND (s.published_at, s.id) < (?::timestamptz, ?)';
    params.push(ts, cid);
  }
  params.push(FEED_PAGE + 1);
  const rows = await db
    .prepare(`${SELECT_SHORT} WHERE s.status = 'active' AND s.expires_at > NOW() AND s.user_id IS NOT NULL ${NOT_BLOCKED} AND NOT EXISTS (SELECT 1 FROM short_hidden h WHERE h.short_id = s.id AND h.user_id = ?) ${cursorSql} ORDER BY s.published_at DESC, s.id DESC LIMIT ?`)
    .all(...params);
  const page = rows.slice(0, FEED_PAGE);
  const last = page[page.length - 1];
  res.json({
    items: page.map((r) => present(r, req.user.id)),
    next_cursor: rows.length > FEED_PAGE && last ? `${last.published_cursor}|${last.id}` : null,
  });
}));

// Mes vidéos (actives et non expirées)
router.get('/mine', wrap(async (req, res) => {
  const rows = await db
    .prepare(`${SELECT_SHORT} WHERE s.user_id = ? AND s.status = 'active' AND s.expires_at > NOW() ORDER BY s.published_at DESC, s.id DESC LIMIT 100`)
    .all(...V4(req.user.id), req.user.id);
  res.json({ items: rows.map((r) => present(r, req.user.id)) });
}));

// Recherche de vidéos (légende, auteur ou #hashtag) pour la page Explorer
router.get('/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').replace(/[%_\\]/g, '').trim().slice(0, 60);
  const tag = String(req.query.tag || '').replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '').toLowerCase().slice(0, 50);
  if (q.length < 2 && tag.length < 2) return res.json({ items: [] });
  let filter;
  let args;
  if (tag.length >= 2) {
    filter = `AND LOWER(COALESCE(s.caption, '')) ~ ?`;
    args = [`(^|[^[:alnum:]_#])#${tag}($|[^[:alnum:]_])`];
  } else {
    const like = `%${q}%`;
    filter = `AND (s.caption ILIKE ? OR u.username ILIKE ? OR u.first_name ILIKE ? OR u.last_name ILIKE ?)`;
    args = [like, like, like, like];
  }
  const rows = await db
    .prepare(`${SELECT_SHORT} WHERE s.status = 'active' AND s.expires_at > NOW() AND s.user_id IS NOT NULL ${NOT_BLOCKED} ${filter} ORDER BY s.published_at DESC, s.id DESC LIMIT 30`)
    .all(...V4(req.user.id), req.user.id, req.user.id, ...args);
  res.json({ items: rows.map((r) => present(r, req.user.id)) });
}));

// Hashtags des légendes de vidéos (7 derniers jours), à ajouter aux tendances de la page Explorer
router.get('/trending-tags', wrap(async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT LOWER(m[2]) AS tag, COUNT(DISTINCT s.id) AS count
       FROM shorts s, regexp_matches(s.caption, '(^|[^[:alnum:]_#])#([[:alpha:]0-9_]{2,50})', 'g') AS m
       WHERE s.caption IS NOT NULL AND s.status = 'active' AND s.expires_at > NOW() AND s.published_at > NOW() - INTERVAL '7 days'
       GROUP BY 1 ORDER BY count DESC, tag ASC LIMIT 10`
    )
    .all();
  res.json(rows);
}));

// Vidéos actives d'un membre (affichées dans sa page de profil, parmi ses publications)
router.get('/user/:userId', wrap(async (req, res) => {
  const rows = await db
    .prepare(`${SELECT_SHORT} WHERE s.user_id = ? AND s.status = 'active' AND s.expires_at > NOW() ${NOT_BLOCKED} ORDER BY s.published_at DESC, s.id DESC LIMIT 100`)
    .all(...V4(req.user.id), String(req.params.userId), req.user.id, req.user.id);
  res.json({ items: rows.map((r) => present(r, req.user.id)) });
}));

// Vidéos publiées aussi dans le fil classique (« K-Short + fil ») : ce sont les MÊMES vidéos, avec les mêmes likes et commentaires
router.get('/in-feed', wrap(async (req, res) => {
  const rows = await db
    .prepare(`${SELECT_SHORT} WHERE s.status = 'active' AND s.expires_at > NOW() AND (s.in_feed = TRUE OR EXISTS (SELECT 1 FROM short_reposts rp2 WHERE rp2.short_id = s.id AND (rp2.user_id = ? OR rp2.user_id IN (SELECT f2.followed_id FROM follows f2 WHERE f2.follower_id = ? AND f2.status = 'accepted')))) AND s.user_id IS NOT NULL ${NOT_BLOCKED} ORDER BY s.published_at DESC, s.id DESC LIMIT 20`)
    .all(...V4(req.user.id), req.user.id, req.user.id, req.user.id, req.user.id);
  res.json({ items: rows.map((r) => present(r, req.user.id)) });
}));

// Mes vidéos enregistrées (actives et non expirées)
router.get('/saved', wrap(async (req, res) => {
  const rows = await db
    .prepare(`${SELECT_SHORT} WHERE s.status = 'active' AND s.expires_at > NOW() AND s.user_id IS NOT NULL ${NOT_BLOCKED} AND EXISTS (SELECT 1 FROM short_saves sv2 WHERE sv2.short_id = s.id AND sv2.user_id = ?) ORDER BY s.published_at DESC, s.id DESC LIMIT 100`)
    .all(...V4(req.user.id), req.user.id, req.user.id, req.user.id);
  res.json({ items: rows.map((r) => present(r, req.user.id)) });
}));

// Une vidéo (lien de partage) : une vidéo expirée répond 410, elle n'est plus lisible
router.get('/:id', wrap(async (req, res) => {
  const row = await findLive(req.params.id, req.user.id);
  if (row) return res.json(present(row, req.user.id));
  const s = await db.prepare('SELECT status, expires_at FROM shorts WHERE id = ?').get(req.params.id);
  if (s && (s.status === 'expired' || (s.status === 'active' && s.expires_at && new Date(s.expires_at) <= new Date()))) {
    return res.status(410).json({ error: 'Cette vidéo a expiré', expired: true });
  }
  res.status(404).json({ error: 'Vidéo introuvable' });
}));

router.post('/:id/like', wrap(async (req, res) => {
  const row = await findLive(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Vidéo introuvable' });
  const already = await db.prepare('SELECT 1 FROM short_likes WHERE short_id = ? AND user_id = ?').get(row.id, req.user.id);
  if (already) await db.prepare('DELETE FROM short_likes WHERE short_id = ? AND user_id = ?').run(row.id, req.user.id);
  else await db.prepare('INSERT INTO short_likes (short_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(row.id, req.user.id);
  const count = await db.prepare('SELECT COUNT(*) AS n FROM short_likes WHERE short_id = ?').get(row.id);
  res.json({ liked: !already, like_count: count.n });
}));

// Enregistrer / ne plus enregistrer une vidéo
router.post('/:id/save', wrap(async (req, res) => {
  const row = await findLive(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Vidéo introuvable' });
  const already = await db.prepare('SELECT 1 FROM short_saves WHERE short_id = ? AND user_id = ?').get(row.id, req.user.id);
  if (already) await db.prepare('DELETE FROM short_saves WHERE short_id = ? AND user_id = ?').run(row.id, req.user.id);
  else await db.prepare('INSERT INTO short_saves (short_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(row.id, req.user.id);
  res.json({ saved: !already });
}));

// Republier / annuler : la vidéo apparaît aussi dans le fil de la personne et de ses abonnés
router.post('/:id/repost', wrap(async (req, res) => {
  const row = await findLive(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Vidéo introuvable' });
  if (row.user_id === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas republier ta propre vidéo' });
  const already = await db.prepare('SELECT 1 FROM short_reposts WHERE short_id = ? AND user_id = ?').get(row.id, req.user.id);
  if (already) await db.prepare('DELETE FROM short_reposts WHERE short_id = ? AND user_id = ?').run(row.id, req.user.id);
  else await db.prepare('INSERT INTO short_reposts (short_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(row.id, req.user.id);
  const count = await db.prepare('SELECT COUNT(*) AS n FROM short_reposts WHERE short_id = ?').get(row.id);
  res.json({ reposted: !already, repost_count: Number(count.n) });
}));

// « Ça ne m'intéresse pas » : la vidéo n'apparaît plus dans MON flux (annulable)
router.post('/:id/hide', wrap(async (req, res) => {
  const row = await findLive(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Vidéo introuvable' });
  if (row.user_id === req.user.id) return res.status(400).json({ error: 'C\'est ta propre vidéo' });
  await db.prepare('INSERT INTO short_hidden (short_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(row.id, req.user.id);
  res.json({ ok: true });
}));
router.delete('/:id/hide', wrap(async (req, res) => {
  await db.prepare('DELETE FROM short_hidden WHERE short_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
}));

// Téléchargement : adresse temporaire qui force l'enregistrement du fichier. Refusé si l'auteur l'a interdit (sauf pour lui-même).
router.get('/:id/download-url', wrap(async (req, res) => {
  const row = await findLive(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Vidéo introuvable' });
  if (row.user_id !== req.user.id && row.allow_download === false) return res.status(403).json({ error: 'Le téléchargement est désactivé pour cette vidéo' });
  const ext = row.r2_key.includes('.') ? row.r2_key.split('.').pop() : 'mp4';
  res.json({ url: r2.signedUrl('GET', row.r2_key, { expiresSec: 300, downloadName: `kalchat-${row.id.slice(0, 8)}.${ext}` }) });
}));

// L'auteur autorise ou interdit le téléchargement de sa vidéo
router.patch('/:id/download', wrap(async (req, res) => {
  const s = await db.prepare('SELECT id, user_id FROM shorts WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Vidéo introuvable' });
  if (s.user_id !== req.user.id) return res.status(403).json({ error: 'Action non autorisée' });
  const allow = parseBool(req.body.allow);
  await db.prepare('UPDATE shorts SET allow_download = ? WHERE id = ?').run(allow, s.id);
  res.json({ allow_download: allow });
}));

router.get('/:id/comments', wrap(async (req, res) => {
  const row = await findLive(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Vidéo introuvable' });
  const comments = await db
    .prepare(
      `SELECT c.id, c.content, c.created_at, c.user_id, c.parent_id, u.username, u.avatar_url, u.badge, u.role,
              (SELECT COUNT(*) FROM short_comment_likes cl WHERE cl.comment_id = c.id) AS like_count,
              EXISTS(SELECT 1 FROM short_comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = ?) AS liked_by_me
       FROM short_comments c JOIN users u ON u.id = c.user_id
       WHERE c.short_id = ? AND u.is_blocked = 0
         AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = c.user_id) OR (b.blocker_id = c.user_id AND b.blocked_id = ?))
       ORDER BY c.created_at ASC LIMIT 300`
    )
    .all(req.user.id, row.id, req.user.id, req.user.id);
  res.json({
    items: comments.map((c) => ({ ...c, like_count: Number(c.like_count || 0), liked_by_me: !!c.liked_by_me })),
  });
}));

router.post('/:id/comments', wrap(async (req, res) => {
  const row = await findLive(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Vidéo introuvable' });
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!content) return res.status(400).json({ error: 'Commentaire vide' });
  if (content.length > COMMENT_MAX) return res.status(400).json({ error: `Commentaire trop long (max ${COMMENT_MAX} caractères)` });
  // Réponse : on rattache toujours à la racine (un seul niveau de réponses, comme sur les publications)
  let rootId = null;
  if (req.body.parent_id) {
    const parent = await db.prepare('SELECT id, short_id, parent_id FROM short_comments WHERE id = ?').get(String(req.body.parent_id));
    if (!parent || parent.short_id !== row.id) return res.status(404).json({ error: 'Commentaire introuvable' });
    rootId = parent.parent_id || parent.id;
  }
  const id = uuid();
  await db.prepare('INSERT INTO short_comments (id, short_id, user_id, content, parent_id) VALUES (?, ?, ?, ?, ?)').run(id, row.id, req.user.id, content, rootId);
  const count = await db.prepare('SELECT COUNT(*) AS n FROM short_comments WHERE short_id = ?').get(row.id);
  res.status(201).json({ id, comment_count: count.n });
}));

router.post('/comments/:commentId/like', wrap(async (req, res) => {
  const c = await db.prepare('SELECT id, short_id FROM short_comments WHERE id = ?').get(req.params.commentId);
  if (!c) return res.status(404).json({ error: 'Commentaire introuvable' });
  const live = await findLive(c.short_id, req.user.id);
  if (!live) return res.status(404).json({ error: 'Vidéo introuvable' });
  const already = await db.prepare('SELECT 1 FROM short_comment_likes WHERE comment_id = ? AND user_id = ?').get(c.id, req.user.id);
  if (already) await db.prepare('DELETE FROM short_comment_likes WHERE comment_id = ? AND user_id = ?').run(c.id, req.user.id);
  else await db.prepare('INSERT INTO short_comment_likes (comment_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(c.id, req.user.id);
  const count = await db.prepare('SELECT COUNT(*) AS n FROM short_comment_likes WHERE comment_id = ?').get(c.id);
  res.json({ liked: !already, like_count: Number(count.n) });
}));

router.delete('/comments/:commentId', wrap(async (req, res) => {
  const c = await db.prepare('SELECT c.id, c.user_id, s.user_id AS owner_id FROM short_comments c JOIN shorts s ON s.id = c.short_id WHERE c.id = ?').get(req.params.commentId);
  if (!c) return res.status(404).json({ error: 'Commentaire introuvable' });
  const me = await db.prepare('SELECT is_admin, role FROM users WHERE id = ?').get(req.user.id);
  if (c.user_id !== req.user.id && c.owner_id !== req.user.id && !isStaffRow(me)) return res.status(403).json({ error: 'Action non autorisée' });
  await db.prepare('DELETE FROM short_comments WHERE id = ?').run(c.id);
  res.json({ ok: true });
}));

// Suppression par l'auteur ou l'équipe : la vidéo disparaît IMMÉDIATEMENT (statut), le fichier est effacé juste après par la tâche de nettoyage
router.delete('/:id', wrap(async (req, res) => {
  const s = await db.prepare('SELECT id, user_id, status FROM shorts WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Vidéo introuvable' });
  const me = await db.prepare('SELECT is_admin, role FROM users WHERE id = ?').get(req.user.id);
  if (s.user_id !== req.user.id && !isStaffRow(me)) return res.status(403).json({ error: 'Action non autorisée' });
  await db.prepare("UPDATE shorts SET status = 'deleted', delete_next_at = NOW() WHERE id = ? AND status IN ('pending', 'active')").run(s.id);
  res.json({ ok: true });
}));

// ---------- Expiration et suppression physique ----------
// Trois choses distinctes :
//  1) BLOCAGE : une vidéo dont expires_at est passé n'est plus servie (toutes les requêtes filtrent sur expires_at), même si ce travail n'a pas encore tourné.
//  2) SUPPRESSION DU FICHIER : cette tâche efface le fichier R2, avec nouvelles tentatives (délai doublé, 24 h max, 10 essais) et erreur gardée dans last_error.
//  3) NETTOYAGE : likes et commentaires sont supprimés quand le fichier est effacé ; la ligne (traces minimales) est gardée 90 jours puis supprimée.
async function runExpiry() {
  await db.prepare("UPDATE shorts SET status = 'expired', delete_next_at = NOW() WHERE status = 'active' AND expires_at <= NOW()").run();
  await db.prepare("UPDATE shorts SET status = 'abandoned', delete_next_at = NOW() WHERE status = 'pending' AND created_at < NOW() - INTERVAL '1 hour'").run();
  // Auteur dont le compte a été supprimé : sa vidéo ne doit pas rester
  await db.prepare("UPDATE shorts SET status = 'deleted', delete_next_at = NOW() WHERE user_id IS NULL AND status IN ('pending', 'active')").run();

  const due = await db
    .prepare(
      `SELECT id, r2_key, delete_attempts FROM shorts
       WHERE status IN ('expired', 'deleted', 'abandoned', 'rejected') AND r2_deleted_at IS NULL AND delete_next_at <= NOW() AND delete_attempts < ?
       ORDER BY delete_next_at LIMIT 50`
    )
    .all(DELETE_MAX_ATTEMPTS);

  let removed = 0;
  for (const s of due) {
    try {
      await r2.remove(s.r2_key);
      await db.prepare('UPDATE shorts SET r2_deleted_at = NOW(), last_error = NULL WHERE id = ?').run(s.id);
      removed++;
    } catch (err) {
      const attempts = s.delete_attempts + 1;
      const delayMinutes = Math.min(5 * 2 ** attempts, 24 * 60);
      await db
        .prepare("UPDATE shorts SET delete_attempts = ?, last_error = ?, delete_next_at = NOW() + (? * INTERVAL '1 minute') WHERE id = ?")
        .run(attempts, String(err.message).slice(0, 300), delayMinutes, s.id);
      if (attempts >= DELETE_MAX_ATTEMPTS) console.error(`⚠️ K-Short : suppression abandonnée après ${attempts} essais (${s.r2_key}) — à vérifier à la main dans Cloudflare`);
    }
  }

  // Interactions des vidéos dont le fichier a bien été effacé
  await db.prepare("DELETE FROM short_comments WHERE short_id IN (SELECT id FROM shorts WHERE status IN ('expired', 'deleted') AND r2_deleted_at IS NOT NULL)").run();
  await db.prepare("DELETE FROM short_likes WHERE short_id IN (SELECT id FROM shorts WHERE status IN ('expired', 'deleted') AND r2_deleted_at IS NOT NULL)").run();
  for (const t of ['short_saves', 'short_reposts', 'short_hidden']) {
    await db.prepare(`DELETE FROM ${t} WHERE short_id IN (SELECT id FROM shorts WHERE status IN ('expired', 'deleted') AND r2_deleted_at IS NOT NULL)`).run();
  }
  // Traces minimales : supprimées après 90 jours
  await db
    .prepare("DELETE FROM shorts WHERE status IN ('expired', 'deleted', 'abandoned', 'rejected') AND r2_deleted_at IS NOT NULL AND r2_deleted_at < NOW() - (? * INTERVAL '1 day')")
    .run(TOMBSTONE_DAYS);

  if (removed > 0) console.log(`🧹 K-Short : ${removed} fichier(s) vidéo supprimé(s) de R2.`);
  return removed;
}

// ---------- Mise en route (appelée par server.js) ----------
async function setupShorts(app) {
  const limits = { max_days: MAX_DAYS, default_days: DEFAULT_DAYS, max_seconds: MAX_SECONDS, max_mb: MAX_MB, formats: Object.keys(ALLOWED_TYPES) };
  // Réponse publique et sans secret : le site sait s'il doit afficher K-Short
  app.get('/api/shorts/status', (req, res) => res.json({ enabled: r2.isConfigured(), ...limits }));

  if (!r2.isConfigured()) {
    console.log('ℹ️ K-Short désactivé (variables R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET absentes).');
    return;
  }
  await db.exec(SCHEMA);
  app.use('/api/shorts', router);

  const tick = () => runExpiry().catch((err) => console.error('K-Short (expiration) :', err.message));
  setTimeout(tick, 30 * 1000);
  setInterval(tick, 5 * 60 * 1000);
  console.log('✅ K-Short activé.');
}

module.exports = { setupShorts, runExpiry, router, SCHEMA };
