// Notifications push Android (Firebase Cloud Messaging, API HTTP v1) : aucune dépendance, juste crypto + fetch.
// Variable d'environnement (Render) :
//   FIREBASE_SERVICE_ACCOUNT  contenu du fichier JSON de la « clé de compte de service » Firebase
//                             (Paramètres du projet > Comptes de service > Générer une nouvelle clé privée).
//                             Sans elle, les notifications push sont simplement désactivées.
const crypto = require('crypto');
const db = require('./db');

let serviceAccount; // undefined = pas encore lu ; null = absent ou invalide
let configError = null;

// Remet la clé privée au format PEM attendu, même si le collage dans Render a abîmé les retours à la ligne
// (espaces à la place des sauts de ligne, « \n » littéraux, guillemets autour…).
function normalizePem(key) {
  const k = String(key).replace(/\\n/g, '\n').replace(/\r/g, '');
  const m = k.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m) return k;
  const body = m[2].replace(/[^A-Za-z0-9+/=]/g, '');
  return `-----BEGIN ${m[1]}-----\n${(body.match(/.{1,64}/g) || []).join('\n')}\n-----END ${m[1]}-----\n`;
}

function loadServiceAccount() {
  if (serviceAccount !== undefined) return serviceAccount;
  serviceAccount = null;
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) return null;
  try {
    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'); // JSON brut ou encodé en base64
    const sa = JSON.parse(json);
    if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('champs client_email, private_key ou project_id manquants');
    sa.private_key = normalizePem(sa.private_key);
    try {
      crypto.createPrivateKey(sa.private_key);
    } catch {
      throw new Error('la clé privée est illisible ou incomplète : recopie le contenu ENTIER du fichier JSON (ou encode-le en base64)');
    }
    serviceAccount = sa;
  } catch (err) {
    configError = `FIREBASE_SERVICE_ACCOUNT invalide : ${err.message}`;
    console.error(`⚠️ ${configError}. Notifications push désactivées.`);
  }
  return serviceAccount;
}

function isPushEnabled() {
  return !!loadServiceAccount();
}

const b64url = (input) => Buffer.from(input).toString('base64url');

let cachedAccessToken = null; // { value, expiresAt }
async function getAccessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60 * 1000) return cachedAccessToken.value;
  const sa = loadServiceAccount();
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 })
  )}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Authentification Google refusée (${res.status}) : ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  cachedAccessToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedAccessToken.value;
}

async function sendOne(token, { title, body, url, tag, type, priority }, accessToken) {
  const sa = loadServiceAccount();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data: { url: String(url || '/notifications'), type: String(type || 'generic') },
        android: {
          priority: priority === 'high' ? 'HIGH' : 'NORMAL',
          ttl: '86400s',
          notification: { icon: 'ic_stat_kalchat', color: '#7c4dff', ...(tag ? { tag } : {}) },
        },
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (res.ok) return true;
  const text = await res.text().catch(() => '');
  // Appareil désinstallé / jeton périmé : on l'oublie
  if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(text) || (res.status === 400 && /INVALID_ARGUMENT/i.test(text) && /token/i.test(text))) {
    await db.prepare('DELETE FROM push_tokens WHERE token = ?').run(token);
  } else {
    console.error(`Push refusé (${res.status}) : ${text.slice(0, 200)}`);
  }
  return false;
}

/** Envoie une notification push à tous les appareils d'un membre. Renvoie le nombre d'appareils atteints. */
async function sendPushToUser(userId, payload) {
  if (!isPushEnabled()) return 0;
  const tokens = await db.prepare('SELECT token FROM push_tokens WHERE user_id = ?').all(userId);
  if (!tokens.length) return 0;
  const accessToken = await getAccessToken();
  let sent = 0;
  for (const { token } of tokens) {
    if (await sendOne(token, payload, accessToken)) sent++;
  }
  return sent;
}

// ---------- Texte des notifications ----------
const cut = (text, max) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const ACTIONS = {
  like: 'a aimé ta publication',
  comment: 'a commenté ta publication',
  reply: 'a répondu à ton commentaire',
  comment_like: 'a aimé ton commentaire',
  share: 'a repartagé ta publication',
  follow_request: "t'a envoyé une demande d'abonnement",
  follow_accept: "a accepté ta demande d'abonnement",
  group_add: "t'a ajouté à un groupe",
  community_invite: "t'invite à rejoindre une communauté",
  community_request: 'veut rejoindre ta communauté',
  community_approved: 'a accepté ta demande pour rejoindre une communauté',
};

