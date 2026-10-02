import { api, displayName, toBadges } from "@/lib/api";
import type { MiniProfile } from "@/lib/social";

export type PresenceMode = "everyone" | "friends" | "nobody";

export const PRESENCE_LABELS: Record<PresenceMode, string> = {
  everyone: "Tout le monde",
  friends: "Mes amis",
  nobody: "Personne",
};

/** Durées possibles pour les messages éphémères (secondes). 0 = désactivé. */
export const EPHEMERAL_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Désactivés" },
  { value: 86400, label: "24 heures" },
  { value: 604800, label: "7 jours" },
  { value: 7776000, label: "90 jours" },
];

export function ephemeralLabel(seconds: number): string {
  return EPHEMERAL_OPTIONS.find((o) => o.value === seconds)?.label ?? "Désactivés";
}

export interface SettingsPatch {
  privacy_online?: PresenceMode;
  read_receipts?: boolean;
  default_ephemeral?: number;
}

export async function updateSettings(patch: SettingsPatch) {
  return api<{ privacy_online: PresenceMode; read_receipts: number; default_ephemeral: number }>("/users/me/settings", { method: "PATCH", body: patch });
}

export async function changePassword(currentPassword: string, newPassword: string) {
  await api("/users/me/password", { method: "POST", body: { current_password: currentPassword, new_password: newPassword } });
}

export async function deleteMyAccount(password: string) {
  await api("/users/me", { method: "DELETE", body: { password } });
}

interface RawBlocked {
  id: string;
  username: string;
  avatar_url: string | null;
  badge: string | null;
  role: string | null;
  first_name: string | null;
  last_name: string | null;
}

export async function fetchBlocked(): Promise<MiniProfile[]> {
  const rows = await api<RawBlocked[]>("/users/me/blocked");
  return rows.map((u) => ({ id: u.id, username: u.username, display_name: displayName(u), avatar_url: u.avatar_url, badges: toBadges(u.id, u.badge, u.role) }));
}

export async function blockUser(username: string) {
  await api(`/users/${encodeURIComponent(username)}/block`, { method: "POST" });
}

export async function unblockUser(username: string) {
  await api(`/users/${encodeURIComponent(username)}/block`, { method: "DELETE" });
}
