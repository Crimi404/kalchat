import { api, displayName, getSocket, toBadges, type RawUser } from "@/lib/api";
import type { MiniProfile } from "@/lib/social";

export type { MiniProfile };

export interface ConversationItem {
  id: string;
  isGroup: boolean;
  /** Nom affiché : nom du groupe, ou nom de l'autre personne pour une discussion privée. */
  name: string;
  avatar_url: string | null;
  last_message_at: string | null;
  other: MiniProfile | null;
  lastMessage: string | null;
  lastMediaType: string | null;
  lastSenderId: string | null;
  lastSenderName: string | null;
  unread: number;
  isFavorite: boolean;
  memberCount: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  media_url: string | null;
  media_type: string | null;
  seen: boolean;
  created_at: string;
  sender_name: string;
  sender_avatar: string | null;
}

interface RawConversation extends RawUser {
  id: string;
  is_group: number;
  avatar_url: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread: number;
  other_user_id?: string;
  name: string | null;
  is_favorite: number | boolean;
  member_count: number;
  last_media_type: string | null;
  last_sender_id: string | null;
  last_sender_name: string | null;
}

interface RawMessage {
  id: string;
  sender_id: string;
  content: string | null;
  media_url: string | null;
  media_type: string | null;
  seen?: boolean;
  created_at: string;
  sender_username?: string;
  sender_first_name?: string | null;
  sender_last_name?: string | null;
  sender_avatar_url?: string | null;
}

function shapeMessage(conversationId: string, m: RawMessage): MessageRow {
  return {
    id: m.id,
    conversation_id: conversationId,
    sender_id: m.sender_id,
    body: m.content ?? "",
    media_url: m.media_url,
    media_type: m.media_type,
    seen: !!m.seen,
    created_at: m.created_at,
    sender_name: displayName({ username: m.sender_username ?? "", first_name: m.sender_first_name, last_name: m.sender_last_name }),
    sender_avatar: m.sender_avatar_url ?? null,
  };
}

export async function fetchConversations(): Promise<ConversationItem[]> {
  const rows = await api<RawConversation[]>("/chat/conversations");
  return rows.map((c) => {
    const isGroup = !!Number(c.is_group);
    const otherId = c.other_user_id ?? "";
    const other: MiniProfile | null = !isGroup && otherId
      ? { id: otherId, username: c.username, display_name: displayName(c), avatar_url: c.avatar_url, badges: toBadges(otherId, c.badge, c.role) }
      : null;
    return {
      id: c.id,
      isGroup,
      name: isGroup ? (c.name ?? "Groupe") : (other?.display_name ?? c.name ?? ""),
      avatar_url: c.avatar_url,
      last_message_at: c.last_message_at,
      other,
      lastMessage: c.last_message,
      lastMediaType: c.last_media_type,
      lastSenderId: c.last_sender_id,
      lastSenderName: c.last_sender_name,
      unread: Number(c.unread) || 0,
      isFavorite: !!Number(c.is_favorite),
      memberCount: Number(c.member_count) || 0,
    };
  });
}

/** Texte d'aperçu d'une conversation dans la liste (« Toi : … », « Awa : … », « 📷 Photo »…). */
export function previewText(c: ConversationItem, myId?: string | null): string {
  if (c.lastMessage === null && !c.lastMediaType) return "Nouvelle conversation";
  if (c.lastMediaType === "system") return c.lastMessage ?? "";
  let body = (c.lastMessage ?? "").trim();
  if (!body) {
    body = c.lastMediaType === "video" ? "🎥 Vidéo" : c.lastMediaType === "audio" ? "🎤 Message vocal" : "📷 Photo";
  }
  if (c.isGroup && c.lastSenderId) {
    return `${c.lastSenderId === myId ? "Toi" : (c.lastSenderName ?? "")} : ${body}`;
  }
  return body;
}

export async function fetchUnreadTotal(): Promise<number> {
  const list = await fetchConversations();
  return list.reduce((n, c) => n + c.unread, 0);
}

/** Ouvre (ou crée) la conversation privée. Le serveur refuse si l'abonnement n'a pas été accepté. */
export async function getOrCreateConversation(otherId: string): Promise<string> {
  const res = await api<{ id: string }>("/chat/conversations", { method: "POST", body: { member_ids: [otherId] } });
  return res.id;
}

