const express = require('express');
const db = require('../db');
const { sweepOrphanFiles } = require('../mediaCleanup');
const ai = require('../ai');
const koraSettings = require('../koraSettings');
const authMiddleware = require('../middleware/auth');
const staffMiddleware = require('../middleware/staff');
const { notify } = require('../notify');

const router = express.Router();
router.use(authMiddleware, staffMiddleware);

// Rangs de badge, du plus bas au plus haut
const BADGES = [null, 'plus', 'vip', 'vip_plus', 'legend'];

// Utilisateurs actuellement connectés (au moins un socket ouvert), sans doublons
function countOnline(io) {
  const ids = new Set();
  for (const s of io.sockets.sockets.values()) {
    if (s.user?.id) ids.add(s.user.id);
  }
  return ids.size;
}

async function getTarget(id) {
  return db.prepare('SELECT id, is_admin, role FROM users WHERE id = ?').get(id);
}

// ---------- Statistiques globales ----------
router.get('/stats', async (req, res) => {
  const n = async (sql) => (await db.prepare(sql).get()).n;
  const [users, messages, posts, comments, blocked, postPhotos, postVideos, storyPhotos, storyVideos, openReports] = await Promise.all([
    n("SELECT COUNT(*) AS n FROM users WHERE id != 'kalchat-ai'"),
    n('SELECT COUNT(*) AS n FROM messages'),
    n('SELECT COUNT(*) AS n FROM posts'),
    n('SELECT COUNT(*) AS n FROM post_comments'),
    n('SELECT COUNT(*) AS n FROM users WHERE is_blocked = 1'),
    n("SELECT COUNT(*) AS n FROM posts WHERE media_type = 'image'"),
    n("SELECT COUNT(*) AS n FROM posts WHERE media_type = 'video'"),
    n("SELECT COUNT(*) AS n FROM stories WHERE media_type = 'image'"),
    n("SELECT COUNT(*) AS n FROM stories WHERE media_type = 'video'"),
    n("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
  ]);
  res.json({
    users,
    online: countOnline(req.app.get('io')),
    messages,
    posts,
    comments,
    blocked,
    open_reports: openReports,
    photos: postPhotos + storyPhotos,
    videos: postVideos + storyVideos,
  });
});

// ---------- Liste des utilisateurs (recherche optionnelle par pseudo ou nom) ----------
router.get('/users', async (req, res) => {
  const q = (req.query.q || '').trim();
  const like = `%${q}%`;
  const rows = await db
    .prepare(
      `SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_url, u.badge, u.role, u.is_admin, u.is_blocked, u.created_at,
              (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS post_count
       FROM users u
       WHERE u.id != 'kalchat-ai'${q ? " AND (u.username ILIKE ? OR (COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE ?)" : ''}
       ORDER BY u.created_at DESC
       LIMIT 100`
    )
    .all(...(q ? [like, like] : []));
  res.json(rows.map((u) => ({ ...u, is_admin: !!u.is_admin, is_blocked: !!u.is_blocked })));
});

// ---------- Attribuer / retirer un badge (administrateurs uniquement) ----------
router.patch('/users/:id/badge', async (req, res) => {
  if (!req.staff.is_admin) return res.status(403).json({ error: 'Réservé aux administrateurs' });
  const badge = req.body.badge ?? null;
  if (!BADGES.includes(badge)) return res.status(400).json({ error: 'Badge invalide' });
  const target = await getTarget(req.params.id);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  await db.prepare('UPDATE users SET badge = ? WHERE id = ?').run(badge, req.params.id);
  res.json({ ok: true, badge });
});

// ---------- Nommer / retirer un modérateur (administrateurs uniquement) ----------
router.patch('/users/:id/role', async (req, res) => {
  if (!req.staff.is_admin) return res.status(403).json({ error: 'Réservé aux administrateurs' });
  const { moderator } = req.body;
  const target = await getTarget(req.params.id);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (target.is_admin) return res.status(400).json({ error: "Impossible de modifier le rôle d'un administrateur" });

  const role = moderator ? 'moderator' : 'user';
  await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ ok: true, role });
});

