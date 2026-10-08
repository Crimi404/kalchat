const { Pool, types } = require('pg');

// Par défaut, node-postgres renvoie les BIGINT (type des résultats de COUNT(*)) sous forme
// de string pour éviter les pertes de précision. Comme tout le code ici a été écrit en
// supposant des nombres JS classiques (comme le faisait SQLite), on force la conversion.
types.setTypeParser(20, (val) => parseInt(val, 10)); // OID 20 = int8/bigint

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL manquant. Ajoute la chaîne de connexion Supabase dans les variables d\'environnement.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------- Compatibilité : conversion des `?` en `$1, $2, ...` (syntaxe Postgres) ----------
function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ---------- Petite couche de compatibilité façon better-sqlite3, mais asynchrone ----------
function prepare(sql) {
  const pgSql = toPgSql(sql);
  return {
    get: async (...params) => (await pool.query(pgSql, params)).rows[0],
    all: async (...params) => (await pool.query(pgSql, params)).rows,
    run: async (...params) => {
      const result = await pool.query(pgSql, params);
      return { changes: result.rowCount };
    },
  };
}

async function exec(sql) {
  await pool.query(sql);
}

// ---------- Schéma ----------
async function initSchema() {
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      status_text TEXT DEFAULT 'Salut, j''utilise Kalchat !',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      is_group INTEGER NOT NULL DEFAULT 0,
      name TEXT,
      avatar_url TEXT,
      created_by TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_admin INTEGER NOT NULL DEFAULT 0,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT,
      media_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS message_reads (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_url TEXT NOT NULL,
      caption TEXT,
      shared_from_id TEXT REFERENCES stories(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS story_views (
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      viewer_id TEXT NOT NULL,
      viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (story_id, viewer_id)
    );

    CREATE TABLE IF NOT EXISTS story_likes (
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (story_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS story_comments (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT,
      media_url TEXT,
      shared_from_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS post_likes (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS post_bookmarks (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      post_id TEXT,
      conversation_id TEXT,
      message_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);

    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      followed_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      responded_at TIMESTAMPTZ,
      PRIMARY KEY (follower_id, followed_id)
    );

    CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_id, status);

    CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (blocker_id, blocked_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);
  `);

  // ---------- Migrations légères (colonnes ajoutées après la première version) ----------
  // Postgres supporte IF NOT EXISTS nativement sur ADD COLUMN, beaucoup plus simple qu'avec SQLite.
  await exec(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS badge TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_url TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS tags TEXT;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type TEXT;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_type TEXT;
    ALTER TABLE stories ADD COLUMN IF NOT EXISTS media_type TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'dark';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;
    ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS is_favorite INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_duration INTEGER;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id TEXT;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ephemeral_seconds INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_online TEXT NOT NULL DEFAULT 'everyone';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS read_receipts INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS push_prefs TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS default_ephemeral INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS image_generations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_image_generations_user ON image_generations(user_id, created_at);
    ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES post_comments(id) ON DELETE CASCADE;
    ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS comment_likes (
      comment_id TEXT NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (comment_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_comments_post ON post_comments(post_id, created_at);
  `);

  // ---------- Masquage de publications et signalements ----------
  await exec(`
    CREATE TABLE IF NOT EXISTS post_hidden (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,            -- 'post' | 'comment' | 'message' | 'user'
      target_id TEXT NOT NULL,
      target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      details TEXT,
      snapshot TEXT,                        -- copie du contenu signalé (il peut être supprimé ensuite)
      status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'resolved' | 'dismissed'
      handled_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      handled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS category TEXT;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS theme TEXT;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS font TEXT;
    ALTER TABLE stories ADD COLUMN IF NOT EXISTS theme TEXT;
    ALTER TABLE stories ADD COLUMN IF NOT EXISTS font TEXT;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS invite_token TEXT;
    -- Demandes de message : NULL = discussion normale ; 'pending' = en attente de réponse ; 'declined' = refusée
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS request_status TEXT;

    -- Email : adresse vérifiée (n'est renseignée qu'une fois le code saisi), invitation envoyée par Kora, date du dernier changement de mot de passe
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_prompted_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email)) WHERE email IS NOT NULL;
    -- Codes à usage unique (inscription, vérification d'adresse, mot de passe oublié)
    CREATE TABLE IF NOT EXISTS email_otps (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      email TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      payload TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_email_otps_lookup ON email_otps(email, purpose, created_at);

    -- Appareils Android enregistrés pour les notifications push (jeton Firebase)
    CREATE TABLE IF NOT EXISTS push_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_invite_token ON conversations(invite_token) WHERE invite_token IS NOT NULL;
    CREATE TABLE IF NOT EXISTS muted_categories (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, category)
    );
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);

    -- Réglages de Kora IA (page Administration) et journal pour ses statistiques
    CREATE TABLE IF NOT EXISTS kora_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS kora_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      user_id TEXT,
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_kora_events_created ON kora_events(created_at);
    -- Retours des membres sur les réponses de Kora (1 = utile, -1 = pas utile)
    CREATE TABLE IF NOT EXISTS kora_feedback (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating SMALLINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id)
    );
  `);

  // ---------- Badges à rangs : plus (bleu) < vip (rouge) < vip_plus (violet) < legend (doré) ----------
  // Conversion des anciens badges (gold / diamond / blue) vers les nouveaux rangs. Idempotent.
  await exec(`
    UPDATE users SET badge = 'legend' WHERE badge = 'gold';
    UPDATE users SET badge = 'vip_plus' WHERE badge = 'diamond';
    UPDATE users SET badge = 'plus' WHERE badge = 'blue';
  `);

  console.log('✅ Schéma Postgres (Supabase) prêt.');
}

module.exports = { prepare, exec, pool, initSchema };
