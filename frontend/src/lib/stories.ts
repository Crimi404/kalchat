import { api, displayName, toBadges, type RawUser } from "@/lib/api";
import type { MiniProfile } from "@/lib/social";

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

export async function createStory(input: { content?: string; image_url?: string | undefined; media_type?: string | undefined; theme?: string | null; font?: string | null }) {
  await api("/stories", {
    method: "POST",
    body: { caption: input.content?.trim() || null, media_url: input.image_url ?? null, media_type: input.media_type ?? null, theme: input.theme ?? null, font: input.font ?? null },
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
}

export async function fetchStoryViewers(id: string): Promise<StoryViewer[]> {
  return api<StoryViewer[]>(`/stories/${id}/viewers`);
}
