const multer = require('multer');
const authMiddleware = require('./middleware/auth');

// ---------- Réglages (modifiables par variables d'environnement Render, valeurs par défaut sûres) ----------
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 25; // membres connectés
const MAX_AUDIO_MB = 3; // un vocal dure 2 minutes maximum
const GUEST_MAX_MB = 3; // visiteur non connecté (photo de profil à l'inscription uniquement)
const USER_UPLOADS_PER_10MIN = Number(process.env.UPLOAD_USER_PER_10MIN) || 60;
const GUEST_UPLOADS_PER_10MIN_PER_IP = Number(process.env.UPLOAD_GUEST_PER_10MIN) || 5;
const GUEST_UPLOADS_PER_HOUR_GLOBAL = Number(process.env.UPLOAD_GUEST_PER_HOUR_GLOBAL) || 60;
// Les fichiers passent par la mémoire du serveur : on limite le nombre d'envois simultanés (plan Render gratuit)
const MAX_CONCURRENT_UPLOADS = Number(process.env.UPLOAD_MAX_CONCURRENT) || 4;

// ---------- Types acceptés (liste blanche) et extension imposée par le serveur ----------
// L'extension vient du type vérifié, jamais du nom de fichier envoyé par le client. Le SVG est refusé (il peut contenir du script).
const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/3gpp': '.3gp',
  'video/x-m4v': '.m4v',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/3gpp': '.3gp',
};
const GUEST_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function normalizeMime(mimetype) {
  return String(mimetype || '').split(';')[0].trim().toLowerCase();
}

/** Vérifie que le contenu correspond vraiment à une image JPEG / PNG / GIF / WebP (signature du fichier). */
function looksLikeImage(buf) {
  if (!buf || buf.length < 12) return false;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const gif = buf.toString('latin1', 0, 4) === 'GIF8';
  const webp = buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
  return jpeg || png || gif || webp;
}

// ---------- Limiteur simple en mémoire (fenêtre glissante) ----------
const hits = new Map();
function tooMany(key, limit, windowMs) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10000) {
    for (const [k, list] of hits) if (!list.some((t) => now - t < 60 * 60 * 1000)) hits.delete(k);
    if (hits.size > 10000) hits.clear();
  }
  return false;
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown'); // voir « trust proxy » dans server.js
}

/** Essaie d'authentifier la requête avec le middleware habituel, sans répondre à la place de l'appelant. */
function tryAuth(req) {
  return new Promise((resolve) => {
    const fakeRes = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ ok: false, code: this.statusCode, body });
        return this;
      },
    };
    Promise.resolve(authMiddleware(req, fakeRes, () => resolve({ ok: true }))).catch(() => resolve({ ok: false, code: 401, body: null }));
  });
}

let activeUploads = 0;

/** Étape 1 : qui envoie ? (avant de lire le moindre octet du fichier). */
async function uploadGuard(req, res, next) {
  const presentedToken = !!req.headers.authorization;
  let user = false;

  if (presentedToken) {
    const auth = await tryAuth(req);
    if (auth.ok) {
      user = true;
    } else if (auth.code === 403) {
      return res.status(403).json(auth.body || { error: 'Ce compte a été bloqué par un administrateur' });
    }
    // 401 : session expirée -> traité comme visiteur (l'inscription garde ainsi sa photo de profil)
  }

  if (user) {
    if (tooMany(`user:${req.user.id}`, USER_UPLOADS_PER_10MIN, 10 * 60 * 1000)) {
      return res.status(429).json({ error: 'Trop d\'envois en peu de temps, réessaie dans quelques minutes' });
    }
    req.uploadMode = 'user';
  } else {
    if (tooMany(`guest-ip:${clientIp(req)}`, GUEST_UPLOADS_PER_10MIN_PER_IP, 10 * 60 * 1000) || tooMany('guest-global', GUEST_UPLOADS_PER_HOUR_GLOBAL, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'Trop d\'envois, réessaie plus tard' });
    }
    req.uploadMode = 'guest';
    req.sessionExpired = presentedToken;
  }

  if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
    return res.status(503).json({ error: 'Le serveur est occupé, réessaie dans quelques secondes' });
  }
  activeUploads++;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      activeUploads--;
    }
  };
  res.on('close', release);
  res.on('finish', release);
  next();
}

function fileFilter(req, file, cb) {
  const mime = normalizeMime(file.mimetype);
  const allowed = req.uploadMode === 'guest' ? GUEST_MIMES.has(mime) : !!MIME_EXT[mime];
  if (!allowed) {
    const err = new Error('BAD_TYPE');
    err.code = 'BAD_TYPE';
    return cb(err);
  }
  cb(null, true);
}

const userUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5 }, fileFilter });
const guestUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: GUEST_MAX_MB * 1024 * 1024, files: 1, fields: 5 }, fileFilter });

/** Étape 2 : lecture du fichier avec la limite de taille qui correspond au profil. */
function parseFile(req, res, next) {
  const limitMb = req.uploadMode === 'guest' ? GUEST_MAX_MB : MAX_UPLOAD_MB;
  const parser = req.uploadMode === 'guest' ? guestUpload : userUpload;
  parser.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Fichier trop volumineux (max ${limitMb} Mo)` });
    if (err.code === 'BAD_TYPE') {
      const msg = req.uploadMode === 'guest' ? 'Connecte-toi pour envoyer ce type de fichier (seules les photos JPG, PNG, WebP ou GIF sont acceptées ici)' : 'Type de fichier non accepté (photos, vidéos et messages vocaux uniquement)';
      return res.status(415).json({ error: req.sessionExpired ? 'Session expirée, reconnecte-toi' : msg });
    }
    console.error('Erreur upload (multer):', err.message);
    return res.status(400).json({ error: 'Fichier invalide ou upload échoué' });
  });
}

/** Branche POST /api/upload sur l'application Express. */
function registerUpload(app, storage) {
  app.post('/api/upload', uploadGuard, parseFile, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
    const mime = normalizeMime(req.file.mimetype);

    if (req.uploadMode === 'guest' && !looksLikeImage(req.file.buffer)) {
      return res.status(415).json({ error: 'Ce fichier n\'est pas une image valide' });
    }
    // Un message vocal dure 2 minutes maximum : au-delà de 3 Mo, ce n'est pas un vocal valide
    if (mime.startsWith('audio/') && req.file.size > MAX_AUDIO_MB * 1024 * 1024) {
      return res.status(413).json({ error: `Message vocal trop volumineux (max ${MAX_AUDIO_MB} Mo, 2 minutes)` });
    }
    try {
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${MIME_EXT[mime]}`;
      const url = await storage.uploadFile(filename, req.file.buffer, mime);
      res.json({ url, type: storage.mediaTypeFromMimetype(mime) });
    } catch (err) {
      console.error('Erreur upload Supabase Storage:', err.message, err);
      res.status(500).json({ error: `Échec de l'upload : ${err.message || 'erreur inconnue'}` });
    }
  });
}

module.exports = { registerUpload, looksLikeImage, normalizeMime, MIME_EXT, MAX_UPLOAD_MB };
