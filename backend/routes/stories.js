const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { releaseMedia, cleanupExpiredStories } = require('../mediaCleanup');
const { mediaUrlOk, BAD_URL } = require('../mediaUrl');
const { normalizeTheme, normalizeFont } = require('../themes');
const { notify } = require('../notify');
const { isBlockedEitherWay } = require('../blocks');

const router = express.Router();
router.use(authMiddleware);

const LIFETIME_HOURS = Number(process.env.STORY_LIFETIME_HOURS || 24);
const ALLOWED_DURATIONS = [6, 12, 24];

// Durée choisie par l'auteur (6 h, 12 h ou 24 h), 24 h par défaut
function storyHours(value) {
  const h = Number(value);
  return ALLOWED_DURATIONS.includes(h) ? Math.min(h, LIFETIME_HOURS) : LIFETIME_HOURS;
}

// Une story n'est visible que par son auteur et par les personnes abonnées à lui (ou qu'il suit), sans blocage.
async function canSeeStory(viewerId, story) {
  if (!story || new Date(story.expires_at) <= new Date()) return false;
  if (story.user_id === viewerId) return true;
  if (await isBlockedEitherWay(viewerId, story.user_id)) return false;
  const friend = await db
    .prepare(
      `SELECT 1 FROM follows WHERE status = 'accepted' AND (
         (follower_id = ? AND followed_id = ?) OR (follower_id = ? AND followed_id = ?)
       )`
    )
    .get(viewerId, story.user_id, story.user_id, viewerId);
  return !!friend;
}

// Le repartage est-il autorisé par l'auteur ? Choix de la story d'abord, sinon réglage général du membre (activé par défaut).
async function shareAllowed(story) {
  if (story.allow_share !== null && story.allow_share !== undefined) return Number(story.allow_share) === 1;
  const author = await db.prepare('SELECT allow_story_share FROM users WHERE id = ?').get(story.user_id);
  return Number(author?.allow_story_share ?? 1) === 1;
}

// ---------- Publier une story ----------
router.post('/', async (req, res) => {
  // Un repartage passe uniquement par POST /:id/share (le client ne peut pas se déclarer « repartage »)
  const { media_url, media_type, caption } = req.body;
  if (!(await mediaUrlOk(media_url))) return res.status(400).json(BAD_URL);
  if (!media_url && !caption?.trim()) return res.status(400).json({ error: 'Une story doit contenir une photo, une vidéo ou du texte' });

  // Fond et police : uniquement pour une story texte (sans photo ni vidéo)
  const theme = media_url ? null : normalizeTheme(req.body.theme);
  const font = media_url ? null : normalizeFont(req.body.font);

  // Repartage autorisé pour cette story : true / false, ou rien = on suit le réglage général
  const allowShare = req.body.allow_share === undefined || req.body.allow_share === null ? null : req.body.allow_share ? 1 : 0;

  const id = uuid();
  await db
    .prepare(
      `INSERT INTO stories (id, user_id, media_url, media_type, caption, shared_from_id, theme, font, allow_share, expires_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NOW() + (? * INTERVAL '1 hour'))`
    )
    .run(id, req.user.id, media_url || '', media_type || null, caption?.trim() || null, theme, font, allowShare, storyHours(req.body.duration_hours));

  const story = await db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
  res.status(201).json(story);
});

