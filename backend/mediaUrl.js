// Validation des adresses de médias envoyées par les clients (photos de profil, couvertures, avatars, médias de posts / stories / messages).
// Avant, n'importe quelle adresse était acceptée, y compris externe : traçage des personnes qui voient le profil, contournement des contrôles d'upload.
// On n'accepte que : une adresse du stockage de Kalchat, la valeur déjà enregistrée, ou une adresse déjà utilisée dans la base (anciennes données).
const { isStillUsed } = require('./mediaCleanup');

const BUCKET = 'kalchat-media';

/** Vrai si l'adresse pointe vers le dossier public de notre stockage Supabase. */
function isOwnMediaUrl(url) {
  if (url == null || url === '') return true;
  if (typeof url !== 'string' || url.length > 1000 || url.includes('..')) return false;
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  if (!base) return true; // stockage non configuré : on ne bloque pas (rien à comparer)
  return url.startsWith(`${base}/storage/v1/object/public/${BUCKET}/`);
}

/** Adresse acceptable pour un champ de média : stockage Kalchat, inchangée, ou déjà présente en base. */
async function mediaUrlOk(url, current = null) {
  if (url == null || url === '') return true;
  if (typeof url !== 'string' || url.length > 1000) return false;
  if (current && url === current) return true;
  if (isOwnMediaUrl(url)) return true;
  try {
    return await isStillUsed(url);
  } catch {
    return false;
  }
}

const BAD_URL = { error: 'Adresse de média invalide' };

module.exports = { isOwnMediaUrl, mediaUrlOk, BAD_URL };
