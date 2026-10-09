const { v4: uuid } = require('uuid');
const db = require('./db');
const { isBlockedEitherWay } = require('./blocks');
const { pushForNotification } = require('./push');

/**
 * Crée une notification pour `user_id` et la pousse en temps réel si l'utilisateur est connecté.
 * Ne notifie jamais quelqu'un pour sa propre action (ex: liker son propre post).
 */
async function notify(io, { user_id, actor_id, type, post_id = null, conversation_id = null, message_id = null, community_id = null, body = null }) {
  if (user_id === actor_id) return;
  if (user_id === 'kalchat-ai') return; // le compte IA n'a pas de notifications
  // Si l'un a bloqué l'autre, aucune notification (sauf avertissement officiel de la modération)
  if (type !== 'moderation' && (await isBlockedEitherWay(user_id, actor_id))) return;

  const id = uuid();
  await db
    .prepare(
      `INSERT INTO notifications (id, user_id, actor_id, type, post_id, conversation_id, message_id, community_id, body)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, user_id, actor_id, type, post_id, conversation_id, message_id, community_id, body);

  const full = await db
    .prepare(
      `SELECT n.id, n.type, n.body, n.post_id, n.conversation_id, n.message_id, n.community_id, n.is_read, n.created_at,
              (SELECT c.name FROM communities c WHERE c.id = n.community_id) AS community_name,
              a.id AS actor_id, a.username AS actor_username, a.avatar_url AS actor_avatar_url
       FROM notifications n JOIN users a ON a.id = n.actor_id
       WHERE n.id = ?`
    )
    .get(id);

  io?.to(`user:${user_id}`).emit('notification', full);
  // Notification push sur le téléphone (sans bloquer ni faire échouer l'action de l'utilisateur)
  pushForNotification(full, user_id).catch((err) => console.error('Push :', err.message));
  return full;
}

module.exports = { notify };
