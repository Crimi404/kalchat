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

module.exports = { initStorage, uploadFile };
