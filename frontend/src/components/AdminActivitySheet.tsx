import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api, displayName, toBadges } from "@/lib/api";
import { useBackHandler } from "@/lib/back";
import { BadgeList } from "@/components/KalBadge";
import { MiniAvatar } from "@/components/MiniAvatar";

export type ActivityMember = {
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  badge: string | null;
  role: string | null;
  is_admin: boolean;
  created_at: string;
  today_seconds: number;
  week_seconds: number;
  days_active_7d: number;
  total_seconds: number;
  last_day: string | null;
  online: boolean;
  active: boolean;
};

type ActivityData = {
  tracking_since: string | null;
  active_min_days: number;
  summary: { online: number; active_7d: number; today_seconds: number; week_seconds: number };
  members: ActivityMember[];
};

/** 0 → « 0 min », 540 → « 9 min », 3900 → « 1 h 05 ». */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return s === 0 ? "0 min" : "< 1 min";
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

function lastSeen(m: ActivityMember): string {
  if (m.online) return "En ligne";
  if (!m.last_day) return "Pas encore mesuré";
  const today = new Date().toISOString().slice(0, 10);
  if (m.last_day === today) return "Vu aujourd'hui";
  const days = Math.round((new Date(today).getTime() - new Date(m.last_day).getTime()) / 86_400_000);
  return days === 1 ? "Vu hier" : `Vu il y a ${days} j`;
}

type Mode = "online" | "users";
type Filter = "all" | "active" | "inactive";

/**
 * Panneau de détails ouvert depuis les cases « En ligne » et « Utilisateurs » de la page Administration.
 * Pas de nouvelle page : une feuille qui monte du bas, comme les autres panneaux de l'appli.
 */
export function AdminActivitySheet({ mode, onClose }: { mode: Mode | null; onClose: () => void }) {
  const open = mode !== null;
  const [filter, setFilter] = useState<Filter>("all");
  useBackHandler(onClose, open);

  const data = useQuery({
    queryKey: ["adminActivity"],
    enabled: open,
    refetchInterval: open ? 30_000 : false,
    queryFn: () => api<ActivityData>("/admin/activity"),
  });

  if (!open || typeof document === "undefined") return null;

  const all = data.data?.members ?? [];
  const list =
    mode === "online"
      ? all.filter((m) => m.online)
      : all.filter((m) => (filter === "active" ? m.active : filter === "inactive" ? !m.active : true));
  const sum = data.data?.summary;
  const since = data.data?.tracking_since ? new Date(data.data.tracking_since).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : null;

  const stat = "rounded-2xl border border-border bg-background p-2.5 text-center";

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div className="animate-fade-in absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="animate-sheet-up relative flex max-h-[88vh] w-full max-w-md flex-col rounded-t-3xl border-t border-border bg-card p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold text-foreground">{mode === "online" ? "En ligne maintenant" : "Utilisateurs et activité"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {since ? `Temps passé mesuré depuis le ${since}.` : "Le temps passé commence à être mesuré."}
            </p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 hover:bg-secondary"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className={stat}>
            <p className="text-lg font-bold">{sum ? sum.online : "…"}</p>
            <p className="text-[11px] text-muted-foreground">En ligne</p>
          </div>
          <div className={stat}>
            <p className="text-lg font-bold">{sum ? sum.active_7d : "…"}</p>
            <p className="text-[11px] text-muted-foreground">Actifs 7 j</p>
          </div>
          <div className={stat}>
            <p className="text-lg font-bold">{sum ? fmtDuration(sum.today_seconds) : "…"}</p>
            <p className="text-[11px] text-muted-foreground">Temps aujourd'hui</p>
          </div>
        </div>

        {mode === "users" && (
          <div className="mt-3 flex gap-2">
            {([
              ["all", "Tous"],
              ["active", "Actifs 7 j"],
              ["inactive", "Inactifs"],
            ] as [Filter, string][]).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                aria-pressed={filter === k}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === k ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {data.isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Chargement…</p>}
          {data.isError && <p className="py-8 text-center text-sm text-destructive">{(data.error as Error).message}</p>}
          {data.isSuccess && list.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">{mode === "online" ? "Personne n'est en ligne pour le moment." : "Aucun membre dans cette liste."}</p>
          )}
          {list.map((m) => {
            const name = displayName(m);
            return (
              <div key={m.id} className="flex items-center gap-3 rounded-2xl border border-border p-2.5">
                <div className="relative">
                  <MiniAvatar url={m.avatar_url} name={name} size={40} />
                  {m.online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card bg-emerald-500" aria-label="En ligne" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-sm font-semibold">
                    {name}
                    <BadgeList badges={toBadges(m.id, m.badge, m.role)} size={14} />
                    {m.active && <span className="ml-1 shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">Actif</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">@{m.username} · {lastSeen(m)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold">{fmtDuration(m.week_seconds)}</p>
                  <p className="text-[11px] text-muted-foreground">7 j · {m.days_active_7d}/7 jours</p>
                  {mode === "users" && <p className="text-[11px] text-muted-foreground">Aujourd'hui {fmtDuration(m.today_seconds)}</p>}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">Actif = au moins {data.data?.active_min_days ?? 1} jour d'utilisation sur les 7 derniers jours.</p>
      </div>
    </div>,
    document.body,
  );
}