// ---------- Réglages : quels types de notifications push le membre veut recevoir ----------
// Catégories : messages, publications (likes, commentaires, mentions, repartages), abonnements.
// Les avertissements de la modération (type « moderation ») sont toujours envoyés.
const PUSH_CATEGORIES = ['messages', 'publications', 'abonnements'];
const PUSH_CATEGORY_OF = {
  message: 'messages',
  group_add: 'messages',
  like: 'publications',
  comment: 'publications',
  reply: 'publications',
  comment_like: 'publications',
  share: 'publications',
  mention: 'publications',
  follow_request: 'abonnements',
  follow_accept: 'abonnements',
  community_invite: 'abonnements',
  community_request: 'abonnements',
  community_approved: 'abonnements',
};

async function getPushPrefs(userId) {
  const row = await db.prepare('SELECT push_prefs FROM users WHERE id = ?').get(userId);
  let saved = {};
  try {
    saved = row?.push_prefs ? JSON.parse(row.push_prefs) : {};
  } catch {
    saved = {};
  }
  const prefs = {};
  for (const k of PUSH_CATEGORIES) prefs[k] = saved[k] !== false; // tout est activé par défaut
  return prefs;
}

async function savePushPrefs(userId, patch) {
  const prefs = await getPushPrefs(userId);
  for (const k of PUSH_CATEGORIES) if (typeof patch?.[k] === 'boolean') prefs[k] = patch[k];
  await db.prepare('UPDATE users SET push_prefs = ? WHERE id = ?').run(JSON.stringify(prefs), userId);
  return prefs;
}

/** Construit et envoie la notification push correspondant à une notification enregistrée (`full`, voir notify.js). */
async function pushForNotification(full, userId) {
  if (!isPushEnabled()) return;
  const has = await db.prepare('SELECT 1 FROM push_tokens WHERE user_id = ? LIMIT 1').get(userId);
  if (!has) return;

  // Le membre a-t-il désactivé ce type de notification ? (la modération passe toujours)
  const category = PUSH_CATEGORY_OF[full.type];
  if (category && !(await getPushPrefs(userId))[category]) return;

  const actor = await db.prepare('SELECT first_name, last_name, username FROM users WHERE id = ?').get(full.actor_id);
  const name = [actor?.first_name, actor?.last_name].filter(Boolean).join(' ') || actor?.username || 'Kalchat';

  let title = name;
  let body = ACTIONS[full.type] || 'a une nouvelle activité pour toi';
  let url = '/notifications';
  let tag = `n-${full.type}-${full.post_id || full.conversation_id || full.actor_id}`;
  let priority = 'normal';

  if (full.post_id) url = `/post/${full.post_id}`;
  if (full.type === 'follow_accept' && actor?.username) url = `/u/${actor.username}`;

  if (full.type === 'mention') {
    body = full.body === 'comment' ? "t'a mentionné dans un commentaire" : "t'a mentionné dans une publication";
  } else if (full.type.startsWith('community_')) {
    const label = full.community_name ? ` « ${cut(full.community_name, 40)} »` : '';
    if (full.community_id) url = `/communaute/${full.community_id}`;
    tag = `cm-${full.community_id}-${full.type}`;
    if (full.type === 'community_invite') body = `t'invite à rejoindre${label}`;
    else if (full.type === 'community_request') body = `veut rejoindre${label}`;
    else if (full.type === 'community_approved') body = `a accepté ta demande pour rejoindre${label}`;
  } else if (full.type === 'moderation') {
    title = 'Kalchat — Modération';
    body = cut(full.body, 140) || 'Tu as reçu un message de la modération';
    url = '/notifications';
    priority = 'high';
  } else if (full.type === 'message' || full.type === 'group_add') {
    url = full.conversation_id ? `/messages/${full.conversation_id}` : '/messages';
    tag = `c-${full.conversation_id}`;
    priority = 'high';
    if (full.type === 'message') {
      const conv = full.conversation_id
        ? await db.prepare('SELECT is_group, name, created_by, request_status FROM conversations WHERE id = ?').get(full.conversation_id)
        : null;
      const msg = full.message_id ? await db.prepare('SELECT content, media_type FROM messages WHERE id = ?').get(full.message_id) : null;
      const label = msg?.content
        ? cut(msg.content, 120)
        : { image: '📷 Photo', video: '🎬 Vidéo', audio: '🎤 Message vocal' }[msg?.media_type] || 'Nouveau message';
      if (conv?.request_status && conv.created_by === full.actor_id) {
        body = "t'a envoyé une demande de message"; // pas d'aperçu du contenu pour un inconnu
      } else if (conv?.is_group) {
        title = conv.name || 'Groupe';
        body = `${name} : ${label}`;
      } else {
        body = label;
      }
    }
  }

  await sendPushToUser(userId, { title, body, url, tag, type: full.type, priority });
}

function pushConfigError() {
  loadServiceAccount();
  return configError;
}

module.exports = { isPushEnabled, pushConfigError, sendPushToUser, pushForNotification, getPushPrefs, savePushPrefs };
