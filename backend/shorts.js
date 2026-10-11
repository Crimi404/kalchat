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
    author: row.user_id ? { id: row.user_id, username: row.username, avatar_url: row.avatar_url, badge: row.badge, first_name: row.first_name, last_name: row.last_name } : null,
    content_type: row.content_type,
    duration_seconds: row.duration_seconds,
    in_feed: !!row.in_feed,
    published_at: row.published_at,
    expires_at: row.expires_at,
    like_count: Number(row.like_count || 0),
    comment_count: Number(row.comment_count || 0),
    liked: !!row.liked,
    mine: row.user_id === viewerId,
    video_url: live ? r2.signedUrl('GET', row.r2_key, { expiresSec: GET_TTL_SEC }) : null,
    video_url_ttl: live ? GET_TTL_SEC : null,
  };
}

const SELECT_SHORT = `
  SELECT s.id, s.user_id, s.caption, s.r2_key, s.content_type, s.duration_seconds, s.in_feed, s.status, s.published_at, s.expires_at,
         u.username, u.avatar_url, u.badge, u.first_name, u.last_name,
         to_char(s.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS published_cursor,
         (SELECT COUNT(*) FROM short_likes l WHERE l.short_id = s.id) AS like_count,
         (SELECT COUNT(*) FROM short_comments c WHERE c.short_id = s.id) AS comment_count,
         EXISTS (SELECT 1 FROM short_likes l WHERE l.short_id = s.id AND l.user_id = ?) AS liked
  FROM shorts s
  LEFT JOIN users u ON u.id = s.user_id
`;

// Hors blocages dans les deux sens et comptes bloqués par l'équipe
const NOT_BLOCKED = `
  AND u.is_blocked = 0
  AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = s.user_id) OR (b.blocker_id = s.user_id AND b.blocked_id = ?))
`;

/** Une vidéo qu'on peut montrer : active, non expirée, auteur non bloqué (et pas bloqué par / bloquant le spectateur). */
async function findLive(id, viewerId) {
  return db
    .prepare(`${SELECT_SHORT} WHERE s.id = ? AND s.status = 'active' AND s.expires_at > NOW() AND s.user_id IS NOT NULL ${NOT_BLOCKED}`)
    .get(viewerId, id, viewerId, viewerId);
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
  const params = [req.user.id, req.user.id, req.user.id];
  let cursorSql = '';
  if (req.query.cursor) {
    const [ts, cid] = String(req.query.cursor).split('|');
    if (!ts || !cid || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(ts)) return res.status(400).json({ error: 'Curseur invalide' });
    cursorSql = 'AND (s.published_at, s.id) < (?::timestamptz, ?)';
    params.push(ts, cid);
  }
  params.push(FEED_PAGE + 1);
  const rows = await db
    .prepare(`${SELECT_SHORT} WHERE s.status = 'active' AND s.expires_at > NOW() AND s.user_id IS NOT NULL ${NOT_BLOCKED} ${cursorSql} ORDER BY s.published_at DESC, s.id DESC LIMIT ?`)
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
    .all(req.user.id, req.user.id);
  res.json({ items: rows.map((r) => present(r, req.user.id)) });
}));

// Vidéos publiées aussi dans le fil classique (« K-Short + fil ») : ce sont les MÊMES vidéos, avec les mêmes likes et commentaires
router.get('/in-feed', wrap(async (req, res) => {
  const rows = await db
    .prepare(`${SELECT_SHORT} WHERE s.status = 'active' AND s.expires_at > NOW() AND s.in_feed = TRUE AND s.user_id IS NOT NULL ${NOT_BLOCKED} ORDER BY s.published_at DESC, s.id DESC LIMIT 20`)
    .all(req.user.id, req.user.id, req.user.id);
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

router.get('/:id/comments', wrap(async (req, res) => {
  const row = await findLive(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Vidéo introuvable' });
  const comments = await db
    .prepare(
      `SELECT c.id, c.content, c.created_at, c.user_id, u.username, u.avatar_url, u.badge
       FROM short_comments c JOIN users u ON u.id = c.user_id
       WHERE c.short_id = ? AND u.is_blocked = 0
         AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = c.user_id) OR (b.blocker_id = c.user_id AND b.blocked_id = ?))
       ORDER BY c.created_at ASC LIMIT 200`
    )
    .all(row.id, req.user.id, req.user.id);
  res.json({ items: comments });
}));

router.post('/:id/comments', wrap(async (req, res) => {
  const row = await findLive(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Vidéo introuvable' });
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!content) return res.status(400).json({ error: 'Commentaire vide' });
  if (content.length > COMMENT_MAX) return res.status(400).json({ error: `Commentaire trop long (max ${COMMENT_MAX} caractères)` });
  const id = uuid();
  await db.prepare('INSERT INTO short_comments (id, short_id, user_id, content) VALUES (?, ?, ?, ?)').run(id, row.id, req.user.id, content);
  const count = await db.prepare('SELECT COUNT(*) AS n FROM short_comments WHERE short_id = ?').get(row.id);
  res.status(201).json({ id, comment_count: count.n });
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
