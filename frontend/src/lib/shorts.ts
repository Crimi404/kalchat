import { api, ApiError } from "@/lib/api";
import { downloadMedia } from "@/lib/download";

// ---------- Types ----------
export interface ShortAuthor {
  id: string;
  username: string;
  avatar_url: string | null;
  badge?: string | null;
  role?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export type ShortFollow = "none" | "pending" | "accepted";

export interface ShortItem {
  id: string;
  caption: string | null;
  author: ShortAuthor | null;
  content_type: string;
  duration_seconds: number | null;
  in_feed: boolean;
  published_at: string;
  expires_at: string;
  like_count: number;
  comment_count: number;
  repost_count?: number;
  liked: boolean;
  reposted?: boolean;
  saved?: boolean;
  /** L'auteur autorise-t-il le téléchargement ? (activé par défaut) */
  allow_download?: boolean;
  /** Mon lien avec l'auteur : pas abonné, demande envoyée ou abonné. */
  follow_status?: ShortFollow;
  mine: boolean;
  /** Adresse temporaire de lecture (valable ~30 min). null si la vidéo n'est plus disponible. */
  video_url: string | null;
  video_url_ttl: number | null;
}

export interface ShortsStatus {
  enabled: boolean;
  max_days: number;
  default_days: number;
  max_seconds: number;
  max_mb: number;
  formats: string[];
}

export interface ShortComment {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  badge?: string | null;
  role?: string | null;
  parent_id: string | null;
  like_count: number;
  liked_by_me: boolean;
}

// ---------- Appels ----------
export function fetchShortsStatus(): Promise<ShortsStatus> {
  return api<ShortsStatus>("/shorts/status");
}

export function fetchShortsFeed(cursor?: string | null): Promise<{ items: ShortItem[]; next_cursor: string | null }> {
  return api(`/shorts/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
}

export async function fetchInFeedShorts(): Promise<ShortItem[]> {
  const r = await api<{ items: ShortItem[] }>("/shorts/in-feed");
  return r.items;
}

/** Recherche de vidéos par mot (légende, auteur) ou par #hashtag. */
export async function searchShorts(params: { q?: string; tag?: string }): Promise<ShortItem[]> {
  const qs = new URLSearchParams();
  if (params.tag) qs.set("tag", params.tag);
  else if (params.q) qs.set("q", params.q);
  const r = await api<{ items: ShortItem[] }>(`/shorts/search?${qs.toString()}`);
  return r.items;
}

/** Hashtags des légendes de vidéos (7 derniers jours). */
export async function fetchShortTrendingTags(): Promise<{ tag: string; count: number }[]> {
  const rows = await api<{ tag: string; count: number | string }[]>("/shorts/trending-tags");
  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) || 0 }));
}

/** Vidéos K-Short actives d'un membre (pour sa page de profil). */
export async function fetchUserShorts(userId: string): Promise<ShortItem[]> {
  const r = await api<{ items: ShortItem[] }>(`/shorts/user/${encodeURIComponent(userId)}`);
  return r.items;
}

export function fetchShort(id: string): Promise<ShortItem> {
  return api<ShortItem>(`/shorts/${id}`);
}

export function toggleShortLike(id: string): Promise<{ liked: boolean; like_count: number }> {
  return api(`/shorts/${id}/like`, { method: "POST" });
}

export async function fetchShortComments(id: string): Promise<ShortComment[]> {
  const r = await api<{ items: ShortComment[] }>(`/shorts/${id}/comments`);
  return r.items;
}

export function addShortComment(id: string, content: string, parentId?: string | null): Promise<{ id: string; comment_count: number }> {
  return api(`/shorts/${id}/comments`, { method: "POST", body: { content, parent_id: parentId ?? undefined } });
}

export function toggleShortCommentLike(commentId: string): Promise<{ liked: boolean; like_count: number }> {
  return api(`/shorts/comments/${commentId}/like`, { method: "POST" });
}

export function deleteShortComment(commentId: string): Promise<{ ok: boolean }> {
  return api(`/shorts/comments/${commentId}`, { method: "DELETE" });
}

export function toggleShortSave(id: string): Promise<{ saved: boolean }> {
  return api(`/shorts/${id}/save`, { method: "POST" });
}

export function toggleShortRepost(id: string): Promise<{ reposted: boolean; repost_count: number }> {
  return api(`/shorts/${id}/repost`, { method: "POST" });
}

/** « Ça ne m'intéresse pas » : la vidéo disparaît de mon flux. */
export function hideShort(id: string): Promise<{ ok: boolean }> {
  return api(`/shorts/${id}/hide`, { method: "POST" });
}

export function unhideShort(id: string): Promise<{ ok: boolean }> {
  return api(`/shorts/${id}/hide`, { method: "DELETE" });
}

/** L'auteur autorise ou interdit le téléchargement de sa vidéo. */
export function setShortDownload(id: string, allow: boolean): Promise<{ allow_download: boolean }> {
  return api(`/shorts/${id}/download`, { method: "PATCH", body: { allow } });
}

export async function fetchSavedShorts(): Promise<ShortItem[]> {
  const r = await api<{ items: ShortItem[] }>("/shorts/saved");
  return r.items;
}

/** Télécharge la vidéo (galerie du téléphone dans l'APK). Le serveur refuse si l'auteur a interdit le téléchargement. */
export async function downloadShort(id: string): Promise<void> {
  const r = await api<{ url: string }>(`/shorts/${id}/download-url`);
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) {
    await downloadMedia(r.url, "video");
    return;
  }
  // Navigateur : l'adresse force déjà l'enregistrement du fichier
  const a = document.createElement("a");
  a.href = r.url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function deleteShort(id: string): Promise<{ ok: boolean }> {
  return api(`/shorts/${id}`, { method: "DELETE" });
}

// ---------- Publication ----------
/** Durée d'une vidéo choisie sur le téléphone (en secondes), lue sans l'envoyer. */
export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(v.duration) ? v.duration : 0);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Impossible de lire cette vidéo"));
    };
    v.src = url;
  });
}

function putToStorage(url: string, headers: Record<string, string>, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("L'envoi de la vidéo a échoué, réessaie")));
    xhr.onerror = () => reject(new Error("Connexion perdue pendant l'envoi, réessaie"));
    xhr.ontimeout = () => reject(new Error("L'envoi a pris trop de temps, réessaie"));
    xhr.timeout = 10 * 60 * 1000;
    xhr.send(file);
  });
}

export interface PublishInput {
  file: File;
  caption: string;
  days: number;
  inFeed: boolean;
  duration: number | null;
  onProgress: (pct: number) => void;
}

/** 1) le serveur valide et donne une adresse d'envoi  2) la vidéo part directement vers le stockage  3) le serveur vérifie et publie. */
export async function publishShort(input: PublishInput): Promise<ShortItem> {
  const start = await api<{ id: string; upload_url: string; headers: Record<string, string> }>("/shorts/upload-url", {
    method: "POST",
    body: {
      content_type: input.file.type,
      size: input.file.size,
      duration: input.duration,
      days: input.days,
      caption: input.caption,
      in_feed: input.inFeed,
    },
  });
  await putToStorage(start.upload_url, start.headers, input.file, input.onProgress);
  try {
    return await api<ShortItem>(`/shorts/${start.id}/complete`, { method: "POST" });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new Error("Vidéo envoyée mais la publication a échoué, réessaie");
  }
}

// ---------- Affichage ----------
/** « 12 j », « 5 h » ou « moins d'1 h » : temps restant avant la disparition. */
export function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expirée";
  const hours = ms / 3_600_000;
  if (hours < 1) return "moins d'1 h";
  if (hours < 48) return `${Math.floor(hours)} h`;
  return `${Math.floor(hours / 24)} j`;
}
