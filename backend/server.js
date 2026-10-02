require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const storiesRoutes = require('./routes/stories');
const postsRoutes = require('./routes/posts');
const notificationsRoutes = require('./routes/notifications');
const usersRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const db = require('./db');
const storage = require('./storage');
const { cleanupOldMedia } = require('./cleanup');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.set('io', io);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ---------- Upload de médias (photos, vidéos, avatars) — stockés sur Supabase Storage ----------
const MAX_UPLOAD_MB = 25;
const MAX_AUDIO_MB = 3;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 } });

function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `Fichier trop volumineux (max ${MAX_UPLOAD_MB} Mo)` });
      }
      console.error('Erreur upload (multer):', err.message);
      return res.status(400).json({ error: 'Fichier invalide ou upload échoué' });
    }
    next();
  });
}

app.post('/api/upload', handleUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  // Un message vocal dure 2 minutes maximum : au-delà de 3 Mo, ce n'est pas un vocal valide
  if (req.file.mimetype.startsWith('audio/') && req.file.size > MAX_AUDIO_MB * 1024 * 1024) {
    return res.status(413).json({ error: `Message vocal trop volumineux (max ${MAX_AUDIO_MB} Mo, 2 minutes)` });
  }
  try {
    const ext = path.extname(req.file.originalname) || '';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const url = await storage.uploadFile(filename, req.file.buffer, req.file.mimetype);
    res.json({ url, type: storage.mediaTypeFromMimetype(req.file.mimetype) });
  } catch (err) {
    console.error('Erreur upload Supabase Storage:', err.message, err);
    res.status(500).json({ error: `Échec de l'upload : ${err.message || 'erreur inconnue'}` });
  }
});

// ---------- Routes API ----------
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/stories', storiesRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ---------- Frontend React (construit dans frontend/dist) servi par le même serveur ----------
const FRONT_DIST = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(FRONT_DIST));
// Application monopage : toute adresse qui n'est pas /api ni /socket.io renvoie index.html
app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res, next) => {
  res.sendFile(path.join(FRONT_DIST, 'index.html'), (err) => {
    if (err) next();
  });
});

// ---------- Socket.io : chat en temps réel ----------
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const payload = jwt.verify(token, process.env.JWT_SECRET);
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

io.on('connection', (socket) => {
  socket.join(`user:${socket.user.id}`);
  io.emit('presence', onlineIds());
  socket.on('disconnect', () => io.emit('presence', onlineIds()));

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

  socket.on('typing', ({ conversation_id, is_typing }) => {
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
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Kalchat backend démarré sur http://localhost:${PORT}`);
    });
    // Nettoyage des vieux médias (vidéos/vocaux > 90 jours) : au démarrage, puis 1x/jour.
    // Ne fonctionne que tant que le service tourne (il se rendort après inactivité sur le
    // plan gratuit Render) — pas une garantie absolue de ponctualité, mais s'exécute dès
    // que le service se réveille.
    cleanupOldMedia().catch((err) => console.error('Erreur nettoyage médias:', err.message));
    setInterval(() => {
      cleanupOldMedia().catch((err) => console.error('Erreur nettoyage médias:', err.message));
    }, 24 * 60 * 60 * 1000);
  })
  .catch((err) => {
    console.error('❌ Impossible d\'initialiser Postgres ou Supabase Storage. Vérifie DATABASE_URL / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.', err);
    process.exit(1);
  });
