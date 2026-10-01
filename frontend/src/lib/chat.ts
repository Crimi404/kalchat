import { api, displayName, getSocket, toBadges, type RawUser } from "@/lib/api";
import type { MiniProfile } from "@/lib/social";

export type { MiniProfile };

export interface ConversationItem {
  id: string;
  last_message_at: string | null;
  other: MiniProfile | null;
  lastMessage: string | null;
  unread: number;
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
}

interface RawConversation extends RawUser {
  id: string;
  is_group: number;
  avatar_url: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread: number;
  other_user_id?: string;
}

interface RawMessage {
  id: string;
  sender_id: string;
  content: string | null;
  media_url: string | null;
  media_type: string | null;
  seen?: boolean;
  created_at: string;
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
  };
}

export async function fetchConversations(): Promise<ConversationItem[]> {
  const rows = await api<RawConversation[]>("/chat/conversations");
  return rows.map((c) => {
    const otherId = c.other_user_id ?? "";
    const other: MiniProfile | null = otherId
      ? { id: otherId, username: c.username, display_name: displayName(c), avatar_url: c.avatar_url, badges: toBadges(otherId, c.badge, c.role) }
      : null;
    return {
      id: c.id,
      last_message_at: c.last_message_at,
      other,
      lastMessage: c.last_message,
      unread: Number(c.unread) || 0,
    };
  });
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

export async function fetchConversation(id: string): Promise<{ id: string; other: MiniProfile } | null> {
  const list = await fetchConversations();
  const c = list.find((x) => x.id === id);
  return c?.other ? { id: c.id, other: c.other } : null;
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
