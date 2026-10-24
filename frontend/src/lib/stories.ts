import { api, displayName, toBadges, type RawUser } from "@/lib/api";
import type { MiniProfile } from "@/lib/social";
import { getOrCreateConversation, sendMessage } from "@/lib/chat";

export interface StoryRow {
  id: string;
  author_id: string;
  content: string | null;
  image_url: string | null;
  media_type: string | null;
  theme: string | null;
  font: string | null;
  created_at: string;
  expires_at: string;
  seen: boolean;
  like_count: number;
  liked_by_me: boolean;
  /** Je peux repartager cette story (l'auteur l'autorise, ce n'est pas la mienne ni un repartage). */
  can_share: boolean;
  shared_from_username: string | null;
}

export interface StoryGroup {
  author: MiniProfile;
  stories: StoryRow[];
  allSeen: boolean;
}

interface RawStory {
  id: string;
  user_id: string;
  media_url: string;
  media_type: string | null;
  caption: string | null;
  theme?: string | null;
  font?: string | null;
  created_at: string;
  expires_at: string;
  viewed_by_me: boolean;
  like_count?: number | string | null;
  liked_by_me?: boolean | null;
  can_share?: boolean | null;
  shared_from_username?: string | null;
}

interface RawGroup extends RawUser {
  user_id: string;
  avatar_url: string | null;
  stories: RawStory[];
}

export async function fetchStoryGroups(uid: string): Promise<StoryGroup[]> {
  const groups = await api<RawGroup[]>("/stories/feed");
  const shaped = groups.map((g): StoryGroup => {
    // du plus ancien au plus récent à l'intérieur d'un même auteur
    const stories = [...g.stories]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((s): StoryRow => ({
        id: s.id,
        author_id: s.user_id,
        content: s.caption,
        image_url: s.media_url || null,
        media_type: s.media_type,
        theme: s.theme || null,
        font: s.font || null,
        created_at: s.created_at,
        expires_at: s.expires_at,
        seen: s.user_id === uid || !!s.viewed_by_me,
        like_count: Number(s.like_count) || 0,
        liked_by_me: !!s.liked_by_me,
        can_share: !!s.can_share,
        shared_from_username: s.shared_from_username ?? null,
      }));
    return {
      author: { id: g.user_id, username: g.username, display_name: displayName(g), avatar_url: g.avatar_url, badges: toBadges(g.user_id, g.badge, g.role) },
      stories,
      allSeen: stories.every((s) => s.seen),
    };
  });
  // Les miennes d'abord, puis les non vues, puis les vues
  return shaped.sort((a, b) => (a.author.id === uid ? -1 : b.author.id === uid ? 1 : 0) || Number(a.allSeen) - Number(b.allSeen));
}

export async function createStory(input: { content?: string; image_url?: string | undefined; media_type?: string | undefined; theme?: string | null; font?: string | null; duration_hours?: number; allow_share?: boolean }) {
  await api("/stories", {
    method: "POST",
    body: { caption: input.content?.trim() || null, media_url: input.image_url ?? null, media_type: input.media_type ?? null, theme: input.theme ?? null, font: input.font ?? null, duration_hours: input.duration_hours ?? 24, ...(input.allow_share === undefined ? {} : { allow_share: input.allow_share }) },
  });
}

export async function markStoryViewed(storyId: string) {
  await api(`/stories/${storyId}/view`, { method: "POST" }).catch(() => undefined);
}

export async function deleteStory(id: string) {
  await api(`/stories/${id}`, { method: "DELETE" });
}

export async function storyViewCount(id: string): Promise<number> {
  const viewers = await api<unknown[]>(`/stories/${id}/viewers`).catch(() => []);
  return viewers.length;
}

export interface StoryViewer {
  id: string;
  username: string;
  avatar_url: string | null;
  viewed_at: string;
  liked?: boolean;
}

export async function fetchStoryViewers(id: string): Promise<StoryViewer[]> {
  return api<StoryViewer[]>(`/stories/${id}/viewers`);
}

/** ♥ : aime / n'aime plus une story. */
export async function toggleStoryLike(id: string): Promise<{ liked: boolean; like_count: number }> {
  const r = await api<{ liked: boolean; like_count: number | string }>(`/stories/${id}/like`, { method: "POST" });
  return { liked: !!r.liked, like_count: Number(r.like_count) || 0 };
}

/** Repartage la story de quelqu'un dans ma propre story (refusé par le serveur si l'auteur ne l'autorise pas). */
export async function shareStory(id: string) {
  await api(`/stories/${id}/share`, { method: "POST", body: {} });
}

/** Mini-image (80×80) de la story pour la carte de réponse ; null si elle ne peut pas être lue (réseau, droits d'accès). */
async function makeStoryThumb(story: Pick<StoryRow, "image_url" | "media_type">): Promise<string | null> {
  const url = story.image_url;
  if (!url) return null;
  try {
    const isVideo = story.media_type === "video";
    const source = await new Promise<HTMLImageElement | HTMLVideoElement>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("délai dépassé")), 3500);
      const done = (el: HTMLImageElement | HTMLVideoElement) => { clearTimeout(timer); resolve(el); };
      const fail = () => { clearTimeout(timer); reject(new Error("lecture impossible")); };
      if (isVideo) {
        const v = document.createElement("video");
        v.crossOrigin = "anonymous";
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        v.onloadeddata = () => done(v);
        v.onerror = fail;
        v.src = url;
      } else {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => done(img);
        img.onerror = fail;
        img.src = url;
      }
    });
    const w = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const h = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (!w || !h) return null;
    const size = 80;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const k = Math.max(size / w, size / h);
    ctx.drawImage(source, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k);
    for (const q of [0.6, 0.4]) {
      const data = canvas.toDataURL("image/jpeg", q);
      if (data.length <= 7500) return data;
    }
    return null;
  } catch {
    return null; // la réponse part quand même, avec une carte sans image
  }
}

/** Répond à une story : le message part en privé à l'auteur, avec une carte qui rappelle la story (comme sur WhatsApp). */
export async function replyToStory(story: Pick<StoryRow, "id" | "author_id" | "image_url" | "media_type">, text: string) {
  const clean = text.trim().slice(0, 1500);
  if (!clean) return;
  const [convId, thumb] = await Promise.all([getOrCreateConversation(story.author_id), makeStoryThumb(story)]);
  await sendMessage(convId, clean, undefined, null, { id: story.id, thumb });
}
