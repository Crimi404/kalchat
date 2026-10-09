import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, LogOut, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { BottomNav } from "@/components/BottomNav";
import { CommunityPhotoPicker } from "@/components/CommunityPhotoPicker";
import { MiniAvatar } from "@/components/MiniAvatar";
import { PostCard } from "@/components/PostCard";
import { useAuth } from "@/lib/auth";
import {
  deleteCommunity,
  fetchCommunity,
  fetchCommunityMembers,
  isActiveMember,
  isCommunityManager,
  joinCommunity,
  leaveCommunity,
  manageCommunityMember,
  memberDisplayName,
  updateCommunity,
  type Community,
  type CommunityMember,
  type JoinMode,
  type MemberAction,
} from "@/lib/communities";
import { fetchCommunityPosts } from "@/lib/social";

export const Route = createFileRoute("/_authenticated/communaute/$id")({
  head: () => ({ meta: [{ title: "Communauté — Kalchat" }] }),
  component: CommunityPage,
});

const ROLE_LABEL = { owner: "Propriétaire", admin: "Administrateur", member: "" } as const;

function EditForm({ c, onDone }: { c: Community; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description ?? "");
  const [mode, setMode] = useState<JoinMode>(c.join_mode);
  const [avatar, setAvatar] = useState<string | null>(c.avatar_url);
  const save = useMutation({
    mutationFn: () => updateCommunity(c.id, { name, description, join_mode: mode, avatar_url: avatar }),
    onSuccess: () => {
      toast.success("Communauté mise à jour");
      void qc.invalidateQueries({ queryKey: ["community", c.id] });
      void qc.invalidateQueries({ queryKey: ["communities"] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const field = "w-full rounded-xl border border-border bg-secondary/60 px-3 py-2 text-sm outline-none focus:border-primary";
  return (
    <div className="space-y-3 border-b border-border px-4 py-3">
      <CommunityPhotoPicker url={avatar} name={name} onChange={setAvatar} />
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={field} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={3} className={field} />
      <div className="grid grid-cols-2 gap-2 text-xs font-semibold">
        {([["open", "Ouverte"], ["approval", "Sur validation"]] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`rounded-xl border p-2.5 text-sm ${mode === value ? "border-primary bg-primary/15" : "border-border bg-secondary/40"}`}>{label}</button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={onDone} className="flex-1 rounded-full border border-border py-2 text-sm font-semibold hover:bg-secondary">Annuler</button>
        <button disabled={save.isPending || name.trim().length < 3} onClick={() => save.mutate()} className="brand-gradient flex-1 rounded-full py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">Enregistrer</button>
      </div>
    </div>
  );
}

function MemberRow({ m, c, pending }: { m: CommunityMember; c: Community; pending?: boolean }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isOwnerViewer = c.my_role === "owner";
  const manager = isCommunityManager(c);
  const act = useMutation({
    mutationFn: (action: MemberAction) => manageCommunityMember(c.id, m.id, action),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["communityMembers", c.id] });
      void qc.invalidateQueries({ queryKey: ["community", c.id] });
      void qc.invalidateQueries({ queryKey: ["communities"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const btn = "rounded-full border border-border px-3 py-1 text-xs font-semibold hover:bg-secondary disabled:opacity-50";
  const canRemove = manager && m.role !== "owner" && m.id !== user?.id && (m.role === "member" || isOwnerViewer);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Link to="/u/$username" params={{ username: m.username }} className="flex min-w-0 flex-1 items-center gap-3">
        <MiniAvatar url={m.avatar_url} name={memberDisplayName(m)} size={40} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-foreground">{memberDisplayName(m)}</span>
          <span className="block truncate text-xs text-muted-foreground">@{m.username}{ROLE_LABEL[m.role] ? ` · ${ROLE_LABEL[m.role]}` : ""}</span>
        </span>
      </Link>
      <div className="flex shrink-0 gap-1.5">
        {pending ? (
          <>
            <button disabled={act.isPending} onClick={() => act.mutate("approve")} className="brand-gradient rounded-full px-3 py-1 text-xs font-bold text-primary-foreground disabled:opacity-50">Accepter</button>
            <button disabled={act.isPending} onClick={() => act.mutate("reject")} className={btn}>Refuser</button>
          </>
        ) : (
          <>
            {isOwnerViewer && m.role !== "owner" && m.id !== user?.id && (
              <button disabled={act.isPending} onClick={() => act.mutate(m.role === "admin" ? "demote" : "promote")} className={btn}>{m.role === "admin" ? "Retirer admin" : "Nommer admin"}</button>
            )}
            {canRemove && (
              <button disabled={act.isPending} onClick={() => { if (window.confirm(`Retirer ${memberDisplayName(m)} de la communauté ?`)) act.mutate("remove"); }} className={`${btn} text-destructive`}>Retirer</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CommunityPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isStaff } = useAuth();
  const [tab, setTab] = useState<"posts" | "members">("posts");
  const [editing, setEditing] = useState(false);

  const community = useQuery({ queryKey: ["community", id], queryFn: () => fetchCommunity(id), retry: false });
  const c = community.data;
  const member = isActiveMember(c);
  const manager = isCommunityManager(c);
  const canSee = member || isStaff;

  const posts = useQuery({ queryKey: ["communityPosts", id], queryFn: () => fetchCommunityPosts(id), enabled: !!c && canSee });
  const members = useQuery({ queryKey: ["communityMembers", id], queryFn: () => fetchCommunityMembers(id), enabled: !!c && canSee && tab === "members" });

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["community", id] });
    void qc.invalidateQueries({ queryKey: ["communities"] });
    void qc.invalidateQueries({ queryKey: ["communityPosts", id] });
  }
  const join = useMutation({
    mutationFn: () => joinCommunity(id),
    onSuccess: (r) => { toast.success(r.status === "pending" ? "Demande envoyée aux administrateurs" : "Tu as rejoint la communauté"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const leave = useMutation({
    mutationFn: () => leaveCommunity(id),
    onSuccess: () => { toast.success(member ? "Tu as quitté la communauté" : "Demande annulée"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteCommunity(id),
    onSuccess: () => { toast.success("Communauté supprimée"); void qc.invalidateQueries({ queryKey: ["communities"] }); void navigate({ to: "/" }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const back = (
    <button onClick={() => window.history.back()} aria-label="Retour" className="rounded-full p-2 hover:bg-secondary"><ArrowLeft className="h-5 w-5" /></button>
  );

  if (community.isLoading) {
    return <div className="app-shell"><div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div><BottomNav /></div>;
  }
  if (community.isError || !c) {
    return (
      <div className="app-shell">
        <div className="flex items-center gap-2 px-2 py-2">{back}<p className="font-bold">Communauté</p></div>
        <p className="px-6 py-16 text-center text-sm text-muted-foreground">Cette communauté n'existe plus ou a été supprimée.</p>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="flex items-center gap-2 px-2 py-2">
        {back}
        <p className="min-w-0 flex-1 truncate text-base font-bold">{c.name}</p>
        {manager && <button onClick={() => setEditing((v) => !v)} aria-label="Modifier la communauté" className="rounded-full p-2 hover:bg-secondary"><Pencil className="h-5 w-5" /></button>}
      </header>

      <section className="flex items-start gap-3 px-4 pb-3">
        <MiniAvatar url={c.avatar_url} name={c.name} size={64} group />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" /> {c.member_count} membre{c.member_count > 1 ? "s" : ""} · {c.join_mode === "approval" ? "sur validation" : "ouverte"}</p>
          {c.description && <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{c.description}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {!c.my_status && (
              <button disabled={join.isPending} onClick={() => join.mutate()} className="brand-gradient rounded-full px-5 py-2 text-sm font-bold text-primary-foreground disabled:opacity-60">
                {c.join_mode === "approval" ? "Demander à rejoindre" : "Rejoindre"}
              </button>
            )}
            {c.my_status === "pending" && (
              <button disabled={leave.isPending} onClick={() => leave.mutate()} className="rounded-full border border-border px-5 py-2 text-sm font-semibold hover:bg-secondary">Demande envoyée · Annuler</button>
            )}
            {member && c.my_role !== "owner" && (
              <button disabled={leave.isPending} onClick={() => { if (window.confirm("Quitter cette communauté ?")) leave.mutate(); }} className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary"><LogOut className="h-4 w-4" /> Quitter</button>
            )}
            {(c.my_role === "owner" || isStaff) && (
              <button disabled={remove.isPending} onClick={() => { if (window.confirm("Supprimer définitivement cette communauté et toutes ses publications ?")) remove.mutate(); }} className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold text-destructive hover:bg-secondary"><Trash2 className="h-4 w-4" /> Supprimer</button>
            )}
          </div>
        </div>
      </section>

      {editing && manager && <EditForm c={c} onDone={() => setEditing(false)} />}

      {!canSee ? (
        <p className="border-t border-border px-6 py-14 text-center text-sm text-muted-foreground">
          {c.my_status === "pending" ? "Ta demande est en attente. Tu verras les publications dès qu'un administrateur l'aura acceptée." : "Rejoins la communauté pour voir et partager ses publications."}
        </p>
      ) : (
        <>
          <div className="flex border-b border-border">
            {([["posts", "Publications"], ["members", "Membres"]] as const).map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} aria-pressed={tab === key} className={`relative flex-1 py-3 text-sm font-semibold ${tab === key ? "text-foreground" : "text-muted-foreground"}`}>
                {label}{key === "members" && c.pending_count > 0 && <span className="ml-1.5 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-white">{c.pending_count}</span>}
                {tab === key && <span className="absolute bottom-0 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-primary" />}
              </button>
            ))}
          </div>
          <main className="pb-28">
            {tab === "posts" ? (
              <>
                {member && (
                  <Link to="/nouveau" search={{ communaute: c.id }} className="mx-4 my-3 block rounded-full border border-border bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
                    Partager quelque chose avec la communauté…
                  </Link>
                )}
                {posts.isLoading ? (
                  <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
                ) : !posts.data?.length ? (
                  <p className="px-6 py-16 text-center text-sm text-muted-foreground">Aucune publication pour le moment. Lance la discussion !</p>
                ) : (
                  posts.data.map((p) => <PostCard key={p.id} post={p} canModerate={manager} />)
                )}
              </>
            ) : members.isLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            ) : (
              <>
                {!!members.data?.pending.length && (
                  <section className="border-b border-border pb-2">
                    <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Demandes en attente</p>
                    {members.data.pending.map((m) => <MemberRow key={m.id} m={m} c={c} pending />)}
                  </section>
                )}
                {members.data?.members.map((m) => <MemberRow key={m.id} m={m} c={c} />)}
              </>
            )}
          </main>
        </>
      )}
      <BottomNav />
    </div>
  );
}
