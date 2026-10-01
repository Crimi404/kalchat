import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { BadgeList, KalBadge, TIERS, type BadgeRow, type BadgeType } from "@/components/KalBadge";
import { api, displayName, toBadges } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useOnline } from "@/lib/presence";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Administration — Kalchat" },
      { name: "description", content: "Panneau d'administration Kalchat : membres, badges, rôles et modération." },
      { property: "og:title", content: "Administration — Kalchat" },
      { property: "og:description", content: "Panneau d'administration Kalchat." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPage,
});

type Member = { id: string; username: string; display_name: string; avatar_url: string | null; is_suspended: boolean; is_admin: boolean; role: string; badge: string | null; badges: BadgeRow[] };

type Stats = { users: number; online: number; messages: number; posts: number; comments: number; photos: number; videos: number; blocked: number };

interface RawMember {
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  badge: string | null;
  role: string | null;
  is_admin: boolean;
  is_blocked: boolean;
}

function AdminPage() {
  const { isStaff, isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [warn, setWarn] = useState("");

  const online = useOnline();

  const stats = useQuery({
    queryKey: ["adminStats"],
    enabled: isStaff,
    refetchInterval: 30000,
    queryFn: () => api<Stats>("/admin/stats"),
  });

  const members = useQuery({
    queryKey: ["adminMembers", search],
    enabled: isStaff,
    queryFn: async () => {
      const rows = await api<RawMember[]>(`/admin/users?q=${encodeURIComponent(search.trim())}`);
      return rows.map((r): Member => ({
        id: r.id,
        username: r.username,
        display_name: displayName(r),
        avatar_url: r.avatar_url,
        is_suspended: r.is_blocked,
        is_admin: r.is_admin,
        role: r.is_admin ? "admin" : r.role === "moderator" ? "moderator" : "user",
        badge: r.badge,
        badges: toBadges(r.id, r.badge, r.role),
      }));
    },
  });

  if (!isStaff) return <div className="app-shell"><TopBar title="Administration" /><p className="py-20 text-center text-sm text-muted-foreground">Accès réservé à l'équipe Kalchat.</p><BottomNav /></div>;

  async function run(p: Promise<unknown>, ok: string) {
    try {
      await p;
      toast.success(ok);
      void qc.invalidateQueries({ queryKey: ["adminMembers"] });
      void qc.invalidateQueries({ queryKey: ["adminStats"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const btn = "rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary disabled:opacity-40";

  return (
    <div className="app-shell">
      <TopBar title="Administration" subtitle={isAdmin ? "Administrateur" : "Modérateur"} />
      <main className="space-y-3 p-3 pb-28">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un membre…" className="w-full rounded-xl border border-border bg-secondary/60 px-3 py-2 text-sm outline-none focus:border-primary" />
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Utilisateurs", value: stats.data?.users },
            { label: "En ligne", value: stats.data?.online ?? online.size },
            { label: "Messages", value: stats.data?.messages },
            { label: "Publications", value: stats.data?.posts },
            { label: "Photos", value: stats.data?.photos },
            { label: "Vidéos", value: stats.data?.videos },
          ].map((c) => (
            <div key={c.label} className="rounded-2xl border border-border bg-card p-3">
              <p className="text-2xl font-bold">{c.value ?? "…"}</p>
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </div>
          ))}
        </div>
        {stats.isError && <p className="text-xs text-destructive">Statistiques indisponibles : {(stats.error as Error).message}</p>}
        {members.isError && <p className="text-xs text-destructive">Impossible de charger les membres : {(members.error as Error).message}</p>}
        {members.isSuccess && members.data.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Aucun membre trouvé.</p>}
        {members.data?.map((m) => {
          const role = m.role;
          const protectedTarget = m.is_admin || m.id === user?.id;
          return (
            <div key={m.id} className="rounded-2xl border border-border bg-card p-3">
              <button className="flex w-full items-center gap-3 text-left" onClick={() => { setOpen(open === m.id ? null : m.id); setWarn(""); }}>
                {m.avatar_url ? <img src={m.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-full font-bold text-primary-foreground">{m.display_name.slice(0, 1).toUpperCase()}</span>}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-sm font-semibold">{m.display_name}<BadgeList badges={m.badges} size={14} /></p>
                  <p className="text-xs text-muted-foreground">@{m.username} · {role}{m.is_suspended && <span className="text-destructive"> · suspendu</span>}</p>
                </div>
              </button>
              {open === m.id && (
                <div className="mt-3 space-y-3 border-t border-border pt-3">
                  {isAdmin && (
                    <div>
                      <p className="mb-2 text-xs font-semibold text-muted-foreground">Badges</p>
                      <div className="flex flex-wrap gap-2">
                        {TIERS.map((t) => {
                          const has = m.badge === t.type;
                          return (
                            <button key={t.type} className={`${btn} flex items-center gap-1.5 ${has ? "border-primary bg-primary/10" : ""}`}
                              onClick={() => run(
                                api(`/admin/users/${m.id}/badge`, { method: "PATCH", body: { badge: has ? null : (t.type as BadgeType) } }),
                                has ? `Badge ${t.label} retiré` : `Badge ${t.label} attribué (remplace l'ancien)`,
                              )}>
                              <KalBadge badge={{ id: `${m.id}-${t.type}`, type: t.type, label: t.label, description: "" }} size={14} />
                              {has ? `Retirer ${t.label}` : t.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {isAdmin && !protectedTarget && (
                      <button className={btn} onClick={() => run(api(`/admin/users/${m.id}/role`, { method: "PATCH", body: { moderator: role !== "moderator" } }), role === "moderator" ? "Rôle modérateur retiré" : "Nommé modérateur")}>
                        {role === "moderator" ? "Retirer modérateur" : "Nommer modérateur"}
                      </button>
                    )}
                    {!protectedTarget && (
                      <button className={`${btn} text-destructive`} onClick={() => run(api(`/admin/users/${m.id}/block`, { method: "PATCH", body: { blocked: !m.is_suspended } }), m.is_suspended ? "Compte réactivé" : "Compte suspendu")}>
                        {m.is_suspended ? "Réactiver" : "Suspendre / bannir"}
                      </button>
                    )}
                  </div>
                  {m.id !== user?.id && (
                    <div className="space-y-2">
                      <textarea value={warn} onChange={(e) => setWarn(e.target.value)} maxLength={500} rows={2} placeholder="Avertissement officiel (le membre ne pourra pas répondre)" className="w-full rounded-xl border border-border bg-secondary/60 px-3 py-2 text-sm outline-none focus:border-primary" />
                      <button className={`${btn} text-destructive`} disabled={warn.trim().length < 3}
                        onClick={() => run(api(`/admin/users/${m.id}/warn`, { method: "POST", body: { message: warn } }), "Avertissement envoyé").then(() => setWarn(""))}>
                        Envoyer l'avertissement
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </main>
      <BottomNav />
    </div>
  );
}
