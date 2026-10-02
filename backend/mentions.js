const db = require('./db');
const { notify } = require('./notify');

// @pseudo : 3 à 20 caractères (lettres, chiffres, _), précédé d'un début de texte ou d'un espace / signe
const MENTION_RE = /(^|[^\w@])@([A-Za-z0-9_]{3,20})\b/g;

function extractMentions(text) {
  const names = new Set();
  const re = new RegExp(MENTION_RE.source, 'g');
  let m;
  while ((m = re.exec(text || '')) !== null) names.add(m[2].toLowerCase());
  return [...names].slice(0, 10); // 10 mentions max par texte, contre le spam
}

/** Notifie chaque membre mentionné (sauf l'auteur et ceux déjà prévenus autrement). */
async function notifyMentions(io, { text, actorId, postId, where, skipUserIds = [] }) {
  const names = extractMentions(text);
  if (!names.length) return;
  const users = await db.prepare('SELECT id FROM users WHERE LOWER(username) = ANY(?) AND is_blocked = 0').all(names);
  for (const u of users) {
    if (u.id === actorId || skipUserIds.includes(u.id)) continue;
    await notify(io, { user_id: u.id, actor_id: actorId, type: 'mention', post_id: postId, body: where });
  }
}

module.exports = { extractMentions, notifyMentions };
