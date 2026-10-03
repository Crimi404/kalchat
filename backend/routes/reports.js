const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const TYPES = ['post', 'comment', 'message', 'user'];
const REASONS = ['spam', 'harcelement', 'haine', 'violence', 'nudite', 'usurpation', 'arnaque', 'autre'];
const MAX_REPORTS_PER_DAY = 20;

// Texte lisible d'un message pour la copie conservée avec le signalement
function msgText(m) {
  if (m.content) return m.content;
  if (m.media_type === 'image') return '[photo]';
  if (m.media_type === 'video') return '[vidéo]';
  if (m.media_type === 'audio') return '[message vocal]';
  return '[message]';
}

// ---------- Signaler une publication, un commentaire, un message ou un compte ----------
router.post('/', async (req, res) => {
  const type = String(req.body.type || '');
  const targetId = String(req.body.target_id || '');
  const reason = String(req.body.reason || '');
  const details = String(req.body.details || '').trim().slice(0, 500) || null;

  if (!TYPES.includes(type) || !targetId) return res.status(400).json({ error: 'Signalement invalide' });
  if (!REASONS.includes(reason)) return res.status(400).json({ error: 'Choisis un motif de signalement' });

  // Limite anti-abus : pas plus de 20 signalements par jour et par membre
  const today = await db
    .prepare("SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > NOW() - INTERVAL '24 hours'")
    .get(req.user.id);
  if (today.n >= MAX_REPORTS_PER_DAY) {
    return res.status(429).json({ error: 'Trop de signalements aujourd\'hui, réessaie demain' });
  }

  let targetUserId = null;
  let snapshot = null;

  if (type === 'post') {
    const p = await db.prepare('SELECT id, user_id, content, media_type FROM posts WHERE id = ?').get(targetId);
    if (!p) return res.status(404).json({ error: 'Publication introuvable' });
    targetUserId = p.user_id;
    snapshot = [p.content, p.media_type && !p.media_type.endsWith('_expired') ? `[${p.media_type}]` : null].filter(Boolean).join('\n');
  } else if (type === 'comment') {
    const c = await db.prepare('SELECT id, user_id, post_id, content FROM post_comments WHERE id = ?').get(targetId);
    if (!c) return res.status(404).json({ error: 'Commentaire introuvable' });
    targetUserId = c.user_id;
    snapshot = c.content;
  } else if (type === 'user') {
    const u = await db.prepare('SELECT id, username, bio FROM users WHERE id = ?').get(targetId);
    if (!u) return res.status(404).json({ error: 'Compte introuvable' });
    targetUserId = u.id;
    snapshot = `@${u.username}${u.bio ? ` — ${u.bio}` : ''}`;
  } else if (type === 'message') {
    const m = await db
      .prepare('SELECT id, sender_id, conversation_id, content, media_type, created_at FROM messages WHERE id = ?')
      .get(targetId);
    if (!m || m.media_type === 'system') return res.status(404).json({ error: 'Message introuvable' });
    // On ne peut signaler que les messages d'une conversation dont on est membre
    const member = await db
      .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(m.conversation_id, req.user.id);
    if (!member) return res.status(403).json({ error: 'Accès refusé' });
    targetUserId = m.sender_id;
    // Le message signalé + les 4 précédents, pour que la modération comprenne le contexte
    const context = await db
      .prepare(
        `SELECT m2.content, m2.media_type, u.username
         FROM messages m2 JOIN users u ON u.id = m2.sender_id
         WHERE m2.conversation_id = ? AND m2.created_at < ? AND COALESCE(m2.media_type, '') != 'system'
         ORDER BY m2.created_at DESC LIMIT 4`
      )
      .all(m.conversation_id, m.created_at);
    const sender = await db.prepare('SELECT username FROM users WHERE id = ?').get(m.sender_id);
    const lines = context.reverse().map((c) => `@${c.username} : ${msgText(c)}`);
    lines.push(`>>> @${sender.username} : ${msgText(m)}`);
    snapshot = lines.join('\n');
  }

  if (targetUserId === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas te signaler toi-même' });

  // Un même membre ne peut pas signaler deux fois le même contenu tant que le premier signalement est ouvert
  const dup = await db
    .prepare("SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'")
    .get(req.user.id, type, targetId);
  if (dup) return res.status(200).json({ ok: true, duplicate: true });

  await db
    .prepare('INSERT INTO reports (id, reporter_id, target_type, target_id, target_user_id, reason, details, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuid(), req.user.id, type, targetId, targetUserId, reason, details, snapshot);

  res.status(201).json({ ok: true });
});

module.exports = router;
