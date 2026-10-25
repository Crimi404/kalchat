import { api } from "@/lib/api";

export type GifKind = "gif" | "sticker";

export interface GifItem {
  id: string;
  title: string;
  /** Adresse enregistrée dans le message. */
  url: string;
  /** Petite version pour la grille du sélecteur. */
  preview: string;
  width: number | null;
  height: number | null;
}

export interface GifPage {
  configured: boolean;
  items: GifItem[];
  next: number | null;
}

export async function fetchGifs(kind: GifKind, q: string, page: number): Promise<GifPage> {
  const qs = new URLSearchParams({ type: kind, page: String(page) });
  if (q.trim()) qs.set("q", q.trim());
  return api<GifPage>(`/gifs?${qs}`);
}

/** Catégories rapides : libellé affiché → mot recherché. */
export const GIF_CATEGORIES: { label: string; q: string }[] = [
  { label: "Joie", q: "happy" },
  { label: "Amour", q: "love" },
  { label: "Rire", q: "lol" },
  { label: "Bravo", q: "applause" },
  { label: "Merci", q: "thank you" },
  { label: "Salut", q: "hello" },
  { label: "Triste", q: "sad" },
  { label: "Colère", q: "angry" },
  { label: "Fatigué", q: "tired" },
  { label: "Wow", q: "wow" },
  { label: "Danse", q: "dance" },
  { label: "Fête", q: "party" },
];

// ---------- Récents (gardés sur l'appareil) ----------
const RECENT_MAX = 30;
const recentKey = (kind: GifKind) => `kalchat_recent_${kind}_v1`;

function isItem(x: unknown): x is GifItem {
  const o = x as GifItem;
  return !!o && typeof o.id === "string" && typeof o.url === "string" && typeof o.preview === "string";
}

export function getRecents(kind: GifKind): GifItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(recentKey(kind)) || "[]");
    return Array.isArray(raw) ? raw.filter(isItem).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function addRecent(kind: GifKind, item: GifItem) {
  try {
    const next = [item, ...getRecents(kind).filter((x) => x.id !== item.id)].slice(0, RECENT_MAX);
    localStorage.setItem(recentKey(kind), JSON.stringify(next));
  } catch {
    /* stockage indisponible : pas grave */
  }
}
