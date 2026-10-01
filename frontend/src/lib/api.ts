import { io, type Socket } from "socket.io-client";
import { TIERS, type BadgeRow } from "@/components/KalBadge";

// ---------- Jeton de connexion (JWT émis par le backend Kalchat) ----------
const TOKEN_KEY = "kalchat_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* stockage indisponible : on continue sans */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Appel JSON vers l'API Kalchat (même origine : /api/...). Lève ApiError avec le message du serveur. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let body: string | undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }

  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(body !== undefined ? { body } : {}),
  });

  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    if (res.status === 401 && token) {
      setToken(null);
      window.dispatchEvent(new Event("kalchat:logout"));
    }
    throw new ApiError(data?.error ?? "Une erreur est survenue", res.status);
  }
  return data as T;
}

/** Envoie un fichier (photo, vidéo, audio) vers le stockage du backend. */
export async function uploadFile(file: File): Promise<{ url: string; type: string }> {
  const form = new FormData();
  form.append("file", file);
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch("/api/upload", { method: "POST", headers, body: form });
  const data = (await res.json().catch(() => null)) as { url?: string; type?: string; error?: string } | null;
  if (!res.ok || !data?.url) throw new ApiError(data?.error ?? "Échec de l'envoi du fichier", res.status);
  return { url: data.url, type: data.type ?? "image" };
}

// ---------- Temps réel (Socket.io) ----------
let socket: Socket | null = null;

export function getSocket(): Socket | null {
  const token = getToken();
  if (!token) return null;
  if (!socket) socket = io({ auth: { token } });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}

// ---------- Adaptation des données du backend vers le front ----------
export interface RawUser {
  username: string;
  first_name?: string | null;
  last_name?: string | null;
  badge?: string | null;
  role?: string | null;
}

export function displayName(u: RawUser): string {
  const full = [u.first_name, u.last_name].filter((x) => !!x && x.trim()).join(" ").trim();
  return full || u.username;
}

/** Un seul badge par membre : le rang (Plus, VIP, VIP+, Legend) ou, à défaut, « Modérateur ». */
export function toBadges(userId: string, badge?: string | null, role?: string | null): BadgeRow[] {
  const tier = TIERS.find((t) => t.type === badge);
  if (tier) return [{ id: `${userId}-${tier.type}`, type: tier.type, label: tier.label, description: tier.description }];
  if (role === "moderator") {
    return [{ id: `${userId}-moderator`, type: "moderator", label: "Modérateur", description: "Modérateur de Kalchat" }];
  }
  return [];
}
