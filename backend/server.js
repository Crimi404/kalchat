require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const storiesRoutes = require('./routes/stories');
const postsRoutes = require('./routes/posts');
const communitiesRoutes = require('./routes/communities');
const notificationsRoutes = require('./routes/notifications');
const usersRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const reportsRoutes = require('./routes/reports');
const emailRoutes = require('./routes/email');
const { startEmailPrompts } = require('./emailPrompt');
const { setupShorts } = require('./shorts');
const pushRoutes = require('./routes/push');
const activityRoutes = require('./routes/activity');
const announcementsRoutes = require('./routes/announcements');
const linkPreviewRoutes = require('./routes/linkPreview');
const gifsRoutes = require('./routes/gifs');
const stickersRoutes = require('./routes/stickers');
const ogPages = require('./ogPages');
const db = require('./db');
const storage = require('./storage');
const { registerUpload } = require('./uploadGuard');
const { cleanupOldMedia, cleanupExpiredMessages } = require('./cleanup');
const { cleanupExpiredStories, sweepOrphanFiles, processDeleteQueue } = require('./mediaCleanup');
const ai = require('./ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.set('io', io);
// Render place un relais devant le serveur : on fait confiance à ce nombre de relais pour lire la vraie IP (req.ip).
// Si les limites par IP bloquent tout le monde d'un coup, essayer TRUST_PROXY_HOPS=2 dans Render > Environment.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ---------- Upload de médias (photos, vidéos, avatars) — stockés sur Supabase Storage ----------
// Protégé : membres connectés (25 Mo, quotas) ou visiteur à l'inscription (photo seulement, 3 Mo, très limité). Voir uploadGuard.js
registerUpload(app, storage);

// ---------- Fil public (visiteurs non connectés) : lecture seule, sans personnalisation ----------
// Un faux identifiant est utilisé : aucun like, favori, abonnement ni blocage ne lui correspond.
const guestHits = new Map();
app.get('/api/public/feed', (req, res, next) => {
  const ip = String(req.ip || 'unknown');
  const now = Date.now();
  const recent = (guestHits.get(ip) || []).filter((t) => now - t < 60 * 1000);
  if (recent.length >= 40) return res.status(429).json({ error: 'Trop de requêtes, réessaie dans une minute' });
  recent.push(now);
  guestHits.set(ip, recent);
  if (guestHits.size > 5000) guestHits.clear();
  req.user = { id: '__guest__' };
  postsRoutes.listPosts(req, res).catch(next);
});

// ---------- Routes API ----------
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/stories', storiesRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/communities', communitiesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/announcements', announcementsRoutes);
app.use('/api/link-preview', linkPreviewRoutes);
app.use('/api/gifs', gifsRoutes);
app.use('/api/stickers', stickersRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ---------- Frontend React (construit dans frontend/dist) servi par le même serveur ----------
const FRONT_DIST = path.join(__dirname, '..', 'frontend', 'dist');

// ---------- Téléchargement de l'APK Android (publié par le workflow « Build APK Android ») ----------
// Un fichier absent donne une vraie 404 (et non la page d'accueil), pour que le site sache s'il peut proposer le bouton.
app.use('/downloads', express.static(path.join(FRONT_DIST, 'downloads'), {
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="Kalchat.apk"');
    }
    res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use('/downloads', (req, res) => res.status(404).json({ error: 'Fichier introuvable' }));

// ---------- Liens « kalchat.site » qui ouvrent l'appli Android (Android App Links) ----------
// Android vérifie ce fichier pour confirmer que l'APK signée avec cette clé a le droit d'ouvrir les liens du site.
// L'empreinte SHA-256 du certificat se met dans la variable ANDROID_CERT_SHA256 (Render > Environment ; plusieurs valeurs séparées par des virgules).
app.get('/.well-known/assetlinks.json', (req, res) => {
  const fingerprints = String(process.env.ANDROID_CERT_SHA256 || '')
    .split(',')
    .map((v) => v.replace(/[^0-9a-f]/gi, '').toUpperCase())
    .filter((v) => v.length === 64)
    .map((v) => v.match(/.{2}/g).join(':'));
  const body = fingerprints.length
    ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.kalchat.app', sha256_cert_fingerprints: fingerprints } }]
    : [];
  res.set('Cache-Control', 'public, max-age=300').type('application/json').send(JSON.stringify(body));
});

// Aperçus des liens partagés (WhatsApp…) : balises Open Graph injectées AVANT le service des fichiers du site
app.use(ogPages(FRONT_DIST));
app.use(express.static(FRONT_DIST));
// Application monopage : toute adresse qui n'est pas /api ni /socket.io renvoie index.html
app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res, next) => {
  res.sendFile(path.join(FRONT_DIST, 'index.html'), (err) => {
    if (err) next();
  });
});

// ---------- Socket.io : chat en temps réel ----------
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Mêmes règles que pour l'API : compte bloqué ou ancienne session (mot de passe changé depuis) = refus
    const u = await db.prepare('SELECT is_blocked, password_changed_at FROM users WHERE id = ?').get(payload.id);
    if (!u || u.is_blocked) return next(new Error('Authentification WebSocket échouée'));
    if (u.password_changed_at && payload.iat && payload.iat < Math.floor(new Date(u.password_changed_at).getTime() / 1000)) {
      return next(new Error('Authentification WebSocket échouée'));
    }
    socket.user = payload;
    next();
  } catch {
    next(new Error('Authentification WebSocket échouée'));
  }
});

