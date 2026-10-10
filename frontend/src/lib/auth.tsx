import { clearAppLock } from "@/lib/applock";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, closeSocket, displayName, getToken, setToken, toBadges } from "@/lib/api";
import { unregisterPush } from "@/lib/push";
import type { BadgeRow } from "@/components/KalBadge";

export type AppRole = "admin" | "moderator" | "user";

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  bio: string;
  avatar_url: string | null;
  cover_url: string | null;
  location: string | null;
  status_text: string | null;
  is_suspended: boolean;
  created_at: string;
  badges: BadgeRow[];
  theme: "dark" | "light";
  /** Date (ISO) à partir de laquelle le nom d'utilisateur pourra de nouveau être changé ; null = possible maintenant. */
  username_next_change_at: string | null;
  /** Qui peut voir que je suis en ligne. */
  privacy_online: "everyone" | "friends" | "nobody";
  /** Confirmations de lecture (« Vu ») activées ou non. */
  read_receipts: boolean;
  /** Durée par défaut des messages éphémères des nouvelles conversations (secondes, 0 = désactivé). */
  default_ephemeral: number;
}

interface RawMe {
  id: string;
  username: string;
  avatar_url: string | null;
  cover_url: string | null;
  location: string | null;
  status_text: string | null;
  bio: string | null;
  badge: string | null;
  role: string | null;
  is_admin: boolean;
  is_blocked: number | boolean;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  theme?: string | null;
  username_next_change_at?: string | null;
  privacy_online?: string | null;
  read_receipts?: number | boolean | null;
  default_ephemeral?: number | null;
}

export interface SignUpInput {
  first_name: string;
  last_name: string;
  username: string;
  password: string;
  avatar_url?: string | null;
}

interface AuthValue {
  loading: boolean;
  user: { id: string; username: string } | null;
  profile: Profile | null;
  role: AppRole | null;
  isStaff: boolean;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  /** Ouvre la session avec un jeton déjà reçu du serveur (après validation d'un code par email). */
  signInWithToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

function toProfile(m: RawMe): Profile {
  return {
    id: m.id,
    username: m.username,
    display_name: displayName(m),
    first_name: m.first_name,
    last_name: m.last_name,
    bio: m.bio ?? "",
    avatar_url: m.avatar_url,
    cover_url: m.cover_url,
    location: m.location,
    status_text: m.status_text,
    is_suspended: !!m.is_blocked,
    created_at: m.created_at,
    badges: toBadges(m.id, m.badge, m.role),
    theme: m.theme === "light" ? "light" : "dark",
    username_next_change_at: m.username_next_change_at ?? null,
    privacy_online: m.privacy_online === "friends" || m.privacy_online === "nobody" ? m.privacy_online : "everyone",
    read_receipts: m.read_receipts === undefined || m.read_receipts === null ? true : !!Number(m.read_receipts),
    default_ephemeral: Number(m.default_ephemeral) || 0,
  };
}

function toRole(m: RawMe): AppRole {
  if (m.is_admin) return "admin";
  return m.role === "moderator" ? "moderator" : "user";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!getToken()) {
      setProfile(null);
      setRole(null);
      return;
    }
    try {
      const me = await api<RawMe>("/auth/me");
      setProfile(toProfile(me));
      setRole(toRole(me));
    } catch {
      setProfile(null);
      setRole(null);
    }
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
    const onLogout = () => {
      closeSocket();
      setProfile(null);
      setRole(null);
      qc.clear();
    };
    window.addEventListener("kalchat:logout", onLogout);
    return () => window.removeEventListener("kalchat:logout", onLogout);
  }, [load, qc]);

  const value: AuthValue = {
    loading,
    user: profile ? { id: profile.id, username: profile.username } : null,
    profile,
    role,
    isStaff: role === "admin" || role === "moderator",
    isAdmin: role === "admin",
    refresh: load,
    signIn: async (username, password) => {
      const res = await api<{ token: string }>("/auth/login", { method: "POST", body: { username, password } });
      setToken(res.token);
      await load();
    },
    signUp: async (input) => {
      const res = await api<{ token: string }>("/auth/register", { method: "POST", body: input });
      setToken(res.token);
      await load();
    },
    signInWithToken: async (token) => {
      setToken(token);
      await load();
    },
    signOut: async () => {
      void unregisterPush(); // cet appareil ne reçoit plus les notifications de ce compte
      clearAppLock();
      setToken(null);
      closeSocket();
      setProfile(null);
      setRole(null);
      qc.clear();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans AuthProvider");
  return ctx;
}
