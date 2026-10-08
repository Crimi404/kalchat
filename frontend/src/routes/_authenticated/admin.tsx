import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { KoraAdmin } from "@/components/KoraAdmin";
import { BadgeList, KalBadge, TIERS, type BadgeRow, type BadgeType } from "@/components/KalBadge";
import { api, displayName, toBadges } from "@/lib/api";
import { REPORT_REASON_LABEL } from "@/lib/reports";
import { timeAgo } from "@/lib/social";
import { Link } from "@tanstack/react-router";
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

type StorageInfo = { total_files: number; total_bytes: number; orphan_files: number; orphan_bytes: number; removed: number };

function mo(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

type Stats = { users: number; online: number; messages: number; posts: number; comments: number; photos: number; videos: number; blocked: number; open_reports: number };

type Report = {
  id: string;
  target_type: "post" | "comment" | "message" | "user";
  target_id: string;
  reason: string;
  details: string | null;
  snapshot: string | null;
  status: "open" | "resolved" | "dismissed";
  created_at: string;
  handled_by_username: string | null;
  reporter_username: string;
  target_user_id: string | null;
  target_username: string | null;
  target_is_admin: boolean;
  report_count: number;
  target_exists: boolean;
  comment_post_id: string | null;
};

const TARGET_LABEL: Record<Report["target_type"], string> = { post: "Publication", comment: "Commentaire", message: "Message privé", user: "Compte" };

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
  const [tab, setTab] = useState<"members" | "reports">("members");
  const [closed, setClosed] = useState(false);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);

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

  const reports = useQuery({
    queryKey: ["adminReports", closed],
    enabled: isStaff && tab === "reports",
    queryFn: () => api<Report[]>(`/admin/reports?status=${closed ? "closed" : "open"}`),
  });

  if (!isStaff) return <div className="app-shell"><TopBar title="Administration" /><p className="py-20 text-center text-sm text-muted-foreground">Accès réservé à l'équipe Kalchat.</p><BottomNav /></div>;

  async function run(p: Promise<unknown>, ok: string) {
    try {
      await p;
      toast.success(ok);
      void qc.invalidateQueries({ queryKey: ["adminMembers"] });
      void qc.invalidateQueries({ queryKey: ["adminStats"] });
      void qc.invalidateQueries({ queryKey: ["adminReports"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const btn = "rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary disabled:opacity-40";

  return (
    <div className="app-shell">
      <TopBar title="Administration" subtitle={isAdmin ? "Administrateur" : "Modérateur"} />
      <main className="space-y-3 p-3 pb-28">
        <div className="grid grid-cols-2 gap-1 rounded-full border border-border bg-secondary/40 p-1 text-sm font-semibold">
          <button onClick={() => setTab("members")} className={`rounded-full py-1.5 ${tab === "members" ? "bg-card text-foreground shadow" : "text-muted-foreground"}`}>Membres</button>
          <button onClick={() => setTab("reports")} className={`rounded-full py-1.5 ${tab === "reports" ? "bg-card text-foreground shadow" : "text-muted-foreground"}`}>
            Signalements{stats.data?.open_reports ? <span className="ml-1.5 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] text-white">{stats.data.open_reports}</span> : null}
          </button>
        </div>
        {tab === "reports" && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button onClick={() => setClosed(false)} className={`${btn} ${!closed ? "border-primary bg-primary/10" : ""}`}>À traiter</button>
              <button onClick={() => setClosed(true)} className={`${btn} ${closed ? "border-primary bg-primary/10" : ""}`}>Traités</button>
            </div>
            {reports.isError && <p className="text-xs text-destructive">Impossible de charger les signalements : {(reports.error as Error).message}</p>}
            {reports.isSuccess && reports.data.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{closed ? "Aucun signalement traité." : "Aucun signalement à traiter 🎉"}</p>}
            {reports.data?.map((r) => (
              <div key={r.id} className="space-y-2 rounded-2xl border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{TARGET_LABEL[r.target_type]} · {REPORT_REASON_LABEL[r.reason] ?? r.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      par @{r.reporter_username} · {timeAgo(r.created_at)}
                      {r.target_username && <> · visé : <Link to="/u/$username" params={{ username: r.target_username }} className="text-primary hover:underline">@{r.target_username}</Link></>}
                    </p>
                  </div>
                  {r.report_count > 1 && <span className="shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-bold text-destructive">{r.report_count} signalements</span>}
                </div>
                {r.snapshot && <p className="max-h-40 overflow-y-auto whitespace-pre-line break-words rounded-xl bg-secondary/50 p-2.5 text-xs text-foreground">{r.snapshot}</p>}
                {r.details && <p className="text-xs italic text-muted-foreground">« {r.details} »</p>}
                {!r.target_exists && r.target_type !== "user" && <p className="text-xs text-muted-foreground">Ce contenu a déjà été supprimé.</p>}

                {r.status === "open" ? (
                  <div className="flex flex-wrap gap-2 border-t border-border pt-2">
                    {r.target_type === "post" && r.target_exists && (
                      <>
                        <Link to="/post/$id" params={{ id: r.target_id }} className={btn}>Voir</Link>
                        <button className={`${btn} text-destructive`} onClick={() => run(api(`/posts/${r.target_id}`, { method: "DELETE" }).then(() => api(`/admin/reports/${r.id}`, { method: "PATCH", body: { status: "resolved" } })), "Publication supprimée")}>Supprimer la publication</button>
                      </>
                    )}
                    {r.target_type === "comment" && r.target_exists && (
                      <>
                        {r.comment_post_id && <Link to="/post/$id" params={{ id: r.comment_post_id }} className={btn}>Voir</Link>}
                        <button className={`${btn} text-destructive`} onClick={() => run(api(`/posts/comments/${r.target_id}`, { method: "DELETE" }).then(() => api(`/admin/reports/${r.id}`, { method: "PATCH", body: { status: "resolved" } })), "Commentaire supprimé")}>Supprimer le commentaire</button>
                      </>
                    )}
                    {r.target_user_id && !r.target_is_admin && r.target_user_id !== user?.id && (
                      <button className={btn} onClick={() => { setTab("members"); setSearch(r.target_username ?? ""); setOpen(r.target_user_id); setWarn(""); }}>Avertir / suspendre le membre</button>
                    )}
                    <button className={btn} onClick={() => run(api(`/admin/reports/${r.id}`, { method: "PATCH", body: { status: "resolved" } }), "Signalement clôturé")}>Marquer comme traité</button>
                    <button className={btn} onClick={() => run(api(`/admin/reports/${r.id}`, { method: "PATCH", body: { status: "dismissed" } }), "Classé sans suite")}>Sans suite</button>
                  </div>
                ) : (
                  <p className="border-t border-border pt-2 text-xs text-muted-foreground">
                    {r.status === "resolved" ? "Traité" : "Classé sans suite"}{r.handled_by_username ? ` par @${r.handled_by_username}` : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        {tab === "members" && <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un membre…" className="w-full rounded-xl border border-border bg-secondary/60 px-3 py-2 text-sm outline-none focus:border-primary" />}
        {tab === "members" && <div className="grid grid-cols-2 gap-2">
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
        </div>}
        {tab === "members" && isAdmin && <KoraAdmin />}
        {tab === "members" && isAdmin && (
          <div className="rounded-2xl border border-border bg-card p-3">
            <p className="text-sm font-semibold">Stockage des médias</p>
            {storage && (
              <p className="mt-1 text-xs text-muted-foreground">
                {storage.total_files} fichier{storage.total_files > 1 ? "s" : ""} ({mo(storage.total_bytes)}) ·{" "}
                {storage.removed > 0
                  ? `${storage.removed} fichier(s) inutile(s) supprimé(s)`
                  : storage.orphan_files > 0
                    ? `${storage.orphan_files} fichier(s) inutile(s) (${mo(storage.orphan_bytes)})`
                    : "aucun fichier inutile"}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <button
                disabled={storageBusy}
                className={btn}
                onClick={async () => {
                  setStorageBusy(true);
                  try { setStorage(await api<StorageInfo>("/admin/storage")); } catch (e) { toast.error((e as Error).message); } finally { setStorageBusy(false); }
                }}
              >
                Vérifier
              </button>
              <button
                disabled={storageBusy || (storage !== null && storage.orphan_files === 0)}
                className={btn}
                onClick={async () => {
                  setStorageBusy(true);
                  try { setStorage(await api<StorageInfo>("/admin/storage/cleanup", { method: "POST" })); toast.success("Stockage nettoyé"); } catch (e) { toast.error((e as Error).message); } finally { setStorageBusy(false); }
                }}
              >
                Nettoyer
              </button>
            </div>
          </div>
        )}
        {stats.isError && <p className="text-xs text-destructive">Statistiques indisponibles : {(stats.error as Error).message}</p>}
        {tab === "members" && members.isError && <p className="text-xs text-destructive">Impossible de charger les membres : {(members.error as Error).message}</p>}
        {tab === "members" && members.isSuccess && members.data.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Aucun membre trouvé.</p>}
        {tab === "members" && members.data?.map((m) => {
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