// Liste des membres actuellement connectés (au moins un socket ouvert), sans doublons
function onlineIds() {
  const ids = new Set();
  for (const s of io.sockets.sockets.values()) {
    if (s.user?.id) ids.add(s.user.id);
  }
  return [...ids];
}

// Chaque membre reçoit uniquement les « En ligne » que le réglage de confidentialité de l'autre l'autorise à voir :
// 'everyone' (tout le monde), 'friends' (abonnements acceptés) ou 'nobody' (personne).
async function broadcastPresence() {
  try {
    const ids = onlineIds();
    if (!ids.length) {
      io.emit('presence', []);
      return;
    }
    const settings = await db.prepare('SELECT id, privacy_online FROM users WHERE id = ANY(?)').all(ids);
    const mode = new Map(settings.map((s) => [s.id, s.privacy_online]));
    const links = await db
      .prepare("SELECT follower_id, followed_id FROM follows WHERE status = 'accepted' AND follower_id = ANY(?) AND followed_id = ANY(?)")
      .all(ids, ids);
    const friends = new Set();
    for (const l of links) {
      friends.add(`${l.follower_id}|${l.followed_id}`);
      friends.add(`${l.followed_id}|${l.follower_id}`);
    }
    for (const s of io.sockets.sockets.values()) {
      const viewer = s.user?.id;
      const visible = ids.filter((id) => {
        if (id === viewer) return true;
        const m = mode.get(id) || 'everyone';
        return m === 'everyone' || (m === 'friends' && friends.has(`${viewer}|${id}`));
      });
      s.emit('presence', visible);
    }
  } catch (err) {
    console.error('Erreur présence en ligne:', err.message);
  }
}
app.set('broadcastPresence', broadcastPresence);

io.on('connection', (socket) => {
  socket.join(`user:${socket.user.id}`);
  void broadcastPresence();
  socket.on('disconnect', () => void broadcastPresence());

  socket.on('join', async (conversationId) => {
    try {
      const ok = await db
        .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
        .get(conversationId, socket.user.id);
      if (ok) socket.join(conversationId);
    } catch (err) {
      console.error('Erreur join socket:', err.message);
    }
  });

  socket.on('leave', (conversationId) => {
    socket.leave(conversationId);
  });

  socket.on('typing', ({ conversation_id, is_typing } = {}) => {
    // Seulement dans une conversation dont on est membre (la salle n'est rejointe qu'après vérification, voir « join »)
    if (typeof conversation_id !== 'string' || !socket.rooms.has(conversation_id)) return;
    socket.to(conversation_id).emit('typing', {
      conversation_id,
      user_id: socket.user.id,
      username: socket.user.username,
      is_typing,
    });
  });
});

const PORT = process.env.PORT || 4000;

db.initSchema()
  .then(() => storage.initStorage())
  // Kora IA : une erreur ici ne doit jamais empêcher le site de démarrer
  .then(() => ai.init().catch((err) => console.error('Kora : initialisation impossible:', err.message)))
  .then(() => startEmailPrompts(io))
  .then(() => setupShorts(app).catch((err) => console.error('K-Short : initialisation impossible :', err.message)))
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Kalchat backend démarré sur http://localhost:${PORT}`);
    });
    // Nettoyage des vieux médias (vidéos > 60 jours, vocaux > 60 jours) : au démarrage, puis 1x/jour.
    // Ne fonctionne que tant que le service tourne (il se rendort après inactivité sur le
    // plan gratuit Render) — pas une garantie absolue de ponctualité, mais s'exécute dès
    // que le service se réveille.
    cleanupOldMedia().catch((err) => console.error('Erreur nettoyage médias:', err.message));
    setInterval(() => {
      cleanupOldMedia().catch((err) => console.error('Erreur nettoyage médias:', err.message));
    }, 24 * 60 * 60 * 1000);
    // Stories expirées : supprimées toutes les 10 minutes (avant, il fallait que quelqu'un ouvre l'appli)
    const purgeStories = () => cleanupExpiredStories().catch((err) => console.error('Erreur stories expirées:', err.message));
    purgeStories();
    setInterval(purgeStories, 10 * 60 * 1000);
    // Balayage du stockage : fichiers qui ne sont plus utilisés nulle part (anciennes suppressions, photos remplacées…)
    const sweepStorage = () => sweepOrphanFiles().catch((err) => console.error('Erreur balayage stockage:', err.message));
    setTimeout(sweepStorage, 2 * 60 * 1000);
    setInterval(sweepStorage, 24 * 60 * 60 * 1000);
    // File de suppressions à retenter : fichiers que le stockage n'a pas pu effacer du premier coup (toutes les 10 minutes)
    const retryDeletes = () => processDeleteQueue().catch((err) => console.error('Erreur file de suppression:', err.message));
    setTimeout(retryDeletes, 60 * 1000);
    setInterval(retryDeletes, 10 * 60 * 1000);
    // Messages éphémères : on supprime ceux dont la durée est écoulée, toutes les 5 minutes
    const purgeEphemeral = () => cleanupExpiredMessages(io).catch((err) => console.error('Erreur messages éphémères:', err.message));
    purgeEphemeral();
    setInterval(purgeEphemeral, 5 * 60 * 1000);
  })
  .catch((err) => {
    console.error('❌ Impossible d\'initialiser Postgres ou Supabase Storage. Vérifie DATABASE_URL / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.', err);
    process.exit(1);
  });
