import { api, displayName, toBadges, type RawUser } from "@/lib/api";
import type { BadgeRow } from "@/components/KalBadge";

export interface AuthorRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  badges: BadgeRow[];
}

export interface FeedPost {
  id: string;
  content: string;
  image_url: string | null;
  media_type: string | null;
  created_at: string;
  author_id: string;
  author: AuthorRow | null;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  likedByMe: boolean;
  savedByMe: boolean;
  sharedFrom: string | null;
  category: string;
  /** Relation de l'auteur avec moi : « none », « pending » (demande envoyée) ou « accepted » (abonné). */
  followStatus: Relationship;
}

interface RawAuthor extends RawUser {
  avatar_url: string | null;
}

function toAuthor(id: string, u: RawAuthor): AuthorRow {
  return {
    id,
    username: u.username,
    display_name: displayName(u),
    avatar_url: u.avatar_url,
    badges: toBadges(id, u.badge, u.role),
  };
}

interface RawPost extends RawAuthor {
  id: string;
  user_id: string;
  content: string | null;
  media_url: string | null;
  media_type: string | null;
  created_at: string;
  like_count: number;
  liked_by_me: boolean;
  comment_count: number;
  share_count: number;
  bookmarked_by_me: boolean;
  shared_from_username: string | null;
  category?: string | null;
  follow_status?: string | null;
}

function shape(r: RawPost): FeedPost {
  return {
    id: r.id,
    content: r.content ?? "",
    image_url: r.media_url,
    media_type: r.media_type,
    created_at: r.created_at,
    author_id: r.user_id,
    author: toAuthor(r.user_id, r),
    likeCount: Number(r.like_count) || 0,
    commentCount: Number(r.comment_count) || 0,
    shareCount: Number(r.share_count) || 0,
    likedByMe: !!r.liked_by_me,
    savedByMe: !!r.bookmarked_by_me,
    sharedFrom: r.shared_from_username,
    category: r.category || "divers",
    followStatus: r.follow_status === "accepted" || r.follow_status === "pending" ? r.follow_status : "none",
  };
}

export async function fetchFeed(_uid?: string | null): Promise<FeedPost[]> {
  return (await api<RawPost[]>("/posts")).map(shape);
}

export async function fetchUserPosts(authorId: string, _uid?: string | null): Promise<FeedPost[]> {
  return (await api<RawPost[]>(`/posts?user_id=${encodeURIComponent(authorId)}`)).map(shape);
}

export async function fetchSavedPosts(): Promise<FeedPost[]> {
  return (await api<RawPost[]>("/posts/bookmarks")).map(shape);
}

export async function fetchPost(id: string): Promise<FeedPost> {
  return shape(await api<RawPost>(`/posts/${id}`));
}

export interface TrendingTag {
  tag: string;
  count: number;
}

export async function fetchTrendingHashtags(): Promise<TrendingTag[]> {
  const rows = await api<{ tag: string; count: number | string }[]>("/posts/hashtags/trending");
  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) || 0 }));
}

export async function fetchCategoryPosts(category: string): Promise<FeedPost[]> {
  return (await api<RawPost[]>(`/posts?category=${encodeURIComponent(category)}`)).map(shape);
}

export async function fetchHashtagPosts(tag: string): Promise<FeedPost[]> {
  return (await api<RawPost[]>(`/posts?hashtag=${encodeURIComponent(tag.replace(/^#/, ""))}`)).map(shape);
}

export async function createPost(input: { content: string; imageUrl?: string | null; mediaType?: string | null; category?: string }) {
  await api("/posts", {
    method: "POST",
    body: { content: input.content, media_url: input.imageUrl ?? null, media_type: input.mediaType ?? null, category: input.category ?? "divers" },
  });
}

export async function updatePost(postId: string, content: string) {
  await api(`/posts/${postId}`, { method: "PATCH", body: { content } });
}

export async function deletePost(postId: string) {
  await api(`/posts/${postId}`, { method: "DELETE" });
}

/** Le serveur inverse l'état (like / unlike) et envoie lui-même la notification. */
export async function toggleLike(postId: string): Promise<{ liked: boolean; like_count: number }> {
  return api(`/posts/${postId}/like`, { method: "POST" });
}

export async function toggleSave(postId: string): Promise<{ bookmarked: boolean }> {
  return api(`/posts/${postId}/bookmark`, { method: "POST" });
}

export async function repost(postId: string) {
  await api(`/posts/${postId}/share`, { method: "POST" });
}

export interface CommentRow {
  id: string;
  content: string;
  created_at: string;
  edited_at: string | null;
  parentId: string | null;
  likeCount: number;
  likedByMe: boolean;
  author_id: string;
  author: AuthorRow | null;
}

interface RawComment extends RawAuthor {
  id: string;
  content: string;
  created_at: string;
  edited_at: string | null;
  parent_id: string | null;
  like_count: number | string;
  liked_by_me: boolean;
  user_id: string;
}

function shapeComment(c: RawComment): CommentRow {
  return {
    id: c.id,
    content: c.content,
    created_at: c.created_at,
    edited_at: c.edited_at,
    parentId: c.parent_id,
    likeCount: Number(c.like_count) || 0,
    likedByMe: !!c.liked_by_me,
    author_id: c.user_id,
    author: toAuthor(c.user_id, c),
  };
}