export interface GroupMember extends MiniProfile {
  isAdmin: boolean;
}

export interface ConversationDetail {
  id: string;
  isGroup: boolean;
  name: string;
  avatar_url: string | null;
  isFavorite: boolean;
  myIsAdmin: boolean;
  members: GroupMember[];
  /** Pour une discussion privée : l'autre personne. */
  other: MiniProfile | null;
}

interface RawDetail {
  id: string;
  is_group: number;
  name: string | null;
  avatar_url: string | null;
  is_favorite: number | boolean;
  my_is_admin: number | boolean;
  members: (RawUser & { id: string; avatar_url: string | null; is_admin: number | boolean })[];
}

export async function fetchConversationDetail(id: string, myId?: string | null): Promise<ConversationDetail> {
  const d = await api<RawDetail>(`/chat/conversations/${id}`);
  const members: GroupMember[] = d.members.map((m) => ({
    id: m.id,
    username: m.username,
    display_name: displayName(m),
    avatar_url: m.avatar_url,
    badges: toBadges(m.id, m.badge, m.role),
    isAdmin: !!Number(m.is_admin),
  }));
  const isGroup = !!Number(d.is_group);
  const other = isGroup ? null : (members.find((m) => m.id !== myId) ?? null);
  return {
    id: d.id,
    isGroup,
    name: isGroup ? (d.name ?? "Groupe") : (other?.display_name ?? ""),
    avatar_url: isGroup ? d.avatar_url : (other?.avatar_url ?? null),
    isFavorite: !!Number(d.is_favorite),
    myIsAdmin: !!Number(d.my_is_admin),
    members,
    other,
  };
}

/** Amis avec qui on peut discuter (abonnement accepté dans un sens ou dans l'autre). */
export async function fetchContacts(): Promise<MiniProfile[]> {
  const rows = await api<(RawUser & { id: string; avatar_url: string | null })[]>("/chat/contacts");
  return rows.map((u) => ({ id: u.id, username: u.username, display_name: displayName(u), avatar_url: u.avatar_url, badges: toBadges(u.id, u.badge, u.role) }));
}

export async function createGroup(input: { name: string; memberIds: string[]; avatarUrl?: string | null }): Promise<string> {
  const res = await api<{ id: string }>("/chat/conversations", {
    method: "POST",
    body: { is_group: true, name: input.name, member_ids: input.memberIds, avatar_url: input.avatarUrl ?? null },
  });
  return res.id;
}

export async function updateGroup(id: string, patch: { name?: string; avatar_url?: string }) {
  await api(`/chat/conversations/${id}`, { method: "PATCH", body: patch });
}

export async function addGroupMembers(id: string, userIds: string[]) {
  await api(`/chat/conversations/${id}/members`, { method: "POST", body: { user_ids: userIds } });
}

/** Retire un membre (administrateur) ou, avec son propre id, quitte le groupe. */
export async function removeGroupMember(id: string, userId: string) {
  await api(`/chat/conversations/${id}/members/${userId}`, { method: "DELETE" });
}

export async function toggleFavoriteConversation(id: string): Promise<{ favorite: boolean }> {
  return api(`/chat/conversations/${id}/favorite`, { method: "POST" });
}

export async function fetchMessages(conversationId: string): Promise<MessageRow[]> {
  const rows = await api<RawMessage[]>(`/chat/conversations/${conversationId}/messages`);
  return rows.map((m) => shapeMessage(conversationId, m));
}

export async function sendMessage(conversationId: string, body: string, media?: { url: string; type: string }) {
  const text = body.trim().slice(0, 2000);
  if (!text && !media) return;
  await api(`/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { content: text || null, media_url: media?.url ?? null, media_type: media?.type ?? null },
  });
}

export async function markRead(conversationId: string) {
  await api(`/chat/conversations/${conversationId}/read`, { method: "POST" });
}

export async function deleteMessage(id: string) {
  await api(`/chat/messages/${id}`, { method: "DELETE" });
}

/** Rejoint la « salle » Socket.io d'une conversation pour recevoir ses messages en direct. */
export function joinConversation(id: string): () => void {
  const socket = getSocket();
  socket?.emit("join", id);
  return () => {
    socket?.emit("leave", id);
  };
}
