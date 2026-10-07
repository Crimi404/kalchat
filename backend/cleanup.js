const db = require('./db');
const { releaseMedia } = require('./mediaCleanup');
const { BOT_ID } = require('./ai');

// ---------- Durées de conservation (en jours) ----------
const VIDEO_RETENTION_DAYS = 60;
const AUDIO_RETENTION_DAYS = 60;
const KORA_IMAGE_RETENTION_DAYS = 60;

// ---------- Supprime les fichiers trop anciens du stockage ----------
// Le message ou la publication reste (texte, likes, commentaires...), seul le fichier média
// est effacé. Le type devient « video_expired » / « audio_expired » pour que l'appli affiche
// « Vidéo indisponible » / « Message vocal expiré » à la place du média.
async function cleanupTable(table, mediaType, days) {
  const rows = await db
    .prepare(
      `SELECT id, media_url FROM ${table}
       WHERE media_type = ? AND media_url IS NOT NULL
         AND created_at < NOW() - (? * INTERVAL '1 day')`
    )
    .all(mediaType, days);

  for (const row of rows) {
    await db.prepare(`UPDATE ${table} SET media_url = NULL, media_type = ? WHERE id = ?`).run(`${mediaType}_expired`, row.id);
    await releaseMedia(row.media_url);
  }

  if (rows.length > 0) {
    console.log(`🧹 ${rows.length} média(s) "${mediaType}" de plus de ${days} jours supprimé(s) de "${table}".`);
  }
}

// Images créées par Kora IA : supprimées après 60 jours (les photos envoyées par les membres ne sont pas touchées)
async function cleanupKoraImages() {
  const rows = await db
    .prepare(
      `SELECT id, media_url FROM messages
       WHERE sender_id = ? AND media_type = 'image' AND media_url IS NOT NULL
         AND created_at < NOW() - (? * INTERVAL '1 day')`
    )
    .all(BOT_ID, KORA_IMAGE_RETENTION_DAYS);
  for (const row of rows) {
    await db.prepare("UPDATE messages SET media_url = NULL, media_type = 'image_expired' WHERE id = ?").run(row.id);
    await releaseMedia(row.media_url);
  }
  if (rows.length > 0) console.log(`🧹 ${rows.length} image(s) de Kora de plus de ${KORA_IMAGE_RETENTION_DAYS} jours supprimée(s).`);
}

async function cleanupOldMedia() {
  await cleanupTable('messages', 'video', VIDEO_RETENTION_DAYS);
  await cleanupTable('messages', 'audio', AUDIO_RETENTION_DAYS);
  await cleanupTable('posts', 'video', VIDEO_RETENTION_DAYS);
  await cleanupKoraImages();
}

// ---------- Messages éphémères : supprime ceux dont la durée est écoulée ----------
async function cleanupExpiredMessages(io) {
  const rows = await db
    .prepare('SELECT id, conversation_id, media_url FROM messages WHERE expires_at IS NOT NULL AND expires_at < NOW() LIMIT 500')
    .all();
  for (const row of rows) {
    await db.prepare('DELETE FROM messages WHERE id = ?').run(row.id);
    await releaseMedia(row.media_url);
    io?.to(row.conversation_id).emit('message_deleted', { conversation_id: row.conversation_id, message_id: row.id });
  }
}

module.exports = { cleanupOldMedia, cleanupExpiredMessages };
