const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { notify } = require('../notify');
const { notifyMentions } = require('../mentions');

const router = express.Router();
router.use(authMiddleware);

// ---------- Publier un post (texte et/ou média) ----------
router.post('/', async (req, res) => {
  const { content, media_url, media_type } = req.body;
  if (!content?.trim() && !media_url) {
    return res.status(400).json({ error: 'Le post doit contenir du texte ou un média' });
  }

  const id = uuid();
  await db
    .prepare('INSERT INTO posts (id, user_id, content, media_url, media_type) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user.id, content?.trim() || null, media_url || null, media_type || null);

  await notifyMentions(req.app.get('io'), { text: content, actorId: req.user.id, postId: id, where: 'post' });

  res.status(201).json(await getPostById(id));
});

// ---------- Repartager un post existant ----------
router.post('/:id/share', async (req, res) => {
  const original = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Publication introuvable' });

  const id = uuid();
  await db
    .prepare('INSERT INTO posts (id, user_id, content, media_url, media_type, shared_from_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.user.id, original.content, original.media_url, original.media_type, original.id);

  await notify(req.app.get('io'), { user_id: original.user_id, actor_id: req.user.id, type: 'share', post_id: original.id });

  res.status(201).json(await getPostById(id));
});

// ---------- Aimer / ne plus aimer ----------
router.post('/:id/like', async (req, res) => {
  const post = await db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publication introuvable' });

  const already = await db
    .prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);

  if (already) {
    await db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  } else {
    await db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
    await notify(req.app.get('io'), { user_id: post.user_id, actor_id: req.user.id, type: 'like', post_id: post.id });
  }

  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM post_likes WHERE post_id = ?').get(req.params.id);
  res.json({ liked: !already, like_count: countRow.n });
});

// ---------- Favoris ----------
router.post('/:id/bookmark', async (req, res) => {
  const post = await db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publication introuvable' });

  const already = await db
    .prepare('SELECT 1 FROM post_bookmarks WHERE post_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);

  if (already) {
    await db.prepare('DELETE FROM post_bookmarks WHERE post_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  } else {
    await db.prepare('INSERT INTO post_bookmarks (post_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
  }

  res.json({ bookmarked: !already });
});

// ---------- Mes publications enregistrées (les plus récemment enregistrées en premier) ----------
router.get('/bookmarks', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT p.id, p.user_id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name, p.content, p.media_url, p.media_type, p.created_at,
              (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS like_count,
              EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me,
              (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id) AS comment_count,
              (SELECT COUNT(*) FROM posts sp WHERE sp.shared_from_id = p.id) AS share_count,
              true AS bookmarked_by_me,
              su.username AS shared_from_username
       FROM post_bookmarks b
       JOIN posts p ON p.id = b.post_id
       JOIN users u ON u.id = p.user_id
       LEFT JOIN posts so ON so.id = p.shared_from_id
       LEFT JOIN users su ON su.id = so.user_id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC
       LIMIT 100`
    )
    .all(req.user.id, req.user.id);
  res.json(rows);
});

// ---------- Commentaires ----------
router.get('/:id/comments', async (req, res) => {
  const comments = await db
    .prepare(
      `SELECT c.id, c.content, c.created_at, u.id AS user_id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name
       FROM post_comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY c.created_at ASC`
    )
    .all(req.params.id);
  res.json(comments);
});

router.post('/:id/comments', async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Commentaire vide' });

  const post = await db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publication introuvable' });

  const id = uuid();
  await db
    .prepare('INSERT INTO post_comments (id, post_id, user_id, content) VALUES (?, ?, ?, ?)')
    .run(id, req.params.id, req.user.id, content.trim());

  await notify(req.app.get('io'), { user_id: post.user_id, actor_id: req.user.id, type: 'comment', post_id: post.id });
  // Les personnes mentionnées sont prévenues (le propriétaire du post l'est déjà par la notification ci-dessus)
  await notifyMentions(req.app.get('io'), { text: content, actorId: req.user.id, postId: post.id, where: 'comment', skipUserIds: [post.user_id] });

  const comment = await db
    .prepare(
      `SELECT c.id, c.content, c.created_at, u.id AS user_id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name
       FROM post_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`
    )
    .get(id);
  res.status(201).json(comment);
});

// ---------- Fil de publications (le plus récent en premier) ----------
router.get('/', async (req, res) => {
  const { user_id, hashtag } = req.query;

  // On ne voit jamais les publications d'un compte qu'on a bloqué (ni de quelqu'un qui nous a bloqué)
  const conditions = [
    `NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = ? AND ub.blocked_id = p.user_id) OR (ub.blocker_id = p.user_id AND ub.blocked_id = ?))`,
  ];
  const extraParams = [req.user.id, req.user.id];
  if (user_id) {
    conditions.push('p.user_id = ?');
    extraParams.push(user_id);
  } else if (hashtag) {
    // Recherche insensible à la casse, délimitée par un mot pour éviter les faux positifs (#kalchat vs #kalchatting)
    conditions.push('p.content ~* ?');
    extraParams.push(`(^|[^\\w#])#${hashtag}([^\\w]|$)`);
  }
  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const rows = await db
    .prepare(
      `SELECT p.id, p.user_id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name, p.content, p.media_url, p.media_type, p.created_at,
              (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS like_count,
              EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me,
              (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id) AS comment_count,
              (SELECT COUNT(*) FROM posts sp WHERE sp.shared_from_id = p.id) AS share_count,
              EXISTS(SELECT 1 FROM post_bookmarks b WHERE b.post_id = p.id AND b.user_id = ?) AS bookmarked_by_me,
              su.username AS shared_from_username
       FROM posts p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN posts so ON so.id = p.shared_from_id
       LEFT JOIN users su ON su.id = so.user_id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT 100`
    )
    .all(req.user.id, req.user.id, ...extraParams);
  res.json(rows);
});

// ---------- Une publication (page « Post ») ----------
router.get('/:id', async (req, res) => {
  const blocked = `NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = ? AND ub.blocked_id = p.user_id) OR (ub.blocker_id = p.user_id AND ub.blocked_id = ?))`;
  const post = await db
    .prepare(
      `SELECT p.id, p.user_id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name, p.content, p.media_url, p.media_type, p.created_at,
              (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS like_count,
              EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me,
              (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id) AS comment_count,
              (SELECT COUNT(*) FROM posts sp WHERE sp.shared_from_id = p.id) AS share_count,
              EXISTS(SELECT 1 FROM post_bookmarks b WHERE b.post_id = p.id AND b.user_id = ?) AS bookmarked_by_me,
              su.username AS shared_from_username
       FROM posts p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN posts so ON so.id = p.shared_from_id
       LEFT JOIN users su ON su.id = so.user_id
       WHERE p.id = ? AND ${blocked}`
    )
    .get(req.user.id, req.user.id, req.params.id, req.user.id, req.user.id);
  if (!post) return res.status(404).json({ error: 'Publication introuvable' });
  res.json(post);
});

// ---------- Modifier son propre post ----------
router.patch('/:id', async (req, res) => {
  const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publication introuvable' });
  if (post.user_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
  const content = (req.body.content || '').trim();
  if (!content && !post.media_url) return res.status(400).json({ error: 'Le post ne peut pas être vide' });
  await db.prepare('UPDATE posts SET content = ? WHERE id = ?').run(content || null, req.params.id);
  res.json({ ok: true });
});

// ---------- Supprimer un commentaire (auteur du commentaire, auteur du post ou équipe) ----------
router.delete('/comments/:commentId', async (req, res) => {
  const c = await db
    .prepare('SELECT c.id, c.user_id, p.user_id AS post_owner FROM post_comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?')
    .get(req.params.commentId);
  if (!c) return res.status(404).json({ error: 'Commentaire introuvable' });
  const me = await db.prepare('SELECT is_admin, role FROM users WHERE id = ?').get(req.user.id);
  const staff = !!me?.is_admin || me?.role === 'moderator';
  if (c.user_id !== req.user.id && c.post_owner !== req.user.id && !staff) return res.status(403).json({ error: 'Non autorisé' });
  await db.prepare('DELETE FROM post_comments WHERE id = ?').run(req.params.commentId);
  res.json({ ok: true });
});

// ---------- Supprimer son propre post ----------
router.delete('/:id', async (req, res) => {
  const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publication introuvable' });
  if (post.user_id !== req.user.id) {
    const me = await db.prepare('SELECT is_admin, role FROM users WHERE id = ?').get(req.user.id);
    if (!me?.is_admin && me?.role !== 'moderator') return res.status(403).json({ error: 'Non autorisé' });
  }

  await db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

async function getPostById(id) {
  return db
    .prepare(
      `SELECT p.id, p.user_id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name, p.content, p.media_url, p.media_type, p.created_at,
              0 AS like_count, false AS liked_by_me, 0 AS comment_count, 0 AS share_count,
              false AS bookmarked_by_me, su.username AS shared_from_username
       FROM posts p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN posts so ON so.id = p.shared_from_id
       LEFT JOIN users su ON su.id = so.user_id
       WHERE p.id = ?`
    )
    .get(id);
}

module.exports = router;
