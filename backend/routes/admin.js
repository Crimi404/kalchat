const express = require('express');
const db = require('../db');
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
  const [users, messages, posts, comments, blocked, postPhotos, postVideos, storyPhotos, storyVideos] = await Promise.all([
    n('SELECT COUNT(*) AS n FROM users'),
    n('SELECT COUNT(*) AS n FROM messages'),
    n('SELECT COUNT(*) AS n FROM posts'),
    n('SELECT COUNT(*) AS n FROM post_comments'),
    n('SELECT COUNT(*) AS n FROM users WHERE is_blocked = 1'),
    n("SELECT COUNT(*) AS n FROM posts WHERE media_type = 'image'"),
    n("SELECT COUNT(*) AS n FROM posts WHERE media_type = 'video'"),
    n("SELECT COUNT(*) AS n FROM stories WHERE media_type = 'image'"),
    n("SELECT COUNT(*) AS n FROM stories WHERE media_type = 'video'"),
  ]);
  res.json({
    users,
    online: countOnline(req.app.get('io')),
    messages,
    posts,
    comments,
    blocked,
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
       ${q ? "WHERE u.username ILIKE ? OR (COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE ?" : ''}
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

module.exports = router;
