const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { notify } = require('../notify');
const { notifyMentions } = require('../mentions');
const { CATEGORIES, DEFAULT_CATEGORY, normalizeCategory } = require('../categories');
const { releaseMedia } = require('../mediaCleanup');
const ai = require('../ai');
const { THEMED_POST_MAX_CHARS, normalizeTheme, normalizeFont } = require('../themes');

const router = express.Router();
router.use(authMiddleware);

// ---------- Publier un post (texte et/ou média) ----------
router.post('/', async (req, res) => {
  const { content, media_url, media_type } = req.body;
  if (!content?.trim() && !media_url) {
    return res.status(400).json({ error: 'Le post doit contenir du texte ou un média' });
  }

  // Fond coloré : uniquement pour un post texte court, sans média
  let theme = normalizeTheme(req.body.theme);
  if (theme && (media_url || !content?.trim() || content.trim().length > THEMED_POST_MAX_CHARS)) theme = null;
  const font = theme ? normalizeFont(req.body.font) : null;

  const id = uuid();
  await db
    .prepare('INSERT INTO posts (id, user_id, content, media_url, media_type, category, theme, font) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.user.id, content?.trim() || null, media_url || null, media_type || null, normalizeCategory(req.body.category), theme, font);

  await notifyMentions(req.app.get('io'), { text: content, actorId: req.user.id, postId: id, where: 'post' });

  res.status(201).json(await getPostById(id));
});

// ---------- Repartager un post existant ----------
router.post('/:id/share', async (req, res) => {
  const original = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Publication introuvable' });

  const id = uuid();
  await db
    .prepare('INSERT INTO posts (id, user_id, content, media_url, media_type, shared_from_id, category, theme, font) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.user.id, original.content, original.media_url, original.media_type, original.id, normalizeCategory(original.category), original.theme || null, original.font || null);

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

// ---------- Masquer une publication de mon fil (« Cela ne m'intéresse pas ») ----------
router.post('/:id/hide', async (req, res) => {
  const post = await db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publication introuvable' });
  await db.prepare('INSERT INTO post_hidden (user_id, post_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(req.user.id, post.id);
  res.json({ hidden: true });
});

router.delete('/:id/hide', async (req, res) => {
  await db.prepare('DELETE FROM post_hidden WHERE user_id = ? AND post_id = ?').run(req.user.id, req.params.id);
  res.json({ hidden: false });
});

// ---------- Sujets masqués (« Ce sujet ne m'intéresse pas ») ----------
router.get('/categories/muted', async (req, res) => {
  const rows = await db.prepare('SELECT category FROM muted_categories WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows.map((r) => r.category));
});

router.post('/categories/:key/mute', async (req, res) => {
  const key = String(req.params.key || '').toLowerCase();
  if (!CATEGORIES.includes(key) || key === DEFAULT_CATEGORY) return res.status(400).json({ error: 'Ce sujet ne peut pas être masqué' });
  await db.prepare('INSERT INTO muted_categories (user_id, category) VALUES (?, ?) ON CONFLICT DO NOTHING').run(req.user.id, key);
  res.json({ muted: true });
});

router.delete('/categories/:key/mute', async (req, res) => {
  await db.prepare('DELETE FROM muted_categories WHERE user_id = ? AND category = ?').run(req.user.id, String(req.params.key || '').toLowerCase());
  res.json({ muted: false });
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
              su.username AS shared_from_username,
              COALESCE(p.category, 'divers') AS category, p.theme, p.font,
              (SELECT f.status FROM follows f WHERE f.follower_id = ? AND f.followed_id = p.user_id) AS follow_status
       FROM post_bookmarks b
       JOIN posts p ON p.id = b.post_id
       JOIN users u ON u.id = p.user_id
       LEFT JOIN posts so ON so.id = p.shared_from_id
       LEFT JOIN users su ON su.id = so.user_id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC
       LIMIT 100`
    )
    .all(req.user.id, req.user.id, req.user.id);
  res.json(rows);
});

// ---------- Hashtags tendance (7 derniers jours) ----------
router.get('/hashtags/trending', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT LOWER(m[2]) AS tag, COUNT(DISTINCT p.id) AS count
       FROM posts p, regexp_matches(p.content, '(^|[^[:alnum:]_#])#([[:alpha:]0-9_]{2,50})', 'g') AS m
       WHERE p.content IS NOT NULL AND p.created_at > NOW() - INTERVAL '7 days'
       GROUP BY 1 ORDER BY count DESC, tag ASC LIMIT 10`
    )
    .all();
  res.json(rows);
});

// ---------- Commentaires ----------
const COMMENT_SELECT = `SELECT c.id, c.content, c.created_at, c.edited_at, c.parent_id, u.id AS user_id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name,
              (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS like_count,
              EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = ?) AS liked_by_me
       FROM post_comments c JOIN users u ON u.id = c.user_id`;

router.get('/:id/comments', async (req, res) => {
  const comments = await db
    .prepare(`${COMMENT_SELECT} WHERE c.post_id = ? ORDER BY c.created_at ASC`)
    .all(req.user.id, req.params.id);
  res.json(comments);
});

router.post('/:id/comments', async (req, res) => {
  const { content, parent_id } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Commentaire vide' });

  const post = await db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publication introuvable' });

  // Réponse à un commentaire : on rattache toujours à un commentaire « racine » (un seul niveau, comme Instagram)
  let rootId = null;
  let repliedTo = null;
  if (parent_id) {
    const parent = await db.prepare('SELECT id, user_id, post_id, parent_id FROM post_comments WHERE id = ?').get(parent_id);
    if (!parent || parent.post_id !== post.id) return res.status(404).json({ error: 'Commentaire introuvable' });
    rootId = parent.parent_id || parent.id;
    repliedTo = parent;
  }

  const id = uuid();
  await db
    .prepare('INSERT INTO post_comments (id, post_id, user_id, content, parent_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.params.id, req.user.id, content.trim(), rootId);

  const io = req.app.get('io');
  const skip = [post.user_id];
  if (repliedTo) {
    // La personne à qui on répond est prévenue d'une réponse ; le propriétaire du post l'est aussi (sauf si c'est la même personne)
    await notify(io, { user_id: repliedTo.user_id, actor_id: req.user.id, type: 'reply', post_id: post.id });
    skip.push(repliedTo.user_id);
    if (post.user_id !== repliedTo.user_id) {
      await notify(io, { user_id: post.user_id, actor_id: req.user.id, type: 'comment', post_id: post.id });
    }
  } else {
    await notify(io, { user_id: post.user_id, actor_id: req.user.id, type: 'comment', post_id: post.id });
  }
  // Les personnes mentionnées sont prévenues (sauf celles déjà notifiées ci-dessus)
  await notifyMentions(io, { text: content, actorId: req.user.id, postId: post.id, where: 'comment', skipUserIds: skip });

  // @kora (ou réponse à un commentaire de Kora) : Kora répond dans les commentaires quelques secondes plus tard
  const koraWillReply = await ai.maybeReplyToComment(io, {
    postId: post.id,
    commentId: id,
    rootId,
    authorId: req.user.id,
    text: content,
    repliedToUserId: repliedTo?.user_id || null,
  }).catch(() => false);

  const comment = await db.prepare(`${COMMENT_SELECT} WHERE c.id = ?`).get(req.user.id, id);
  res.status(201).json({ ...comment, kora_will_reply: !!koraWillReply });
});

// ---------- Aimer / ne plus aimer un commentaire ----------
router.post('/comments/:commentId/like', async (req, res) => {
  const c = await db.prepare('SELECT id, user_id, post_id FROM post_comments WHERE id = ?').get(req.params.commentId);
  if (!c) return res.status(404).json({ error: 'Commentaire introuvable' });

  const already = await db
    .prepare('SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?')
    .get(c.id, req.user.id);

  if (already) {
    await db.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?').run(c.id, req.user.id);
  } else {
    await db.prepare('INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)').run(c.id, req.user.id);
    await notify(req.app.get('io'), { user_id: c.user_id, actor_id: req.user.id, type: 'comment_like', post_id: c.post_id });
  }

  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?').get(c.id);
  res.json({ liked: !already, like_count: countRow.n });
});

// ---------- Modifier son propre commentaire ----------
router.patch('/comments/:commentId', async (req, res) => {
  const c = await db.prepare('SELECT id, user_id FROM post_comments WHERE id = ?').get(req.params.commentId);
  if (!c) return res.status(404).json({ error: 'Commentaire introuvable' });
  if (c.user_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
  const content = (req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Commentaire vide' });
  await db.prepare('UPDATE post_comments SET content = ?, edited_at = NOW() WHERE id = ?').run(content, c.id);
  res.json({ ok: true });
});

// ---------- Fil de publications (le plus récent en premier) ----------
async function listPosts(req, res) {
  const { user_id, hashtag, category } = req.query;

  // On ne voit jamais les publications d'un compte qu'on a bloqué (ni de quelqu'un qui nous a bloqué)
  const conditions = [
    `NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = ? AND ub.blocked_id = p.user_id) OR (ub.blocker_id = p.user_id AND ub.blocked_id = ?))`,
  ];
  const extraParams = [req.user.id, req.user.id];
  // Les publications masquées disparaissent du fil et des hashtags (mais restent visibles sur le profil de leur auteur)
  if (!user_id) {
    conditions.push('NOT EXISTS (SELECT 1 FROM post_hidden ph WHERE ph.post_id = p.id AND ph.user_id = ?)');
    extraParams.push(req.user.id);
  }
  if (category) {
    // Parcourir une catégorie précise (page Explorer) : on l'affiche même si le sujet est masqué dans le fil
    conditions.push(`COALESCE(p.category, 'divers') = ?`);
    extraParams.push(normalizeCategory(category));
  } else if (!user_id && !hashtag) {
    // Fil principal : on retire les sujets que le membre ne veut plus voir
    conditions.push(`COALESCE(p.category, 'divers') NOT IN (SELECT mc.category FROM muted_categories mc WHERE mc.user_id = ?)`);
    extraParams.push(req.user.id);
  }
  if (user_id) {
    conditions.push('p.user_id = ?');
    extraParams.push(user_id);
  } else if (hashtag) {
    // Recherche insensible à la casse, délimitée par un mot pour éviter les faux positifs (#kalchat vs #kalchatting)
    const safeTag = String(hashtag).replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    conditions.push('p.content ~* ?');
    extraParams.push(`(^|[^\\w#])#${safeTag}([^\\w]|$)`);
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
              su.username AS shared_from_username,
              COALESCE(p.category, 'divers') AS category, p.theme, p.font,
              (SELECT f.status FROM follows f WHERE f.follower_id = ? AND f.followed_id = p.user_id) AS follow_status
       FROM posts p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN posts so ON so.id = p.shared_from_id
       LEFT JOIN users su ON su.id = so.user_id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT 100`
    )
    .all(req.user.id, req.user.id, req.user.id, ...extraParams);
  res.json(rows);
}
router.get('/', listPosts);
router.listPosts = listPosts; // réutilisé par le fil public (visiteurs non connectés)

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
              su.username AS shared_from_username,
              COALESCE(p.category, 'divers') AS category, p.theme, p.font,
              (SELECT f.status FROM follows f WHERE f.follower_id = ? AND f.followed_id = p.user_id) AS follow_status
       FROM posts p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN posts so ON so.id = p.shared_from_id
       LEFT JOIN users su ON su.id = so.user_id
       WHERE p.id = ? AND ${blocked}`
    )
    .get(req.user.id, req.user.id, req.user.id, req.params.id, req.user.id, req.user.id);
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
  if (post.theme && content.length > THEMED_POST_MAX_CHARS) {
    return res.status(400).json({ error: `Un post avec fond est limité à ${THEMED_POST_MAX_CHARS} caractères` });
  }
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
  await releaseMedia(post.media_url);
  res.json({ ok: true });
});

async function getPostById(id) {
  return db
    .prepare(
      `SELECT p.id, p.user_id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name, p.content, p.media_url, p.media_type, p.created_at,
              0 AS like_count, false AS liked_by_me, 0 AS comment_count, 0 AS share_count,
              false AS bookmarked_by_me, su.username AS shared_from_username,
              COALESCE(p.category, 'divers') AS category, p.theme, p.font, NULL AS follow_status
       FROM posts p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN posts so ON so.id = p.shared_from_id
       LEFT JOIN users su ON su.id = so.user_id
       WHERE p.id = ?`
    )
    .get(id);
}

module.exports = router;