export async function fetchComments(postId: string): Promise<CommentRow[]> {
  return (await api<RawComment[]>(`/posts/${postId}/comments`)).map(shapeComment);
}

export async function addComment(postId: string, content: string, parentId?: string | null): Promise<CommentRow> {
  return shapeComment(
    await api<RawComment>(`/posts/${postId}/comments`, { method: "POST", body: { content, parent_id: parentId ?? null } }),
  );
}

export async function toggleCommentLike(commentId: string): Promise<{ liked: boolean; like_count: number }> {
  return api(`/posts/comments/${commentId}/like`, { method: "POST" });
}

export async function updateComment(commentId: string, content: string) {
  await api(`/posts/comments/${commentId}`, { method: "PATCH", body: { content } });
}

export async function deleteComment(id: string) {
  await api(`/posts/comments/${id}`, { method: "DELETE" });
}

// ---------- Profils et abonnements ----------
export type Relationship = "me" | "none" | "pending" | "accepted";

export interface PublicProfile {
  id: string;
  username: string;
  display_name: string;
  first_name: string;
  last_name: string;
  bio: string;
  avatar_url: string | null;
  cover_url: string | null;
  location: string | null;
  created_at: string;
  is_suspended: boolean;
  badges: BadgeRow[];
  stats: { posts: number; followers: number; following: number };
  relationship: Relationship;
  canMessage: boolean;
  /** J'ai bloqué ce compte. */
  blockedByMe: boolean;
  /** Ce compte m'a bloqué. */
  blockedMe: boolean;
}

interface RawProfile extends RawAuthor {
  id: string;
  bio: string | null;
  cover_url: string | null;
  location: string | null;
  created_at: string;
  is_blocked: number | boolean;
  follower_count: number;
  following_count: number;
  post_count: number;
  relationship: Relationship;
  can_message: boolean;
  blocked_by_me?: boolean;
  blocked_me?: boolean;
}

export async function fetchProfileByUsername(username: string): Promise<PublicProfile | null> {
  try {
    const p = await api<RawProfile>(`/users/${encodeURIComponent(username)}`);
    return {
      id: p.id,
      username: p.username,
      display_name: displayName(p),
      first_name: p.first_name ?? "",
      last_name: p.last_name ?? "",
      bio: p.bio ?? "",
      avatar_url: p.avatar_url,
      cover_url: p.cover_url,
      location: p.location,
      created_at: p.created_at,
      is_suspended: !!p.is_blocked,
      badges: toBadges(p.id, p.badge, p.role),
      stats: { posts: p.post_count, followers: p.follower_count, following: p.following_count },
      relationship: p.relationship,
      canMessage: !!p.can_message,
      blockedByMe: !!p.blocked_by_me,
      blockedMe: !!p.blocked_me,
    };
  } catch (e) {
    if (e instanceof Error && /introuvable/i.test(e.message)) return null;
    throw e;
  }
}

/** S'abonner (demande à accepter), annuler la demande ou se désabonner selon l'état actuel. */
export async function toggleFollow(username: string, relationship: Relationship): Promise<Relationship> {
  const path = `/users/${encodeURIComponent(username)}/follow`;
  if (relationship === "none") {
    const res = await api<{ status: Relationship }>(path, { method: "POST" });
    return res.status;
  }
  await api(path, { method: "DELETE" });
  return "none";
}

export interface MiniProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  badges: BadgeRow[];
}

interface RawMini extends RawAuthor {
  id: string;
}

export function toMini(u: RawMini): MiniProfile {
  return { id: u.id, username: u.username, display_name: displayName(u), avatar_url: u.avatar_url, badges: toBadges(u.id, u.badge, u.role) };
}

export async function fetchFollowList(username: string, kind: "followers" | "following"): Promise<MiniProfile[]> {
  return (await api<RawMini[]>(`/users/${encodeURIComponent(username)}/${kind}`)).map(toMini);
}

export async function searchUsers(q: string): Promise<MiniProfile[]> {
  const term = q.trim();
  if (!term) return [];
  return (await api<RawMini[]>(`/auth/search?q=${encodeURIComponent(term)}`)).map(toMini);
}

export interface FollowRequest {
  userId: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  badges: BadgeRow[];
  created_at: string;
}

export async function fetchRequests(): Promise<FollowRequest[]> {
  const rows = await api<(RawAuthor & { follower_id: string; created_at: string })[]>("/users/me/requests");
  return rows.map((r) => ({
    userId: r.follower_id,
    username: r.username,
    display_name: displayName(r),
    avatar_url: r.avatar_url,
    badges: toBadges(r.follower_id, r.badge, r.role),
    created_at: r.created_at,
  }));
}

export async function respondRequest(followerId: string, accept: boolean) {
  await api(`/users/requests/${followerId}/respond`, { method: "POST", body: { accept } });
}

export interface ProfileUpdate {
  first_name?: string;
  last_name?: string;
  bio?: string;
  location?: string;
  avatar_url?: string;
  cover_url?: string;
}

export async function updateMyProfile(input: ProfileUpdate) {
  await api("/users/me", { method: "PATCH", body: input });
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} j`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
