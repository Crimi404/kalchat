import { api } from "@/lib/api";

export interface PostCategory {
  value: string;
  label: string;
  emoji: string;
}

/** Même liste que backend/categories.js. « divers » est la catégorie par défaut. */
export const CATEGORIES: PostCategory[] = [
  { value: "divers", label: "Divers", emoji: "🎲" },
  { value: "info", label: "Info", emoji: "📰" },
  { value: "economie", label: "Économie", emoji: "💰" },
  { value: "crypto", label: "Crypto", emoji: "🪙" },
  { value: "musique", label: "Musique", emoji: "🎵" },
  { value: "sport", label: "Sport", emoji: "⚽" },
  { value: "gaming", label: "Gaming", emoji: "🎮" },
  { value: "anime", label: "Anime & manga", emoji: "🎌" },
  { value: "tech", label: "Tech", emoji: "💻" },
  { value: "humour", label: "Humour", emoji: "😂" },
  { value: "education", label: "Éducation", emoji: "📚" },
  { value: "lifestyle", label: "Lifestyle", emoji: "✨" },
];

export const DEFAULT_CATEGORY = "divers";

export function categoryOf(value: string | null | undefined): PostCategory {
  return CATEGORIES.find((c) => c.value === value) ?? CATEGORIES[0];
}

export async function fetchMutedCategories(): Promise<string[]> {
  return api<string[]>("/posts/categories/muted");
}

/** « Ce sujet ne m'intéresse pas » : retire la catégorie du fil principal. */
export async function muteCategory(key: string) {
  await api(`/posts/categories/${encodeURIComponent(key)}/mute`, { method: "POST" });
}

export async function unmuteCategory(key: string) {
  await api(`/posts/categories/${encodeURIComponent(key)}/mute`, { method: "DELETE" });
}
