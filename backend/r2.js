const crypto = require('crypto');

// ---------- Cloudflare R2 (stockage des vidéos K-Short) ----------
// Aucune dépendance : les URLs « présignées » (AWS Signature V4, compatible S3) sont calculées ici avec le module crypto de Node.
// Variables Render nécessaires : R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
// Les clés ne quittent jamais le serveur : le navigateur reçoit seulement une URL temporaire pour UN fichier.

const REGION = 'auto';

function config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    accessKeyId,
    secretAccessKey,
    bucket,
    host: process.env.R2_ENDPOINT_HOST || `${accountId}.r2.cloudflarestorage.com`,
  };
}

function isConfigured() {
  return !!config();
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();
const sha256hex = (data) => crypto.createHash('sha256').update(data, 'utf8').digest('hex');
const uriEncode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encodePath = (p) => p.split('/').map(uriEncode).join('/');

/**
 * Construit une URL présignée (AWS SigV4, charge utile non signée).
 * `signedHeaders` : en-têtes que le client DEVRA envoyer à l'identique (ex. content-type pour un envoi).
 */
function presign({ method, host, path, accessKeyId, secretAccessKey, region = REGION, service = 's3', expiresSec, now = new Date(), signedHeaders = {}, extraQuery = {} }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;

  const headers = { host, ...Object.fromEntries(Object.entries(signedHeaders).map(([k, v]) => [k.toLowerCase(), String(v).trim()])) };
  const names = Object.keys(headers).sort();
  const signedHeaderNames = names.join(';');
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');

  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSec),
    'X-Amz-SignedHeaders': signedHeaderNames,
    ...extraQuery,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
    .join('&');

  const canonicalUri = encodePath(path);
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaderNames, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  const kDate = hmac('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** URL temporaire pour UN objet. method : GET (lecture), PUT (envoi, avec contentType imposé), HEAD, DELETE. */
function signedUrl(method, key, { expiresSec = 600, contentType = null, contentLength = null, now, downloadName = null } = {}) {
  const c = config();
  if (!c) throw new Error('R2 non configuré');
  return presign({
    method,
    host: c.host,
    path: `/${c.bucket}/${key}`,
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    expiresSec,
    now,
    // Nom de fichier : le stockage répond « attachment » (téléchargement) au lieu de lire la vidéo
    extraQuery: downloadName ? { 'response-content-disposition': `attachment; filename="${String(downloadName).replace(/[^A-Za-z0-9._-]/g, '_')}"` } : {},
    signedHeaders: { ...(contentType ? { 'content-type': contentType } : {}), ...(contentLength ? { 'content-length': contentLength } : {}) },
  });
}

async function call(method, key) {
  const res = await fetch(signedUrl(method, key, { expiresSec: 60 }), { method, signal: AbortSignal.timeout(15000) });
  return res;
}

/** Infos sur un fichier : { exists, size, contentType }. Lève une erreur si R2 est injoignable. */
async function head(key) {
  const res = await call('HEAD', key);
  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error(`R2 HEAD ${res.status}`);
  return { exists: true, size: Number(res.headers.get('content-length') || 0), contentType: String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() };
}

/** Supprime un fichier. Un fichier déjà absent compte comme supprimé. Lève une erreur sinon. */
async function remove(key) {
  const res = await call('DELETE', key);
  if (res.status === 404 || res.ok) return true;
  throw new Error(`R2 DELETE ${res.status}`);
}

module.exports = { isConfigured, signedUrl, head, remove, presign };
