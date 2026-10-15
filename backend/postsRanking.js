// Classement du fil « Pour vous » des publications — fonctions pures (aucun accès à la base), faciles à tester.
//
// Chaque publication reçoit :
//  - « personal » : selon les goûts du membre (catégories et auteurs avec lesquels il interagit), la fraîcheur et la popularité ;
//  - « pop »      : popularité (j'aime, commentaires, repartages) pondérée par la fraîcheur.
// Le fil est ensuite composé avec un mélange fixe (par blocs de 20) : 12 publications de comptes suivis, 5 recommandées, 3 de découverte.

const HALF_LIFE_HOURS = 48; // une publication perd la moitié de son bonus de fraîcheur tous les 2 jours
const OWN_BOOST_HOURS = 3; // ma propre publication toute fraîche reste en haut de MON fil
const STABLE_MINUTES = 30; // le hasard et les « déjà vues » ne changent qu'une fois toutes les 30 min : le fil ne bouge pas sous les doigts

// 12 comptes suivis (F), 5 recommandées (REC), 3 découverte (R) sur 20 places
const PATTERN = ['F', 'F', 'REC', 'F', 'F', 'R', 'F', 'F', 'REC', 'F', 'F', 'REC', 'F', 'F', 'R', 'F', 'REC', 'F', 'R', 'REC'];

/** Intérêt normalisé entre -1 et 1 à partir d'un poids cumulé (3 j'aime ≈ 0,76 ; 6 ≈ 0,96). */
function interest(weight) {
  return Math.tanh((weight || 0) / 6);
}

function engagement(row) {
  return Number(row.like_count || 0) * 2 + Number(row.comment_count || 0) * 2.5 + Number(row.share_count || 0) * 3;
}

/** Générateur pseudo-aléatoire reproductible (mulberry32) à partir d'un texte. */
function seededRandom(text) {
  let h = 1779033703 ^ String(text).length;
  for (let i = 0; i < String(text).length; i++) {
    h = Math.imul(h ^ String(text).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Début de la fenêtre de stabilité en cours (ms). */
function stableWindowStart(now) {
  const size = STABLE_MINUTES * 60_000;
  return Math.floor(now / size) * size;
}

/**
 * @param row  ligne de listPosts (user_id, category, created_at, like_count, comment_count, share_count, follow_status)
 * @param ctx  { userId, catWeights: Map, authorWeights: Map, seenBefore: Set, random: () => number }
 */
function scorePost(row, ctx, now) {
  const ageHours = Math.max(0, (now - new Date(row.created_at).getTime()) / 3_600_000);
  const fresh = Math.pow(0.5, ageHours / HALF_LIFE_HOURS);
  const eng = engagement(row);
  const seen = ctx.seenBefore.has(row.id);

  let pop = Math.log1p(eng) * (0.4 + 0.6 * fresh);
  let personal =
    1.2 * interest(ctx.catWeights.get(row.category || 'divers')) +
    1.0 * interest(ctx.authorWeights.get(row.user_id)) +
    0.9 * fresh +
    0.25 * (Math.log1p(eng) / 3);

  // Déjà vue lors d'une session précédente : on la repousse (elle reste dans le fil, plus bas)
  if (seen) {
    personal -= 1.2;
    pop -= 0.8;
  }
  // Ma publication toute fraîche : en haut de mon fil pour que je la voie tout de suite
  if (row.user_id === ctx.userId && ageHours < OWN_BOOST_HOURS) personal += 2.5;
  // Petit bruit (reproductible sur la fenêtre de stabilité) pour varier l'ordre à note presque égale
  personal += ctx.random() * 0.15;
  return { personal, pop };
}

function shuffle(list, random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Compose le fil à partir de publications déjà notées ({ ...row, personal, pop }).
 * Abonnés = comptes suivis (abonnement accepté) + mes propres publications.
 * Quand un bloc est épuisé (ex. je ne suis presque personne), les places passent aux autres blocs : rien n'est perdu.
 */
function composeFeed(candidates, ctx, limit = 100) {
  const isFollowed = (c) => c.user_id === ctx.userId || c.follow_status === 'accepted';
  const followed = candidates.filter(isFollowed).sort((a, b) => b.personal - a.personal);
  const others = candidates.filter((c) => !isFollowed(c));
  const rec = [...others].sort((a, b) => b.personal + 0.6 * b.pop - (a.personal + 0.6 * a.pop));
  const discovery = shuffle(others, ctx.random);

  const used = new Set();
  const take = (...lists) => {
    for (const list of lists) {
      for (const c of list) {
        if (!used.has(c.id)) {
          used.add(c.id);
          return c;
        }
      }
    }
    return null;
  };

  const out = [];
  const slots = Math.ceil(candidates.length / PATTERN.length) * PATTERN.length;
  for (let i = 0; i < slots && out.length < limit; i++) {
    const slot = PATTERN[i % PATTERN.length];
    const c = slot === 'F' ? take(followed, rec, discovery) : slot === 'REC' ? take(rec, followed) : take(discovery, rec, followed);
    if (c) out.push(c);
  }
  return out;
}

module.exports = { scorePost, composeFeed, seededRandom, stableWindowStart, interest, engagement, PATTERN, HALF_LIFE_HOURS, STABLE_MINUTES };
