// Règle d'accès aux stories, partagée par les routes des stories et par la messagerie (réponse à une story).
const db = require('./db');
const { isBlockedEitherWay } = require('./blocks');

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

module.exports = { canSeeStory };
