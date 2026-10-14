const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('./db');
const r2 = require('./r2');
const authMiddleware = require('./middleware/auth');
const { normalizeCategory } = require('./categories');
const { scoreCandidate, composePage } = require('./shortsRanking');

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

// Flux personnalisé « Pour vous » : on note un lot de vidéos récentes puis on compose chaque page
const FEED_POOL = 300; // nombre de vidéos récentes examinées à chaque page
const SESSION_MINUTES = 3; // une vidéo montrée il y a moins de 3 min n'est jamais remontrée (même page de défilement)
const COOLDOWN_HOURS = 6; // une vidéo déjà montrée n'est remontrée qu'après ce délai (sauf s'il n'y a plus rien d'autre)
const TASTE_DAYS = 30; // fenêtre des goûts retenus (j'aime, vues, enregistrements…)
// 10 places par page : P = selon tes goûts (7), POP = populaire (2), R = au hasard pour découvrir (1)
const PAGE_PATTERN = ['P', 'P', 'P', 'POP', 'P', 'P', 'R', 'P', 'POP', 'P'];

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
  ALTER TABLE shorts ADD COLUMN IF NOT EXISTS play_count BIGINT NOT NULL DEFAULT 0;
  UPDATE shorts SET play_count = (SELECT COUNT(*) FROM short_views vw WHERE vw.short_id = shorts.id)
    WHERE play_count = 0 AND EXISTS (SELECT 1 FROM short_views vw WHERE vw.short_id = shorts.id);

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
  CREATE TABLE IF NOT EXISTS short_views (
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

  -- Catégorie choisie par l'auteur (mêmes clés que les publications ; « divers » par défaut, y compris pour les anciennes vidéos)
  ALTER TABLE shorts ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'divers';

  -- Temps réellement regardé par membre et par vidéo (signal principal du flux personnalisé)
  CREATE TABLE IF NOT EXISTS short_watch (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    short_id TEXT NOT NULL REFERENCES shorts(id) ON DELETE CASCADE,
    watched_seconds REAL NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    plays INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, short_id)
  );
  CREATE INDEX IF NOT EXISTS idx_short_watch_user ON short_watch (user_id, updated_at DESC);

  -- Vidéos déjà proposées à un membre (pour ne pas les remontrer tout de suite)
  CREATE TABLE IF NOT EXISTS short_served (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    short_id TEXT NOT NULL REFERENCES shorts(id) ON DELETE CASCADE,
    served_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, short_id)
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
    category: row.category || 'divers',
    in_feed: !!row.in_feed,
    published_at: row.published_at,
    expires_at: row.expires_at,
    like_count: Number(row.like_count || 0),
    comment_count: Number(row.comment_count || 0),
    repost_count: Number(row.repost_count || 0),
    view_count: Number(row.view_count || 0),
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
         s.allow_download, s.category, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name,
         to_char(s.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS published_cursor,
         (SELECT COUNT(*) FROM short_likes l WHERE l.short_id = s.id) AS like_count,
         (SELECT COUNT(*) FROM short_comments c WHERE c.short_id = s.id) AS comment_count,
         (SELECT COUNT(*) FROM short_reposts rp WHERE rp.short_id = s.id) AS repost_count,
         s.play_count AS view_count,
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
  // Catégorie choisie par l'auteur ; toute valeur inconnue devient « divers »
  const category = normalizeCategory(req.body.category);

  const recent = await db.prepare("SELECT COUNT(*) AS n FROM shorts WHERE user_id = ? AND created_at > NOW() - INTERVAL '24 hours'").get(req.user.id);
  if (recent.n >= SHORTS_PER_DAY) return res.status(429).json({ error: `Limite atteinte : ${SHORTS_PER_DAY} vidéos par 24 h` });
  const pending = await db.prepare("SELECT COUNT(*) AS n FROM shorts WHERE user_id = ? AND status = 'pending' AND created_at > NOW() - INTERVAL '1 hour'").get(req.user.id);
  if (pending.n >= MAX_PENDING) return res.status(429).json({ error: 'Termine tes envois en cours avant d\'en commencer un autre' });

  const id = uuid();
  const key = `shorts/${req.user.id}/${id}.${ext}`;
  await db
    .prepare('INSERT INTO shorts (id, user_id, caption, r2_key, content_type, size_bytes, duration_seconds, retention_days, in_feed, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.user.id, caption || null, key, contentType, size, duration, days, parseBool(req.body.in_feed), category);

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

// Goûts du membre sur les 30 derniers jours : poids cumulé par catégorie et par auteur.
// j'aime / enregistrement = +3, republication = +2, vidéo regardée jusqu'au bout = +2, à moitié = +1, passée en moins de 2 s = -1, « pas intéressé » = -3.
async function loadTaste(userId) {
  const rows = await db
    .prepare(
      `WITH signals AS (
         SELECT short_id, 3.0::float8 AS w FROM short_likes WHERE user_id = ? AND created_at > NOW() - INTERVAL '${TASTE_DAYS} days'
         UNION ALL SELECT short_id, 3.0::float8 FROM short_saves WHERE user_id = ? AND created_at > NOW() - INTERVAL '${TASTE_DAYS} days'
         UNION ALL SELECT short_id, 2.0::float8 FROM short_reposts WHERE user_id = ? AND created_at > NOW() - INTERVAL '${TASTE_DAYS} days'
         UNION ALL SELECT short_id, (-3.0)::float8 FROM short_hidden WHERE user_id = ? AND created_at > NOW() - INTERVAL '${TASTE_DAYS} days'
         UNION ALL SELECT sw.short_id,
                (CASE WHEN sw.completed THEN 2.0
                      WHEN sw.watched_seconds >= 0.5 * COALESCE(sh.duration_seconds, 15) THEN 1.0
                      WHEN sw.watched_seconds < 2 THEN -1.0
                      ELSE 0.0 END)::float8
           FROM short_watch sw JOIN shorts sh ON sh.id = sw.short_id
           WHERE sw.user_id = ? AND sw.updated_at > NOW() - INTERVAL '${TASTE_DAYS} days'
       )
       SELECT s.category, s.user_id AS author_id, SUM(g.w) AS w
       FROM signals g JOIN shorts s ON s.id = g.short_id
       GROUP BY s.category, s.user_id`
    )
    .all(userId, userId, userId, userId, userId);
  const catWeights = new Map();
  const authorWeights = new Map();
  for (const r of rows) {
    const w = Number(r.w) || 0;
    catWeights.set(r.category || 'divers', (catWeights.get(r.category || 'divers') || 0) + w);
    if (r.author_id) authorWeights.set(r.author_id, (authorWeights.get(r.author_id) || 0) + w);
  }
  return { catWeights, authorWeights };
}

// Flux « Pour vous » : personnalisé et un peu aléatoire. Chaque page = 7 vidéos selon les goûts, 2 populaires, 1 au hasard.
// Les vidéos déjà montrées ne reviennent pas tout de suite (voir SESSION_MINUTES et COOLDOWN_HOURS). Le curseur n'est qu'un témoin « il y a encore des nouveautés ».
router.get('/feed', wrap(async (req, res) => {
  const uid = req.user.id;
  const now = Date.now();
  const [rows, taste, servedRows, doneRows] = await Promise.all([
    db
      .prepare(`${SELECT_SHORT} WHERE s.status = 'active' AND s.expires_at > NOW() AND s.user_id IS NOT NULL ${NOT_BLOCKED} AND NOT EXISTS (SELECT 1 FROM short_hidden h WHERE h.short_id = s.id AND h.user_id = ?) ORDER BY s.published_at DESC, s.id DESC LIMIT ?`)
      .all(...V4(uid), uid, uid, uid, FEED_POOL),
    loadTaste(uid),
    db.prepare("SELECT short_id, served_at FROM short_served WHERE user_id = ? AND served_at > NOW() - INTERVAL '7 days'").all(uid),
    db.prepare('SELECT short_id FROM short_watch WHERE user_id = ? AND completed = TRUE').all(uid),
  ]);

  const servedAt = new Map(servedRows.map((r) => [r.short_id, new Date(r.served_at).getTime()]));
  const ctx = { userId: uid, catWeights: taste.catWeights, authorWeights: taste.authorWeights, completed: new Set(doneRows.map((r) => r.short_id)), random: Math.random };
  const scored = rows.map((r) => ({ ...r, ...scoreCandidate(r, ctx, now) }));

  // Ancienneté de la dernière fois où la vidéo a été montrée (infinie si jamais)
  const since = (c) => (servedAt.has(c.id) ? now - servedAt.get(c.id) : Infinity);
  const sessionMs = SESSION_MINUTES * 60_000;
  const cooldownMs = COOLDOWN_HOURS * 3_600_000;

  const fresh = scored.filter((c) => since(c) >= cooldownMs);
  let page = composePage(fresh, PAGE_PATTERN);
  // Pas assez de nouveautés : on complète avec les vidéos montrées il y a le plus longtemps (jamais celles de la session en cours)
  if (page.length < FEED_PAGE) {
    const have = new Set(page.map((c) => c.id));
    const older = scored.filter((c) => !have.has(c.id) && since(c) < cooldownMs && since(c) >= sessionMs).sort((a, b) => since(b) - since(a));
    page = page.concat(older.slice(0, FEED_PAGE - page.length));
  }
  // Dernier recours : tout a été montré à l'instant, on ne renvoie pas un flux vide
  if (!page.length) page = [...scored].sort((a, b) => since(b) - since(a)).slice(0, FEED_PAGE);

  const pageIds = new Set(page.map((c) => c.id));
  const hasMore = fresh.some((c) => !pageIds.has(c.id));

  if (page.length) {
    await db
      .prepare('INSERT INTO short_served (user_id, short_id) SELECT ?::text, UNNEST(?::text[]) ON CONFLICT (user_id, short_id) DO UPDATE SET served_at = NOW()')
      .run(uid, page.map((c) => c.id));
  }

  res.json({
    items: page.map((r) => present(r, uid)),
    next_cursor: hasMore ? 'more' : null,
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

// Une lecture : chaque visionnage compte, même si c'est la même personne qui revoit la vidéo (pas pour l'auteur).
// Anti-abus : au plus une lecture comptée toutes les 2 s par personne et par vidéo.
const lastPlay = new Map();
const PLAY_MIN_GAP_MS = 2000;
setInterval(() => {
  const limit = Date.now() - 60_000;
  for (const [k, t] of lastPlay) if (t < limit) lastPlay.delete(k);
}, 60_000).unref();

router.post('/:id/view', wrap(async (req, res) => {
  const row = await findLive(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Vidéo introuvable' });
  if (row.user_id !== req.user.id) {
    const key = `${req.user.id}:${row.id}`;
    const now = Date.now();
    if (now - (lastPlay.get(key) || 0) >= PLAY_MIN_GAP_MS) {
      lastPlay.set(key, now);
      await db.prepare('UPDATE shorts SET play_count = play_count + 1 WHERE id = ?').run(row.id);
    }
  }
  const count = await db.prepare('SELECT play_count AS n FROM shorts WHERE id = ?').get(row.id);
  res.json({ view_count: Number(count.n) });
}));

// Temps regardé : envoyé quand on quitte la vidéo (ou que l'appli passe en arrière-plan). Signal principal du flux personnalisé.
// Garde la meilleure valeur par membre et par vidéo ; « plays » compte les passages. Rien n'est enregistré pour l'auteur lui-même.
router.post('/:id/watch', wrap(async (req, res) => {
  const s = await db.prepare("SELECT id, user_id, duration_seconds FROM shorts WHERE id = ? AND status = 'active' AND expires_at > NOW()").get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Vidéo introuvable' });
  if (s.user_id === req.user.id) return res.json({ ok: true });
  const duration = Number(s.duration_seconds) > 0 ? Number(s.duration_seconds) : MAX_SECONDS;
  const raw = Number(req.body?.seconds);
  if (!Number.isFinite(raw) || raw < 0) return res.status(400).json({ error: 'Durée invalide' });
  const seconds = Math.min(raw, duration + 5); // on ne croit pas un temps plus long que la vidéo
  const completed = parseBool(req.body?.completed) || seconds >= duration * 0.9;
  await db
    .prepare(
      `INSERT INTO short_watch (user_id, short_id, watched_seconds, completed) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, short_id) DO UPDATE SET
         watched_seconds = GREATEST(short_watch.watched_seconds, EXCLUDED.watched_seconds),
         completed = short_watch.completed OR EXCLUDED.completed,
         plays = short_watch.plays + 1,
         updated_at = NOW()`
    )
    .run(req.user.id, s.id, seconds, completed);
  res.json({ ok: true });
}));

// Qui a aimé cette vidéo (hors comptes bloqués), avec mon lien d'abonnement avec chacun
router.get('/:id/likers', wrap(async (req, res) => {
  const row = await findLive(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Vidéo introuvable' });
  const likers = await db
    .prepare(
      `SELECT u.id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name,
              (SELECT f.status FROM follows f WHERE f.follower_id = ? AND f.followed_id = u.id) AS follow_status
       FROM short_likes l JOIN users u ON u.id = l.user_id
       WHERE l.short_id = ? AND u.is_blocked = 0
         AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
       ORDER BY l.created_at DESC LIMIT 200`
    )
    .all(req.user.id, row.id, req.user.id, req.user.id);
  res.json({
    like_count: Number(row.like_count || 0),
    view_count: Number(row.view_count || 0),
    items: likers.map((u) => ({
      id: u.id,
      username: u.username,
      avatar_url: u.avatar_url,
      badge: u.badge,
      role: u.role,
      first_name: u.first_name,
      last_name: u.last_name,
      me: u.id === req.user.id,
      follow_status: u.follow_status === 'accepted' || u.follow_status === 'pending' ? u.follow_status : 'none',
    })),
  });
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
  for (const t of ['short_saves', 'short_reposts', 'short_hidden', 'short_views']) {
    await db.prepare(`DELETE FROM ${t} WHERE short_id IN (SELECT id FROM shorts WHERE status IN ('expired', 'deleted') AND r2_deleted_at IS NOT NULL)`).run();
  }
  // Journal des vidéos montrées : inutile au-delà d'une semaine
  await db.prepare("DELETE FROM short_served WHERE served_at < NOW() - INTERVAL '7 days'").run();
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