// ---------- Bloquer / débloquer un utilisateur (équipe) ----------
router.patch('/users/:id/block', async (req, res) => {
  const { blocked } = req.body;
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Impossible de te bloquer toi-même' });
  const target = await getTarget(req.params.id);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (target.is_admin) return res.status(400).json({ error: 'Impossible de bloquer un administrateur' });
  if (!req.staff.is_admin && target.role === 'moderator') {
    return res.status(403).json({ error: "Un modérateur ne peut pas bloquer un autre modérateur" });
  }

  await db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(blocked ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// ---------- Avertissement officiel (à sens unique : le membre ne peut pas répondre) ----------
router.post('/users/:id/warn', async (req, res) => {
  const message = (req.body.message || '').trim();
  if (message.length < 3 || message.length > 500) {
    return res.status(400).json({ error: 'Le message doit faire entre 3 et 500 caractères' });
  }
  if (req.params.id === req.user.id) return res.status(400).json({ error: "Impossible de t'avertir toi-même" });
  const target = await getTarget(req.params.id);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  await notify(req.app.get('io'), { user_id: target.id, actor_id: req.user.id, type: 'moderation', body: message });
  res.status(201).json({ ok: true });
});

// ---------- Signalements ----------
// ?status=open (par défaut) ou ?status=closed (traités : résolus ou classés sans suite)
router.get('/reports', async (req, res) => {
  const closed = req.query.status === 'closed';
  const rows = await db
    .prepare(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.snapshot, r.status, r.created_at, r.handled_at,
              ru.username AS reporter_username,
              tu.id AS target_user_id, tu.username AS target_username, tu.is_admin AS target_is_admin,
              hu.username AS handled_by_username,
              (SELECT COUNT(*) FROM reports r2 WHERE r2.target_type = r.target_type AND r2.target_id = r.target_id) AS report_count,
              CASE WHEN r.target_type = 'post' THEN EXISTS(SELECT 1 FROM posts p WHERE p.id = r.target_id)
                   WHEN r.target_type = 'comment' THEN EXISTS(SELECT 1 FROM post_comments c WHERE c.id = r.target_id)
                   WHEN r.target_type = 'message' THEN EXISTS(SELECT 1 FROM messages m WHERE m.id = r.target_id)
                   ELSE TRUE END AS target_exists,
              (SELECT c.post_id FROM post_comments c WHERE r.target_type = 'comment' AND c.id = r.target_id) AS comment_post_id
       FROM reports r
       JOIN users ru ON ru.id = r.reporter_id
       LEFT JOIN users tu ON tu.id = r.target_user_id
       LEFT JOIN users hu ON hu.id = r.handled_by
       WHERE r.status ${closed ? "!= 'open'" : "= 'open'"}
       ORDER BY r.created_at ${closed ? 'DESC' : 'ASC'}
       LIMIT 100`
    )
    .all();
  res.json(rows.map((r) => ({ ...r, target_is_admin: !!r.target_is_admin, target_exists: !!r.target_exists })));
});

// ---------- Clôturer un signalement : « resolved » (mesure prise) ou « dismissed » (sans suite) ----------
// Tous les signalements ouverts sur le même contenu sont clôturés ensemble.
router.patch('/reports/:id', async (req, res) => {
  const status = req.body.status;
  if (!['resolved', 'dismissed'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  const report = await db.prepare('SELECT id, target_type, target_id FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Signalement introuvable' });
  await db
    .prepare("UPDATE reports SET status = ?, handled_by = ?, handled_at = NOW() WHERE target_type = ? AND target_id = ? AND status = 'open'")
    .run(status, req.user.id, report.target_type, report.target_id);
  res.json({ ok: true });
});

// ---------- Stockage : état du bucket et nettoyage des fichiers orphelins (administrateurs) ----------
async function requireAdmin(req, res) {
  const me = await db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
  if (!me?.is_admin) { res.status(403).json({ error: 'Réservé aux administrateurs' }); return false; }
  return true;
}

router.get('/storage', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    res.json(await sweepOrphanFiles({ dryRun: true }));
  } catch (err) {
    res.status(500).json({ error: `Stockage inaccessible : ${err.message}` });
  }
});

router.post('/storage/cleanup', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    res.json(await sweepOrphanFiles());
  } catch (err) {
    res.status(500).json({ error: `Nettoyage impossible : ${err.message}` });
  }
});

// ---------- Kora IA : publier le post du jour tout de suite (administrateurs) ----------
router.post('/kora/post-now', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = await ai.postDaily({ force: true });
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: `Publication impossible : ${err.message}` });
  }
});

// ---------- Kora IA : réglages, quotas et statistiques (administrateurs) ----------
router.get('/kora', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    res.json({ settings: koraSettings.all(), limits: koraSettings.LIMITS, stats: await koraSettings.stats() });
  } catch (err) {
    res.status(500).json({ error: `Impossible de charger Kora : ${err.message}` });
  }
});

router.patch('/kora/settings', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    res.json({ settings: await koraSettings.update(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
