const db = require('./db');
const { deleteFileByUrl } = require('./storage');

// ---------- Supprime les fichiers vidéo/vocal de plus de 90 jours ----------
// Le message ou la publication reste (texte, likes, commentaires...), seul le fichier
// média est effacé du stockage pour libérer de la place, comme demandé.
async function cleanupTable(table) {
  const rows = await db
    .prepare(
      `SELECT id, media_url FROM ${table}
       WHERE media_type IN ('video', 'audio') AND media_url IS NOT NULL
         AND created_at < NOW() - INTERVAL '90 days'`
    )
    .all();

  for (const row of rows) {
    await deleteFileByUrl(row.media_url).catch((err) => console.error(`Erreur suppression média ${table}#${row.id}:`, err.message));
    await db.prepare(`UPDATE ${table} SET media_url = NULL, media_type = NULL WHERE id = ?`).run(row.id);
  }

  if (rows.length > 0) {
    console.log(`🧹 ${rows.length} média(s) vidéo/vocal de plus de 90 jours supprimé(s) de "${table}".`);
  }
}

async function cleanupOldMedia() {
  await cleanupTable('messages');
  await cleanupTable('posts');
}

module.exports = { cleanupOldMedia };
