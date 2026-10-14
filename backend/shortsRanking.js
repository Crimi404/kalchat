// Classement du flux K-Short « Pour vous » — fonctions pures (aucun accès à la base), faciles à tester.
//
// Chaque vidéo reçoit deux notes :
//  - « personal » : selon les goûts du membre (catégories et auteurs qu'il regarde/aime), les abonnements, la fraîcheur ;
//  - « pop »      : popularité (j'aime, commentaires, republications, vues) pondérée par la fraîcheur.
// Une page est ensuite composée avec un mélange fixe : surtout des goûts, un peu de populaire, un peu de hasard.

const HALF_LIFE_HOURS = 72; // une vidéo perd la moitié de son bonus de fraîcheur tous les 3 jours

/** Intérêt normalisé entre -1 et 1 à partir d'un poids cumulé (3 j'aime ≈ 0,76 ; 6 ≈ 0,96). */
function interest(weight) {
  return Math.tanh((weight || 0) / 6);
}

function engagement(row) {
  return Number(row.like_count || 0) * 2 + Number(row.comment_count || 0) * 2.5 + Number(row.repost_count || 0) * 3;
}

/**
 * @param row   ligne renvoyée par SELECT_SHORT (+ category, follow_status, like_count…)
 * @param ctx   { userId, catWeights: Map, authorWeights: Map, completed: Set, random: () => number }
 * @param now   Date.now()
 */
function scoreCandidate(row, ctx, now) {
  const ageHours = Math.max(0, (now - new Date(row.published_at).getTime()) / 3_600_000);
  const fresh = Math.pow(0.5, ageHours / HALF_LIFE_HOURS);
  const eng = engagement(row);
  const views = Number(row.view_count || 0);

  const pop = Math.log1p(eng + views * 0.1) * (0.4 + 0.6 * fresh);

  let personal =
    1.2 * interest(ctx.catWeights.get(row.category || 'divers')) +
    1.0 * interest(ctx.authorWeights.get(row.user_id)) +
    0.7 * (row.follow_status === 'accepted' ? 1 : 0) +
    0.8 * fresh +
    0.25 * (Math.log1p(eng) / 3);

  // Déjà regardée jusqu'au bout : on la repousse ; sa propre vidéo aussi (elle reste possible, mais rarement en tête)
  if (ctx.completed.has(row.id)) personal -= 1.0;
  if (row.user_id === ctx.userId) personal -= 0.6;
  // Petit bruit pour que deux vidéos de même note ne sortent pas toujours dans le même ordre
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
 * Compose une page à partir de candidats déjà notés ({ ...row, personal, pop }).
 * pattern : tableau de 'P' | 'POP' | 'R'. Retourne au plus pattern.length vidéos, sans doublon.
 */
function composePage(candidates, pattern, random = Math.random) {
  const byPersonal = [...candidates].sort((a, b) => b.personal - a.personal);
  const byPop = [...candidates].sort((a, b) => b.pop - a.pop);
  const byRandom = shuffle(candidates, random);
  const used = new Set();
  const take = (list) => {
    for (const c of list) {
      if (!used.has(c.id)) {
        used.add(c.id);
        return c;
      }
    }
    return null;
  };
  const page = [];
  for (const slot of pattern) {
    const list = slot === 'P' ? byPersonal : slot === 'POP' ? byPop : byRandom;
    const c = take(list);
    if (c) page.push(c);
  }
  return page;
}

module.exports = { scoreCandidate, composePage, interest, engagement, HALF_LIFE_HOURS };
