const db = require('./db');
const { deleteFileByUrl, extractFilenameFromUrl, listAllFiles, deleteFilesByName } = require('./storage');

// Un même fichier peut servir à plusieurs endroits (un repartage de story ou de post réutilise l'URL de l'original).
// On ne l'efface donc du stockage que s'il n'est plus utilisé nulle part.
const URL_COLUMNS = [
  ['posts', 'media_url'],
  ['stories', 'media_url'],
  ['messages', 'media_url'],
  ['users', 'avatar_url'],
  ['users', 'cover_url'],
  ['conversations', 'avatar_url'],
  ['communities', 'avatar_url'],
];

async function isStillUsed(url) {
  for (const [table, column] of URL_COLUMNS) {
    const row = await db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`).get(url);
    if (row) return true;
  }
  return false;
}

/** Met un fichier dans la file de suppression : il sera retenté automatiquement (voir processDeleteQueue). */
async function enqueueDelete(url, reason) {
  await db
    .prepare("INSERT INTO media_delete_queue (url, last_error, next_attempt_at) VALUES (?, ?, NOW() + INTERVAL '5 minutes') ON CONFLICT (url) DO NOTHING")
    .run(url, String(reason || '').slice(0, 300));
}

/** À appeler APRÈS la suppression en base : efface le fichier du stockage s'il n'est plus référencé. En cas d'échec, il est retenté plus tard. */
async function releaseMedia(url) {
  if (!url || !extractFilenameFromUrl(url)) return;
  try {
    if (await isStillUsed(url)) return;
    const ok = await deleteFileByUrl(url);
    if (!ok) await enqueueDelete(url, 'suppression refusée par le stockage');
  } catch (err) {
    console.error('Erreur libération média:', err.message);
    await enqueueDelete(url, err.message).catch(() => {});
  }
}

// ---------- Réessaie les suppressions échouées (délai doublé à chaque échec, 24 h maximum, 10 essais) ----------
const QUEUE_MAX_ATTEMPTS = 10;

async function processDeleteQueue() {
  const rows = await db
    .prepare('SELECT url, attempts FROM media_delete_queue WHERE next_attempt_at <= NOW() AND attempts < ? ORDER BY next_attempt_at LIMIT 100')
    .all(QUEUE_MAX_ATTEMPTS);
  let done = 0;
  for (const row of rows) {
    try {
      // Si le fichier est de nouveau utilisé quelque part, on ne le supprime surtout pas
      if (!(await isStillUsed(row.url))) {
        const ok = await deleteFileByUrl(row.url);
        if (!ok) throw new Error('suppression refusée par le stockage');
      }
      await db.prepare('DELETE FROM media_delete_queue WHERE url = ?').run(row.url);
      done++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const delayMinutes = Math.min(5 * 2 ** attempts, 24 * 60);
      await db
        .prepare("UPDATE media_delete_queue SET attempts = ?, last_error = ?, next_attempt_at = NOW() + (? * INTERVAL '1 minute') WHERE url = ?")
        .run(attempts, String(err.message).slice(0, 300), delayMinutes, row.url);
      if (attempts >= QUEUE_MAX_ATTEMPTS) console.error(`⚠️ Suppression abandonnée après ${attempts} essais : ${row.url}`);
    }
  }
  if (done > 0) console.log(`🧹 File de suppression : ${done} fichier(s) supprimé(s) après nouvelle tentative.`);
  return done;
}

async function releaseMany(urls) {
  for (const url of new Set((urls || []).filter(Boolean))) await releaseMedia(url);
}

// ---------- Stories expirées : suppression en base + fichiers ----------
async function cleanupExpiredStories() {
  const expired = await db.prepare('SELECT id, media_url FROM stories WHERE expires_at <= NOW()').all();
  if (!expired.length) return 0;
  await db.prepare('DELETE FROM stories WHERE expires_at <= NOW()').run();
  await releaseMany(expired.map((s) => s.media_url));
  console.log(`🧹 ${expired.length} story(s) expirée(s) supprimée(s).`);
  return expired.length;
}

// ---------- Balayage : fichiers du bucket qui ne sont plus référencés nulle part ----------
// Les fichiers de moins de 6 h sont épargnés (un envoi peut précéder la création du post ou du message).
const ORPHAN_MIN_AGE_MS = 6 * 60 * 60 * 1000;

async function referencedFileNames() {
  const names = new Set();
  for (const [table, column] of URL_COLUMNS) {
    const rows = await db.prepare(`SELECT ${column} AS url FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`).all();
    for (const r of rows) {
      const name = extractFilenameFromUrl(r.url);
      if (name) names.add(name);
    }
  }
  return names;
}

/** dryRun = true : compte seulement. Renvoie { total_files, total_bytes, orphan_files, orphan_bytes, removed }. */
async function sweepOrphanFiles({ dryRun = false } = {}) {
  const [files, used] = await Promise.all([listAllFiles(), referencedFileNames()]);
  const now = Date.now();
  const orphans = files.filter((f) => !used.has(f.name) && (!f.created_at || now - f.created_at.getTime() > ORPHAN_MIN_AGE_MS));
  const result = {
    total_files: files.length,
    total_bytes: files.reduce((n, f) => n + f.size, 0),
    orphan_files: orphans.length,
    orphan_bytes: orphans.reduce((n, f) => n + f.size, 0),
    removed: 0,
  };
  if (!dryRun && orphans.length) {
    result.removed = await deleteFilesByName(orphans.map((f) => f.name));
    console.log(`🧹 Stockage : ${result.removed} fichier(s) orphelin(s) supprimé(s) (${Math.round(result.orphan_bytes / 1024 / 1024)} Mo).`);
  }
  return result;
}

module.exports = { releaseMedia, releaseMany, cleanupExpiredStories, sweepOrphanFiles, processDeleteQueue };
