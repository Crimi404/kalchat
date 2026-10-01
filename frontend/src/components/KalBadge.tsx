export type BadgeType =
  | "plus"
  | "vip"
  | "vip_plus"
  | "legend"
  | "verified"
  | "official"
  | "creator"
  | "developer"
  | "community"
  | "ambassador"
  | "founder"
  | "custom"
  | "moderator";

export interface BadgeRow {
  id: string;
  type: BadgeType;
  label: string;
  description: string;
}

// Rang : plus haut = plus prestigieux
export const TIERS: { type: BadgeType; label: string; description: string; rank: number }[] = [
  { type: "plus", label: "Plus", description: "Membre Plus de Kalchat", rank: 1 },
  { type: "vip", label: "VIP", description: "Membre VIP de Kalchat", rank: 2 },
  { type: "vip_plus", label: "VIP+", description: "Membre VIP+ de Kalchat", rank: 3 },
  { type: "legend", label: "Legend", description: "Légende de Kalchat", rank: 4 },
];

const COLORS: Record<string, [string, string]> = {
  plus: ["#1D9BF0", "#1A8CD8"],
  vip: ["#F4212E", "#C8102E"],
  vip_plus: ["#8B5CF6", "#6D28D9"],
  legend: ["#F7D774", "#C99A2E"],
  verified: ["#1D9BF0", "#1A8CD8"],
  official: ["#829AAB", "#5B7083"],
  founder: ["#F7D774", "#C99A2E"],
  moderator: ["#22C55E", "#15803D"],
};

function rankOf(t: BadgeType) {
  return TIERS.find((x) => x.type === t)?.rank ?? 0;
}

// Pastille style "coche vérifiée" (rosette à 8 lobes + coche blanche)
export function KalBadge({ badge, size = 16 }: { badge: BadgeRow; size?: number }) {
  const [c1, c2] = COLORS[badge.type] ?? ["#A78BFA", "#7C3AED"];
  const gid = `kb-${badge.id}`;
  return (
    <span className="group/badge relative inline-flex shrink-0 items-center" role="img" aria-label={badge.label}>
      <svg viewBox="0 0 22 22" width={size} height={size}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={c1} />
            <stop offset="1" stopColor={c2} />
          </linearGradient>
        </defs>
        <path
          fill={`url(#${gid})`}
          d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816z"
        />
        <path fill="#fff" d="M9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" />
      </svg>
      <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 hidden w-44 -translate-x-1/2 rounded-xl border border-border bg-popover p-2 text-left text-[11px] leading-snug text-popover-foreground shadow-xl group-hover/badge:block">
        <span className="block font-semibold text-foreground">{badge.label}</span>
        {badge.description && <span className="block text-muted-foreground">{badge.description}</span>}
      </span>
    </span>
  );
}

// Affiche un seul badge : le rang le plus élevé (comme X), ou à défaut un badge spécial
export function BadgeList({ badges, size = 16 }: { badges: BadgeRow[]; size?: number }) {
  if (!badges?.length) return null;
  const tiers = badges.filter((b) => rankOf(b.type) > 0).sort((a, b) => rankOf(b.type) - rankOf(a.type));
  const others = badges.filter((b) => rankOf(b.type) === 0);
  const shown = tiers.length ? tiers.slice(0, 1) : others.slice(0, 1);
  return (
    <span className="inline-flex items-center gap-0.5">
      {shown.map((b) => (
        <KalBadge key={b.id} badge={b} size={size} />
      ))}
    </span>
  );
}
