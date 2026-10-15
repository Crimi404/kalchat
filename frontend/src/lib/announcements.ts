import { api } from "@/lib/api";

/** Annonce vue par les membres (bannière en haut du fil). */
export interface Announcement {
  id: string;
  title: string;
  body: string;
  created_at: string;
  expires_at: string;
}

/** Annonce vue par l'administrateur, avec son état et quelques chiffres. */
export interface AdminAnnouncement extends Announcement {
  deleted_at: string | null;
  status: "live" | "expired" | "removed";
  push_requested: boolean;
  /** Nombre de membres atteints par la notification push (0 tant qu'elle n'est pas partie). */
  push_sent: number;
  dismissed_count: number;
}

export const ANNOUNCEMENT_TITLE_MAX = 80;
export const ANNOUNCEMENT_BODY_MAX = 500;
export const ANNOUNCEMENT_DAYS = [1, 3, 7, 14, 30];

export function fetchAnnouncements(): Promise<Announcement[]> {
  return api<Announcement[]>("/announcements");
}

export function dismissAnnouncement(id: string): Promise<{ ok: boolean }> {
  return api(`/announcements/${id}/dismiss`, { method: "POST" });
}

export function fetchAdminAnnouncements(): Promise<AdminAnnouncement[]> {
  return api<AdminAnnouncement[]>("/admin/announcements");
}

export function createAnnouncement(input: { title: string; body: string; days: number; push: boolean }): Promise<{ id: string }> {
  return api("/admin/announcements", { method: "POST", body: input });
}

export function removeAnnouncement(id: string): Promise<{ ok: boolean }> {
  return api(`/admin/announcements/${id}`, { method: "DELETE" });
}
