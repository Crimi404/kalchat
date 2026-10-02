const db = require('./db');
const { deleteFileByUrl } = require('./storage');

// ---------- Durées de conservation (en jours) ----------
const VIDEO_RETENTION_DAYS = 90;
const AUDIO_RETENTION_DAYS = 60;

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
    await deleteFileByUrl(row.media_url).catch((err) => console.error(`Erreur suppression média ${table}#${row.id}:`, err.message));
    await db.prepare(`UPDATE ${table} SET media_url = NULL, media_type = ? WHERE id = ?`).run(`${mediaType}_expired`, row.id);
  }

  if (rows.length > 0) {
    console.log(`🧹 ${rows.length} média(s) "${mediaType}" de plus de ${days} jours supprimé(s) de "${table}".`);
  }
}

async function cleanupOldMedia() {
  await cleanupTable('messages', 'video', VIDEO_RETENTION_DAYS);
  await cleanupTable('messages', 'audio', AUDIO_RETENTION_DAYS);
  await cleanupTable('posts', 'video', VIDEO_RETENTION_DAYS);
}

module.exports = { cleanupOldMedia };
