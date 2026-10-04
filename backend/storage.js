const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'kalchat-media';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants. Les fichiers uploadés (photos, vidéos) ne seront pas stockés durablement.'
  );
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ---------- Crée le bucket de stockage au démarrage s'il n'existe pas déjà ----------
async function initStorage() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    console.error('❌ Impossible de lister les buckets Supabase Storage :', error.message);
    return;
  }
  const exists = buckets?.some((b) => b.name === BUCKET);
  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (createError) {
      console.error('❌ Impossible de créer le bucket Supabase Storage :', createError.message);
    } else {
      console.log(`✅ Bucket de stockage "${BUCKET}" créé sur Supabase.`);
    }
  }
}

// ---------- Upload un fichier (buffer en mémoire) et renvoie son URL publique ----------
async function uploadFile(filename, buffer, mimetype) {
  const { error } = await supabase.storage.from(BUCKET).upload(filename, buffer, {
    contentType: mimetype,
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

// ---------- Déduit le type de média à partir du mimetype ----------
function mediaTypeFromMimetype(mimetype = '') {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return 'file';
}

// ---------- Supprime un fichier à partir de son URL publique Supabase ----------
function extractFilenameFromUrl(url) {
  const marker = `/${BUCKET}/`;
  const idx = url?.indexOf(marker);
  if (idx == null || idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

async function deleteFileByUrl(url) {
  const filename = extractFilenameFromUrl(url);
  if (!filename) return;
  const { error } = await supabase.storage.from(BUCKET).remove([filename]);
  if (error) console.error('Erreur suppression fichier Supabase Storage:', error.message);
}

// ---------- Liste les fichiers à la racine du bucket (avec taille et date d'envoi) ----------
async function listAllFiles() {
  const files = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage.from(BUCKET).list('', { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    for (const f of data || []) {
      if (!f.id) continue; // dossiers / marqueurs
      files.push({ name: f.name, size: Number(f.metadata?.size || 0), created_at: f.created_at ? new Date(f.created_at) : null });
    }
    if (!data || data.length < PAGE) break;
  }
  return files;
}

async function deleteFilesByName(names) {
  let removed = 0;
  for (let i = 0; i < names.length; i += 100) {
    const batch = names.slice(i, i + 100);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) console.error('Erreur suppression fichiers Supabase Storage:', error.message);
    else removed += batch.length;
  }
  return removed;
}

module.exports = { initStorage, uploadFile, mediaTypeFromMimetype, deleteFileByUrl, extractFilenameFromUrl, listAllFiles, deleteFilesByName };
