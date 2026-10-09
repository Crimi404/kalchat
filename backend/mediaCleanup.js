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

/** À appeler APRÈS la suppression en base : efface le fichier du stockage s'il n'est plus référencé. */
async function releaseMedia(url) {
  if (!url || !extractFilenameFromUrl(url)) return;
  try {
    if (!(await isStillUsed(url))) await deleteFileByUrl(url);
  } catch (err) {
    console.error('Erreur libération média:', err.message);
  }
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

module.exports = { releaseMedia, releaseMany, cleanupExpiredStories, sweepOrphanFiles };
