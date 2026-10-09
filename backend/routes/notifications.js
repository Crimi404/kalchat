const express = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ---------- Liste des notifications (les plus récentes en premier) ----------
router.get('/', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT n.id, n.type, n.body, n.post_id, n.conversation_id, n.message_id, n.community_id, n.is_read, n.created_at,
              (SELECT c.name FROM communities c WHERE c.id = n.community_id) AS community_name,
              a.id AS actor_id, a.username AS actor_username, a.avatar_url AS actor_avatar_url, a.badge AS actor_badge, a.role AS actor_role,
              (SELECT f.status FROM follows f WHERE f.follower_id = n.actor_id AND f.followed_id = n.user_id) AS follow_status
       FROM notifications n JOIN users a ON a.id = n.actor_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT 100`
    )
    .all(req.user.id);
  res.json(rows);
});

// ---------- Nombre de notifications non lues ----------
router.get('/unread-count', async (req, res) => {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(req.user.id);
  res.json({ count: row.n });
});

// ---------- Marquer une notification comme lue ----------
router.post('/:id/read', async (req, res) => {
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- Tout marquer comme lu ----------
router.post('/read-all', async (req, res) => {
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(req.user.id);
  res.json({ ok: true });
});

// ---------- Supprimer une notification ----------
// Les avertissements de la modération sont conservés : ils restent une trace officielle.
router.delete('/:id', async (req, res) => {
  await db.prepare("DELETE FROM notifications WHERE id = ? AND user_id = ? AND type != 'moderation'").run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- Supprimer toutes les notifications (ou seulement les lues avec ?read=1) ----------
router.delete('/', async (req, res) => {
  const onlyRead = req.query.read === '1' ? ' AND is_read = 1' : '';
  await db.prepare(`DELETE FROM notifications WHERE user_id = ? AND type != 'moderation'${onlyRead}`).run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