// ---------- Repartager la story de quelqu'un dans son propre fil (si l'auteur l'autorise) ----------
router.post('/:id/share', async (req, res) => {
  const original = await db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!original || !(await canSeeStory(req.user.id, original))) return res.status(404).json({ error: 'Story introuvable' });
  if (original.user_id === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas repartager ta propre story' });
  if (original.shared_from_id) return res.status(400).json({ error: 'Cette story est déjà un repartage' });
  if (!(await shareAllowed(original))) return res.status(403).json({ error: "Cette personne n'autorise pas le repartage de ses stories" });

  const already = await db
    .prepare('SELECT 1 FROM stories WHERE user_id = ? AND shared_from_id = ? AND expires_at > NOW()')
    .get(req.user.id, original.id);
  if (already) return res.status(409).json({ error: 'Tu as déjà repartagé cette story' });

  // Le repartage disparaît au plus tard en même temps que la story d'origine
  const wanted = Date.now() + storyHours(req.body?.duration_hours) * 3600 * 1000;
  const until = new Date(Math.min(wanted, new Date(original.expires_at).getTime())).toISOString();

  const id = uuid();
  await db
    .prepare(
      `INSERT INTO stories (id, user_id, media_url, media_type, caption, shared_from_id, theme, font, allow_share, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    )
    .run(id, req.user.id, original.media_url, original.media_type, original.caption, original.id, original.theme || null, original.font || null, until);

  await notify(req.app.get('io'), { user_id: original.user_id, actor_id: req.user.id, type: 'story_share' });

  const story = await db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
  res.status(201).json(story);
});

// ---------- Aimer / ne plus aimer une story ----------
router.post('/:id/like', async (req, res) => {
  const story = await db.prepare('SELECT id, user_id, expires_at FROM stories WHERE id = ?').get(req.params.id);
  if (!story || !(await canSeeStory(req.user.id, story))) return res.status(404).json({ error: 'Story introuvable' });

  const already = await db
    .prepare('SELECT 1 FROM story_likes WHERE story_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);

  if (already) {
    await db.prepare('DELETE FROM story_likes WHERE story_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  } else {
    await db.prepare('INSERT INTO story_likes (story_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(req.params.id, req.user.id);
    // Une seule notification non lue par personne et par heure (évite le spam en cas de like / unlike répétés)
    const recent = await db
      .prepare("SELECT 1 FROM notifications WHERE user_id = ? AND actor_id = ? AND type = 'story_like' AND is_read = 0 AND created_at > NOW() - INTERVAL '1 hour'")
      .get(story.user_id, req.user.id);
    if (!recent) await notify(req.app.get('io'), { user_id: story.user_id, actor_id: req.user.id, type: 'story_like' });
  }

  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM story_likes WHERE story_id = ?').get(req.params.id);
  res.json({ liked: !already, like_count: countRow.n });
});

// ---------- Commentaires ----------
router.get('/:id/comments', async (req, res) => {
  const target = await db.prepare('SELECT id, user_id, expires_at FROM stories WHERE id = ?').get(req.params.id);
  if (!target || !(await canSeeStory(req.user.id, target))) return res.status(404).json({ error: 'Story introuvable' });
  const comments = await db
    .prepare(
      `SELECT c.id, c.content, c.created_at, u.id AS user_id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name
       FROM story_comments c JOIN users u ON u.id = c.user_id
       WHERE c.story_id = ? ORDER BY c.created_at ASC`
    )
    .all(req.params.id);
  res.json(comments);
});

router.post('/:id/comments', async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Commentaire vide' });

  const story = await db.prepare('SELECT id, user_id, expires_at FROM stories WHERE id = ?').get(req.params.id);
  if (!story || !(await canSeeStory(req.user.id, story))) return res.status(404).json({ error: 'Story introuvable' });

  const id = uuid();
  await db
    .prepare('INSERT INTO story_comments (id, story_id, user_id, content) VALUES (?, ?, ?, ?)')
    .run(id, req.params.id, req.user.id, content.trim());

  const comment = await db
    .prepare(
      `SELECT c.id, c.content, c.created_at, u.id AS user_id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name
       FROM story_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`
    )
    .get(id);
  res.status(201).json(comment);
});

// ---------- Fil des stories actives, groupées par utilisateur ----------
// (contacts = personnes avec qui on a déjà une conversation, + soi-même)
router.get('/feed', async (req, res) => {
  await cleanupExpiredStories();

  const rows = await db
    .prepare(
      `SELECT s.id, s.user_id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name, s.media_url, s.media_type, s.caption, s.theme, s.font, s.created_at, s.expires_at,
              EXISTS(SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.viewer_id = ?) AS viewed_by_me,
              (SELECT COUNT(*) FROM story_likes l WHERE l.story_id = s.id) AS like_count,
              EXISTS(SELECT 1 FROM story_likes l WHERE l.story_id = s.id AND l.user_id = ?) AS liked_by_me,
              (s.shared_from_id IS NULL AND s.user_id != ? AND COALESCE(s.allow_share, u.allow_story_share, 1) = 1) AS can_share,
              s.shared_from_id,
              (SELECT COUNT(*) FROM story_comments c WHERE c.story_id = s.id) AS comment_count,
              su.username AS shared_from_username
       FROM stories s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN stories so ON so.id = s.shared_from_id
       LEFT JOIN users su ON su.id = so.user_id
       WHERE s.expires_at > NOW()
         AND (
           s.user_id = ?
           OR s.user_id IN (
             SELECT followed_id FROM follows WHERE follower_id = ? AND status = 'accepted'
             UNION
             SELECT follower_id FROM follows WHERE followed_id = ? AND status = 'accepted'
           )
         )
       ORDER BY s.created_at DESC`
    )
    .all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);

  // Regroupe par auteur
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.user_id]) {
      grouped[r.user_id] = { user_id: r.user_id, username: r.username, avatar_url: r.avatar_url, badge: r.badge, role: r.role, first_name: r.first_name, last_name: r.last_name, stories: [] };
    }
    grouped[r.user_id].stories.push(r);
  }
  res.json(Object.values(grouped));
});

// ---------- Marquer une story comme vue + voir qui l'a vue ----------
router.post('/:id/view', async (req, res) => {
  const target = await db.prepare('SELECT id, user_id, expires_at FROM stories WHERE id = ?').get(req.params.id);
  if (!target || !(await canSeeStory(req.user.id, target))) return res.status(404).json({ error: 'Story introuvable' });
  await db
    .prepare('INSERT INTO story_views (story_id, viewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.get('/:id/viewers', async (req, res) => {
  const story = await db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Story introuvable' });
  if (story.user_id !== req.user.id) return res.status(403).json({ error: 'Seul l\'auteur peut voir la liste' });

  const viewers = await db
    .prepare(
      `SELECT u.id, u.username, u.avatar_url, v.viewed_at,
              EXISTS(SELECT 1 FROM story_likes l WHERE l.story_id = v.story_id AND l.user_id = u.id) AS liked
       FROM story_views v
       JOIN users u ON u.id = v.viewer_id WHERE v.story_id = ? ORDER BY v.viewed_at DESC`
    )
    .all(req.params.id);
  res.json(viewers);
});

// ---------- Supprimer sa propre story ----------
router.delete('/:id', async (req, res) => {
  const story = await db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Story introuvable' });
  if (story.user_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });

  await db.prepare('DELETE FROM stories WHERE id = ?').run(req.params.id);
  await releaseMedia(story.media_url);
  res.json({ ok: true });
});

module.exports = router;
